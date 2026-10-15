package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	pb "github.com/darshpatel1052/PeerShare/services/api/gen/peerscreen/media/v1"
	"github.com/darshpatel1052/PeerShare/services/api/internal/encoder"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Persist the immutable submission in the SAME transaction as source completion.
func queueSubmission(ctx context.Context, tx pgx.Tx, videoID string) error {
	tag, err := tx.Exec(ctx, `INSERT INTO catalog.media_submissions(job_id,owner_id,video_id,generation_id,source_key,source_bytes,source_sha256,recipe_version,prior_attempts)
 SELECT j.id,u.owner_id,j.video_id,j.generation_id,v.source_key,v.source_bytes,u.source_sha256,$2,j.attempt
 FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id JOIN catalog.upload_sessions u ON u.video_id=j.video_id
 WHERE j.video_id=$1 AND u.source_sha256 IS NOT NULL ON CONFLICT(job_id) DO NOTHING`, videoID, encoder.RecipeVersion)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM catalog.media_submissions WHERE video_id=$1)", videoID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrUploadConflict
		}
	}
	_, err = tx.Exec(ctx, "UPDATE catalog.processing_jobs SET distributed=true WHERE video_id=$1", videoID)
	return err
}
func queueCommand(ctx context.Context, tx pgx.Tx, videoID, command string) error {
	_, err := tx.Exec(ctx, "UPDATE catalog.media_submissions SET command=$2,command_id=$3,command_sent_at=NULL,next_attempt_at=now() WHERE video_id=$1", videoID, command, uuid.NewString())
	return err
}

type MediaSubmission struct {
	Spec               *pb.JobSpec
	Submitted          bool
	Command, CommandID string
}

