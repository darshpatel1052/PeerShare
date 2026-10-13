package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/config"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/ratelimit"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/redis/go-redis/v9"
)

type testApp struct {
	App    *App
	Server *httptest.Server
	DB     *store.Store
	Logs   *safeBuffer
}
type safeBuffer struct {
	mu sync.Mutex
	bytes.Buffer
}

func (b *safeBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.Buffer.Write(p)
}
func (b *safeBuffer) text() string { b.mu.Lock(); defer b.mu.Unlock(); return b.Buffer.String() }
func setup(t *testing.T) *testApp {
	t.Helper()
	if os.Getenv("PEERSCREEN_INTEGRATION") != "true" {
		t.Skip("run npm run test:integration for real isolated PostgreSQL/Redis tests")
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	cfg.RatePrefix = "peerscreen:test:" + uuid.NewString()
	cfg.AuthLimit = 120
	cfg.UploadDir = t.TempDir()
	cfg.MediaDir = t.TempDir()
	db, err := store.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		t.Fatal("test PostgreSQL unavailable")
	}
	t.Cleanup(db.Pool.Close)
	if err := db.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(context.Background(), "TRUNCATE catalog.users CASCADE"); err != nil {
		t.Fatal(err)
	}
	options, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		t.Fatal(err)
	}
	cache := redis.NewClient(options)
	t.Cleanup(func() { cache.Close() })
	logs := &safeBuffer{}
	app, err := New(context.Background(), cfg, db, cache, slog.New(slog.NewJSONHandler(logs, nil)))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	return &testApp{App: app, Server: server, DB: db, Logs: logs}
}
func client() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, Timeout: 10 * time.Second}
}
func request(t *testing.T, c *http.Client, server, method, path string, body any, headers map[string]string) (int, []byte, *http.Response) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(data)
	}
	r, err := http.NewRequest(method, server+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	if method != "GET" && method != "HEAD" {
		r.Header.Set("Origin", "http://localhost:3000")
	}
	for key, value := range headers {
		r.Header.Set(key, value)
	}
	response, err := c.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, data, response
}
func registerUser(t *testing.T, f *testApp, c *http.Client) (store.Me, string, string) {
	t.Helper()
	email := uuid.NewString() + "@example.test"
	password := "a private learning password 123"
	status, data, _ := request(t, c, f.Server.URL, "POST", "/api/v1/auth/register", map[string]string{"email": strings.ToUpper(email), "password": password, "display_name": "Test creator"}, nil)
	if status != 201 {
		t.Fatalf("registration status %d: %s", status, data)
	}
	var me store.Me
	if json.Unmarshal(data, &me) != nil {
		t.Fatal("invalid registration response")
	}
	return me, email, password
}
func createChannel(t *testing.T, f *testApp, c *http.Client, handle string) store.Channel {
	t.Helper()
	status, data, _ := request(t, c, f.Server.URL, "POST", "/api/v1/channels", map[string]string{"handle": handle, "title": "My channel", "description": "Persisted metadata"}, nil)
	if status != 201 {
		t.Fatalf("create channel status %d: %s", status, data)
	}
	var channel store.Channel
	if json.Unmarshal(data, &channel) != nil {
		t.Fatal("invalid channel response")
	}
	return channel
}

