package httpapi

import (
	"context"
	"errors"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/encoder"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
)

type segmentIntegrity = encoder.File

// RunMediaWorker is a bounded executor; PostgreSQL owns queue state and the single global slot.
func (a *App) RunMediaWorker(ctx context.Context) {
	if a.Media != nil {
		a.RunCatalogueWorkers(ctx)
		return
	}
	workerID := uuid.NewString()
	maintenanceDone := make(chan struct{})
	go func() {
		defer close(maintenanceDone)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			a.reconcileMedia(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	defer func() { <-maintenanceDone }()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			job, err := a.Store.ClaimJob(ctx, workerID)
			if err != nil {
				if ctx.Err() == nil {
					a.Logger.Error("media_job_claim_failed", "reason", err.Error())
				}
				continue
			}
			if job.ID == "" {
				continue
			}
			if err = a.processMediaJob(ctx, job); err != nil && ctx.Err() == nil {
				a.Logger.Warn("media_job_stopped", "video_id", job.VideoID, "attempt_id", job.AttemptID, "reason", err.Error())
			}
		}
	}
}
func cleanupContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 3*time.Second)
}

// This adapter retains the Phase 2 recovery tests while the distributed runtime uses the same encoder.
func (a *App) processMediaJob(parent context.Context, job store.Job) error {
	ctx, cancel := context.WithTimeout(parent, 30*time.Minute)
	defer cancel()
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if a.Store.HeartbeatJob(ctx, job) != nil {
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-heartbeatDone }()
	spec := encoder.Job{ID: job.ID, VideoID: job.VideoID, GenerationID: job.GenerationID, AttemptID: job.AttemptID, SourceKey: job.SourceKey, SourceBytes: job.SourceBytes, SourceHash: job.SourceHash}
	result, err := encoder.Process(ctx, spec, a.Config.UploadDir, a.Config.MediaDir, func(stage string, progress int) error { return a.Store.ProcessingProgress(ctx, job, stage, progress) })
	if err != nil {
		dbctx, stop := cleanupContext()
		defer stop()
		if parent.Err() != nil {
			_ = a.Store.ReleaseJob(dbctx, job)
			return err
		}
		code := "dependency_unavailable"
		var failed *encoder.Failure
		if errors.As(err, &failed) {
			code = failed.Code
		}
		_ = a.Store.FinishProcessing(dbctx, job, "", "", "", 0, nil, 0, code)
		return err
	}
	return a.Store.FinishProcessing(ctx, job, result.ManifestKey, result.IntegrityKey, result.ThumbnailKey, result.DurationSeconds, result.Qualities, result.Bytes, "")
}
