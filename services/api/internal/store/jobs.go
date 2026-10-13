package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// A claim is a capability for one immutable attempt. All writes compare its attempt and worker IDs.
type Job struct {
	ID, VideoID, SourceKey, GenerationID, AttemptID, WorkerID string
	SourceBytes                                               int64
	SourceHash                                                []byte
}

func (s *Store) ClaimJob(ctx context.Context, workerID string) (Job, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Job{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20061015)"); err != nil {
		return Job{}, err
	}
	var running bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM catalog.processing_jobs WHERE state='running' AND lease_expires_at>now())").Scan(&running); err != nil {
		return Job{}, err
	}
	if running {
		return Job{}, tx.Commit(ctx)
	}
	var job Job
	err = tx.QueryRow(ctx, `SELECT j.id,j.video_id,v.source_key,v.source_bytes,u.source_sha256,j.generation_id FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id JOIN catalog.upload_sessions u ON u.video_id=v.id WHERE j.state='queued' AND v.deleted_at IS NULL ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`).Scan(&job.ID, &job.VideoID, &job.SourceKey, &job.SourceBytes, &job.SourceHash, &job.GenerationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, tx.Commit(ctx)
	}
	if err != nil {
		return Job{}, err
	}
	job.AttemptID = uuid.NewString()
	job.WorkerID = workerID
	if _, err = tx.Exec(ctx, `UPDATE catalog.processing_jobs SET state='running',stage='validating',progress=1,attempt=attempt+1,attempt_id=$2,worker_id=$3,lease_expires_at=now()+interval '60 seconds',error_code=NULL,updated_at=now() WHERE id=$1`, job.ID, job.AttemptID, workerID); err != nil {
		return Job{}, err
	}
	if _, err = tx.Exec(ctx, "UPDATE catalog.videos SET processing_state='processing',updated_at=now() WHERE id=$1 AND deleted_at IS NULL", job.VideoID); err != nil {
		return Job{}, err
	}
	return job, tx.Commit(ctx)
}
func (s *Store) HeartbeatJob(ctx context.Context, j Job) error {
	tag, err := s.Pool.Exec(ctx, `UPDATE catalog.processing_jobs SET lease_expires_at=now()+interval '60 seconds',updated_at=now() WHERE id=$1 AND attempt_id=$2 AND worker_id=$3 AND state='running' AND lease_expires_at>now()`, j.ID, j.AttemptID, j.WorkerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrUploadConflict
	}
	return nil
}
func (s *Store) ProcessingProgress(ctx context.Context, j Job, stage string, progress int) error {
	tag, err := s.Pool.Exec(ctx, `UPDATE catalog.processing_jobs SET stage=$4,progress=$5,updated_at=now() WHERE id=$1 AND attempt_id=$2 AND worker_id=$3 AND state='running' AND lease_expires_at>now()`, j.ID, j.AttemptID, j.WorkerID, stage, progress)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrUploadConflict
	}
	return nil
}