func (s *Store) PendingMediaSubmissions(ctx context.Context) ([]MediaSubmission, error) {
	rows, err := s.Pool.Query(ctx, `SELECT job_id,owner_id,video_id,generation_id,source_key,source_bytes,source_sha256,recipe_version,prior_attempts,submitted_at IS NOT NULL,command,COALESCE(command_id::text,'') FROM catalog.media_submissions WHERE (submitted_at IS NULL OR (command<>'' AND command_sent_at IS NULL)) AND next_attempt_at<=now() ORDER BY created_at LIMIT 20`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []MediaSubmission{}
	for rows.Next() {
		item := MediaSubmission{Spec: &pb.JobSpec{}}
		p := item.Spec
		if err = rows.Scan(&p.JobId, &p.OwnerId, &p.VideoId, &p.GenerationId, &p.SourceKey, &p.SourceBytes, &p.SourceSha256, &p.RecipeVersion, &p.PriorAttempts, &item.Submitted, &item.Command, &item.CommandID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Store) MediaSubmissionSent(ctx context.Context, id, commandID string) error {
	if commandID == "" {
		_, err := s.Pool.Exec(ctx, "UPDATE catalog.media_submissions SET submitted_at=COALESCE(submitted_at,now()) WHERE job_id=$1", id)
		return err
	}
	_, err := s.Pool.Exec(ctx, "UPDATE catalog.media_submissions SET command_sent_at=now() WHERE job_id=$1 AND command_id=$2", id, commandID)
	return err
}
func (s *Store) MediaSubmissionDeferred(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, "UPDATE catalog.media_submissions SET failures=failures+1,next_attempt_at=now()+interval '2 seconds' WHERE job_id=$1", id)
	return err
}
func (s *Store) DistributedJobs(ctx context.Context) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `SELECT j.id FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id
 WHERE j.distributed AND v.deleted_at IS NULL AND (j.state NOT IN('ready','failed','cancelled')
 OR EXISTS(SELECT 1 FROM catalog.media_submissions s WHERE s.job_id=j.id AND s.command='cancel'))
 ORDER BY j.updated_at LIMIT 30`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// Read-model update + inbox insert commit together. Generations, versions, cancellation, and deletion all gate it.
func (s *Store) ApplyMediaSnapshot(ctx context.Context, job *pb.JobSnapshot, acknowledgedCommand ...string) error {
	if job == nil || job.Spec == nil || job.Version < 1 {
		return errors.New("invalid media snapshot")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var videoID, generation, state string
	var version int64
	err = tx.QueryRow(ctx, "SELECT video_id,generation_id,state,media_version FROM catalog.processing_jobs WHERE id=$1 AND distributed FOR UPDATE", job.Spec.JobId).Scan(&videoID, &generation, &state, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if generation != job.Spec.GenerationId || videoID != job.Spec.VideoId {
		return tx.Commit(ctx)
	}
	var command, commandID string
	var commandSent bool
	if err = tx.QueryRow(ctx, "SELECT command,COALESCE(command_id::text,''),command_sent_at IS NOT NULL FROM catalog.media_submissions WHERE job_id=$1 FOR UPDATE", job.Spec.JobId).Scan(&command, &commandID, &commandSent); err != nil {
		return err
	}
	if len(acknowledgedCommand) > 0 && acknowledgedCommand[0] != "" && acknowledgedCommand[0] == commandID {
		if command == "retry" {
			if _, err = tx.Exec(ctx, "UPDATE catalog.media_submissions SET command='',command_id=NULL,command_sent_at=NULL WHERE job_id=$1", job.Spec.JobId); err != nil {
				return err
			}
			command = ""
		} else {
			commandSent = true
			if _, err = tx.Exec(ctx, "UPDATE catalog.media_submissions SET command_sent_at=now() WHERE job_id=$1", job.Spec.JobId); err != nil {
				return err
			}
		}
	}
	tag, err := tx.Exec(ctx, "INSERT INTO catalog.media_event_inbox(event_id,job_id,media_version) VALUES($1,$2,$3) ON CONFLICT(event_id) DO NOTHING", job.EventId, job.Spec.JobId, job.Version)
	if err != nil {
		return err
	}
	// A locally requested cancel/retry is not an authoritative media decision.
	// Reapply an already-seen ready snapshot if that local intent hid completion.
	retireCancellation := job.State == "cancelled" && command == "cancel" && commandSent
	reconcileTerminal := retireCancellation || (job.Version == version && state != job.State &&
		(job.State == "ready" || (command != "retry" && (job.State == "failed" || job.State == "cancelled"))))
	if ((tag.RowsAffected() == 0 || job.Version == version) && !reconcileTerminal) || job.Version < version || generation != job.Spec.GenerationId || videoID != job.Spec.VideoId {
		return tx.Commit(ctx)
	}
	var live bool
	if err = tx.QueryRow(ctx, "SELECT deleted_at IS NULL FROM catalog.videos WHERE id=$1 FOR UPDATE", videoID).Scan(&live); err != nil {
		return err
	}
	if !live {
		return tx.Commit(ctx)
	}
	cancellation := command == "cancel"
	if job.State == "ready" || retireCancellation {
		// The coordinator serializes completion and cancellation under its job
		// lock. A completed encode wins a late cancellation; deletion still wins
		// above. Retire the resolved command so reconciliation can stop.
		if _, err = tx.Exec(ctx, "UPDATE catalog.media_submissions SET command='',command_id=NULL,command_sent_at=NULL WHERE job_id=$1", job.Spec.JobId); err != nil {
			return err
		}
		cancellation = false
	}
	mediaState, processing := job.State, "processing"
	switch job.State {
	case "queued", "retry_wait":
		mediaState = "queued"
		processing = "pending"
	case "running":
		processing = "processing"
	case "ready":
		processing = "ready"
	case "failed":
		processing = "failed"
	case "cancelled", "cancel_requested":
		mediaState = "cancelled"
		processing = "cancelled"
	default:
		return errors.New("invalid media state")
	}
	if cancellation {
		mediaState = "cancelled"
		processing = "cancelled"
	}
	// An event describing the previous cancelled/failed attempt cannot consume
	// a retry that has not received its own coordinator acknowledgement yet.
	if command == "retry" && (job.State == "cancelled" || job.State == "cancel_requested" || job.State == "failed") {
		mediaState, processing = "queued", "pending"
	}
	stage, progress := job.Stage, job.Progress
	if mediaState == "queued" {
		stage, progress = "queued", 0
	}
	if mediaState == "cancelled" {
		stage = "cancelled"
		progress = 0
	}
	var attempt, worker, lease, code any
	if job.AttemptId != "" {
		attempt = job.AttemptId
	}
	if job.WorkerId != "" {
		worker = job.WorkerId
	}
	if job.LeaseExpiresUnixMs > 0 {
		lease = time.UnixMilli(job.LeaseExpiresUnixMs)
	}
	if job.ErrorCode != "" {
		code = job.ErrorCode
	}
	var outputBytes any
	if job.OutputBytes > 0 {
		outputBytes = job.OutputBytes
	}
	if _, err = tx.Exec(ctx, "UPDATE catalog.processing_jobs SET state=$2,stage=$3,progress=$4,attempt=$5,attempt_id=$6,worker_id=$7,lease_expires_at=$8,error_code=$9,output_bytes=$10,media_version=$11,updated_at=now() WHERE id=$1", job.Spec.JobId, mediaState, stage, progress, job.Attempts, attempt, worker, lease, code, outputBytes, job.Version); err != nil {
		return err
	}
	if job.State == "ready" && !cancellation {
		var output encoder.Output
		if json.Unmarshal(job.AcceptedOutputJson, &output) != nil || output.JobID != job.Spec.JobId || output.VideoID != videoID || output.GenerationID != generation || output.AttemptID != job.AttemptId {
			return errors.New("invalid accepted output")
		}
		if _, err = tx.Exec(ctx, "UPDATE catalog.videos SET processing_state='ready',duration_seconds=$2,accepted_generation_id=$3,accepted_attempt_id=$4,manifest_key=$5,integrity_key=$6,thumbnail_key=$7,qualities=$8,updated_at=now() WHERE id=$1", videoID, output.DurationSeconds, generation, output.AttemptID, output.ManifestKey, output.IntegrityKey, output.ThumbnailKey, output.Qualities); err != nil {
			return err
		}
	} else {
		if _, err = tx.Exec(ctx, "UPDATE catalog.videos SET processing_state=$2,updated_at=now() WHERE id=$1", videoID, processing); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
