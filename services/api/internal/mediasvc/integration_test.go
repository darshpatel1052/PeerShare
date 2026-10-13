package mediasvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	pb "github.com/darshpatel1052/Peer-Screen/services/api/gen/peerscreen/media/v1"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/encoder"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type fixture struct {
	store           *Store
	catalog, worker *Client
	target          string
}

func setup(t *testing.T) *fixture {
	t.Helper()
	if os.Getenv("PEERSCREEN_INTEGRATION") != "true" {
		t.Skip("run npm run test:integration with isolated real PostgreSQL and Kafka")
	}
	store, err := Open(context.Background(), os.Getenv("MEDIA_DATABASE_URL"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Pool.Close)
	if err = store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Pool.Exec(context.Background(), "TRUNCATE media.jobs,media.outbox,media.quarantine CASCADE"); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(store, strings.Repeat("a", 64), strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go server.Serve(listener)
	t.Cleanup(func() { server.Stop(); listener.Close() })
	catalog, err := Dial(listener.Addr().String(), strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	worker, err := Dial(listener.Addr().String(), strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { catalog.Conn.Close(); worker.Conn.Close() })
	return &fixture{store, catalog, worker, listener.Addr().String()}
}
func specification() *pb.JobSpec {
	hash := sha256.Sum256([]byte("owned immutable source"))
	video := uuid.NewString()
	return &pb.JobSpec{JobId: uuid.NewString(), OwnerId: uuid.NewString(), VideoId: video, GenerationId: uuid.NewString(), SourceKey: "sources/" + video + "-" + hex.EncodeToString(hash[:]) + ".mp4", SourceBytes: 128, SourceSha256: hash[:], RecipeVersion: encoder.RecipeVersion}
}
func attempt(job *pb.JobSnapshot) *pb.Attempt {
	return &pb.Attempt{JobId: job.Spec.JobId, AttemptId: job.AttemptId, WorkerId: job.WorkerId, LeaseEpoch: job.LeaseEpoch}
}
func claim(t *testing.T, f *fixture, spec *pb.JobSpec) *pb.JobSnapshot {
	t.Helper()
	ctx := context.Background()
	if _, err := f.catalog.SubmitProcessingJob(ctx, spec); err != nil {
		t.Fatal(err)
	}
	job, err := f.worker.ClaimJob(ctx, &pb.ClaimRequest{JobId: spec.JobId, WorkerId: uuid.NewString(), ClaimRequestId: uuid.NewString()})
	if err != nil || job.State != "running" {
		t.Fatal("durable claim failed", err)
	}
	return job
}
func TestIntegrationMediaRPCRolesAndDatabaseOwnership(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	spec := specification()
	if _, err := f.worker.SubmitProcessingJob(ctx, spec); status.Code(err) != codes.PermissionDenied {
		t.Fatal("worker could submit", err)
	}
	if _, err := f.catalog.ClaimJob(ctx, &pb.ClaimRequest{JobId: spec.JobId, WorkerId: uuid.NewString(), ClaimRequestId: uuid.NewString()}); status.Code(err) != codes.PermissionDenied {
		t.Fatal("catalogue could claim", err)
	}
	connection, err := grpc.NewClient(f.target, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if _, err = pb.NewMediaCoordinatorClient(connection).GetJob(ctx, &pb.JobRequest{JobId: spec.JobId}); status.Code(err) != codes.Unauthenticated {
		t.Fatal("unauthenticated RPC accepted", err)
	}
	if _, err = f.store.Pool.Exec(ctx, "CREATE TABLE catalog.media_role_probe(id integer)"); err == nil {
		t.Fatal("media role can write catalogue")
	}
	expired, cancel := context.WithDeadline(ctx, time.Now().Add(-time.Second))
	defer cancel()
	if _, err = f.catalog.SubmitProcessingJob(expired, spec); status.Code(err) != codes.DeadlineExceeded {
		t.Fatal("deadline not respected", err)
	}
	var count int
	if err = f.store.Pool.QueryRow(ctx, "SELECT count(*) FROM media.jobs").Scan(&count); err != nil || count != 0 {
		t.Fatal("denied calls persisted a job")
	}
}
func TestIntegrationConcurrentSubmitAndConflictingInputs(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	spec := specification()
	var group sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		group.Add(1)
		go func() { defer group.Done(); _, err := f.catalog.SubmitProcessingJob(ctx, spec); errs <- err }()
	}
	group.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var jobs, events int
	if err := f.store.Pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM media.jobs),(SELECT count(*) FROM media.outbox)").Scan(&jobs, &events); err != nil || jobs != 1 || events != 2 {
		t.Fatal("duplicate durable effects", jobs, events, err)
	}
	changed := proto.Clone(spec).(*pb.JobSpec)
	changed.SourceBytes++
	if _, err := f.catalog.SubmitProcessingJob(ctx, changed); status.Code(err) != codes.AlreadyExists {
		t.Fatal("conflicting job ID accepted", err)
	}
}
func TestIntegrationDurableClaimReplayAndEpochFencing(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	spec := specification()
	if _, err := f.catalog.SubmitProcessingJob(ctx, spec); err != nil {
		t.Fatal(err)
	}
	request := &pb.ClaimRequest{JobId: spec.JobId, WorkerId: uuid.NewString(), ClaimRequestId: uuid.NewString()}
	old, err := f.worker.ClaimJob(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := f.worker.ClaimJob(ctx, request)
	if err != nil || replayed.AttemptId != old.AttemptId || replayed.Attempts != 1 {
		t.Fatal("lost claim response created another attempt", err)
	}
	another := specification()
	if _, err = f.catalog.SubmitProcessingJob(ctx, another); err != nil {
		t.Fatal(err)
	}
	busy, err := f.worker.ClaimJob(ctx, &pb.ClaimRequest{JobId: another.JobId, WorkerId: uuid.NewString(), ClaimRequestId: uuid.NewString()})
	if err != nil || busy.State != "queued" {
		t.Fatal("global execution slot bypassed", err)
	}
	if _, err = f.store.Pool.Exec(ctx, "UPDATE media.jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", spec.JobId); err != nil {
		t.Fatal(err)
	}
	if err = f.store.Reap(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = f.worker.ClaimJob(ctx, request); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("expired claim request recreated a lease", err)
	}
	current, err := f.worker.ClaimJob(ctx, &pb.ClaimRequest{JobId: spec.JobId, WorkerId: uuid.NewString(), ClaimRequestId: uuid.NewString()})
	if err != nil || current.LeaseEpoch != 2 || current.AttemptId == old.AttemptId {
		t.Fatal("recovery did not advance epoch", err)
	}
	if _, err = f.worker.HeartbeatJob(ctx, &pb.HeartbeatRequest{Attempt: attempt(old), Stage: "encoding", Progress: 20}); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("stale worker heartbeated", err)
	}
	if _, err = f.worker.CompleteJob(ctx, &pb.CompleteRequest{Attempt: attempt(old), OutputDescriptorKey: "ignored"}); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("stale worker completed", err)
	}
	if _, err = f.worker.FailJob(ctx, &pb.FailRequest{Attempt: attempt(old), ErrorCode: "processing_failed", Permanent: true}); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("stale worker failed current attempt", err)
	}
	latest, err := f.catalog.GetJob(ctx, &pb.JobRequest{JobId: spec.JobId})
	if err != nil || latest.AttemptId != current.AttemptId || latest.State != "running" {
		t.Fatal("stale result changed current work", err)
	}
}
func TestIntegrationCancelRequiresStoppedAttemptAndIdempotentRetry(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	spec := specification()
	job := claim(t, f, spec)
	request := &pb.JobRequest{JobId: spec.JobId, RequestId: uuid.NewString()}
	cancelled, err := f.catalog.CancelJob(ctx, request)
	if err != nil || cancelled.State != "cancel_requested" || cancelled.LeaseExpiresUnixMs == 0 {
		t.Fatal("cancellation released active lease early", err)
	}
	if _, err = f.worker.HeartbeatJob(ctx, &pb.HeartbeatRequest{Attempt: attempt(job), Stage: "encoding", Progress: 15}); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("cancelled work heartbeated", err)
	}
	stopped, err := f.worker.FailJob(ctx, &pb.FailRequest{Attempt: attempt(job), ErrorCode: "dependency_unavailable"})
	if err != nil || stopped.State != "cancelled" || stopped.LeaseExpiresUnixMs != 0 {
		t.Fatal("stopped acknowledgement failed", err)
	}
	retry := &pb.JobRequest{JobId: spec.JobId, RequestId: uuid.NewString()}
	pending, err := f.catalog.RetryJob(ctx, retry)
	if err != nil || pending.State != "queued" {
		t.Fatal("retry failed", err)
	}
	again, err := f.catalog.RetryJob(ctx, retry)
	if err != nil || again.Version != pending.Version {
		t.Fatal("duplicate retry changed work", err)
	}
	if _, err = f.catalog.CancelJob(ctx, retry); status.Code(err) != codes.AlreadyExists {
		t.Fatal("command ID was reused for different action", err)
	}
	current, err := f.worker.ClaimJob(ctx, &pb.ClaimRequest{JobId: spec.JobId, WorkerId: uuid.NewString(), ClaimRequestId: uuid.NewString()})
	if err != nil || current.Attempts != 2 {
		t.Fatal("retry did not consume bounded attempt", err)
	}
}
func TestIntegrationTransientRetryAndExhaustion(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	spec := specification()
	for index := int32(1); index <= 3; index++ {
		job := claim(t, f, spec)
		if job.Attempts != index {
			t.Fatal("wrong attempt count")
		}
		failed, err := f.worker.FailJob(ctx, &pb.FailRequest{Attempt: attempt(job), ErrorCode: "storage_unavailable"})
		if err != nil {
			t.Fatal(err)
		}
		if index < 3 {
			if failed.State != "retry_wait" {
				t.Fatal("transient failure was terminal")
			}
			if _, err = f.store.Pool.Exec(ctx, "UPDATE media.jobs SET next_retry_at=now()-interval '1 second' WHERE id=$1", spec.JobId); err != nil {
				t.Fatal(err)
			}
			if err = f.store.Reap(ctx); err != nil {
				t.Fatal(err)
			}
		} else {
			if failed.State != "failed" {
				t.Fatal("attempt budget did not terminate work")
			}
		}
	}
	if _, err := f.catalog.RetryJob(ctx, &pb.JobRequest{JobId: spec.JobId, RequestId: uuid.NewString()}); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("retry budget bypassed", err)
	}
}

func TestIntegrationImportedAttemptBudgetCannotReset(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	spec := specification()
	spec.PriorAttempts = 2
	job := claim(t, f, spec)
	if job.Attempts != 3 {
		t.Fatal("import reset consumed attempts")
	}
	if _, err := f.worker.FailJob(ctx, &pb.FailRequest{Attempt: attempt(job), ErrorCode: "storage_unavailable"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.catalog.RetryJob(ctx, &pb.JobRequest{JobId: spec.JobId, RequestId: uuid.NewString()}); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("import expanded retry budget")
	}
	exhausted := specification()
	exhausted.PriorAttempts = 3
	failed, err := f.catalog.SubmitProcessingJob(ctx, exhausted)
	if err != nil || failed.State != "failed" || failed.ErrorCode != "recovery_exhausted" {
		t.Fatal("exhausted import remained queued", err)
	}
}
