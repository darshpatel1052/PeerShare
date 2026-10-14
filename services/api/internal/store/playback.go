package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrPlaybackConflict = errors.New("playback sequence or counters conflict")
var ErrPlaybackInvalid = errors.New("playback measurement out of bounds")
var ErrPlaybackCapacity = errors.New("playback measurement capacity reached")

// All counters are cumulative within one logical watch session. Native HLS cannot
// attribute verified segment payload and must report those byte counters as zero.
type PlaybackMetrics struct {
	PlayedMS         int64  `json:"played_ms"`
	HTTPBytes        int64  `json:"http_bytes"`
	PeerBytes        int64  `json:"peer_bytes"`
	UploadedBytes    int64  `json:"uploaded_bytes"`
	RebufferMS       int64  `json:"rebuffer_ms"`
	RebufferCount    int64  `json:"rebuffer_count"`
	VerifiedSegments int64  `json:"verified_segments"`
	RejectedSegments int64  `json:"rejected_segments"`
	Quality          int    `json:"quality"`
	PeerSharing      bool   `json:"peer_sharing"`
	StartupMS        *int64 `json:"startup_ms"`
}

func (m *PlaybackMetrics) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for _, key := range []string{"played_ms", "http_bytes", "peer_bytes", "uploaded_bytes", "rebuffer_ms", "rebuffer_count", "verified_segments", "rejected_segments", "quality", "peer_sharing", "startup_ms"} {
		value, ok := fields[key]
		if !ok || (key != "startup_ms" && bytes.Equal(value, []byte("null"))) {
			return ErrPlaybackInvalid
		}
	}
	type plain PlaybackMetrics
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode((*plain)(m))
}

type PlaybackSession struct {
	ID              string    `json:"session_id"`
	Token           string    `json:"token"`
	ExpiresAt       time.Time `json:"expires_at"`
	MeasurementMode string    `json:"measurement_mode"`
}

