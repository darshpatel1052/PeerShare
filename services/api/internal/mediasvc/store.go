// Package mediasvc owns media state. It never reads or writes the catalog schema.
package mediasvc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	pb "github.com/darshpatel1052/Peer-Screen/services/api/gen/peerscreen/media/v1"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/encoder"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/objectstore"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"os"
)

const DispatchTopic = "peerscreen.media.dispatch.v1"
const LifecycleTopic = "peerscreen.media.lifecycle.v1"

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	Objects         *objectstore.Remote
	validationSlots chan struct{}
	Pool            *pgxpool.Pool
	MediaRoot       string
}
type Event struct {
	SchemaVersion int    `json:"schema_version"`
	EventID       string `json:"event_id"`
	EventType     string `json:"event_type"`
	AggregateID   string `json:"aggregate_id"`
	JobID         string `json:"job_id"`
	GenerationID  string `json:"generation_id"`
	Version       int64  `json:"version"`
	Snapshot      []byte `json:"snapshot"`
}

func Open(ctx context.Context, url, mediaRoot string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("invalid media database configuration")
	}
	cfg.MaxConns = 6
	cfg.MinConns = 1
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = "3000"
	cfg.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "5000"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, errors.New("media database unavailable")
	}
	return &Store{Pool: pool, MediaRoot: mediaRoot, validationSlots: make(chan struct{}, 1)}, nil
}
func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(2026101401)"); err != nil {
		return err
	}
	// The migration table is created before the checksummed migration so re-runs can verify it.
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS media.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	files, _ := migrations.ReadDir("migrations")
	for _, file := range files {
		sql, err := migrations.ReadFile("migrations/" + file.Name())
		if err != nil {
			return err
		}
		sum := sha256.Sum256(sql)
		hash := hex.EncodeToString(sum[:])
		var previous string
		err = tx.QueryRow(ctx, "SELECT checksum FROM media.schema_migrations WHERE version=$1", file.Name()).Scan(&previous)
		if err == nil {
			if previous != hash {
				return errors.New("applied media migration changed")
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO media.schema_migrations(version,checksum) VALUES($1,$2)", file.Name(), hash); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func validID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.String() == id && id != uuid.Nil.String()
}
func ValidateSpec(spec *pb.JobSpec) error {
	if spec == nil || !validID(spec.JobId) || !validID(spec.OwnerId) || !validID(spec.VideoId) || !validID(spec.GenerationId) || spec.PriorAttempts < 0 || spec.PriorAttempts > 3 || spec.SourceBytes < 1 || spec.SourceBytes > encoder.MaxSourceBytes || len(spec.SourceSha256) != 32 || spec.RecipeVersion != encoder.RecipeVersion || spec.SourceKey != "sources/"+spec.VideoId+"-"+hex.EncodeToString(spec.SourceSha256)+".mp4" {
		return status.Error(codes.InvalidArgument, "invalid immutable job specification")
	}
	return nil
}
func (s *Store) Get(ctx context.Context, id string) (*pb.JobSnapshot, error) {
	if !validID(id) {
		return nil, status.Error(codes.InvalidArgument, "invalid job identifier")
	}
	return readJob(ctx, s.Pool, id, false)
}

type rowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func readJob(ctx context.Context, q rowQuerier, id string, lock bool) (*pb.JobSnapshot, error) {
	query := "SELECT snapshot FROM media.jobs WHERE id=$1"
	if lock {
		query += " FOR UPDATE"
	}
	var data []byte
	err := q.QueryRow(ctx, query, id).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, status.Error(codes.NotFound, "job not found")
	}
	if err != nil {
		return nil, status.Error(codes.Unavailable, "media database unavailable")
	}
	job := &pb.JobSnapshot{}
	if proto.Unmarshal(data, job) != nil {
		return nil, status.Error(codes.Internal, "invalid stored job")
	}
	return job, nil
}
func dbNow(ctx context.Context, tx pgx.Tx) (time.Time, error) {
	var now time.Time
	err := tx.QueryRow(ctx, "SELECT clock_timestamp()").Scan(&now)
	return now, err
}
func emit(ctx context.Context, tx pgx.Tx, job *pb.JobSnapshot, dispatch bool) error {
	topic, kind, id := LifecycleTopic, "media.processing."+job.State, job.EventId
	if dispatch {
		topic, kind, id = DispatchTopic, "media.dispatch", uuid.NewString()
	}
	data, err := proto.Marshal(job)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(Event{1, id, kind, job.Spec.VideoId, job.Spec.JobId, job.Spec.GenerationId, job.Version, data})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "INSERT INTO media.outbox(id,topic,aggregate_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", id, topic, job.Spec.VideoId, payload)
	return err
}
func writeJob(ctx context.Context, tx pgx.Tx, job *pb.JobSnapshot, event bool) error {
	if event {
		job.Version++
		job.EventId = uuid.NewString()
	}
	data, err := proto.Marshal(job)
	if err != nil {
		return err
	}
	var lease any
	if job.LeaseExpiresUnixMs > 0 {
		lease = time.UnixMilli(job.LeaseExpiresUnixMs)
	}
	_, err = tx.Exec(ctx, "UPDATE media.jobs SET snapshot=$2,state=$3,attempts=$4,version=$5,lease_expires_at=$6,updated_at=now() WHERE id=$1", job.Spec.JobId, data, job.State, job.Attempts, job.Version, lease)
	if err != nil {
		return err
	}
	if event {
		return emit(ctx, tx, job, false)
	}
	return nil
}
func (s *Store) Submit(ctx context.Context, spec *pb.JobSpec) (*pb.JobSnapshot, error) {
	if err := ValidateSpec(spec); err != nil {
		return nil, err
	}
	input, _ := proto.MarshalOptions{Deterministic: true}.Marshal(spec)
	hash := sha256.Sum256(input)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	job := &pb.JobSnapshot{Spec: spec, State: "queued", Stage: "queued", Attempts: spec.PriorAttempts, Version: 1, EventId: uuid.NewString()}
	// Serialize equivalent submissions before either unique index is checked.
	// ON CONFLICT(id) alone does not arbitrate the video/generation index.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,2026101403))", spec.JobId); err != nil {
		return nil, err
	}
	if spec.PriorAttempts == 3 {
		job.State = "failed"
		job.Stage = "failed"
		job.ErrorCode = "recovery_exhausted"
	}
	snapshot, _ := proto.Marshal(job)
	tag, err := tx.Exec(ctx, "INSERT INTO media.jobs(id,video_id,generation_id,input_hash,snapshot,state,version,attempts,last_dispatch_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,now()) ON CONFLICT(id) DO NOTHING", spec.JobId, spec.VideoId, spec.GenerationId, hash[:], snapshot, job.State, spec.PriorAttempts)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		var previous []byte
		if err = tx.QueryRow(ctx, "SELECT input_hash FROM media.jobs WHERE id=$1", spec.JobId).Scan(&previous); err != nil {
			return nil, err
		}
		if !bytes.Equal(hash[:], previous) {
			return nil, status.Error(codes.AlreadyExists, "job ID already has different immutable input")
		}
		job, err = readJob(ctx, tx, spec.JobId, false)
		if err != nil {
			return nil, err
		}
	} else {
		if err = emit(ctx, tx, job, false); err != nil {
			return nil, err
		}
		if job.State == "queued" {
			if err = emit(ctx, tx, job, true); err != nil {
				return nil, err
			}
		}
	}
	return job, tx.Commit(ctx)
}
func (s *Store) Claim(ctx context.Context, r *pb.ClaimRequest) (*pb.JobSnapshot, error) {
	if r == nil || !validID(r.JobId) || !validID(r.WorkerId) || !validID(r.ClaimRequestId) {
		return nil, status.Error(codes.InvalidArgument, "invalid claim")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(2026101402)"); err != nil {
		return nil, err
	}
	job, err := readJob(ctx, tx, r.JobId, true)
	if err != nil {
		return nil, err
	}
	now, err := dbNow(ctx, tx)
	if err != nil {
		return nil, err
	}
	var priorJob, priorWorker, priorAttempt string
	var priorEpoch int64
	err = tx.QueryRow(ctx, "SELECT job_id,worker_id,attempt_id,epoch FROM media.claim_requests WHERE request_id=$1", r.ClaimRequestId).Scan(&priorJob, &priorWorker, &priorAttempt, &priorEpoch)
	if err == nil {
		if priorJob != r.JobId || priorWorker != r.WorkerId {
			return nil, status.Error(codes.AlreadyExists, "claim request ID already used")
		}
		if job.State != "running" || job.AttemptId != priorAttempt || job.LeaseEpoch != priorEpoch || job.LeaseExpiresUnixMs <= now.UnixMilli() {
			return nil, status.Error(codes.FailedPrecondition, "claim request has expired")
		}
		return job, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	// One initial global execution slot, even when several workers race across partitions.
	var occupied bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM media.jobs WHERE state IN('running','cancel_requested') AND lease_expires_at>clock_timestamp())").Scan(&occupied); err != nil {
		return nil, err
	}
	if job.State != "queued" || occupied {
		return job, tx.Commit(ctx)
	}
	if job.Attempts >= 3 {
		return nil, status.Error(codes.FailedPrecondition, "attempt budget exhausted")
	}
	job.State = "running"
	job.Stage = "validating"
	job.Progress = 1
	job.Attempts++
	job.LeaseEpoch++
	job.AttemptId = uuid.NewString()
	job.WorkerId = r.WorkerId
	job.ClaimRequestId = r.ClaimRequestId
	job.LeaseExpiresUnixMs = now.Add(60 * time.Second).UnixMilli()
	job.ErrorCode = ""
	if _, err = tx.Exec(ctx, "INSERT INTO media.claim_requests(request_id,job_id,worker_id,attempt_id,epoch) VALUES($1,$2,$3,$4,$5)", r.ClaimRequestId, r.JobId, r.WorkerId, job.AttemptId, job.LeaseEpoch); err != nil {
		return nil, err
	}
	if err = writeJob(ctx, tx, job, true); err != nil {
		return nil, err
	}
	return job, tx.Commit(ctx)
}
func validAttempt(job *pb.JobSnapshot, a *pb.Attempt, now time.Time) bool {
	return a != nil && job.State == "running" && job.Spec.JobId == a.JobId && job.AttemptId == a.AttemptId && job.WorkerId == a.WorkerId && job.LeaseEpoch == a.LeaseEpoch && job.LeaseExpiresUnixMs > now.UnixMilli()
}
func validateAttempt(a *pb.Attempt) error {
	if a == nil || !validID(a.JobId) || !validID(a.AttemptId) || !validID(a.WorkerId) || a.LeaseEpoch < 1 {
		return status.Error(codes.InvalidArgument, "invalid attempt")
	}
	return nil
}
func (s *Store) Heartbeat(ctx context.Context, r *pb.HeartbeatRequest) (*pb.JobSnapshot, error) {
	if r == nil {
		return nil, status.Error(codes.InvalidArgument, "missing heartbeat")
	}
	if err := validateAttempt(r.Attempt); err != nil {
		return nil, err
	}
	if r.Progress < 0 || r.Progress > 99 || !map[string]bool{"validating": true, "encoding": true, "thumbnail": true, "indexing": true}[r.Stage] {
		return nil, status.Error(codes.InvalidArgument, "invalid progress")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	job, err := readJob(ctx, tx, r.Attempt.JobId, true)
	if err != nil {
		return nil, err
	}
	now, err := dbNow(ctx, tx)
	if err != nil {
		return nil, err
	}
	if !validAttempt(job, r.Attempt, now) {
		return nil, status.Error(codes.FailedPrecondition, "attempt is stale or cancelled")
	}
	if r.Progress < job.Progress {
		return nil, status.Error(codes.InvalidArgument, "progress cannot regress")
	}
	changed := job.Stage != r.Stage || job.Progress != r.Progress
	job.Stage = r.Stage
	job.Progress = r.Progress
	job.LeaseExpiresUnixMs = now.Add(60 * time.Second).UnixMilli()
	if err = writeJob(ctx, tx, job, changed); err != nil {
		return nil, err
	}
	return job, tx.Commit(ctx)
}
func (s *Store) Complete(ctx context.Context, r *pb.CompleteRequest) (*pb.JobSnapshot, error) {
	if r == nil {
		return nil, status.Error(codes.InvalidArgument, "missing completion")
	}
	if err := validateAttempt(r.Attempt); err != nil {
		return nil, err
	}
	current, err := s.Get(ctx, r.Attempt.JobId)
	if err != nil {
		return nil, err
	}
	if current.AttemptId != r.Attempt.AttemptId || current.WorkerId != r.Attempt.WorkerId || current.LeaseEpoch != r.Attempt.LeaseEpoch {
		return nil, status.Error(codes.FailedPrecondition, "attempt is stale")
	}
	if current.State == "ready" {
		expected := fmt.Sprintf("videos/%s/%s/%s/output.json", current.Spec.VideoId, current.Spec.GenerationId, current.AttemptId)
		if r.OutputDescriptorKey != expected {
			return nil, status.Error(codes.InvalidArgument, "accepted descriptor differs")
		}
		return current, nil
	}
	spec := current.Spec
	verifyRoot := s.MediaRoot
	verifyJob := encoder.Job{ID: spec.JobId, VideoID: spec.VideoId, GenerationID: spec.GenerationId, AttemptID: current.AttemptId}
	if s.Objects != nil {
		select {
		case s.validationSlots <- struct{}{}:
			defer func() { <-s.validationSlots }()
		default:
			return nil, status.Error(codes.Unavailable, "output validation busy")
		}
		verifyRoot, err = os.MkdirTemp(s.MediaRoot, ".verify-")
		if err != nil {
			return nil, err
		}
		defer os.RemoveAll(verifyRoot)
		if err = s.Objects.DownloadAttempt(ctx, verifyRoot, verifyJob, r.OutputDescriptorKey); err != nil {
			return nil, status.Error(codes.Unavailable, "remote output validation unavailable")
		}
	}
	output, err := encoder.ValidateOutput(ctx, verifyJob, verifyRoot, r.OutputDescriptorKey)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "output descriptor failed validation")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	job, err := readJob(ctx, tx, spec.JobId, true)
	if err != nil {
		return nil, err
	}
	now, err := dbNow(ctx, tx)
	if err != nil {
		return nil, err
	}
	if job.State == "ready" && job.AttemptId == r.Attempt.AttemptId && job.LeaseEpoch == r.Attempt.LeaseEpoch {
		return job, tx.Commit(ctx)
	}
	if !validAttempt(job, r.Attempt, now) {
		return nil, status.Error(codes.FailedPrecondition, "attempt is stale or cancelled")
	}
	job.State = "ready"
	job.Stage = "ready"
	job.Progress = 100
	job.LeaseExpiresUnixMs = 0
	job.ErrorCode = ""
	job.OutputBytes = output.Bytes
	job.AcceptedOutputJson, _ = json.Marshal(output.Output)
	if err = writeJob(ctx, tx, job, true); err != nil {
		return nil, err
	}
	return job, tx.Commit(ctx)
}
func (s *Store) Fail(ctx context.Context, r *pb.FailRequest) (*pb.JobSnapshot, error) {
	if r == nil {
		return nil, status.Error(codes.InvalidArgument, "missing failure")
	}
	if err := validateAttempt(r.Attempt); err != nil {
		return nil, err
	}
	allowed := map[string]bool{"source_unavailable": true, "source_corrupt": true, "unsupported_media": true, "storage_unavailable": true, "processing_failed": true, "processing_interrupted": true, "dependency_unavailable": true, "output_too_large": true, "shutdown": true}
	if !allowed[r.ErrorCode] {
		return nil, status.Error(codes.InvalidArgument, "invalid bounded failure code")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	job, err := readJob(ctx, tx, r.Attempt.JobId, true)
	if err != nil {
		return nil, err
	}
	now, err := dbNow(ctx, tx)
	if err != nil {
		return nil, err
	}
	sameAttempt := job.AttemptId == r.Attempt.AttemptId && job.WorkerId == r.Attempt.WorkerId && job.LeaseEpoch == r.Attempt.LeaseEpoch
	if sameAttempt && job.State == "cancel_requested" {
		job.State = "cancelled"
		job.Stage = "cancelled"
		job.Progress = 0
		job.ErrorCode = ""
		job.LeaseExpiresUnixMs = 0
		if err = writeJob(ctx, tx, job, true); err != nil {
			return nil, err
		}
		return job, tx.Commit(ctx)
	}
	if sameAttempt && ((job.State == "failed" || job.State == "retry_wait") && job.ErrorCode == r.ErrorCode || job.State == "cancelled") {
		return job, tx.Commit(ctx)
	}
	if !validAttempt(job, r.Attempt, now) {
		return nil, status.Error(codes.FailedPrecondition, "attempt is stale or cancelled")
	}
	job.State = "failed"
	job.Stage = "failed"
	job.Progress = 0
	job.ErrorCode = r.ErrorCode
	job.LeaseExpiresUnixMs = 0
	if !r.Permanent && job.Attempts < 3 {
		job.State = "retry_wait"
		job.Stage = "queued"
		if _, err = tx.Exec(ctx, "UPDATE media.jobs SET next_retry_at=now()+(($2+random())*interval '1 second') WHERE id=$1", job.Spec.JobId, 2*job.Attempts); err != nil {
			return nil, err
		}
	}
	if err = writeJob(ctx, tx, job, true); err != nil {
		return nil, err
	}
	return job, tx.Commit(ctx)
}
func (s *Store) Command(ctx context.Context, r *pb.JobRequest, retry bool) (*pb.JobSnapshot, error) {
	if r == nil || !validID(r.JobId) || !validID(r.RequestId) {
		return nil, status.Error(codes.InvalidArgument, "invalid job command")
	}
	action := "cancel"
	if retry {
		action = "retry"
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	job, err := readJob(ctx, tx, r.JobId, true)
	if err != nil {
		return nil, err
	}
	var priorJob, priorAction string
	err = tx.QueryRow(ctx, "SELECT job_id,action FROM media.command_inbox WHERE request_id=$1", r.RequestId).Scan(&priorJob, &priorAction)
	if err == nil {
		if priorJob != r.JobId || priorAction != action {
			return nil, status.Error(codes.AlreadyExists, "command identifier reused")
		}
		return job, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if retry {
		if job.State != "failed" && job.State != "cancelled" {
			return nil, status.Error(codes.FailedPrecondition, "job cannot be retried in this state")
		}
		if job.Attempts >= 3 {
			return nil, status.Error(codes.FailedPrecondition, "attempt budget exhausted")
		}
		job.State = "queued"
		job.Stage = "queued"
		job.Progress = 0
		job.ErrorCode = ""
		job.LeaseExpiresUnixMs = 0
	} else {
		if job.State == "running" || job.State == "cancel_requested" {
			job.State = "cancel_requested"
			job.Stage = "cancelled"
			job.Progress = 0
		} else if job.State != "ready" {
			job.State = "cancelled"
			job.Stage = "cancelled"
			job.Progress = 0
			job.LeaseExpiresUnixMs = 0
		}
	}
	if _, err = tx.Exec(ctx, "INSERT INTO media.command_inbox(request_id,job_id,action) VALUES($1,$2,$3)", r.RequestId, r.JobId, action); err != nil {
		return nil, err
	}
	if err = writeJob(ctx, tx, job, true); err != nil {
		return nil, err
	}
	if retry {
		if err = emit(ctx, tx, job, true); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, "UPDATE media.jobs SET last_dispatch_at=now(),next_retry_at=NULL WHERE id=$1", r.JobId); err != nil {
			return nil, err
		}
	}
	return job, tx.Commit(ctx)
}

// Reap closes the acknowledged-notification crash window and repairs notification loss.
func (s *Store) Reap(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(2026101402)"); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT id FROM media.jobs WHERE (state IN('running','cancel_requested') AND lease_expires_at<=clock_timestamp()) OR (state='retry_wait' AND next_retry_at<=clock_timestamp()) OR (state='queued' AND last_dispatch_at<now()-interval '15 seconds') ORDER BY created_at LIMIT 30 FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		job, err := readJob(ctx, tx, id, false)
		if err != nil {
			return err
		}
		changed := false
		dispatch := true
		if job.State == "cancel_requested" {
			job.State = "cancelled"
			job.Stage = "cancelled"
			job.Progress = 0
			job.LeaseExpiresUnixMs = 0
			changed = true
			dispatch = false
		} else if job.State == "running" {
			job.State = "queued"
			job.Stage = "queued"
			job.Progress = 0
			job.LeaseExpiresUnixMs = 0
			job.ErrorCode = ""
			changed = true
			if job.Attempts >= 3 {
				job.State = "failed"
				job.Stage = "failed"
				job.ErrorCode = "recovery_exhausted"
				dispatch = false
			}
		} else if job.State == "retry_wait" {
			job.State = "queued"
			job.Stage = "queued"
			job.ErrorCode = ""
			changed = true
		}
		if changed {
			if err = writeJob(ctx, tx, job, true); err != nil {
				return err
			}
		}
		if dispatch {
			if err = emit(ctx, tx, job, true); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, "UPDATE media.jobs SET last_dispatch_at=now(),next_retry_at=NULL WHERE id=$1", id); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}
func DecodeEvent(data []byte) (Event, *pb.JobSnapshot, error) {
	var event Event
	if len(data) > 2*1024*1024 || json.Unmarshal(data, &event) != nil || event.SchemaVersion != 1 || !validID(event.EventID) || !validID(event.JobID) || !validID(event.AggregateID) || !validID(event.GenerationID) || event.Version < 1 {
		return event, nil, errors.New("invalid event envelope")
	}
	job := &pb.JobSnapshot{}
	if proto.Unmarshal(event.Snapshot, job) != nil || job.Spec == nil || job.Spec.JobId != event.JobID || job.Spec.VideoId != event.AggregateID || job.Spec.GenerationId != event.GenerationID || job.Version != event.Version {
		return event, nil, errors.New("event identity mismatch")
	}
	if err := ValidateSpec(job.Spec); err != nil {
		return event, nil, errors.New("invalid event specification")
	}
	if event.EventType != "media.dispatch" && (event.EventType != "media.processing."+job.State || event.EventID != job.EventId) {
		return event, nil, errors.New("event state mismatch")
	}
	return event, job, nil
}
