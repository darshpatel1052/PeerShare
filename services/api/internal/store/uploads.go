package store

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const PartBytes = 8 * 1024 * 1024
const MaxSourceBytes int64 = 250 * 1024 * 1024
const MaxOutputBytes int64 = 220 * 1024 * 1024
const StorageCeiling int64 = 20 * 1024 * 1024 * 1024
const DerivativeReservation = 3 * MaxOutputBytes
const StagingAllowance int64 = 128 * 1024 * 1024

var ErrUploadConflict = errors.New("upload state conflict")
var ErrUploadLimit = errors.New("upload policy limit")

type Upload struct {
	ID               string       `json:"id"`
	VideoID          string       `json:"video_id"`
	Title            string       `json:"title"`
	Description      string       `json:"description"`
	Tags             []string     `json:"tags"`
	Revision         int64        `json:"revision"`
	ExpectedBytes    int64        `json:"expected_bytes"`
	PartBytes        int          `json:"part_bytes"`
	Parts            []UploadPart `json:"parts"`
	PartChecksums    []string     `json:"part_checksums"`
	State            string       `json:"state"`
	ProcessingState  string       `json:"processing_state"`
	ProcessingStage  string       `json:"processing_stage"`
	Progress         int          `json:"progress"`
	ErrorCode        *string      `json:"error_code"`
	PublicationState string       `json:"publication_state"`
	ExpiresAt        time.Time    `json:"expires_at"`
	JobID            *string      `json:"job_id"`
}
type UploadPart struct {
	Number     int    `json:"number"`
	Bytes      int    `json:"bytes"`
	SHA256     string `json:"sha256"`
	StorageKey string `json:"-"`
}

const uploadSelect = `SELECT u.id,u.video_id,v.title,v.description,v.tags,v.revision,u.expected_bytes,u.part_bytes,u.part_checksums,u.state,v.processing_state,COALESCE(j.stage,'queued'),COALESCE(j.progress,0),j.error_code,v.publication_state,u.expires_at,j.id FROM catalog.upload_sessions u JOIN catalog.videos v ON v.id=u.video_id LEFT JOIN catalog.processing_jobs j ON j.video_id=v.id `

func scanUpload(row pgx.Row) (Upload, error) {
	var u Upload
	err := row.Scan(&u.ID, &u.VideoID, &u.Title, &u.Description, &u.Tags, &u.Revision, &u.ExpectedBytes, &u.PartBytes, &u.PartChecksums, &u.State, &u.ProcessingState, &u.ProcessingStage, &u.Progress, &u.ErrorCode, &u.PublicationState, &u.ExpiresAt, &u.JobID)
	u.Parts = []UploadPart{}
	if u.PartChecksums == nil {
		u.PartChecksums = []string{}
	}
	return u, translate(err)
}