func (s *Store) StartPlayback(ctx context.Context, videoID, generationID, attemptID, mode string, tokenHash []byte, includeFixture bool) (PlaybackSession, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return PlaybackSession{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(2026101404)`); err != nil {
		return PlaybackSession{}, err
	}
	// Session retention and admission are bounded independently of media storage.
	if _, err = tx.Exec(ctx, `SELECT singleton FROM catalog.playback_capacity WHERE singleton FOR UPDATE`); err != nil {
		return PlaybackSession{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM catalog.playback_sessions WHERE id IN(SELECT id FROM catalog.playback_sessions WHERE created_at<now()-interval '30 days' ORDER BY created_at LIMIT 1000)`); err != nil {
		return PlaybackSession{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE catalog.playback_capacity SET batches=(SELECT count(*) FROM catalog.telemetry_batches) WHERE singleton`); err != nil {
		return PlaybackSession{}, err
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM catalog.playback_sessions`).Scan(&count); err != nil {
		return PlaybackSession{}, err
	}
	if count >= 20000 {
		return PlaybackSession{}, ErrPlaybackCapacity
	}
	var valid bool
	err = tx.QueryRow(ctx, `SELECT true FROM catalog.videos v WHERE v.id=$1 AND v.accepted_generation_id=$2 AND v.accepted_attempt_id=$3 AND `+visibleVideo+` AND ($4 OR v.source_kind<>'fixture') FOR SHARE`, videoID, generationID, attemptID, includeFixture).Scan(&valid)
	if err != nil {
		return PlaybackSession{}, translate(err)
	}
	session := PlaybackSession{ID: uuid.NewString(), MeasurementMode: mode}
	err = tx.QueryRow(ctx, `INSERT INTO catalog.playback_sessions(id,video_id,generation_id,attempt_id,token_hash,measurement_mode) VALUES($1,$2,$3,$4,$5,$6) RETURNING expires_at`, session.ID, videoID, generationID, attemptID, tokenHash, mode).Scan(&session.ExpiresAt)
	if err != nil {
		return PlaybackSession{}, err
	}
	return session, tx.Commit(ctx)
}

type PlaybackAck struct {
	LastSequence int  `json:"last_sequence"`
	Duplicate    bool `json:"duplicate"`
	Qualified    bool `json:"qualified"`
}

func qualified(played int64, duration int) bool {
	threshold := min(int64(30000), max(int64(1000), int64(duration)*500))
	return played >= threshold
}
func validatePlayback(m, old PlaybackMetrics, elapsedMS, deltaMS int64, qualities []int, mode string) error {
	counters := [][3]int64{{m.PlayedMS, old.PlayedMS, 7200000}, {m.RebufferMS, old.RebufferMS, 7200000}, {m.HTTPBytes, old.HTTPBytes, 2 << 30}, {m.PeerBytes, old.PeerBytes, 2 << 30}, {m.UploadedBytes, old.UploadedBytes, 16 << 30}, {m.RebufferCount, old.RebufferCount, 10000}, {m.VerifiedSegments, old.VerifiedSegments, 100000}, {m.RejectedSegments, old.RejectedSegments, 100000}}
	for _, c := range counters {
		if c[0] < 0 || c[0] > c[2] {
			return ErrPlaybackInvalid
		}
		if c[0] < c[1] {
			return ErrPlaybackConflict
		}
	}
	if m.PlayedMS+m.RebufferMS > elapsedMS+5000 || m.PlayedMS-old.PlayedMS+m.RebufferMS-old.RebufferMS > deltaMS+5000 {
		return ErrPlaybackInvalid
	}
	if m.HTTPBytes-old.HTTPBytes > 32<<20 || m.PeerBytes-old.PeerBytes > 32<<20 || m.UploadedBytes-old.UploadedBytes > 128<<20 || m.VerifiedSegments-old.VerifiedSegments > 1024 || m.RejectedSegments-old.RejectedSegments > 1024 {
		return ErrPlaybackInvalid
	}
	if m.StartupMS != nil && (*m.StartupMS < 0 || *m.StartupMS > 120000) {
		return ErrPlaybackInvalid
	}
	if old.StartupMS != nil && (m.StartupMS == nil || *old.StartupMS != *m.StartupMS) {
		return ErrPlaybackConflict
	}
	validQuality := m.Quality == 0
	for _, quality := range qualities {
		validQuality = validQuality || quality == m.Quality
	}
	if !validQuality {
		return ErrPlaybackInvalid
	}
	// Sharing is the current choice. Cumulative bytes may include an earlier
	// opted-in connection in the same watch session, after sharing is turned off.
	if mode == "native_hls" && (m.HTTPBytes != 0 || m.PeerBytes != 0 || m.UploadedBytes != 0 || m.VerifiedSegments != 0 || m.RejectedSegments != 0 || m.PeerSharing) {
		return ErrPlaybackInvalid
	}
	return nil
}
func (s *Store) RecordPlayback(ctx context.Context, id string, tokenHash []byte, sequence int, m PlaybackMetrics) (PlaybackAck, error) {
	if sequence < 1 || sequence > 720 {
		return PlaybackAck{}, ErrPlaybackInvalid
	}
	payload, err := json.Marshal(m)
	if err != nil {
		return PlaybackAck{}, ErrPlaybackInvalid
	}
	hash := sha256.Sum256(payload)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return PlaybackAck{}, err
	}
	defer tx.Rollback(ctx)
	var video, generation, attempt, mode string
	var last int
	var previous []byte
	var created, updated, now time.Time
	err = tx.QueryRow(ctx, `SELECT video_id,generation_id,attempt_id,measurement_mode,last_sequence,latest_metrics,created_at,updated_at,clock_timestamp() FROM catalog.playback_sessions WHERE id=$1 AND token_hash=$2 AND expires_at>now() FOR UPDATE`, id, tokenHash).Scan(&video, &generation, &attempt, &mode, &last, &previous, &created, &updated, &now)
	if err != nil {
		return PlaybackAck{}, translate(err)
	}
	var duration int
	var qualities []int
	err = tx.QueryRow(ctx, `SELECT duration_seconds,qualities FROM catalog.videos v WHERE v.id=$1 AND v.accepted_generation_id=$2 AND v.accepted_attempt_id=$3 AND `+visibleVideo+` FOR SHARE`, video, generation, attempt).Scan(&duration, &qualities)
	if err != nil {
		return PlaybackAck{}, translate(err)
	}
	old := PlaybackMetrics{}
	if last > 0 && json.Unmarshal(previous, &old) != nil {
		return PlaybackAck{}, ErrPlaybackInvalid
	}
	var stored []byte
	err = tx.QueryRow(ctx, `SELECT request_hash FROM catalog.telemetry_batches WHERE session_id=$1 AND sequence=$2`, id, sequence).Scan(&stored)
	if err == nil {
		if !bytes.Equal(stored, hash[:]) {
			return PlaybackAck{}, ErrPlaybackConflict
		}
		return PlaybackAck{last, true, qualified(old.PlayedMS, duration)}, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return PlaybackAck{}, err
	}
	if sequence <= last {
		return PlaybackAck{}, ErrPlaybackConflict
	}
	if err = validatePlayback(m, old, now.Sub(created).Milliseconds(), now.Sub(updated).Milliseconds(), qualities, mode); err != nil {
		return PlaybackAck{}, err
	}
	eventID := uuid.NewString()
	capacity, err := tx.Exec(ctx, `UPDATE catalog.playback_capacity SET batches=batches+1 WHERE singleton AND batches<200000`)
	if err != nil {
		return PlaybackAck{}, err
	}
	if capacity.RowsAffected() != 1 {
		return PlaybackAck{}, ErrPlaybackCapacity
	}
	if _, err = tx.Exec(ctx, `INSERT INTO catalog.telemetry_batches(session_id,sequence,request_hash,event_id) VALUES($1,$2,$3,$4)`, id, sequence, hash[:], eventID); err != nil {
		return PlaybackAck{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE catalog.playback_sessions SET last_sequence=$2,latest_metrics=$3,updated_at=clock_timestamp() WHERE id=$1`, id, sequence, payload); err != nil {
		return PlaybackAck{}, err
	}
	event, err := json.Marshal(map[string]any{"schema_version": 1, "event_id": eventID, "event_type": "playback.observed", "session_id": id, "video_id": video, "generation_id": generation, "attempt_id": attempt, "sequence": sequence, "measurement_mode": mode, "occurred_at": now.UTC(), "metrics": m})
	if err != nil {
		return PlaybackAck{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO catalog.playback_outbox(event_id,video_id,payload) VALUES($1,$2,$3)`, eventID, video, event); err != nil {
		return PlaybackAck{}, err
	}
	return PlaybackAck{sequence, false, qualified(m.PlayedMS, duration)}, tx.Commit(ctx)
}

type PlaybackOutboxEvent struct {
	ID, VideoID string
	Payload     []byte
}

func (s *Store) PlaybackOutbox(ctx context.Context) ([]PlaybackOutboxEvent, error) {
	rows, err := s.Pool.Query(ctx, `SELECT event_id,video_id,payload FROM catalog.playback_outbox WHERE published_at IS NULL AND next_attempt_at<=now() ORDER BY created_at,event_id LIMIT 20`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]PlaybackOutboxEvent, 0)
	for rows.Next() {
		var event PlaybackOutboxEvent
		if err = rows.Scan(&event.ID, &event.VideoID, &event.Payload); err != nil {
			return nil, err
		}
		result = append(result, event)
	}
	return result, rows.Err()
}
func (s *Store) PlaybackPublished(ctx context.Context, id string, success bool) error {
	query := `UPDATE catalog.playback_outbox SET published_at=COALESCE(published_at,now()) WHERE event_id=$1`
	if !success {
		query = `UPDATE catalog.playback_outbox SET failures=failures+1,next_attempt_at=now()+interval '2 seconds' WHERE event_id=$1 AND published_at IS NULL`
	}
	_, err := s.Pool.Exec(ctx, query, id)
	return err
}

