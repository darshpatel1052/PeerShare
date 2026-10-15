package httpapi

import (
	"context"
	"crypto/sha256"
	"errors"
	"sync"
	"time"

	pb "github.com/darshpatel1052/PeerShare/services/api/gen/peerscreen/media/v1"
	"github.com/darshpatel1052/PeerShare/services/api/internal/mediasvc"
	"github.com/darshpatel1052/PeerShare/services/api/internal/store"
	"github.com/jackc/pgx/v5"
	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kgo"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (a *App) RunCatalogueWorkers(ctx context.Context) {
	var workers sync.WaitGroup
	workers.Add(3)
	go func() {
		defer workers.Done()
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			a.dispatchSubmissions(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	go func() { defer workers.Done(); a.consumeMediaEvents(ctx) }()
	go func() {
		defer workers.Done()
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			ids, err := a.Store.DistributedJobs(ctx)
			if err == nil {
				for _, id := range ids {
					job, e := a.Media.GetJob(ctx, &pb.JobRequest{JobId: id})
					if e == nil {
						_ = a.Store.ApplyMediaSnapshot(ctx, job)
					}
				}
			}
			a.reconcileMedia(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	workers.Wait()
}
func (a *App) dispatchSubmissions(ctx context.Context) {
	items, err := a.Store.PendingMediaSubmissions(ctx)
	if err != nil {
		return
	}
	for _, item := range items {
		var job *pb.JobSnapshot
		if !item.Submitted {
			job, err = a.Media.SubmitProcessingJob(ctx, item.Spec)
			if err == nil {
				err = a.Store.MediaSubmissionSent(ctx, item.Spec.JobId, "")
			}
			if err == nil {
				err = a.Store.ApplyMediaSnapshot(ctx, job)
			}
		}
		if err == nil && item.Command != "" {
			request := &pb.JobRequest{JobId: item.Spec.JobId, RequestId: item.CommandID}
			if item.Command == "cancel" {
				job, err = a.Media.CancelJob(ctx, request)
			} else {
				job, err = a.Media.RetryJob(ctx, request)
			}
			if err == nil {
				err = a.Store.ApplyMediaSnapshot(ctx, job, item.CommandID)
			}
		}
		if err != nil {
			_ = a.Store.MediaSubmissionDeferred(ctx, item.Spec.JobId)
			if ctx.Err() == nil {
				a.Logger.Warn("media_submission_deferred", "job_id", item.Spec.JobId)
			}
		}
		err = nil
	}
}
func (a *App) quarantineMediaEvent(ctx context.Context, record *kgo.Record, reason string) error {
	hash := sha256.Sum256(record.Value)
	_, err := a.Store.Pool.Exec(ctx, "INSERT INTO catalog.media_quarantine(topic,partition_id,record_offset,content_sha256,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", record.Topic, record.Partition, record.Offset, hash[:], reason)
	return err
}
func (a *App) consumeMediaEvents(ctx context.Context) {
	consumer, err := mediasvc.Consumer(a.Config.KafkaServers, mediasvc.LifecycleTopic, "peerscreen-catalog-projection-v1")
	if err != nil {
		a.Logger.Error("media_projection_start_failed")
		return
	}
	defer consumer.CloseAllowingRebalance()
	for ctx.Err() == nil {
		fetched := consumer.PollRecords(ctx, 1)
		if ctx.Err() != nil {
			return
		}
		if len(fetched.Errors()) > 0 {
			for _, failure := range fetched.Errors() {
				var protocol *kerr.Error
				if errors.As(failure.Err, &protocol) {
					a.Logger.Warn("media_projection_fetch_deferred", "kafka_code", protocol.Code, "kafka_error", protocol.Message)
				} else {
					a.Logger.Warn("media_projection_fetch_deferred", "topic", failure.Topic, "partition", failure.Partition)
				}
			}
			consumer.AllowRebalance()
			if !waitDistributed(ctx, time.Second) {
				return
			}
			continue
		}
		for _, record := range fetched.Records() {
			event, _, decodeErr := mediasvc.DecodeEvent(record.Value)
			for ctx.Err() == nil {
				if decodeErr != nil || event.EventType == "media.dispatch" {
					err = a.quarantineMediaEvent(ctx, record, "invalid_lifecycle")
				} else {
					var current *pb.JobSnapshot
					current, err = a.Media.GetJob(ctx, &pb.JobRequest{JobId: event.JobID})
					if status.Code(err) == codes.NotFound {
						err = a.quarantineMediaEvent(ctx, record, "unknown_job")
					}
					if err == nil {
						if current == nil {
							break
						}
						if current.Spec.VideoId != event.AggregateID || current.Spec.GenerationId != event.GenerationID {
							err = a.quarantineMediaEvent(ctx, record, "identity_mismatch")
						} else {
							err = a.Store.ApplyMediaSnapshot(ctx, current)
						}
					}
				}
				if err == nil {
					break
				}
				consumer.AllowRebalance()
				if !waitDistributed(ctx, time.Second) {
					return
				}
			}
			if ctx.Err() != nil {
				consumer.AllowRebalance()
				return
			}
			if consumer.CommitRecords(ctx, record) != nil {
				a.Logger.Warn("media_projection_acknowledgement_ambiguous", "job_id", event.JobID)
			}
			consumer.AllowRebalance()
		}
	}
}
func waitDistributed(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// Filesystem reconciliation consults the current coordinator lease rather than a lagging projection lease.
func (a *App) attemptReferenced(ctx context.Context, video, generation, attempt string) (bool, error) {
	referenced, err := a.Store.AttemptReferenced(ctx, attempt)
	if err != nil || referenced || a.Media == nil {
		return referenced, err
	}
	var id string
	var live bool
	err = a.Store.Pool.QueryRow(ctx, "SELECT j.id,v.deleted_at IS NULL FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id WHERE j.video_id=$1 AND j.generation_id=$2 AND j.distributed", video, generation).Scan(&id, &live)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	job, err := a.Media.GetJob(ctx, &pb.JobRequest{JobId: id})
	if err != nil {
		return false, err
	}
	if job.AttemptId != attempt {
		return false, nil
	}
	if job.State == "running" || job.State == "cancel_requested" {
		return job.LeaseExpiresUnixMs > time.Now().UnixMilli(), nil
	}
	return live && job.State == "ready", nil
}
func (a *App) cleanupQuiesced(ctx context.Context, c store.Cleanup) bool {
	if a.Media == nil || !c.Deleted {
		return true
	}
	var jobID string
	var submitted, commandSent bool
	err := a.Store.Pool.QueryRow(ctx, "SELECT job_id,submitted_at IS NOT NULL,command_sent_at IS NOT NULL FROM catalog.media_submissions WHERE video_id=$1", c.VideoID).Scan(&jobID, &submitted, &commandSent)
	if errors.Is(err, pgx.ErrNoRows) {
		return true
	}
	if err != nil || !submitted || !commandSent {
		return false
	}
	job, err := a.Media.GetJob(ctx, &pb.JobRequest{JobId: jobID})
	return err == nil && (job.State == "ready" || job.State == "failed" || job.State == "cancelled")
}