// The global admission lock serializes the read-count/reserve transaction, including idempotent retries.
func (s *Store) CreateUpload(ctx context.Context, ownerID, channelID, key, title, description string, tags []string, size int64, checksums ...[]string) (Upload, bool, error) {
	expected := []string{}
	if len(checksums) > 0 && checksums[0] != nil {
		expected = checksums[0]
	}
	fingerprint, _ := json.Marshal(struct {
		ChannelID, Title, Description string
		Tags                          []string
		Size                          int64
		Checksums                     []string
	}{channelID, title, description, tags, size, expected})
	sum := sha256.Sum256(fingerprint)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Upload{}, false, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20061014)"); err != nil {
		return Upload{}, false, err
	}
	existing, err := scanUpload(tx.QueryRow(ctx, uploadSelect+"WHERE u.owner_id=$1 AND u.idempotency_key=$2", ownerID, key))
	if err == nil {
		var previous []byte
		if err = tx.QueryRow(ctx, "SELECT request_fingerprint FROM catalog.upload_sessions WHERE id=$1", existing.ID).Scan(&previous); err != nil {
			return Upload{}, false, err
		}
		if string(previous) != string(sum[:]) {
			return Upload{}, false, ErrUploadConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return Upload{}, false, err
		}
		existing, err = s.Upload(ctx, ownerID, existing.ID)
		return existing, true, err
	}
	if !errors.Is(err, ErrNotFound) {
		return Upload{}, false, err
	}
	var owned string
	if err = tx.QueryRow(ctx, "SELECT id FROM catalog.channels WHERE id=$1 AND owner_id=$2", channelID, ownerID).Scan(&owned); err != nil {
		return Upload{}, false, translate(err)
	}
	var own, active int
	var used int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FILTER(WHERE owner_id=$1 AND state='open' AND expires_at>now()),count(*) FILTER(WHERE state='open' AND expires_at>now()),COALESCE(sum(reserved_bytes),0) FROM catalog.upload_sessions`, ownerID).Scan(&own, &active, &used); err != nil {
		return Upload{}, false, err
	}
	reservation := size*2 + DerivativeReservation + StagingAllowance
	if own >= 1 || active >= 4 || used+reservation+StagingAllowance > StorageCeiling {
		return Upload{}, false, ErrUploadLimit
	}
	videoID, uploadID := uuid.NewString(), uuid.NewString()
	if _, err = tx.Exec(ctx, `INSERT INTO catalog.videos(id,channel_id,title,description,tags,source_kind) VALUES($1,$2,$3,$4,$5,'upload')`, videoID, channelID, title, description, tags); err != nil {
		return Upload{}, false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO catalog.upload_sessions(id,video_id,owner_id,idempotency_key,request_fingerprint,expected_bytes,part_checksums,reserved_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, uploadID, videoID, ownerID, key, sum[:], size, expected, reservation); err != nil {
		return Upload{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Upload{}, false, err
	}
	u, err := s.Upload(ctx, ownerID, uploadID)
	return u, false, err
}
func (s *Store) Upload(ctx context.Context, ownerID, id string) (Upload, error) {
	u, err := scanUpload(s.Pool.QueryRow(ctx, uploadSelect+"WHERE u.id=$1 AND u.owner_id=$2 AND v.deleted_at IS NULL", id, ownerID))
	if err != nil {
		return u, err
	}
	rows, err := s.Pool.Query(ctx, "SELECT part_number,byte_length,encode(sha256,'hex'),storage_key FROM catalog.upload_parts WHERE upload_id=$1 ORDER BY part_number", id)
	if err != nil {
		return u, err
	}
	defer rows.Close()
	for rows.Next() {
		var p UploadPart
		if err = rows.Scan(&p.Number, &p.Bytes, &p.SHA256, &p.StorageKey); err != nil {
			return u, err
		}
		u.Parts = append(u.Parts, p)
	}
	return u, rows.Err()
}
func (s *Store) OwnedUploads(ctx context.Context, ownerID string) ([]Upload, error) {
	rows, err := s.Pool.Query(ctx, uploadSelect+"WHERE u.owner_id=$1 AND v.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT 30", ownerID)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for rows.Next() {
		u, e := scanUpload(rows)
		if e != nil {
			rows.Close()
			return nil, e
		}
		ids = append(ids, u.ID)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	out := []Upload{}
	for _, id := range ids {
		u, e := s.Upload(ctx, ownerID, id)
		if errors.Is(e, ErrNotFound) {
			continue
		}
		if e != nil {
			return nil, e
		}
		out = append(out, u)
	}
	return out, nil
}
func (u Upload) PartCount() int { return int((u.ExpectedBytes + PartBytes - 1) / PartBytes) }
func (u Upload) PartSize(number int) int64 {
	if number < 1 || number > u.PartCount() {
		return 0
	}
	if number == u.PartCount() {
		return u.ExpectedBytes - int64(number-1)*PartBytes
	}
	return PartBytes
}
func PartKey(uploadID string, number int, digest ...string) string {
	suffix := ""
	if len(digest) > 0 {
		suffix = "-" + digest[0]
	}
	return fmt.Sprintf("%s/part-%03d%s", uploadID, number, suffix)
}
func (s *Store) CheckUploadPart(ctx context.Context, ownerID, id string) error {
	var found bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.upload_sessions u JOIN catalog.videos v ON v.id=u.video_id WHERE u.id=$1 AND u.owner_id=$2 AND u.state='open' AND u.expires_at>now() AND v.deleted_at IS NULL)`, id, ownerID).Scan(&found)
	if err != nil {
		return err
	}
	if !found {
		return ErrUploadConflict
	}
	return nil
}
func (s *Store) RecordUploadPart(ctx context.Context, ownerID, uploadID string, number, bytes int, digest []byte, key string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var u Upload
	var state string
	var valid bool
	err = tx.QueryRow(ctx, `SELECT expected_bytes,state,expires_at>now() FROM catalog.upload_sessions WHERE id=$1 AND owner_id=$2 FOR UPDATE`, uploadID, ownerID).Scan(&u.ExpectedBytes, &state, &valid)
	if err != nil {
		return translate(err)
	}
	if state != "open" || !valid || int64(bytes) != u.PartSize(number) {
		return ErrUploadConflict
	}
	var old []byte
	var oldSize int
	err = tx.QueryRow(ctx, "SELECT sha256,byte_length FROM catalog.upload_parts WHERE upload_id=$1 AND part_number=$2", uploadID, number).Scan(&old, &oldSize)
	if err == nil {
		if oldSize != bytes || string(old) != string(digest) {
			return ErrUploadConflict
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO catalog.upload_parts(upload_id,part_number,byte_length,sha256,storage_key) VALUES($1,$2,$3,$4,$5)`, uploadID, number, bytes, digest, key); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) CompleteUpload(ctx context.Context, ownerID, id, sourceKey string, total int64, hash ...[]byte) (string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var videoID, state string
	var expected int64
	var valid bool
	err = tx.QueryRow(ctx, `SELECT video_id,expected_bytes,state,expires_at>now() FROM catalog.upload_sessions WHERE id=$1 AND owner_id=$2 FOR UPDATE`, id, ownerID).Scan(&videoID, &expected, &state, &valid)
	if err != nil {
		return "", translate(err)
	}
	if state == "completed" {
		return videoID, tx.Commit(ctx)
	}
	if state != "open" || !valid || total != expected {
		return "", ErrUploadConflict
	}
	var parts int
	var stored int64
	if err = tx.QueryRow(ctx, "SELECT count(*),COALESCE(sum(byte_length),0) FROM catalog.upload_parts WHERE upload_id=$1", id).Scan(&parts, &stored); err != nil {
		return "", err
	}
	if parts != int((expected+PartBytes-1)/PartBytes) || stored != expected {
		return "", ErrUploadConflict
	}
	var digest []byte
	if len(hash) > 0 {
		digest = hash[0]
	}
	if _, err = tx.Exec(ctx, `UPDATE catalog.upload_sessions SET state='completed',source_sha256=$2,updated_at=now() WHERE id=$1`, id, digest); err != nil {
		return "", err
	}
	if _, err = tx.Exec(ctx, `UPDATE catalog.videos SET source_key=$1,source_bytes=$2,updated_at=now() WHERE id=$3 AND deleted_at IS NULL`, sourceKey, total, videoID); err != nil {
		return "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO catalog.processing_jobs(id,video_id) VALUES($1,$2) ON CONFLICT(video_id) DO NOTHING`, uuid.NewString(), videoID); err != nil {
		return "", err
	}
	return videoID, tx.Commit(ctx)
}
func (s *Store) AbortUpload(ctx context.Context, ownerID, id string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var videoID, state string
	if err = tx.QueryRow(ctx, "SELECT video_id,state FROM catalog.upload_sessions WHERE id=$1 AND owner_id=$2 FOR UPDATE", id, ownerID).Scan(&videoID, &state); err != nil {
		return translate(err)
	}
	if state == "aborted" || state == "expired" {
		return tx.Commit(ctx)
	}
	if state != "open" {
		return ErrUploadConflict
	}
	if _, err = tx.Exec(ctx, "UPDATE catalog.upload_sessions SET state='aborted',updated_at=now() WHERE id=$1", id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE catalog.videos SET processing_state='cancelled',updated_at=now() WHERE id=$1", videoID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Grants are scoped to an authenticated owner, one part and ten minutes. Only token hashes persist.
func (s *Store) GrantPart(ctx context.Context, ownerID, id string, number int, hash []byte) (time.Time, error) {
	var expiry time.Time
	err := s.Pool.QueryRow(ctx, `INSERT INTO catalog.upload_part_grants(upload_id,part_number,token_hash,expires_at) SELECT id,$3,$4,LEAST(expires_at,now()+interval '10 minutes') FROM catalog.upload_sessions WHERE id=$1 AND owner_id=$2 AND state='open' AND expires_at>now() AND $3 BETWEEN 1 AND ((expected_bytes+8388607)/8388608) ON CONFLICT(upload_id,part_number) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at RETURNING expires_at`, id, ownerID, number, hash).Scan(&expiry)
	return expiry, translate(err)
}
func (s *Store) ValidPartGrant(ctx context.Context, id string, number int, hash []byte) error {
	var ok bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.upload_part_grants WHERE upload_id=$1 AND part_number=$2 AND token_hash=$3 AND expires_at>now())`, id, number, hash).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrUploadConflict
	}
	return nil
}
func (s *Store) PublishVideo(ctx context.Context, ownerID, videoID string, publish bool) error {
	state := "unpublished"
	if publish {
		state = "published"
	}
	tag, err := s.Pool.Exec(ctx, `UPDATE catalog.videos v SET publication_state=$1,published_at=CASE WHEN $1='published' THEN COALESCE(published_at,now()) ELSE NULL END,revision=v.revision+1,updated_at=now() FROM catalog.channels c WHERE v.id=$2 AND v.channel_id=c.id AND c.owner_id=$3 AND v.processing_state='ready' AND v.deleted_at IS NULL`, state, videoID, ownerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUploadConflict
	}
	return nil
}
func (s *Store) CanReadProcessedMedia(ctx context.Context, ownerID, videoID, generationID, attemptID string) (bool, error) {
	var allowed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id=$1 AND v.accepted_generation_id=$2 AND v.accepted_attempt_id=$3 AND v.deleted_at IS NULL AND v.processing_state='ready' AND (v.publication_state='published' OR c.owner_id=NULLIF($4,'')::uuid))`, videoID, generationID, attemptID, ownerID).Scan(&allowed)
	return allowed, err
}