// No startup-wide requeue: a second process must respect a live worker's lease.
func (s *Store) RecoverJobs(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, `WITH recovered AS (UPDATE catalog.processing_jobs SET state=CASE WHEN attempt>=3 THEN 'failed' ELSE 'queued' END,stage=CASE WHEN attempt>=3 THEN 'failed' ELSE 'queued' END,progress=0,error_code=CASE WHEN attempt>=3 THEN 'recovery_exhausted' ELSE NULL END,worker_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE state='running' AND (lease_expires_at IS NULL OR lease_expires_at<=now()) RETURNING video_id,state) UPDATE catalog.videos v SET processing_state=CASE WHEN recovered.state='failed' THEN 'failed' ELSE 'pending' END,updated_at=now() FROM recovered WHERE v.id=recovered.video_id AND v.deleted_at IS NULL`)
	return err
}
func (s *Store) ReleaseJob(ctx context.Context, j Job) error {
	_, err := s.Pool.Exec(ctx, `WITH released AS (UPDATE catalog.processing_jobs SET state='queued',stage='queued',progress=0,worker_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND attempt_id=$2 AND worker_id=$3 AND state='running' RETURNING video_id) UPDATE catalog.videos v SET processing_state='pending',updated_at=now() FROM released WHERE v.id=released.video_id AND v.deleted_at IS NULL`, j.ID, j.AttemptID, j.WorkerID)
	return err
}
func (s *Store) FinishProcessing(ctx context.Context, j Job, manifest, integrity, thumbnail string, duration int, qualities []int, outputBytes int64, failed string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var valid bool
	err = tx.QueryRow(ctx, `SELECT state='running' AND attempt_id=$2 AND worker_id=$3 AND lease_expires_at>now() FROM catalog.processing_jobs WHERE id=$1 FOR UPDATE`, j.ID, j.AttemptID, j.WorkerID).Scan(&valid)
	if err != nil {
		return translate(err)
	}
	if !valid {
		return ErrUploadConflict
	}
	var live bool
	if err = tx.QueryRow(ctx, "SELECT deleted_at IS NULL FROM catalog.videos WHERE id=$1 FOR UPDATE", j.VideoID).Scan(&live); err != nil {
		return err
	}
	if !live {
		return ErrUploadConflict
	}
	if failed != "" {
		if _, err = tx.Exec(ctx, `UPDATE catalog.processing_jobs SET state='failed',stage='failed',progress=0,error_code=$2,lease_expires_at=NULL,updated_at=now() WHERE id=$1`, j.ID, failed); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "UPDATE catalog.videos SET processing_state='failed',updated_at=now() WHERE id=$1", j.VideoID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if outputBytes <= 0 || outputBytes > MaxOutputBytes {
		return ErrUploadLimit
	}
	if _, err = tx.Exec(ctx, `UPDATE catalog.videos SET processing_state='ready',duration_seconds=$2,accepted_generation_id=$3,accepted_attempt_id=$4,manifest_key=$5,integrity_key=$6,thumbnail_key=$7,qualities=$8,updated_at=now() WHERE id=$1`, j.VideoID, duration, j.GenerationID, j.AttemptID, manifest, integrity, thumbnail, qualities); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE catalog.processing_jobs SET state='ready',stage='ready',progress=100,error_code=NULL,lease_expires_at=NULL,output_bytes=$2,updated_at=now() WHERE id=$1`, j.ID, outputBytes); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
func (s *Store) MutateJob(ctx context.Context, ownerID, videoID string, retry bool) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var size, previous int64
	var cleaned bool
	if retry {
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20061014)"); err != nil {
			return err
		}
		if err = tx.QueryRow(ctx, `SELECT u.expected_bytes,u.reserved_bytes,u.parts_cleaned FROM catalog.upload_sessions u JOIN catalog.videos v ON v.id=u.video_id WHERE u.video_id=$1 AND u.owner_id=$2 AND v.deleted_at IS NULL FOR UPDATE OF u`, videoID, ownerID).Scan(&size, &previous, &cleaned); err != nil {
			return translate(err)
		}
	}
	var jobID, state string
	var attempts int
	err = tx.QueryRow(ctx, `SELECT j.id,j.state,j.attempt FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id=$1 AND c.owner_id=$2 AND v.deleted_at IS NULL FOR UPDATE OF j`, videoID, ownerID).Scan(&jobID, &state, &attempts)
	if err != nil {
		return translate(err)
	}
	if retry {
		if state == "queued" || state == "running" {
			return tx.Commit(ctx)
		}
		if (state != "failed" && state != "cancelled") || attempts >= 3 {
			return ErrUploadConflict
		}
		reservation := size + DerivativeReservation + StagingAllowance
		if !cleaned {
			reservation += size
		}
		var used int64
		if err = tx.QueryRow(ctx, "SELECT COALESCE(sum(reserved_bytes),0) FROM catalog.upload_sessions").Scan(&used); err != nil {
			return err
		}
		if used-previous+reservation+StagingAllowance > StorageCeiling {
			return ErrUploadLimit
		}
		if _, err = tx.Exec(ctx, "UPDATE catalog.upload_sessions SET reserved_bytes=$2 WHERE video_id=$1", videoID, reservation); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE catalog.processing_jobs SET state='queued',stage='queued',progress=0,error_code=NULL,worker_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`, jobID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "UPDATE catalog.videos SET processing_state='pending',updated_at=now() WHERE id=$1", videoID); err != nil {
			return err
		}
	} else {
		if state == "cancelled" {
			return tx.Commit(ctx)
		}
		if state == "ready" {
			return ErrUploadConflict
		}
		if _, err = tx.Exec(ctx, `UPDATE catalog.processing_jobs SET state='cancelled',stage='cancelled',progress=0,lease_expires_at=NULL,updated_at=now() WHERE id=$1`, jobID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "UPDATE catalog.videos SET processing_state='cancelled',updated_at=now() WHERE id=$1", videoID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) DeleteVideo(ctx context.Context, ownerID, videoID string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Lock upload before job/video, matching source completion; job completion never locks an open upload.
	if _, err = tx.Exec(ctx, `SELECT id FROM catalog.upload_sessions WHERE video_id=$1 AND owner_id=$2 FOR UPDATE`, videoID, ownerID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `SELECT j.id FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id=$1 AND c.owner_id=$2 FOR UPDATE OF j`, videoID, ownerID); err != nil {
		return err
	}
	var found string
	if err = tx.QueryRow(ctx, `SELECT v.id FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id=$1 AND c.owner_id=$2 FOR UPDATE OF v`, videoID, ownerID).Scan(&found); err != nil {
		return translate(err)
	}
	if _, err = tx.Exec(ctx, "UPDATE catalog.videos SET deleted_at=COALESCE(deleted_at,now()),publication_state='unpublished',published_at=NULL,updated_at=now() WHERE id=$1", videoID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE catalog.processing_jobs SET state='cancelled',stage='cancelled',lease_expires_at=NULL WHERE video_id=$1", videoID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE catalog.upload_sessions SET state=CASE WHEN state='open' THEN 'aborted' ELSE state END,cleanup_done=false,updated_at=now() WHERE video_id=$1", videoID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) EditVideo(ctx context.Context, ownerID, id, title, description string, tags []string, revision int64) error {
	tag, err := s.Pool.Exec(ctx, `UPDATE catalog.videos v SET title=$3,description=$4,tags=$5,revision=v.revision+1,updated_at=now() FROM catalog.channels c WHERE v.id=$1 AND c.id=v.channel_id AND c.owner_id=$2 AND v.deleted_at IS NULL AND v.revision=$6`, id, ownerID, title, description, tags, revision)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		var owned bool
		if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id=$1 AND c.owner_id=$2 AND v.deleted_at IS NULL)`, id, ownerID).Scan(&owned); err != nil {
			return err
		}
		if !owned {
			return ErrNotFound
		}
		return ErrRevisionConflict
	}
	return nil
}

type Cleanup struct {
	ID, VideoID, State, SourceKey string
	Deleted                       bool
}

func (s *Store) CleanupCandidates(ctx context.Context) ([]Cleanup, error) {
	if _, err := s.Pool.Exec(ctx, `WITH expired AS (UPDATE catalog.upload_sessions SET state='expired',updated_at=now() WHERE state='open' AND expires_at<=now() RETURNING video_id) UPDATE catalog.videos v SET processing_state='cancelled',updated_at=now() FROM expired WHERE v.id=expired.video_id`); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT u.id,u.video_id,u.state,COALESCE(v.source_key,''),v.deleted_at IS NOT NULL FROM catalog.upload_sessions u JOIN catalog.videos v ON v.id=u.video_id WHERE ((u.state IN ('aborted','expired') OR v.deleted_at IS NOT NULL) AND NOT u.cleanup_done) OR (u.state='completed' AND NOT u.parts_cleaned) ORDER BY u.updated_at LIMIT 30`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Cleanup{}
	for rows.Next() {
		var c Cleanup
		if err = rows.Scan(&c.ID, &c.VideoID, &c.State, &c.SourceKey, &c.Deleted); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Store) MarkCleaned(ctx context.Context, c Cleanup) error {
	if c.Deleted || c.State == "aborted" || c.State == "expired" {
		_, err := s.Pool.Exec(ctx, `UPDATE catalog.upload_sessions SET reserved_bytes=0,parts_cleaned=true,cleanup_done=true WHERE id=$1 AND (state IN ('aborted','expired') OR EXISTS(SELECT 1 FROM catalog.videos WHERE id=video_id AND deleted_at IS NOT NULL))`, c.ID)
		return err
	}
	_, err := s.Pool.Exec(ctx, `UPDATE catalog.upload_sessions u SET reserved_bytes=expected_bytes+GREATEST(COALESCE((SELECT output_bytes FROM catalog.processing_jobs WHERE video_id=u.video_id),0),$2),parts_cleaned=true WHERE id=$1 AND state='completed' AND NOT parts_cleaned`, c.ID, DerivativeReservation+StagingAllowance)
	return err
}
func (s *Store) SourceReferenced(ctx context.Context, key string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM catalog.videos WHERE source_key=$1 AND deleted_at IS NULL)", key).Scan(&exists)
	return exists, err
}
func (s *Store) AttemptReferenced(ctx context.Context, attempt string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id WHERE j.attempt_id=$1 AND j.state='running' AND j.lease_expires_at>now() AND v.deleted_at IS NULL) OR EXISTS(SELECT 1 FROM catalog.videos WHERE accepted_attempt_id=$1 AND deleted_at IS NULL)`, attempt).Scan(&exists)
	return exists, err
}

// Time is supplied only for filesystem grace-period selection, never for DB lease decisions.
const OrphanGrace = 10 * time.Minute

// After the orphan grace period and a successful disk sweep, settle terminal jobs to verified stored sizes.
func (s *Store) SettleReservations(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20061014)"); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE catalog.upload_sessions u SET reserved_bytes=u.expected_bytes+COALESCE(j.output_bytes,0) FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id WHERE u.video_id=j.video_id AND u.state='completed' AND u.parts_cleaned AND NOT u.cleanup_done AND v.deleted_at IS NULL AND j.state IN ('ready','failed','cancelled') AND j.updated_at<now()-interval '10 minutes'`)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