type PlaybackTotals struct {
	Sessions          int64    `json:"sessions"`
	QualifiedPlays    int64    `json:"qualified_plays"`
	PlayedMS          int64    `json:"played_ms"`
	HTTPBytes         int64    `json:"http_bytes"`
	PeerBytes         int64    `json:"peer_bytes"`
	UploadedBytes     int64    `json:"uploaded_bytes"`
	RebufferMS        int64    `json:"rebuffer_ms"`
	RebufferCount     int64    `json:"rebuffer_count"`
	VerifiedSessions  int64    `json:"verified_sessions"`
	NativeSessions    int64    `json:"native_sessions"`
	StartupAverageMS  *float64 `json:"startup_average_ms"`
	PeerDeliveryShare *float64 `json:"peer_delivery_share"`
}
type VideoAnalytics struct {
	VideoID string         `json:"video_id"`
	Title   string         `json:"title"`
	Totals  PlaybackTotals `json:"totals"`
}
type CreatorAnalytics struct {
	PeriodDays int              `json:"period_days"`
	Totals     PlaybackTotals   `json:"totals"`
	Videos     []VideoAnalytics `json:"videos"`
}

func setPeerShare(total *PlaybackTotals) {
	denominator := total.HTTPBytes + total.PeerBytes
	if denominator > 0 {
		share := float64(total.PeerBytes) / float64(denominator)
		total.PeerDeliveryShare = &share
	}
}

