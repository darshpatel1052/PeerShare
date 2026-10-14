package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/config"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/mediasvc"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/ratelimit"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type App struct {
	Media      *mediasvc.Client
	Google     *googleAuth
	Config     config.Config
	Store      *store.Store
	Redis      *redis.Client
	Hasher     *auth.Hasher
	Limiter    *ratelimit.Limiter
	Logger     *slog.Logger
	metrics    requestMetrics
	analytics  *analyticsCache
	dummyHash  string
	partSlots  chan struct{}
	imageSlots chan struct{}
}
type requestIDKey struct{}
type identityKey struct{}
type APIError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id"`
}

func New(ctx context.Context, cfg config.Config, db *store.Store, cache *redis.Client, logger *slog.Logger) (*App, error) {
	for _, dir := range []string{cfg.UploadDir, cfg.MediaDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, err
		}
	}
	if cfg.MediaAddress == "" {
		for _, tool := range []string{"ffmpeg", "ffprobe"} {
			if _, err := exec.LookPath(tool); err != nil {
				return nil, err
			}
		}
	}
	var media *mediasvc.Client
	if cfg.MediaAddress != "" {
		var err error
		media, err = mediasvc.Dial(cfg.MediaAddress, cfg.CatalogRPCToken)
		if err != nil {
			return nil, err
		}
	}
	db.Distributed = media != nil
	hasher := auth.NewHasher(2)
	dummy, err := hasher.Hash(ctx, "dummy credential for nonexistent accounts")
	if err != nil {
		return nil, err
	}
	analytics, err := newAnalyticsCache(cfg.AnalyticsRedisURL)
	if err != nil {
		if media != nil {
			_ = media.Conn.Close()
		}
		return nil, errors.New("invalid ANALYTICS_REDIS_URL")
	}
	return &App{analytics: analytics, Media: media, Google: newGoogleAuth(cfg), Config: cfg, Store: db, Redis: cache, Hasher: hasher, Logger: logger, dummyHash: dummy, partSlots: make(chan struct{}, 12), imageSlots: make(chan struct{}, 1), Limiter: &ratelimit.Limiter{Client: cache, Prefix: cfg.RatePrefix, Limit: cfg.AuthLimit, Window: time.Minute}}, nil
}

func (a *App) Close() {
	if a.analytics.client != nil {
		_ = a.analytics.client.Close()
	}
	if a.Media != nil {
		_ = a.Media.Conn.Close()
	}
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /metrics", a.operationalMetrics)
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /health/ready", a.ready)
	mux.HandleFunc("POST /api/v1/auth/register", a.register)
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.HandleFunc("POST /api/v1/auth/logout", a.logout)
	mux.Handle("POST /api/v1/auth/logout-all", a.requireIdentity(http.HandlerFunc(a.logoutAll)))
	mux.Handle("GET /api/v1/me", a.requireIdentity(http.HandlerFunc(a.me)))
	mux.Handle("POST /api/v1/channels", a.requireIdentity(http.HandlerFunc(a.createChannel)))
	mux.Handle("PATCH /api/v1/channels/{id}", a.requireIdentity(http.HandlerFunc(a.editChannel)))
	mux.HandleFunc("GET /api/v1/channels/{id}", a.getChannel)
	mux.HandleFunc("GET /api/v1/videos", a.listVideos)
	mux.HandleFunc("GET /api/v1/videos/{id}", a.getVideo)
	mux.HandleFunc("GET /api/v1/media/{key...}", a.getProcessedMedia)
	a.registerUploads(mux)
	a.registerImages(mux)
	a.registerGoogle(mux)
	a.registerLibrary(mux)
	a.registerPlayback(mux)
	for path, allowed := range map[string]string{"/api/v1/auth/register": "POST", "/api/v1/auth/login": "POST", "/api/v1/auth/logout": "POST", "/api/v1/auth/logout-all": "POST", "/api/v1/me": "GET, HEAD", "/api/v1/channels": "POST", "/api/v1/channels/{id}": "GET, HEAD, PATCH", "/api/v1/videos": "GET, HEAD", "/api/v1/videos/{id}": "GET, HEAD, PATCH, DELETE"} {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Allow", allowed)
			a.error(w, r, 405, "method_not_allowed", "This endpoint does not support that HTTP method.")
		})
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		a.error(w, r, 404, "not_found", "The requested endpoint was not found.")
	})
	return a.requestScope(mux)
}

func (a *App) requestScope(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		id := uuid.NewString()
		timeout := 8 * time.Second
		if strings.Contains(r.URL.Path, "/parts/") || strings.HasSuffix(r.URL.Path, "/complete") {
			timeout = 2 * time.Minute
		}
		ctx, cancel := context.WithTimeout(context.WithValue(r.Context(), requestIDKey{}, id), timeout)
		defer cancel()
		r = r.WithContext(ctx)
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if a.Config.ReplicaDiagnostics {
			name, _ := os.Hostname()
			w.Header().Set("X-PeerScreen-Replica", name)
		}
		w.Header().Set("Cache-Control", "no-store")
		tracked := &responseWriter{ResponseWriter: w, status: 200}
		defer func() {
			if recover() != nil {
				a.error(tracked, r, 500, "internal_error", "The request could not be completed.")
				a.Logger.Error("handler_panic", "request_id", id)
			}
			a.Logger.Info("http_request", "request_id", id, "method", r.Method, "route", r.Pattern, "status", tracked.status, "duration_ms", time.Since(started).Milliseconds())
			if r.URL.Path != "/metrics" {
				a.metrics.observe(r.Method, r.Pattern, tracked.status, time.Since(started).Seconds())
			}
		}()
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" && r.Header.Get("Origin") != a.Config.AppOrigin {
			a.error(tracked, r, 403, "origin_not_allowed", "The request must come from the configured application origin.")
			return
		}
		next.ServeHTTP(tracked, r)
	})
}

type responseWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *responseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}
func (w *responseWriter) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(200)
	}
	return w.ResponseWriter.Write(body)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (a *App) error(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	id, _ := r.Context().Value(requestIDKey{}).(string)
	writeJSON(w, status, APIError{Code: code, Message: message, RequestID: id})
}
func (a *App) storeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		a.error(w, r, 404, "not_found", "This resource is unavailable.")
	case errors.Is(err, store.ErrEmailTaken):
		a.error(w, r, 409, "email_taken", "That email is already registered. Try signing in.")
	case errors.Is(err, store.ErrHandleTaken):
		a.error(w, r, 409, "handle_taken", "That channel handle is already in use.")
	case errors.Is(err, store.ErrChannelExists):
		a.error(w, r, 409, "channel_exists", "You already have a channel. Reload your account to view it.")
	case errors.Is(err, store.ErrNotOwner):
		a.error(w, r, 403, "not_owner", "You can only edit your own channel.")
	case errors.Is(err, store.ErrRevisionConflict):
		subject := "video"
		if strings.HasPrefix(r.URL.Path, "/api/v1/channels/") {
			subject = "channel"
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/playlists/") {
			subject = "playlist"
		}
		a.error(w, r, 409, "revision_conflict", "This "+subject+" changed since you opened it. Reload before editing.")
	case errors.Is(err, store.ErrLibraryLimit):
		a.error(w, r, 422, "library_capacity", "Your library has reached its limit. Remove an item before adding another.")
	case errors.Is(err, store.ErrLibraryConflict):
		a.error(w, r, 409, "library_conflict", "This request conflicts with the saved playlist. Reload before trying again.")
	case errors.Is(err, store.ErrPlaybackConflict):
		a.error(w, r, 409, "telemetry_conflict", "This playback batch conflicts with an accepted sequence or cumulative counter.")
	case errors.Is(err, store.ErrPlaybackInvalid):
		a.error(w, r, 422, "invalid_telemetry", "Measurements exceed this playback session's limits or expected state.")
	case errors.Is(err, store.ErrPlaybackCapacity):
		a.error(w, r, 429, "telemetry_capacity", "Playback measurement capacity is currently full.")
	case errors.Is(err, store.ErrUploadLimit):
		a.error(w, r, 429, "upload_capacity", "Upload capacity is currently full. Finish or cancel an existing upload first.")
	case errors.Is(err, store.ErrUploadConflict):
		a.error(w, r, 409, "upload_conflict", "The upload state changed. Reload the upload before retrying.")
	default:
		a.error(w, r, 503, "dependency_unavailable", "The service is temporarily unavailable. Please retry.")
	}
}
func (a *App) decode(w http.ResponseWriter, r *http.Request, target any) bool {
	contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || contentType != "application/json" {
		a.error(w, r, 415, "json_required", "Send an application/json request body.")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	err = decoder.Decode(target)
	if err == nil {
		err = decoder.Decode(new(any))
		if err == io.EOF {
			return true
		}
	}
	var oversized *http.MaxBytesError
	if errors.As(err, &oversized) {
		a.error(w, r, 413, "body_too_large", "The request body exceeds 16 KiB.")
	} else {
		a.error(w, r, 400, "invalid_json", "Send one JSON object using only the supported fields.")
	}
	return false
}
func (a *App) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if a.Store.Pool.Ping(ctx) != nil || a.Redis.Ping(ctx).Err() != nil {
		writeJSON(w, 503, map[string]string{"status": "unavailable"})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
func (a *App) authCapacity(w http.ResponseWriter, r *http.Request) bool {
	address := a.clientAddress(r)
	allowed, retry, err := a.Limiter.Check(r.Context(), address)
	if err != nil {
		a.error(w, r, 503, "limits_unavailable", "Sign-in protection is temporarily unavailable. Please retry.")
		return false
	}
	if !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		a.error(w, r, 429, "rate_limited", "Too many authentication attempts. Please wait and try again.")
		return false
	}
	return true
}
func (a *App) requireIdentity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(a.Config.CookieName)
		if err != nil || !auth.ValidToken(cookie.Value) {
			a.error(w, r, 401, "authentication_required", "Sign in to continue.")
			return
		}
		user, err := a.Store.SessionUser(r.Context(), auth.TokenHash(cookie.Value))
		if errors.Is(err, store.ErrNotFound) {
			a.clearCookie(w)
			a.error(w, r, 401, "authentication_required", "Your session has ended. Sign in again.")
			return
		}
		if err != nil {
			a.storeError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey{}, user)))
	})
}
func identity(r *http.Request) store.User { return r.Context().Value(identityKey{}).(store.User) }
func (a *App) setCookie(w http.ResponseWriter, token string, expiry time.Time) {
	http.SetCookie(w, &http.Cookie{Name: a.Config.CookieName, Value: token, Path: "/", HttpOnly: true, Secure: a.Config.SecureCookies, SameSite: http.SameSiteLaxMode, Expires: expiry, MaxAge: int(a.Config.SessionTTL.Seconds())})
}
func (a *App) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: a.Config.CookieName, Value: "", Path: "/", HttpOnly: true, Secure: a.Config.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)})
}
func cleanText(value string) string { return strings.TrimSpace(value) }