func TestIntegrationIdentityStorageRevocationAndExpiry(t *testing.T) {
	f := setup(t)
	c := client()
	me, email, password := registerUser(t, f, c)
	if me.User.Email != email || me.Channel != nil {
		t.Fatal("canonical email and initially absent channel expected")
	}
	status, _, response := request(t, c, f.Server.URL, "POST", "/api/v1/auth/login", map[string]string{"email": email, "password": password}, nil)
	if status != 200 {
		t.Fatal("login failed")
	}
	var token string
	for _, cookie := range response.Cookies() {
		if cookie.Name == f.App.Config.CookieName {
			token = cookie.Value
			if !cookie.HttpOnly || cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
				t.Fatal("development cookie flags incorrect")
			}
		}
	}
	var storedHash []byte
	var passwordHash string
	if err := f.DB.Pool.QueryRow(context.Background(), "SELECT token_hash FROM catalog.sessions WHERE token_hash=$1", auth.TokenHash(token)).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(storedHash, auth.TokenHash(token)) || bytes.Equal(storedHash, []byte(token)) {
		t.Fatal("session database must contain only token hash")
	}
	if err := f.DB.Pool.QueryRow(context.Background(), "SELECT password_hash FROM catalog.users WHERE id=$1", me.User.ID).Scan(&passwordHash); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(passwordHash, "$argon2id$") || strings.Contains(passwordHash, password) {
		t.Fatal("password must be hashed")
	}
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/auth/logout", map[string]string{}, nil)
	if status != 204 {
		t.Fatal("logout failed")
	}
	status, _, _ = request(t, client(), f.Server.URL, "GET", "/api/v1/me", nil, map[string]string{"Cookie": f.App.Config.CookieName + "=" + token})
	if status != 401 {
		t.Fatal("revoked cookie replay must fail")
	}
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/auth/login", map[string]string{"email": email, "password": password}, nil)
	if status != 200 {
		t.Fatal("second login failed")
	}
	if _, err := f.DB.Pool.Exec(context.Background(), "UPDATE catalog.sessions SET expires_at=created_at+interval '1 microsecond' WHERE user_id=$1 AND revoked_at IS NULL", me.User.ID); err != nil {
		t.Fatal(err)
	}
	status, _, _ = request(t, c, f.Server.URL, "GET", "/api/v1/me", nil, nil)
	if status != 401 {
		t.Fatal("expired session must fail")
	}
	status, _, _ = request(t, c, f.Server.URL, "GET", "/api/v1/videos/"+token+"?accidental_secret="+url.QueryEscape(password), nil, nil)
	if status != 400 {
		t.Fatal("malformed resource identifier must fail")
	}
	if strings.Contains(f.Logs.text(), password) || strings.Contains(f.Logs.text(), token) || strings.Contains(f.Logs.text(), passwordHash) {
		t.Fatal("logs leaked credentials")
	}
}