const analyticsColumns = `count(ps.id),count(ps.id) FILTER(WHERE COALESCE((ps.latest_metrics->>'played_ms')::bigint,0)>=LEAST(30000,GREATEST(1000,v.duration_seconds*500))),COALESCE(sum((ps.latest_metrics->>'played_ms')::bigint),0),COALESCE(sum((ps.latest_metrics->>'http_bytes')::bigint),0),COALESCE(sum((ps.latest_metrics->>'peer_bytes')::bigint),0),COALESCE(sum((ps.latest_metrics->>'uploaded_bytes')::bigint),0),COALESCE(sum((ps.latest_metrics->>'rebuffer_ms')::bigint),0),COALESCE(sum((ps.latest_metrics->>'rebuffer_count')::bigint),0),count(ps.id) FILTER(WHERE ps.measurement_mode='verified_hls'),count(ps.id) FILTER(WHERE ps.measurement_mode='native_hls'),avg((ps.latest_metrics->>'startup_ms')::bigint)`
const analyticsFrom = ` FROM catalog.videos v LEFT JOIN catalog.playback_sessions ps ON ps.video_id=v.id AND ps.created_at>=now()-interval '30 days' AND ps.last_sequence>0 WHERE v.channel_id=$1 AND v.deleted_at IS NULL AND ($2::uuid IS NULL OR v.id=$2)`

func analyticsTargets(t *PlaybackTotals) []any {
	return []any{&t.Sessions, &t.QualifiedPlays, &t.PlayedMS, &t.HTTPBytes, &t.PeerBytes, &t.UploadedBytes, &t.RebufferMS, &t.RebufferCount, &t.VerifiedSessions, &t.NativeSessions, &t.StartupAverageMS}
}
func (s *Store) CreatorAnalytics(ctx context.Context, userID, channelID string, videoID *string) (CreatorAnalytics, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return CreatorAnalytics{}, err
	}
	defer tx.Rollback(ctx)
	var valid bool
	if err := tx.QueryRow(ctx, `SELECT true FROM catalog.channels WHERE id=$1 AND owner_id=$2`, channelID, userID).Scan(&valid); err != nil {
		return CreatorAnalytics{}, translate(err)
	}
	if videoID != nil {
		if err := tx.QueryRow(ctx, `SELECT true FROM catalog.videos WHERE id=$1 AND channel_id=$2 AND deleted_at IS NULL`, *videoID, channelID).Scan(&valid); err != nil {
			return CreatorAnalytics{}, translate(err)
		}
	}
	result := CreatorAnalytics{PeriodDays: 30, Videos: make([]VideoAnalytics, 0)}
	// Totals cover every owned video; limiting the detail table must not silently
	// narrow totals or weight startup means by sessions without a sample.
	if err = tx.QueryRow(ctx, `SELECT `+analyticsColumns+analyticsFrom, channelID, videoID).Scan(analyticsTargets(&result.Totals)...); err != nil {
		return CreatorAnalytics{}, err
	}
	setPeerShare(&result.Totals)
	rows, err := tx.Query(ctx, `SELECT v.id,v.title,`+analyticsColumns+analyticsFrom+` GROUP BY v.id ORDER BY v.created_at DESC,v.id DESC LIMIT 200`, channelID, videoID)
	if err != nil {
		return CreatorAnalytics{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var video VideoAnalytics
		targets := append([]any{&video.VideoID, &video.Title}, analyticsTargets(&video.Totals)...)
		if err = rows.Scan(targets...); err != nil {
			return CreatorAnalytics{}, err
		}
		setPeerShare(&video.Totals)
		result.Videos = append(result.Videos, video)
	}
	if err = rows.Err(); err != nil {
		return CreatorAnalytics{}, err
	}
	rows.Close()
	return result, tx.Commit(ctx)
}
