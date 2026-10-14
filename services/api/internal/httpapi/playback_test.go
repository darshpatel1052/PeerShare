package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/mediasvc"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
)

func playbackGrant(t *testing.T, f *testApp, videoID, mode string) store.PlaybackSession {
	t.Helper()
	v, err := f.DB.Video(context.Background(), videoID)
	if err != nil {
		t.Fatal(err)
	}
	status, data, _ := request(t, client(), f.Server.URL, "POST", "/api/v1/playback/sessions", map[string]any{"video_id": v.ID, "generation_id": v.GenerationID, "attempt_id": v.AttemptID, "measurement_mode": mode}, nil)
	if status != 201 {
		t.Fatalf("playback grant status %d", status)
	}
	var grant store.PlaybackSession
	if json.Unmarshal(data, &grant) != nil || !auth.ValidToken(grant.Token) {
		t.Fatal("invalid playback grant")
	}
	return grant
}
func playbackBatch(t *testing.T, f *testApp, grant store.PlaybackSession, sequence int, metrics store.PlaybackMetrics, expected int) store.PlaybackAck {
	t.Helper()
	status, data, _ := request(t, client(), f.Server.URL, "POST", "/api/v1/playback/telemetry", map[string]any{"session_id": grant.ID, "sequence": sequence, "metrics": metrics}, map[string]string{"Playback-Token": grant.Token})
	if status != expected {
		t.Fatalf("telemetry status %d; wanted %d", status, expected)
	}
	var ack store.PlaybackAck
	if expected == 200 && json.Unmarshal(data, &ack) != nil {
		t.Fatal("invalid telemetry acknowledgement")
	}
	return ack
}
func TestIntegrationPlaybackCapabilityReplayBoundsAndVisibility(t *testing.T) {
	f := setup(t)
	owner := client()
	me, _, _ := registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "measure-creator")
	video := libraryVideo(t, f, channel.ID, "Measured film")
	grant := playbackGrant(t, f, video, "verified_hls")
	var hash []byte
	if err := f.DB.Pool.QueryRow(context.Background(), `SELECT token_hash FROM catalog.playback_sessions WHERE id=$1`, grant.ID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(hash, auth.TokenHash(grant.Token)) || bytes.Equal(hash, []byte(grant.Token)) {
		t.Fatal("capability was not stored as a hash")
	}
	metrics := store.PlaybackMetrics{PlayedMS: 1000, HTTPBytes: 64000, Quality: 480, VerifiedSegments: 1}
	ack := playbackBatch(t, f, grant, 1, metrics, 200)
	if ack.Duplicate || ack.Qualified || ack.LastSequence != 1 {
		t.Fatal("first report acknowledgement incorrect")
	}
	ack = playbackBatch(t, f, grant, 1, metrics, 200)
	if !ack.Duplicate {
		t.Fatal("duplicate report not recognized")
	}
	changed := metrics
	changed.HTTPBytes++
	playbackBatch(t, f, grant, 1, changed, 409)
	changed = metrics
	changed.HTTPBytes--
	playbackBatch(t, f, grant, 2, changed, 409)
	changed = metrics
	changed.PlayedMS = 2000
	changed.HTTPBytes = 128000
	playbackBatch(t, f, grant, 3, changed, 200)
	ack = playbackBatch(t, f, grant, 1, metrics, 200)
	if !ack.Duplicate || ack.LastSequence != 3 {
		t.Fatal("old accepted replay changed latest state")
	}
	playbackBatch(t, f, grant, 2, metrics, 409)
	invalid := changed
	invalid.Quality = 1080
	playbackBatch(t, f, grant, 4, invalid, 422)
	invalid = changed
	invalid.PeerBytes = -1
	playbackBatch(t, f, grant, 4, invalid, 422)
	invalid = changed
	invalid.HTTPBytes += 33 << 20
	playbackBatch(t, f, grant, 4, invalid, 422)
	invalid = changed
	invalid.PlayedMS = 7000000
	playbackBatch(t, f, grant, 4, invalid, 422)
	playbackBatch(t, f, grant, 721, changed, 422)
	wrong := grant
	wrong.Token, _, _ = auth.NewSessionToken()
	playbackBatch(t, f, wrong, 4, changed, 404)
	status, _, _ := request(t, client(), f.Server.URL, "POST", "/api/v1/playback/telemetry", map[string]any{"session_id": grant.ID, "sequence": 4, "metrics": map[string]int{"played_ms": 2000}}, map[string]string{"Playback-Token": grant.Token})
	if status != 400 {
		t.Fatal("incomplete metrics accepted")
	}
	status, _, _ = request(t, client(), f.Server.URL, "POST", "/api/v1/playback/telemetry", map[string]any{"session_id": grant.ID, "sequence": 4, "metrics": changed}, map[string]string{"Playback-Token": grant.Token, "Origin": "https://invalid.example"})
	if status != 403 {
		t.Fatal("cross-origin telemetry accepted")
	}
	libraryRequest(t, f, client(), "GET", "/api/v1/channels/"+channel.ID+"/analytics", nil, 401, nil, map[string]string{"Playback-Token": grant.Token})
	other := client()
	registerUser(t, f, other)
	libraryRequest(t, f, other, "GET", "/api/v1/channels/"+channel.ID+"/analytics", nil, 404, nil, nil)
	libraryRequest(t, f, other, "GET", "/api/v1/videos/"+video+"/analytics", nil, 404, nil, nil)
	native := playbackGrant(t, f, video, "native_hls")
	nativeMetrics := store.PlaybackMetrics{PlayedMS: 1000, Quality: 480}
	playbackBatch(t, f, native, 1, nativeMetrics, 200)
	nativeMetrics.HTTPBytes = 10
	playbackBatch(t, f, native, 2, nativeMetrics, 422)
	mustExec(t, f, `UPDATE catalog.playback_sessions SET expires_at=now()-interval '1 second' WHERE id=$1`, grant.ID)
	playbackBatch(t, f, grant, 4, changed, 404)
	active := playbackGrant(t, f, video, "verified_hls")
	mustExec(t, f, `UPDATE catalog.videos SET publication_state='unpublished' WHERE id=$1`, video)
	playbackBatch(t, f, active, 1, metrics, 404)
	v, err := f.DB.PreviewVideo(context.Background(), me.User.ID, video)
	if err != nil {
		t.Fatal(err)
	}
	status, _, _ = request(t, client(), f.Server.URL, "POST", "/api/v1/playback/sessions", map[string]any{"video_id": video, "generation_id": v.GenerationID, "attempt_id": v.AttemptID, "measurement_mode": "verified_hls"}, nil)
	if status != 404 {
		t.Fatal("private video granted public telemetry session")
	}
}
func TestIntegrationConcurrentPlaybackReportsHaveOneEffect(t *testing.T) {
	f := setup(t)
	owner := client()
	registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "concurrent-measure")
	video := libraryVideo(t, f, channel.ID, "Concurrent measured film")
	grant := playbackGrant(t, f, video, "verified_hls")
	metrics := store.PlaybackMetrics{PlayedMS: 1000, HTTPBytes: 1500, PeerBytes: 500, UploadedBytes: 9000000, Quality: 480, PeerSharing: true, VerifiedSegments: 2}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	acks := make(chan store.PlaybackAck, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ack, err := f.DB.RecordPlayback(context.Background(), grant.ID, auth.TokenHash(grant.Token), 1, metrics)
			errs <- err
			acks <- ack
		}()
	}
	wg.Wait()
	close(errs)
	close(acks)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	duplicates := 0
	for ack := range acks {
		if ack.Duplicate {
			duplicates++
		}
	}
	if duplicates != 7 {
		t.Fatal("equivalent reports did not select one accepted effect")
	}
	var reports, events int
	if err := f.DB.Pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM catalog.telemetry_batches WHERE session_id=$1),(SELECT count(*) FROM catalog.playback_outbox)`, grant.ID).Scan(&reports, &events); err != nil || reports != 1 || events != 1 {
		t.Fatal("duplicate reporting effects")
	}
	var analytics store.CreatorAnalytics
	libraryRequest(t, f, owner, "GET", "/api/v1/channels/"+channel.ID+"/analytics", nil, 200, &analytics, nil)
	total := analytics.Totals
	if total.Sessions != 1 || total.HTTPBytes != 1500 || total.PeerBytes != 500 || total.UploadedBytes != 9000000 || total.PeerDeliveryShare == nil || *total.PeerDeliveryShare != 0.25 {
		t.Fatal("delivery totals included replay or uploaded bytes in denominator")
	}
	metrics.PeerSharing = false
	playbackBatch(t, f, grant, 2, metrics, 200)
	libraryRequest(t, f, owner, "GET", "/api/v1/channels/"+channel.ID+"/analytics", nil, 200, &analytics, nil)
	if analytics.Totals.Sessions != 1 || analytics.Totals.PeerBytes != 500 {
		t.Fatal("turning sharing off reset historical counters or created another watch session")
	}
}

func TestIntegrationPlaybackCapacityAndRetentionAreAtomic(t *testing.T) {
	f := setup(t)
	owner := client()
	registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "bounded-measure")
	video := libraryVideo(t, f, channel.ID, "Bounded measured film")
	grant := playbackGrant(t, f, video, "verified_hls")
	metrics := store.PlaybackMetrics{PlayedMS: 1000, HTTPBytes: 1000, Quality: 480}
	playbackBatch(t, f, grant, 1, metrics, 200)
	mustExec(t, f, `UPDATE catalog.playback_capacity SET batches=200000 WHERE singleton`)
	playbackBatch(t, f, grant, 1, metrics, 200)
	playbackBatch(t, f, grant, 2, metrics, 429)
	var last, count int
	if err := f.DB.Pool.QueryRow(context.Background(), `SELECT last_sequence,(SELECT count(*) FROM catalog.telemetry_batches) FROM catalog.playback_sessions WHERE id=$1`, grant.ID).Scan(&last, &count); err != nil || last != 1 || count != 1 {
		t.Fatal("capacity rejection partially committed a report")
	}
	// Controlled retention transition, not a real thirty-day elapsed run.
	mustExec(t, f, `UPDATE catalog.playback_sessions SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1`, grant.ID)
	playbackGrant(t, f, video, "verified_hls")
	var capacity int
	if err := f.DB.Pool.QueryRow(context.Background(), `SELECT batches FROM catalog.playback_capacity WHERE singleton`).Scan(&capacity); err != nil || capacity != 0 {
		t.Fatal("retention did not release reporting capacity")
	}
	if err := f.DB.Pool.QueryRow(context.Background(), `SELECT count(*) FROM catalog.telemetry_batches`).Scan(&count); err != nil || count != 0 {
		t.Fatal("retention left orphan batches")
	}
}
func TestIntegrationAnalyticsThresholdUnknownMeansAndAllVideoTotals(t *testing.T) {
	f := setup(t)
	owner := client()
	registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "analytics-creator")
	video := libraryVideo(t, f, channel.ID, "Original measured film")
	var analytics store.CreatorAnalytics
	libraryRequest(t, f, owner, "GET", "/api/v1/channels/"+channel.ID+"/analytics", nil, 200, &analytics, nil)
	if analytics.Totals.PeerDeliveryShare != nil || analytics.Totals.StartupAverageMS != nil || analytics.Totals.QualifiedPlays != 0 {
		t.Fatal("unknown measurements were fabricated as known")
	}
	for _, startup := range []*int64{nil, new(int64(100)), new(int64(300))} {
		grant := playbackGrant(t, f, video, "verified_hls")
		// Controlled database-time transition tests the wall-time admission rule;
		// this is not an actual thirty-second playback measurement.
		mustExec(t, f, `UPDATE catalog.playback_sessions SET created_at=now()-interval '60 seconds',updated_at=now()-interval '60 seconds' WHERE id=$1`, grant.ID)
		metrics := store.PlaybackMetrics{PlayedMS: 31000, HTTPBytes: 1500, PeerBytes: 500, UploadedBytes: 9000, Quality: 480, PeerSharing: true, StartupMS: startup}
		if !playbackBatch(t, f, grant, 1, metrics, 200).Qualified {
			t.Fatal("documented thirty-second threshold did not qualify")
		}
		playbackBatch(t, f, grant, 1, metrics, 200)
	}
	for i := 0; i < 205; i++ {
		libraryVideo(t, f, channel.ID, "Additional catalogue metadata")
	}
	libraryRequest(t, f, owner, "GET", "/api/v1/channels/"+channel.ID+"/analytics", nil, 200, &analytics, nil)
	total := analytics.Totals
	if len(analytics.Videos) != 200 || total.QualifiedPlays != 3 || total.Sessions != 3 || total.HTTPBytes != 4500 || total.StartupAverageMS == nil || *total.StartupAverageMS != 200 || total.PeerDeliveryShare == nil || *total.PeerDeliveryShare != 0.25 {
		t.Fatal("totals were narrowed by detail limit or unknown startup samples")
	}
	libraryRequest(t, f, owner, "GET", "/api/v1/videos/"+video+"/analytics", nil, 200, &analytics, nil)
	if len(analytics.Videos) != 1 || analytics.Totals.QualifiedPlays != 3 {
		t.Fatal("single-video owner analytics incorrect")
	}
	mustExec(t, f, `UPDATE catalog.videos SET deleted_at=now() WHERE id=$1`, video)
	libraryRequest(t, f, owner, "GET", "/api/v1/channels/"+channel.ID+"/analytics", nil, 200, &analytics, nil)
	if analytics.Totals.Sessions != 0 {
		t.Fatal("deleted video remained in active creator totals")
	}
}
func TestIntegrationPlaybackOutboxPublishesRealKafkaWithoutCapabilities(t *testing.T) {
	f := setup(t)
	owner := client()
	registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "outbox-measure")
	video := libraryVideo(t, f, channel.ID, "Outbox measured film")
	grant := playbackGrant(t, f, video, "verified_hls")
	metrics := store.PlaybackMetrics{PlayedMS: 1000, HTTPBytes: 32000, Quality: 480, VerifiedSegments: 1}
	playbackBatch(t, f, grant, 1, metrics, 200)
	var pending int
	if err := f.DB.Pool.QueryRow(context.Background(), `SELECT count(*) FROM catalog.playback_outbox WHERE published_at IS NULL`).Scan(&pending); err != nil || pending != 1 {
		t.Fatal("accepted observation did not persist outgoing event")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	consumer, err := mediasvc.Consumer(f.App.Config.KafkaServers, PlaybackTopic, "test-playback-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	defer consumer.CloseAllowingRebalance()
	done := make(chan struct{})
	go func() { defer close(done); f.App.RunPlaybackRelay(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("playback relay shutdown exceeded bound")
		}
	})
	poll, stop := context.WithTimeout(ctx, 20*time.Second)
	defer stop()
	readRecord := func(deadline context.Context) *kgo.Record {
		for deadline.Err() == nil {
			fetched := consumer.PollRecords(deadline, 1)
			records := fetched.Records()
			if len(records) > 0 {
				return records[0]
			}
			consumer.AllowRebalance()
		}
		t.Fatal("real Kafka observation not delivered within its bound")
		return nil
	}
	first := readRecord(poll)
	firstPayload := append([]byte(nil), first.Value...)
	records := []*kgo.Record{first}
	if strings.Contains(string(records[0].Value), grant.Token) {
		t.Fatal("capability leaked into event stream")
	}
	var event struct {
		Schema   int                   `json:"schema_version"`
		ID       string                `json:"event_id"`
		Session  string                `json:"session_id"`
		Sequence int                   `json:"sequence"`
		Metrics  store.PlaybackMetrics `json:"metrics"`
	}
	if json.Unmarshal(records[0].Value, &event) != nil || event.Schema != 1 || event.Sequence != 1 || event.Session != grant.ID || event.Metrics.HTTPBytes != 32000 {
		t.Fatal("invalid real Kafka observation envelope")
	}
	if err = consumer.CommitRecords(ctx, first); err != nil {
		t.Fatal("Kafka test consumer offset acknowledgement failed")
	}
	consumer.AllowRebalance()
	// Force the publish-before-mark ambiguity window: the same stable event is
	// emitted again without replaying the accepted SQL measurement effect.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		f.DB.Pool.QueryRow(ctx, `SELECT count(*) FROM catalog.playback_outbox WHERE published_at IS NULL`).Scan(&pending)
		if pending == 0 {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if pending != 0 {
		t.Fatal("event acknowledgement not recorded")
	}
	mustExec(t, f, `UPDATE catalog.playback_outbox SET published_at=NULL WHERE event_id=$1`, event.ID)
	replayCtx, replayStop := context.WithTimeout(ctx, 10*time.Second)
	defer replayStop()
	second := readRecord(replayCtx)
	if second.Partition != first.Partition || second.Offset <= first.Offset || !bytes.Equal(firstPayload, second.Value) {
		t.Fatal("outbox replay lost stable event identity")
	}
	consumer.AllowRebalance()
	var analytics store.CreatorAnalytics
	libraryRequest(t, f, owner, "GET", "/api/v1/channels/"+channel.ID+"/analytics", nil, 200, &analytics, nil)
	if analytics.Totals.HTTPBytes != 32000 || analytics.Totals.Sessions != 1 {
		t.Fatal("Kafka redelivery changed creator SQL totals")
	}
}
