package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	pb "github.com/darshpatel1052/Peer-Screen/services/api/gen/peerscreen/media/v1"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/mediasvc"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"google.golang.org/protobuf/proto"
)

func TestIntegrationDistributedUploadKafkaAcceptanceAndProjection(t *testing.T) {
	f := setup(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	media, err := mediasvc.Open(ctx, os.Getenv("MEDIA_DATABASE_URL"), f.App.Config.MediaDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(media.Pool.Close)
	if err = media.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = media.Pool.Exec(ctx, "TRUNCATE media.jobs,media.outbox,media.quarantine CASCADE"); err != nil {
		t.Fatal(err)
	}
	server, err := mediasvc.NewServer(media, os.Getenv("CATALOG_RPC_TOKEN"), os.Getenv("WORKER_RPC_TOKEN"))
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go server.Serve(listener)
	t.Cleanup(func() { server.Stop(); listener.Close() })
	catalog, err := mediasvc.Dial(listener.Addr().String(), os.Getenv("CATALOG_RPC_TOKEN"))
	if err != nil {
		t.Fatal(err)
	}
	worker, err := mediasvc.Dial(listener.Addr().String(), os.Getenv("WORKER_RPC_TOKEN"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { catalog.Conn.Close(); worker.Conn.Close() })
	producer, err := mediasvc.Producer(os.Getenv("KAFKA_BOOTSTRAP_SERVERS"))
	if err != nil {
		t.Fatal(err)
	}
	consumer, err := mediasvc.Consumer(os.Getenv("KAFKA_BOOTSTRAP_SERVERS"), mediasvc.DispatchTopic, "test-actual-worker-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { consumer.CloseAllowingRebalance(); producer.Close() })
	f.App.Media = catalog
	f.App.Config.MediaAddress = listener.Addr().String()
	f.App.Store.Distributed = true
	appDone, mediaDone, workerDone := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() { defer close(appDone); f.App.RunMediaWorker(ctx) }()
	go func() { defer close(mediaDone); media.RunMaintenance(ctx, producer, f.App.Logger) }()
	go func() {
		defer close(workerDone)
		mediasvc.RunWorker(ctx, worker, consumer, producer, f.App.Config.UploadDir, f.App.Config.MediaDir, f.App.Logger)
	}()
	t.Cleanup(func() {
		cancel()
		for _, done := range []chan struct{}{appDone, mediaDone, workerDone} {
			select {
			case <-done:
			case <-time.After(10 * time.Second):
				t.Error("distributed consumer shutdown exceeded its bound")
			}
		}
	})
	// A malformed record and a valid-looking unknown reference must not block later lifecycle work.
	unknownSpec := &pb.JobSpec{JobId: uuid.NewString(), OwnerId: uuid.NewString(), VideoId: uuid.NewString(), GenerationId: uuid.NewString(), SourceBytes: 1, SourceSha256: make([]byte, 32), RecipeVersion: "h264-aac-hls-v2"}
	unknownSpec.SourceKey = "sources/" + unknownSpec.VideoId + "-" + hex.EncodeToString(unknownSpec.SourceSha256) + ".mp4"
	unknown := &pb.JobSnapshot{Spec: unknownSpec, State: "queued", Stage: "queued", Version: 1, EventId: uuid.NewString()}
	unknownData, _ := proto.Marshal(unknown)
	unknownEvent, _ := json.Marshal(mediasvc.Event{SchemaVersion: 1, EventID: unknown.EventId, EventType: "media.processing.queued", AggregateID: unknownSpec.VideoId, JobID: unknownSpec.JobId, GenerationID: unknownSpec.GenerationId, Version: 1, Snapshot: unknownData})
	if err = producer.ProduceSync(ctx, &kgo.Record{Topic: mediasvc.LifecycleTopic, Value: []byte("invalid fixture record")}, &kgo.Record{Topic: mediasvc.LifecycleTopic, Value: unknownEvent}).FirstErr(); err != nil {
		t.Fatal(err)
	}
	quarantineDeadline := time.Now().Add(15 * time.Second)
	var quarantined int
	for time.Now().Before(quarantineDeadline) {
		if err = f.DB.Pool.QueryRow(ctx, "SELECT count(*) FROM catalog.media_quarantine").Scan(&quarantined); err != nil {
			t.Fatal(err)
		}
		if quarantined == 2 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if quarantined != 2 {
		t.Logf("quarantined=%d, consumer diagnostics=%s", quarantined, f.Logs.text())
		t.Fatal("poison lifecycle records blocked projection")
	}
	c := client()
	me, _, _ := registerUser(t, f, c)
	channel := createChannel(t, f, c, "distributed-"+uuid.NewString()[:8])
	source := filepath.Join(t.TempDir(), "owned.mp4")
	cmd := exec.Command("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=880", "-t", "5", "-c:v", "libx264", "-threads", "2", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", source)
	if err = cmd.Run(); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(payload)
	status, data, _ := request(t, c, f.Server.URL, "POST", "/api/v1/uploads", map[string]any{"channel_id": channel.ID, "title": "Distributed source", "description": "Owned generated media", "tags": []string{}, "size": len(payload), "part_checksums": []string{hex.EncodeToString(hash[:])}}, map[string]string{"Idempotency-Key": uuid.NewString()})
	if status != 201 {
		t.Fatal("upload creation", status)
	}
	var upload store.Upload
	if json.Unmarshal(data, &upload) != nil {
		t.Fatal("invalid upload")
	}
	completeBytes(t, f, c, upload, payload)
	deadline := time.Now().Add(40 * time.Second)
	var ready store.Upload
	for time.Now().Before(deadline) {
		status, data, _ = request(t, c, f.Server.URL, "GET", "/api/v1/uploads/"+upload.ID, nil, nil)
		if status != 200 {
			t.Fatal(status)
		}
		if json.Unmarshal(data, &ready) != nil {
			t.Fatal("invalid progress")
		}
		if ready.ProcessingState == "ready" {
			break
		}
		if ready.ProcessingState == "failed" {
			t.Fatal("processing failed", ready.ErrorCode)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if ready.ProcessingState != "ready" || ready.JobID == nil {
		t.Fatal("Kafka processing did not become ready")
	}
	accepted, err := catalog.GetJob(ctx, &pb.JobRequest{JobId: *ready.JobID})
	if err != nil || accepted.State != "ready" || accepted.Attempts != 1 {
		t.Fatal("coordinator did not accept one attempt", err)
	}
	t.Run("accepted-completion-response-replay", func(t *testing.T) {
		r := &pb.CompleteRequest{Attempt: &pb.Attempt{JobId: accepted.Spec.JobId, AttemptId: accepted.AttemptId, WorkerId: accepted.WorkerId, LeaseEpoch: accepted.LeaseEpoch}, OutputDescriptorKey: "videos/" + accepted.Spec.VideoId + "/" + accepted.Spec.GenerationId + "/" + accepted.AttemptId + "/output.json"}
		for range 2 {
			same, e := worker.CompleteJob(ctx, r)
			if e != nil || same.Version != accepted.Version || same.EventId != accepted.EventId {
				t.Fatal("completion replay created another acceptance", e)
			}
		}
		var count int
		if e := media.Pool.QueryRow(ctx, "SELECT count(*) FROM media.outbox WHERE aggregate_id=$1 AND convert_from(payload,'UTF8')::jsonb->>'event_type'='media.processing.ready'", upload.VideoID).Scan(&count); e != nil || count != 1 {
			t.Fatal("duplicate completion outbox", count, e)
		}
	})
	video, err := f.DB.PreviewVideo(ctx, me.User.ID, upload.VideoID)
	if err != nil || !reflect.DeepEqual(video.Qualities, []int{480, 720}) {
		t.Fatal("adaptive projection missing", err)
	}
	var submissions, published int
	if err = f.DB.Pool.QueryRow(ctx, "SELECT count(*) FROM catalog.media_submissions WHERE job_id=$1 AND submitted_at IS NOT NULL", *ready.JobID).Scan(&submissions); err != nil || submissions != 1 {
		t.Fatal("submission not durably acknowledged", err)
	}
	if err = media.Pool.QueryRow(ctx, "SELECT count(*) FROM media.outbox WHERE aggregate_id=$1 AND published_at IS NOT NULL", upload.VideoID).Scan(&published); err != nil || published < 2 {
		t.Fatal("no actual Kafka publication evidence", published, err)
	}
	t.Run("duplicate-and-stale-projection", func(t *testing.T) {
		if e := f.DB.ApplyMediaSnapshot(ctx, accepted); e != nil {
			t.Fatal(e)
		}
		if e := f.DB.ApplyMediaSnapshot(ctx, accepted); e != nil {
			t.Fatal(e)
		}
		old := proto.Clone(accepted).(*pb.JobSnapshot)
		old.Version--
		old.EventId = uuid.NewString()
		old.State = "running"
		old.Stage = "encoding"
		old.Progress = 40
		if e := f.DB.ApplyMediaSnapshot(ctx, old); e != nil {
			t.Fatal(e)
		}
		current, e := f.DB.Upload(ctx, me.User.ID, upload.ID)
		if e != nil || current.ProcessingState != "ready" {
			t.Fatal("replayed event regressed state", e)
		}
	})
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/videos/"+upload.VideoID+"/publish", map[string]any{}, nil)
	if status != 200 {
		t.Fatal("publish failed", status)
	}
	status, _, _ = request(t, client(), f.Server.URL, "GET", "/api/v1/videos/"+upload.VideoID, nil, nil)
	if status != 200 {
		t.Fatal("public accepted media missing", status)
	}
	if _, err = f.DB.Pool.Exec(ctx, "CREATE TABLE media.catalog_role_probe(id integer)"); err == nil {
		t.Fatal("catalogue role can write media schema")
	}
	status, _, _ = request(t, c, f.Server.URL, "DELETE", "/api/v1/videos/"+upload.VideoID, nil, nil)
	if status != 204 {
		t.Fatal("delete failed", status)
	}
	late := proto.Clone(accepted).(*pb.JobSnapshot)
	late.Version++
	late.EventId = uuid.NewString()
	if err = f.DB.ApplyMediaSnapshot(ctx, late); err != nil {
		t.Fatal(err)
	}
	status, _, _ = request(t, client(), f.Server.URL, "GET", "/api/v1/videos/"+upload.VideoID, nil, nil)
	if status != 404 {
		t.Fatal("late completion resurrected deleted video", status)
	}
}