func TestIntegrationUploadIdempotencyResumeOwnershipAndPublishGate(t *testing.T) {
	f := setup(t)
	creator := client()
	me, _, _ := registerUser(t, f, creator)
	channel := createChannel(t, f, creator, "upload-"+strings.ReplaceAll(uuid.NewString()[:8], "-", ""))
	key := "upload-request-" + uuid.NewString()
	body := map[string]any{"channel_id": channel.ID, "title": "My first upload", "description": "A private draft", "tags": []string{"learning"}, "size": 11}
	status, data, _ := request(t, creator, f.Server.URL, "POST", "/api/v1/uploads", body, map[string]string{"Idempotency-Key": key})
	if status != 201 {
		t.Fatalf("create upload status %d: %s", status, data)
	}
	var upload store.Upload
	if json.Unmarshal(data, &upload) != nil || upload.State != "open" || upload.ExpectedBytes != 11 || upload.PartBytes != 8*1024*1024 {
		t.Fatal("upload session response did not include the durable chunk policy")
	}
	status, replay, _ := request(t, creator, f.Server.URL, "POST", "/api/v1/uploads", body, map[string]string{"Idempotency-Key": key})
	var replayed store.Upload
	if status != 200 || json.Unmarshal(replay, &replayed) != nil || replayed.ID != upload.ID {
		t.Fatal("an equivalent retry must return the existing upload")
	}
	changed := map[string]any{"channel_id": channel.ID, "title": "Different request", "description": "A private draft", "tags": []string{"learning"}, "size": 11}
	status, _, _ = request(t, creator, f.Server.URL, "POST", "/api/v1/uploads", changed, map[string]string{"Idempotency-Key": key})
	if status != 409 {
		t.Fatal("reusing the idempotency key for different content must conflict")
	}
	other := client()
	registerUser(t, f, other)
	status, _, _ = request(t, other, f.Server.URL, "GET", "/api/v1/uploads/"+upload.ID, nil, nil)
	if status != 404 {
		t.Fatal("upload sessions must not be visible to another creator")
	}
	partURL := f.Server.URL + "/api/v1/uploads/" + upload.ID + "/parts/1"
	putPart := func(payload string) int {
		req, _ := http.NewRequest("PUT", partURL, strings.NewReader(payload))
		req.Header.Set("Origin", "http://localhost:3000")
		req.Header.Set("Content-Type", "application/octet-stream")
		status, data, _ := request(t, creator, f.Server.URL, "POST", "/api/v1/uploads/"+upload.ID+"/parts/presign", map[string]any{"numbers": []int{1}}, nil)
		if status != 200 {
			t.Fatalf("grant status %d: %s", status, data)
		}
		var grants struct {
			Parts []struct {
				Token string `json:"token"`
			} `json:"parts"`
		}
		if err := json.Unmarshal(data, &grants); err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Upload-Token", grants.Parts[0].Token)
		response, err := creator.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		io.Copy(io.Discard, response.Body)
		return response.StatusCode
	}
	if status = putPart("hello world"); status != 200 {
		t.Fatalf("first chunk upload failed: %d", status)
	}
	if status = putPart("hello world"); status != 200 {
		t.Fatalf("identical chunk retry should be idempotent: %d", status)
	}
	if status = putPart("other bytes"); status != 409 {
		t.Fatalf("conflicting chunk retry should be rejected: %d", status)
	}
	status, _, _ = request(t, creator, f.Server.URL, "POST", "/api/v1/uploads/"+upload.ID+"/complete", map[string]any{}, nil)
	if status != 202 {
		t.Fatalf("completed upload should enqueue processing: %d", status)
	}
	status, _, _ = request(t, creator, f.Server.URL, "GET", "/api/v1/videos/"+upload.VideoID, nil, nil)
	if status != 404 {
		t.Fatal("a processing draft must not leak through the public video endpoint")
	}
	status, _, _ = request(t, creator, f.Server.URL, "POST", "/api/v1/videos/"+upload.VideoID+"/publish", map[string]any{}, nil)
	if status != 409 {
		t.Fatalf("processing draft publish: status=%d DB error=%v", status, f.DB.PublishVideo(context.Background(), me.User.ID, upload.VideoID, true))
	}
	generation, attempt := uuid.NewString(), uuid.NewString()
	if _, err := f.DB.Pool.Exec(context.Background(), `UPDATE catalog.videos SET processing_state='ready',duration_seconds=2,accepted_generation_id=$1,accepted_attempt_id=$2,manifest_key='private/master.m3u8',integrity_key='private/integrity.json',thumbnail_key='private/thumbnail.jpg',qualities=ARRAY[360] WHERE id=$3`, generation, attempt, upload.VideoID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.DB.Pool.Exec(context.Background(), `UPDATE catalog.processing_jobs SET state='ready',stage='ready',progress=100 WHERE video_id=$1`, upload.VideoID); err != nil {
		t.Fatal(err)
	}
	mediaKey := "videos/" + upload.VideoID + "/" + generation + "/" + attempt + "/master.m3u8"
	mediaFile := filepath.Join(f.App.Config.MediaDir, filepath.FromSlash(mediaKey))
	if err := os.MkdirAll(filepath.Dir(mediaFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mediaFile, []byte("#EXTM3U\n"), 0644); err != nil {
		t.Fatal(err)
	}
	status, _, _ = request(t, creator, f.Server.URL, "GET", "/api/v1/media/"+mediaKey, nil, nil)
	if status != 200 {
		t.Fatal("the owner must be able to preview processed draft media")
	}
	status, _, _ = request(t, other, f.Server.URL, "GET", "/api/v1/media/"+mediaKey, nil, nil)
	if status != 404 {
		t.Fatal("unpublished media must remain private to its owner")
	}
	status, _, _ = request(t, other, f.Server.URL, "POST", "/api/v1/videos/"+upload.VideoID+"/publish", map[string]any{}, nil)
	if status != 409 {
		t.Fatal("another creator cannot publish this video")
	}
	status, _, _ = request(t, creator, f.Server.URL, "POST", "/api/v1/videos/"+upload.VideoID+"/publish", map[string]any{}, nil)
	if status != 200 {
		t.Fatalf("owner publish failed: %d", status)
	}
	status, _, _ = request(t, other, f.Server.URL, "GET", "/api/v1/videos/"+upload.VideoID, nil, nil)
	if status != 200 {
		t.Fatal("published video must become publicly visible")
	}
	status, _, _ = request(t, client(), f.Server.URL, "GET", "/api/v1/media/"+mediaKey, nil, nil)
	if status != 200 {
		t.Fatal("a published generation must expose its media to public viewers")
	}
	if me.User.ID == "" {
		t.Fatal("registration must return creator identity")
	}
}
func TestIntegrationOwnershipRevisionAndDuplicateCreation(t *testing.T) {
	f := setup(t)
	alice := client()
	bob := client()
	a, _, _ := registerUser(t, f, alice)
	registerUser(t, f, bob)
	channel := createChannel(t, f, alice, "creator-"+uuid.NewString()[:8])
	body := map[string]any{"title": "Bob overwrite", "description": "forbidden", "revision": channel.Revision}
	status, _, _ := request(t, bob, f.Server.URL, "PATCH", "/api/v1/channels/"+channel.ID, body, map[string]string{"X-User-ID": a.User.ID})
	if status != 403 {
		t.Fatal("spoofed owner header must not grant access")
	}
	status, data, _ := request(t, alice, f.Server.URL, "PATCH", "/api/v1/channels/"+channel.ID, body, nil)
	if status != 200 {
		t.Fatalf("owner edit failed: %s", data)
	}
	var edited store.Channel
	json.Unmarshal(data, &edited)
	if edited.Revision != 2 {
		t.Fatal("revision must advance")
	}
	status, _, _ = request(t, alice, f.Server.URL, "PATCH", "/api/v1/channels/"+channel.ID, body, nil)
	if status != 409 {
		t.Fatal("stale revision must conflict")
	}
	status, _, _ = request(t, alice, f.Server.URL, "POST", "/api/v1/channels", map[string]string{"handle": "another-" + uuid.NewString()[:8], "title": "second"}, nil)
	if status != 409 {
		t.Fatal("one-channel-per-owner invariant failed")
	}
	status, data, _ = request(t, client(), f.Server.URL, "GET", "/api/v1/channels/"+channel.ID, nil, nil)
	if status != 200 || bytes.Contains(data, []byte(a.User.Email)) || bytes.Contains(data, []byte("owner_id")) {
		t.Fatal("public channel must not expose private owner identity")
	}
}
func TestIntegrationConcurrentChannelAdmissionAndForeignKeys(t *testing.T) {
	f := setup(t)
	c := client()
	user, _, _ := registerUser(t, f, c)
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, _, _ := request(t, c, f.Server.URL, "POST", "/api/v1/channels", map[string]string{"handle": "race-" + uuid.NewString()[:8], "title": "racing channel"}, nil)
			statuses <- status
		}()
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[201] != 1 || counts[409] != 1 {
		t.Fatal("concurrent creates must produce one success and one conflict", counts)
	}
	var count int
	f.DB.Pool.QueryRow(context.Background(), "SELECT count(*) FROM catalog.channels WHERE owner_id=$1", user.User.ID).Scan(&count)
	if count != 1 {
		t.Fatal("database must persist one channel")
	}
	_, err := f.DB.Pool.Exec(context.Background(), "INSERT INTO catalog.channels(id,owner_id,handle,title) VALUES($1,$2,$3,'orphan')", uuid.NewString(), uuid.NewString(), "orphan-"+uuid.NewString()[:8])
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23503" {
		t.Fatal("foreign key must reject an absent owner")
	}
}
func TestIntegrationStrictInputOriginAndErrors(t *testing.T) {
	f := setup(t)
	c := client()
	status, data, response := request(t, c, f.Server.URL, "POST", "/api/v1/auth/register", map[string]string{"email": "x@example.test", "password": "long enough password", "display_name": "test"}, map[string]string{"Origin": "https://untrusted.example"})
	if status != 403 {
		t.Fatal("cross-origin mutation accepted")
	}
	var apiError APIError
	json.Unmarshal(data, &apiError)
	if apiError.Code != "origin_not_allowed" || apiError.RequestID == "" || response.Header.Get("X-Request-ID") != apiError.RequestID {
		t.Fatal("structured correlated error expected")
	}
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/auth/register", map[string]string{"email": "x@example.test", "password": "long enough password", "display_name": "test", "role": "operator"}, nil)
	if status != 400 {
		t.Fatal("unknown role field accepted")
	}
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/auth/register", map[string]string{"email": "x@example.test", "password": "short", "display_name": "test"}, nil)
	if status != 422 {
		t.Fatal("short password accepted")
	}
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/auth/login", map[string]string{"email": "absent@example.test", "password": "wrong password"}, nil)
	if status != 401 {
		t.Fatal("unknown account login must fail generically")
	}
	status, _, _ = request(t, c, f.Server.URL, "GET", "/api/v1/videos?limit=10000", nil, nil)
	if status != 400 {
		t.Fatal("unbounded page limit accepted")
	}
	status, _, _ = request(t, c, f.Server.URL, "GET", "/api/v1/videos?cursor=garbage", nil, nil)
	if status != 400 {
		t.Fatal("invalid cursor accepted")
	}
	status, _, _ = request(t, c, f.Server.URL, "GET", "/api/v1/auth/login", nil, nil)
	if status != 405 {
		t.Fatal("unsupported method must return 405")
	}
}
func TestIntegrationTransactionRollbackAndMigrationReplay(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	id := uuid.NewString()
	_, _, err := f.DB.Register(ctx, store.User{ID: id, Email: id + "@example.test", DisplayName: "rollback"}, "test-only invalid credential", []byte{1}, time.Hour)
	if err == nil {
		t.Fatal("session hash constraint must reject the transaction")
	}
	var count int
	f.DB.Pool.QueryRow(ctx, "SELECT count(*) FROM catalog.users WHERE id=$1", id).Scan(&count)
	if count != 0 {
		t.Fatal("failed session creation left a partial user")
	}
	var wg sync.WaitGroup
	failures := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); failures <- f.DB.Migrate(ctx) }()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	f.DB.Pool.QueryRow(ctx, "SELECT count(*) FROM catalog.schema_migrations").Scan(&count)
	if count != 3 {
		t.Fatal("migration replay duplicated history")
	}
	_, err = f.DB.Pool.Exec(ctx, "CREATE TABLE public.must_not_be_allowed(id int)")
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		t.Fatal("catalogue role must not write the public schema")
	}
}
func TestIntegrationPublicVisibilityAndCursorTies(t *testing.T) {
	f := setup(t)
	c := client()
	registerUser(t, f, c)
	channel := createChannel(t, f, c, "feed-"+uuid.NewString()[:8])
	ctx := context.Background()
	ids := []string{uuid.NewString(), uuid.NewString()}
	at := time.Now().UTC()
	for _, id := range ids {
		_, err := f.DB.Pool.Exec(ctx, `INSERT INTO catalog.videos(id,channel_id,title,source_kind,processing_state,publication_state,duration_seconds,accepted_generation_id,accepted_attempt_id,manifest_key,integrity_key,thumbnail_key,qualities,published_at) VALUES($1,$2,'Metadata pagination fixture','fixture','ready','published',60,$3,$4,'fixture/master.m3u8','fixture/integrity.json','fixture/thumbnail.jpg',ARRAY[360,480],$5)`, id, channel.ID, uuid.NewString(), uuid.NewString(), at)
		if err != nil {
			t.Fatal(err)
		}
	}
	draft := uuid.NewString()
	_, err := f.DB.Pool.Exec(ctx, "INSERT INTO catalog.videos(id,channel_id,title,source_kind) VALUES($1,$2,'private draft','upload')", draft, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	status, _, _ := request(t, c, f.Server.URL, "GET", "/api/v1/videos/"+draft, nil, nil)
	if status != 404 {
		t.Fatal("draft metadata leaked")
	}
	status, data, _ := request(t, c, f.Server.URL, "GET", "/api/v1/videos?limit=1&channel_id="+channel.ID, nil, nil)
	if status != 200 {
		t.Fatal("first page failed")
	}
	var first store.VideosPage
	json.Unmarshal(data, &first)
	if len(first.Items) != 1 || first.NextCursor == nil {
		t.Fatal("bounded first page expected")
	}
	status, data, _ = request(t, c, f.Server.URL, "GET", "/api/v1/videos?limit=1&channel_id="+channel.ID+"&cursor="+*first.NextCursor, nil, nil)
	var second store.VideosPage
	json.Unmarshal(data, &second)
	if status != 200 || len(second.Items) != 1 || second.Items[0].ID == first.Items[0].ID || second.NextCursor != nil {
		t.Fatal("timestamp ties must neither repeat nor skip rows")
	}
	_, err = f.DB.Pool.Exec(ctx, "UPDATE catalog.videos SET deleted_at=now() WHERE id=$1", ids[0])
	if err != nil {
		t.Fatal(err)
	}
	status, _, _ = request(t, c, f.Server.URL, "GET", "/api/v1/videos/"+ids[0], nil, nil)
	if status != 404 {
		t.Fatal("deleted video leaked")
	}
	_, err = f.DB.Pool.Exec(ctx, "UPDATE catalog.videos SET publication_state='published' WHERE id=$1", draft)
	if err == nil {
		t.Fatal("incomplete draft must not publish")
	}
}
func TestIntegrationSharedAtomicRateLimits(t *testing.T) {
	f := setup(t)
	options, _ := redis.ParseURL(f.App.Config.RedisURL)
	other := redis.NewClient(options)
	defer other.Close()
	prefix := "peerscreen:test:limiter:" + uuid.NewString()
	first := &ratelimit.Limiter{Client: f.App.Redis, Prefix: prefix, Limit: 7, Window: time.Minute}
	second := &ratelimit.Limiter{Client: other, Prefix: prefix, Limit: 7, Window: time.Minute}
	var admitted atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			limiter := first
			if index%2 == 0 {
				limiter = second
			}
			allowed, retry, err := limiter.Check(context.Background(), "shared-test-client")
			if err != nil || retry < 1 {
				t.Error("rate-limit operation failed")
			}
			if allowed {
				admitted.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if admitted.Load() != 7 {
		t.Fatal("two clients must share one atomic budget", admitted.Load())
	}
	f.App.Limiter.Limit = 1
	c := client()
	for i := 0; i < 2; i++ {
		status, _, response := request(t, c, f.Server.URL, "POST", "/api/v1/auth/login", map[string]string{"email": "rate@example.test", "password": "unknown password"}, nil)
		if i == 1 && (status != 429 || response.Header.Get("Retry-After") == "") {
			t.Fatal("HTTP rate limit must report retry information")
		}
	}
}
func TestIntegrationSessionsSurviveFreshAPIInstanceAndLogoutAll(t *testing.T) {
	f := setup(t)
	c := client()
	me, _, _ := registerUser(t, f, c)
	channel := createChannel(t, f, c, "restart-"+uuid.NewString()[:8])
	fresh, err := New(context.Background(), f.App.Config, f.DB, f.App.Redis, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(fresh.Handler())
	defer server.Close()
	status, data, _ := request(t, c, server.URL, "GET", "/api/v1/me", nil, nil)
	var loaded store.Me
	json.Unmarshal(data, &loaded)
	if status != 200 || loaded.User.ID != me.User.ID || loaded.Channel == nil || loaded.Channel.ID != channel.ID {
		t.Fatal("fresh API instance must resolve identity/channel from PostgreSQL")
	}
	status, _, _ = request(t, c, server.URL, "POST", "/api/v1/auth/logout-all", map[string]string{}, nil)
	if status != 204 {
		t.Fatal("logout all failed")
	}
	status, _, _ = request(t, c, f.Server.URL, "GET", "/api/v1/me", nil, nil)
	if status != 401 {
		t.Fatal("revocation must apply across API instances")
	}
}
