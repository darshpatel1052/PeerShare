package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/darshpatel1052/PeerShare/services/api/internal/auth"
	"github.com/darshpatel1052/PeerShare/services/api/internal/mediasvc"
	"github.com/darshpatel1052/PeerShare/services/api/internal/ratelimit"
	"github.com/darshpatel1052/PeerShare/services/api/internal/store"
	"github.com/jackc/pgx/v5"
	"github.com/twmb/franz-go/pkg/kgo"
)

const PlaybackTopic = "peerscreen.playback.telemetry.v1"

func (a *App) registerPlayback(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/playback/sessions", a.startPlayback)
	mux.HandleFunc("POST /api/v1/playback/telemetry", a.playbackTelemetry)
	mux.Handle("GET /api/v1/channels/{id}/analytics", a.requireIdentity(http.HandlerFunc(a.channelAnalytics)))
	mux.Handle("GET /api/v1/videos/{id}/analytics", a.requireIdentity(http.HandlerFunc(a.videoAnalytics)))
}
func (a *App) playbackCapacity(w http.ResponseWriter, r *http.Request, key string, limit int64) bool {
	limiter := ratelimit.Limiter{Client: a.Redis, Prefix: a.Config.RatePrefix + ":playback:" + r.Pattern, Limit: limit, Window: time.Minute}
	allowed, retry, err := limiter.Check(r.Context(), key)
	if err != nil {
		a.error(w, r, 503, "telemetry_unavailable", "Playback measurements are temporarily unavailable.")
		return false
	}
	if !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		a.error(w, r, 429, "telemetry_rate_limited", "Playback reports are arriving too frequently.")
		return false
	}
	return true
}
func (a *App) startPlayback(w http.ResponseWriter, r *http.Request) {
	address := a.clientAddress(r)
	if !a.playbackCapacity(w, r, address, 30) {
		return
	}
	var b struct {
		VideoID      string `json:"video_id"`
		GenerationID string `json:"generation_id"`
		AttemptID    string `json:"attempt_id"`
		Mode         string `json:"measurement_mode"`
	}
	if !a.decode(w, r, &b) {
		return
	}
	for _, id := range []string{b.VideoID, b.GenerationID, b.AttemptID} {
		if _, ok := canonicalID(id); !ok {
			a.error(w, r, 422, "invalid_playback", "Use the published video's current identifiers.")
			return
		}
	}
	if b.Mode != "verified_hls" && b.Mode != "native_hls" {
		a.error(w, r, 422, "invalid_playback", "Choose a supported playback measurement mode.")
		return
	}
	token, hash, err := auth.NewSessionToken()
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	session, err := a.Store.StartPlayback(r.Context(), b.VideoID, b.GenerationID, b.AttemptID, b.Mode, hash, a.Config.ExposeOperatorFixture)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	session.Token = token
	writeJSON(w, 201, session)
}
func (a *App) playbackTelemetry(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get("Playback-Token")
	if !auth.ValidToken(token) {
		a.storeError(w, r, store.ErrNotFound)
		return
	}
	if !a.playbackCapacity(w, r, token, 40) {
		return
	}
	var b struct {
		ID       string                 `json:"session_id"`
		Sequence int                    `json:"sequence"`
		Metrics  *store.PlaybackMetrics `json:"metrics"`
	}
	if !a.decode(w, r, &b) {
		return
	}
	if _, ok := canonicalID(b.ID); !ok || b.Metrics == nil {
		a.error(w, r, 422, "invalid_playback", "Send the playback session, sequence and measurements.")
		return
	}
	value, err := a.Store.RecordPlayback(r.Context(), b.ID, auth.TokenHash(token), b.Sequence, *b.Metrics)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	writeJSON(w, 200, value)
}
func (a *App) channelAnalytics(w http.ResponseWriter, r *http.Request) {
	id, ok := a.libraryID(w, r)
	if !ok {
		return
	}
	value, err := a.creatorAnalytics(r, id, nil)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, 200, value)
}
func (a *App) videoAnalytics(w http.ResponseWriter, r *http.Request) {
	id, ok := a.libraryID(w, r)
	if !ok {
		return
	}
	var channel string
	err := a.Store.Pool.QueryRow(r.Context(), `SELECT v.channel_id FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id=$1 AND c.owner_id=$2 AND v.deleted_at IS NULL`, id, identity(r).ID).Scan(&channel)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			err = store.ErrNotFound
		}
		a.storeError(w, r, err)
		return
	}
	value, err := a.creatorAnalytics(r, channel, &id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, 200, value)
}

// Accepted SQL measurements are immediately readable. Kafka is an independent
// durable observation stream, so a broker outage cannot double-count or block
// the creator's read path. Publish-before-mark allows safe event redelivery.
func (a *App) RunPlaybackRelay(ctx context.Context) {
	if a.Config.KafkaServers == "" {
		return
	}
	producer, err := mediasvc.Producer(a.Config.KafkaServers)
	if err != nil {
		a.Logger.Error("playback_relay_start_failed")
		return
	}
	defer producer.Close()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		events, err := a.Store.PlaybackOutbox(ctx)
		if err == nil {
			for _, event := range events {
				deadline, cancel := context.WithTimeout(ctx, 5*time.Second)
				err = producer.ProduceSync(deadline, &kgo.Record{Topic: PlaybackTopic, Key: []byte(event.VideoID), Value: event.Payload}).FirstErr()
				cancel()
				if ctx.Err() != nil {
					return
				}
				if mark := a.Store.PlaybackPublished(ctx, event.ID, err == nil); mark != nil || err != nil {
					a.Logger.Warn("playback_outbox_deferred")
					break
				}
			}
		} else if ctx.Err() == nil {
			a.Logger.Warn("playback_outbox_read_deferred")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
