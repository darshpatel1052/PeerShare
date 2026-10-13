package mediasvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	pb "github.com/darshpatel1052/Peer-Screen/services/api/gen/peerscreen/media/v1"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/encoder"
	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const DLQTopic = "peerscreen.events.dlq.v1"

func QuarantineRecord(ctx context.Context, producer *kgo.Client, record *kgo.Record, reason string) error {
	hash := sha256.Sum256(record.Value)
	payload, _ := json.Marshal(struct {
		SchemaVersion int    `json:"schema_version"`
		Topic         string `json:"topic"`
		Partition     int32  `json:"partition"`
		Offset        int64  `json:"offset"`
		ContentSHA256 string `json:"content_sha256"`
		Reason        string `json:"reason"`
	}{1, record.Topic, record.Partition, record.Offset, hex.EncodeToString(hash[:]), reason})
	return producer.ProduceSync(ctx, &kgo.Record{Topic: DLQTopic, Key: []byte(hex.EncodeToString(hash[:])), Value: payload}).FirstErr()
}
func wait(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// Kafka offsets move only after a durable claim/no-op decision, never an in-memory queue handoff.
// Only one record is handled at a time, so a later offset cannot skip an earlier ambiguous claim.
func RunWorker(ctx context.Context, client *Client, consumer, producer *kgo.Client, uploads, media string, logger *slog.Logger) {
	workerID := uuid.NewString()
	logger.Info("media_worker_started", "worker_id", workerID)
	for ctx.Err() == nil {
		fetched := consumer.PollRecords(ctx, 1)
		if ctx.Err() != nil {
			return
		}
		if len(fetched.Errors()) > 0 {
			consumer.AllowRebalance()
			if !wait(ctx, time.Second) {
				return
			}
			continue
		}
		for _, record := range fetched.Records() {
			event, _, err := DecodeEvent(record.Value)
			if err != nil || event.EventType != "media.dispatch" {
				request, cancel := context.WithTimeout(ctx, 5*time.Second)
				err = QuarantineRecord(request, producer, record, "invalid_dispatch")
				cancel()
				if err != nil {
					consumer.AllowRebalance()
					return
				}
				if err = consumer.CommitRecords(ctx, record); err != nil {
					consumer.AllowRebalance()
					return
				}
				consumer.AllowRebalance()
				continue
			}
			claimID := uuid.NewString()
			var job *pb.JobSnapshot
			for ctx.Err() == nil {
				job, err = client.ClaimJob(ctx, &pb.ClaimRequest{JobId: event.JobID, WorkerId: workerID, ClaimRequestId: claimID})
				if err == nil && job.State != "queued" {
					break
				}
				if status.Code(err) == codes.FailedPrecondition {
					job, err = client.GetJob(ctx, &pb.JobRequest{JobId: event.JobID})
					if err == nil {
						break
					}
				}
				if status.Code(err) == codes.NotFound || status.Code(err) == codes.InvalidArgument {
					request, cancel := context.WithTimeout(ctx, 5*time.Second)
					err = QuarantineRecord(request, producer, record, "invalid_job_reference")
					cancel()
					if err != nil {
						consumer.AllowRebalance()
						return
					}
					job = nil
					break
				}
				consumer.AllowRebalance()
				if !wait(ctx, time.Second) {
					return
				}
			}
			if ctx.Err() != nil {
				consumer.AllowRebalance()
				return
			}
			// A failed commit can redeliver the notification; the durable lease still owns this computation.
			if err = consumer.CommitRecords(ctx, record); err != nil {
				logger.Warn("dispatch_acknowledgement_ambiguous", "job_id", event.JobID)
			}
			consumer.AllowRebalance()
			if job == nil || job.State != "running" || job.WorkerId != workerID || job.ClaimRequestId != claimID {
				continue
			}
			logger.Info("media_attempt_claimed", "job_id", job.Spec.JobId, "attempt_id", job.AttemptId, "epoch", job.LeaseEpoch)
			processAttempt(ctx, client, job, uploads, media, logger)
		}
	}
}
func processAttempt(parent context.Context, client *Client, job *pb.JobSnapshot, uploads, media string, logger *slog.Logger) {
	ctx, cancel := context.WithTimeout(parent, 30*time.Minute)
	defer cancel()
	attempt := &pb.Attempt{JobId: job.Spec.JobId, AttemptId: job.AttemptId, WorkerId: job.WorkerId, LeaseEpoch: job.LeaseEpoch}
	var progressMu sync.Mutex
	stage, progress := "validating", int32(1)
	heartbeat := func(nextStage string, nextProgress int32) error {
		progressMu.Lock()
		defer progressMu.Unlock()
		_, err := client.HeartbeatJob(ctx, &pb.HeartbeatRequest{Attempt: attempt, Stage: nextStage, Progress: nextProgress})
		if err == nil {
			stage, progress = nextStage, nextProgress
		}
		return err
	}
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				progressMu.Lock()
				_, err := client.HeartbeatJob(ctx, &pb.HeartbeatRequest{Attempt: attempt, Stage: stage, Progress: progress})
				progressMu.Unlock()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	spec := job.Spec
	result, err := encoder.Process(ctx, encoder.Job{ID: spec.JobId, VideoID: spec.VideoId, GenerationID: spec.GenerationId, AttemptID: job.AttemptId, SourceKey: spec.SourceKey, SourceBytes: spec.SourceBytes, SourceHash: spec.SourceSha256}, uploads, media, func(stage string, progress int) error { return heartbeat(stage, int32(progress)) })
	if err == nil {
		// Keep heartbeating while retrying an ambiguous acceptance response. The output remains immutable.
		for ctx.Err() == nil {
			_, err = client.CompleteJob(ctx, &pb.CompleteRequest{Attempt: attempt, OutputDescriptorKey: result.DescriptorKey})
			if err == nil || status.Code(err) == codes.FailedPrecondition || status.Code(err) == codes.InvalidArgument {
				break
			}
			if !wait(ctx, time.Second) {
				break
			}
		}
	} else {
		code, permanent := "dependency_unavailable", false
		var failed *encoder.Failure
		if errors.As(err, &failed) {
			code, permanent = failed.Code, failed.Permanent
		}
		if parent.Err() != nil {
			code = "shutdown"
		}
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = client.FailJob(cleanup, &pb.FailRequest{Attempt: attempt, ErrorCode: code, Permanent: permanent})
		stop()
	}
	cancel()
	<-heartbeatDone
	if err == nil {
		logger.Info("media_attempt_accepted", "job_id", spec.JobId, "attempt_id", attempt.AttemptId, "epoch", attempt.LeaseEpoch)
	} else {
		logger.Warn("media_attempt_stopped", "job_id", spec.JobId, "attempt_id", attempt.AttemptId, "epoch", attempt.LeaseEpoch)
	}
}
