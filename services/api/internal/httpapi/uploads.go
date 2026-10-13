package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/jackc/pgx/v5"
)

type createUploadRequest struct {
	ChannelID     string   `json:"channel_id"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Tags          []string `json:"tags"`
	Size          int64    `json:"size"`
	PartChecksums []string `json:"part_checksums"`
}

func (a *App) registerUploads(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/uploads", a.requireIdentity(http.HandlerFunc(a.createUpload)))
	mux.Handle("GET /api/v1/uploads", a.requireIdentity(http.HandlerFunc(a.listOwnedUploads)))
	mux.Handle("GET /api/v1/uploads/{id}", a.requireIdentity(http.HandlerFunc(a.getUpload)))
	mux.Handle("POST /api/v1/uploads/{id}/parts/presign", a.requireIdentity(http.HandlerFunc(a.presignParts)))
	mux.Handle("PUT /api/v1/uploads/{id}/parts/{number}", a.requireIdentity(http.HandlerFunc(a.putUploadPart)))
	mux.Handle("POST /api/v1/uploads/{id}/complete", a.requireIdentity(http.HandlerFunc(a.completeUpload)))
	mux.Handle("DELETE /api/v1/uploads/{id}", a.requireIdentity(http.HandlerFunc(a.abortUpload)))
	mux.Handle("POST /api/v1/uploads/{id}/abort", a.requireIdentity(http.HandlerFunc(a.abortUpload)))
	mux.Handle("POST /api/v1/videos/{id}/publish", a.requireIdentity(http.HandlerFunc(a.publishVideo)))
	mux.Handle("POST /api/v1/videos/{id}/unpublish", a.requireIdentity(http.HandlerFunc(a.unpublishVideo)))
	mux.Handle("GET /api/v1/videos/{id}/preview", a.requireIdentity(http.HandlerFunc(a.previewVideo)))
	mux.Handle("GET /api/v1/videos/{id}/processing", a.requireIdentity(http.HandlerFunc(a.processingVideo)))
	mux.Handle("POST /api/v1/videos/{id}/processing/retry", a.requireIdentity(http.HandlerFunc(a.retryVideo)))
	mux.Handle("POST /api/v1/videos/{id}/processing/cancel", a.requireIdentity(http.HandlerFunc(a.cancelVideo)))
	mux.Handle("DELETE /api/v1/videos/{id}", a.requireIdentity(http.HandlerFunc(a.deleteVideo)))
	mux.Handle("PATCH /api/v1/videos/{id}", a.requireIdentity(http.HandlerFunc(a.editVideo)))
}
func validateVideoDetails(title, description string, tags []string) bool {
	if !validText(title, 1, 200) || !validText(description, 0, 5000) || len(tags) > 10 {
		return false
	}
	for _, tag := range tags {
		if !validText(tag, 1, 32) || tag != strings.TrimSpace(tag) {
			return false
		}
	}
	return true
}
func (a *App) createUpload(w http.ResponseWriter, r *http.Request) {
	if !a.Config.UploadsEnabled {
		a.error(w, r, 403, "uploads_disabled", "New uploads are unavailable on this deployment.")
		return
	}
	var body createUploadRequest
	if !a.decode(w, r, &body) {
		return
	}
	channelID, ok := canonicalID(body.ChannelID)
	if !ok {
		a.error(w, r, 422, "invalid_channel", "Choose a valid channel.")
		return
	}
	title, description := cleanText(body.Title), cleanText(body.Description)
	if body.Tags == nil {
		body.Tags = []string{}
	}
	if !validateVideoDetails(title, description, body.Tags) || body.Size < 1 || body.Size > store.MaxSourceBytes {
		a.error(w, r, 422, "invalid_upload", "Enter a title and choose an MP4 up to 250 MiB, with at most 10 tags.")
		return
	}
	if len(body.PartChecksums) > 0 {
		if len(body.PartChecksums) != int((body.Size+store.PartBytes-1)/store.PartBytes) {
			a.error(w, r, 422, "invalid_checksums", "Provide one SHA-256 checksum for each upload chunk.")
			return
		}
		for _, digest := range body.PartChecksums {
			decoded, err := hex.DecodeString(digest)
			if err != nil || len(decoded) != 32 || digest != strings.ToLower(digest) {
				a.error(w, r, 422, "invalid_checksums", "Use lowercase SHA-256 chunk checksums.")
				return
			}
		}
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 16 || len(key) > 128 {
		a.error(w, r, 400, "idempotency_key_required", "Upload setup requires an Idempotency-Key of 16–128 characters.")
		return
	}
	u, reused, err := a.Store.CreateUpload(r.Context(), identity(r).ID, channelID, key, title, description, body.Tags, body.Size, body.PartChecksums)
	if err != nil {
		if errors.Is(err, store.ErrUploadConflict) {
			a.error(w, r, 409, "idempotency_conflict", "That request key was already used with different video details.")
		} else {
			a.storeError(w, r, err)
		}
		return
	}
	status := 201
	if reused {
		status = 200
	}
	w.Header().Set("Location", "/api/v1/uploads/"+u.ID)
	a.decorateUpload(&u)
	writeJSON(w, status, u)
}
func validUploadID(raw string) (string, bool) { return canonicalID(raw) }
func (a *App) getUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid upload ID.")
		return
	}
	u, err := a.Store.Upload(r.Context(), identity(r).ID, id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if u.State == "open" {
		valid := []store.UploadPart{}
		for _, p := range u.Parts {
			file, e := os.Open(filepath.Join(a.Config.UploadDir, p.StorageKey))
			if e != nil {
				continue
			}
			h := sha256.New()
			n, e := io.Copy(h, io.LimitReader(file, store.PartBytes+1))
			file.Close()
			if e == nil && n == int64(p.Bytes) && hex.EncodeToString(h.Sum(nil)) == p.SHA256 {
				valid = append(valid, p)
			}
		}
		u.Parts = valid
	}
	a.decorateUpload(&u)
	writeJSON(w, 200, u)
}
func (a *App) listOwnedUploads(w http.ResponseWriter, r *http.Request) {
	items, err := a.Store.OwnedUploads(r.Context(), identity(r).ID)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	for i := range items {
		a.decorateUpload(&items[i])
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (a *App) presignParts(w http.ResponseWriter, r *http.Request) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid upload ID.")
		return
	}
	var body struct {
		Numbers []int `json:"numbers"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if len(body.Numbers) < 1 || len(body.Numbers) > 3 {
		a.error(w, r, 422, "invalid_parts", "Request one to three chunk permissions at a time.")
		return
	}
	u, err := a.Store.Upload(r.Context(), identity(r).ID, id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	seen := map[int]bool{}
	for _, n := range body.Numbers {
		if u.PartSize(n) == 0 || seen[n] {
			a.error(w, r, 422, "invalid_parts", "Choose unique chunk numbers within this upload.")
			return
		}
		seen[n] = true
	}
	grants := []map[string]any{}
	for _, n := range body.Numbers {
		token, hash, err := auth.NewSessionToken()
		if err != nil {
			a.storeError(w, r, err)
			return
		}
		expiry, err := a.Store.GrantPart(r.Context(), identity(r).ID, id, n, hash)
		if err != nil {
			a.storeError(w, r, err)
			return
		}
		grants = append(grants, map[string]any{"number": n, "url": fmt.Sprintf("/api/v1/uploads/%s/parts/%d", id, n), "token": token, "bytes": u.PartSize(n), "expires_at": expiry})
	}
	writeJSON(w, 200, map[string]any{"parts": grants})
}
func (a *App) putUploadPart(w http.ResponseWriter, r *http.Request) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid upload ID.")
		return
	}
	number, err := strconv.Atoi(r.PathValue("number"))
	if err != nil || number < 1 || number > 32 {
		a.error(w, r, 400, "invalid_part", "Choose a valid chunk number.")
		return
	}
	u, err := a.Store.Upload(r.Context(), identity(r).ID, id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if err = a.Store.CheckUploadPart(r.Context(), identity(r).ID, id); err != nil {
		a.storeError(w, r, err)
		return
	}
	token := r.Header.Get("Upload-Token")
	if !auth.ValidToken(token) {
		a.error(w, r, 403, "part_permission_required", "Request a fresh upload permission for this chunk.")
		return
	}
	if err = a.Store.ValidPartGrant(r.Context(), id, number, auth.TokenHash(token)); err != nil {
		if errors.Is(err, store.ErrUploadConflict) {
			a.error(w, r, 403, "part_permission_expired", "Request a fresh upload permission for this chunk.")
		} else {
			a.storeError(w, r, err)
		}
		return
	}
	want := u.PartSize(number)
	if want == 0 || r.ContentLength > 0 && r.ContentLength != want {
		a.error(w, r, 422, "invalid_part_size", "This chunk size does not match the upload.")
		return
	}
	if r.Header.Get("Content-Type") != "application/octet-stream" {
		a.error(w, r, 415, "binary_required", "Send upload chunks as application/octet-stream.")
		return
	}
	// Cross-process nonblocking lock prevents duplicate writers from consuming unbounded staging space.
	conn, err := a.Store.Pool.Acquire(r.Context())
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	defer conn.Release()
	lockKey := id + ":" + strconv.Itoa(number)
	var locked bool
	err = conn.QueryRow(r.Context(), "SELECT pg_try_advisory_lock(hashtextextended($1,20061016))", lockKey).Scan(&locked)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if !locked {
		a.error(w, r, 409, "part_busy", "This chunk is already being received. Retry shortly.")
		return
	}
	sessionLocked := false
	defer func() {
		ctx, cancel := cleanupContext()
		defer cancel()
		query := "SELECT pg_advisory_unlock(hashtextextended($1,20061016))"
		if sessionLocked {
			query += ",pg_advisory_unlock_shared(hashtextextended($2,20061017))"
		}
		args := []any{lockKey}
		if sessionLocked {
			args = append(args, id)
		}
		if _, e := conn.Exec(ctx, query, args...); e != nil {
			conn.Hijack().Close(ctx)
		}
	}()
	if err = conn.QueryRow(r.Context(), "SELECT pg_try_advisory_lock_shared(hashtextextended($1,20061017))", id).Scan(&sessionLocked); err != nil {
		a.storeError(w, r, err)
		return
	}
	if !sessionLocked {
		a.error(w, r, 409, "upload_busy", "This upload is being completed or cleaned up. Refresh its state.")
		return
	}
	// Recheck after acquiring the session lock: abort may have won while this request was waiting.
	if err = a.Store.CheckUploadPart(r.Context(), identity(r).ID, id); err != nil {
		a.storeError(w, r, err)
		return
	}
	u, err = a.Store.Upload(r.Context(), identity(r).ID, id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	select {
	case a.partSlots <- struct{}{}:
		defer func() { <-a.partSlots }()
	default:
		a.error(w, r, 429, "upload_busy", "Upload connections are busy. Retry this chunk shortly.")
		return
	}
	dir := filepath.Join(a.Config.UploadDir, id)
	if err = os.MkdirAll(dir, 0700); err != nil {
		a.storeError(w, r, err)
		return
	}
	tmp, err := os.CreateTemp(dir, ".part-*.tmp")
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(tmp, hash), http.MaxBytesReader(w, r.Body, want))
	syncErr := tmp.Sync()
	closeErr := tmp.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || written != want {
		a.error(w, r, 400, "incomplete_part", "The chunk was incomplete. Retry this chunk.")
		return
	}
	digest := hash.Sum(nil)
	digestHex := hex.EncodeToString(digest)
	if len(u.PartChecksums) > 0 && u.PartChecksums[number-1] != digestHex {
		a.error(w, r, 422, "checksum_mismatch", "The selected file does not match this upload's source. Choose the original MP4.")
		return
	}
	for _, old := range u.Parts {
		if old.Number == number && old.SHA256 != digestHex {
			a.error(w, r, 409, "part_conflict", "This chunk already contains different bytes.")
			return
		}
	}
	key := store.PartKey(id, number, digestHex)
	path := filepath.Join(a.Config.UploadDir, key)
	// A content-addressed name is safe to replace with the same verified bytes, including repairing disk corruption.
	if err = os.Rename(tmpName, path); err != nil {
		a.storeError(w, r, err)
		return
	}
	if err = syncDirectory(dir); err != nil {
		a.storeError(w, r, err)
		return
	}
	if err = a.Store.RecordUploadPart(r.Context(), identity(r).ID, id, number, int(written), digest, key); err != nil {
		dbctx, stop := cleanupContext()
		defer stop()
		var referenced bool
		e := a.Store.Pool.QueryRow(dbctx, "SELECT EXISTS(SELECT 1 FROM catalog.upload_parts WHERE upload_id=$1 AND storage_key=$2)", id, key).Scan(&referenced)
		if e == nil && !referenced {
			_ = os.Remove(path)
		}
		a.storeError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"number": number, "bytes": written, "sha256": digestHex})
}
func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func (a *App) completeUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid upload ID.")
		return
	}
	// Only one assembler per upload, across API processes. A timeout can safely retry the same operation.
	conn, err := a.Store.Pool.Acquire(r.Context())
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	defer conn.Release()
	var locked bool
	err = conn.QueryRow(r.Context(), "SELECT pg_try_advisory_lock(hashtextextended($1,20061017))", id).Scan(&locked)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if !locked {
		a.error(w, r, 409, "completion_busy", "This source is being assembled. Refresh its state before retrying.")
		return
	}
	defer func() {
		ctx, cancel := cleanupContext()
		defer cancel()
		if _, e := conn.Exec(ctx, "SELECT pg_advisory_unlock(hashtextextended($1,20061017))", id); e != nil {
			conn.Hijack().Close(ctx)
		}
	}()
	u, err := a.Store.Upload(r.Context(), identity(r).ID, id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if u.State == "completed" {
		writeJSON(w, 200, map[string]any{"video_id": u.VideoID, "processing_state": u.ProcessingState})
		return
	}
	if err = a.Store.CheckUploadPart(r.Context(), identity(r).ID, id); err != nil {
		a.storeError(w, r, err)
		return
	}
	if len(u.Parts) != u.PartCount() {
		a.error(w, r, 409, "parts_missing", "Upload every chunk before completing the source.")
		return
	}
	dir := filepath.Join(a.Config.UploadDir, "sources")
	if err = os.MkdirAll(dir, 0700); err != nil {
		a.storeError(w, r, err)
		return
	}
	tmp, err := os.CreateTemp(dir, ".source-"+u.VideoID+"-*.tmp")
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	defer tmp.Close()
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	sourceHash := sha256.New()
	var total int64
	for i, p := range u.Parts {
		if p.Number != i+1 {
			a.error(w, r, 409, "parts_missing", "A chunk is missing. Refresh and resume this upload.")
			return
		}
		part, err := os.Open(filepath.Join(a.Config.UploadDir, p.StorageKey))
		if err != nil {
			a.error(w, r, 409, "parts_missing", "A stored chunk is unavailable. Resume to repair it.")
			return
		}
		hash := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(tmp, sourceHash, hash), io.LimitReader(part, u.PartSize(p.Number)+1))
		part.Close()
		if copyErr != nil || n != u.PartSize(p.Number) || hex.EncodeToString(hash.Sum(nil)) != p.SHA256 {
			a.error(w, r, 409, "part_corrupt", "A stored chunk failed verification. Resume to repair it.")
			return
		}
		total += n
	}
	if total != u.ExpectedBytes {
		a.error(w, r, 409, "invalid_source_size", "The stored source size does not match this upload.")
		return
	}
	if err = tmp.Sync(); err != nil {
		a.storeError(w, r, err)
		return
	}
	if err = tmp.Close(); err != nil {
		a.storeError(w, r, err)
		return
	}
	digest := sourceHash.Sum(nil)
	sourceKey := filepath.ToSlash(filepath.Join("sources", u.VideoID+"-"+hex.EncodeToString(digest)+".mp4"))
	path := filepath.Join(a.Config.UploadDir, sourceKey)
	if err = os.Rename(tmpName, path); err != nil {
		a.storeError(w, r, err)
		return
	}
	if err = syncDirectory(dir); err != nil {
		a.storeError(w, r, err)
		return
	}
	videoID, err := a.Store.CompleteUpload(r.Context(), identity(r).ID, id, sourceKey, total, digest)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	writeJSON(w, 202, map[string]any{"video_id": videoID, "processing_state": "pending"})
}
func (a *App) abortUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid upload ID.")
		return
	}
	if err := a.Store.AbortUpload(r.Context(), identity(r).ID, id); err != nil {
		a.storeError(w, r, err)
		return
	}
	w.WriteHeader(204)
}
func (a *App) publishVideo(w http.ResponseWriter, r *http.Request)   { a.setPublication(w, r, true) }
func (a *App) unpublishVideo(w http.ResponseWriter, r *http.Request) { a.setPublication(w, r, false) }
func (a *App) setPublication(w http.ResponseWriter, r *http.Request, publish bool) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid video ID.")
		return
	}
	err := a.Store.PublishVideo(r.Context(), identity(r).ID, id, publish)
	if err != nil {
		if errors.Is(err, store.ErrUploadConflict) {
			a.error(w, r, 409, "video_not_ready", "Only the owner can publish a ready video.")
		} else {
			a.storeError(w, r, err)
		}
		return
	}
	state := "unpublished"
	if publish {
		state = "published"
	}
	writeJSON(w, 200, map[string]string{"video_id": id, "publication_state": state})
}
func (a *App) processingVideo(w http.ResponseWriter, r *http.Request) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid video ID.")
		return
	}
	var uploadID string
	err := a.Store.Pool.QueryRow(r.Context(), "SELECT id FROM catalog.upload_sessions WHERE video_id=$1 AND owner_id=$2", id, identity(r).ID).Scan(&uploadID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			a.error(w, r, 404, "not_found", "This video is unavailable.")
		} else {
			a.storeError(w, r, err)
		}
		return
	}
	u, err := a.Store.Upload(r.Context(), identity(r).ID, uploadID)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	a.decorateUpload(&u)
	writeJSON(w, 200, u)
}
func (a *App) retryVideo(w http.ResponseWriter, r *http.Request)  { a.mutateJob(w, r, true) }
func (a *App) cancelVideo(w http.ResponseWriter, r *http.Request) { a.mutateJob(w, r, false) }
func (a *App) mutateJob(w http.ResponseWriter, r *http.Request, retry bool) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid video ID.")
		return
	}
	if err := a.Store.MutateJob(r.Context(), identity(r).ID, id, retry); err != nil {
		a.storeError(w, r, err)
		return
	}
	w.WriteHeader(204)
}
func (a *App) deleteVideo(w http.ResponseWriter, r *http.Request) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid video ID.")
		return
	}
	if err := a.Store.DeleteVideo(r.Context(), identity(r).ID, id); err != nil {
		a.storeError(w, r, err)
		return
	}
	w.WriteHeader(204)
}
func (a *App) editVideo(w http.ResponseWriter, r *http.Request) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid video ID.")
		return
	}
	var body struct {
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
		Revision    int64    `json:"revision"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	body.Title = cleanText(body.Title)
	body.Description = cleanText(body.Description)
	if body.Tags == nil {
		body.Tags = []string{}
	}
	if !validateVideoDetails(body.Title, body.Description, body.Tags) || body.Revision < 1 {
		a.error(w, r, 422, "invalid_video", "Provide valid video details and the current revision.")
		return
	}
	if err := a.Store.EditVideo(r.Context(), identity(r).ID, id, body.Title, body.Description, body.Tags, body.Revision); err != nil {
		a.storeError(w, r, err)
		return
	}
	w.WriteHeader(204)
}

func (a *App) previewVideo(w http.ResponseWriter, r *http.Request) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a valid video ID.")
		return
	}
	video, err := a.Store.PreviewVideo(r.Context(), identity(r).ID, id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	a.decorateVideo(&video, true)
	video.Playback.PeerSharingAvailable = false
	video.Playback.ManifestURL = a.Config.AppOrigin + "/media/" + video.ManifestKey
	video.Playback.IntegrityURL = a.Config.AppOrigin + "/media/" + video.IntegrityKey
	video.ThumbnailURL = a.Config.AppOrigin + "/media/" + video.ThumbnailKey
	writeJSON(w, 200, map[string]any{"id": video.ID, "title": video.Title, "accepted_generation_id": video.GenerationID, "accepted_attempt_id": video.AttemptID, "thumbnail_url": video.ThumbnailURL, "playback": video.Playback})
}
