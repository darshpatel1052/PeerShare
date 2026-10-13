package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
)

func newUpload(t *testing.T, f *testApp, c *http.Client, payload []byte) (store.Upload, store.Me) {
	t.Helper()
	me, _, _ := registerUser(t, f, c)
	channel := createChannel(t, f, c, "media-"+uuid.NewString()[:8])
	hash := sha256.Sum256(payload)
	status, data, _ := request(t, c, f.Server.URL, "POST", "/api/v1/uploads", map[string]any{"channel_id": channel.ID, "title": "Recovery film", "description": "Actual source", "tags": []string{}, "size": len(payload), "part_checksums": []string{hex.EncodeToString(hash[:])}}, map[string]string{"Idempotency-Key": uuid.NewString()})
	if status != 201 {
		t.Fatalf("create %d %s", status, data)
	}
	var u store.Upload
	if err := json.Unmarshal(data, &u); err != nil {
		t.Fatal(err)
	}
	return u, me
}
func partToken(t *testing.T, f *testApp, c *http.Client, u store.Upload, n int) string {
	t.Helper()
	status, data, _ := request(t, c, f.Server.URL, "POST", "/api/v1/uploads/"+u.ID+"/parts/presign", map[string]any{"numbers": []int{n}}, nil)
	if status != 200 {
		t.Fatalf("grant %d %s", status, data)
	}
	var response struct {
		Parts []struct {
			Token string `json:"token"`
		} `json:"parts"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		t.Fatal(err)
	}
	return response.Parts[0].Token
}
func putBytes(t *testing.T, f *testApp, c *http.Client, u store.Upload, n int, payload []byte, token string) int {
	t.Helper()
	req, _ := http.NewRequest("PUT", f.Server.URL+"/api/v1/uploads/"+u.ID+"/parts/"+stringNumber(n), bytes.NewReader(payload))
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Upload-Token", token)
	response, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(response.Body)
	if response.StatusCode >= 500 {
		t.Fatalf("part %d %s", response.StatusCode, data)
	}
	return response.StatusCode
}
func stringNumber(n int) string { return fmt.Sprint(n) }
func completeBytes(t *testing.T, f *testApp, c *http.Client, u store.Upload, payload []byte) {
	t.Helper()
	if status := putBytes(t, f, c, u, 1, payload, partToken(t, f, c, u, 1)); status != 200 {
		t.Fatalf("part %d", status)
	}
	status, data, _ := request(t, c, f.Server.URL, "POST", "/api/v1/uploads/"+u.ID+"/complete", nil, nil)
	if status != 202 {
		t.Fatalf("complete %d %s", status, data)
	}
}
func mustExec(t *testing.T, f *testApp, query string, args ...any) {
	t.Helper()
	if _, err := f.DB.Pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatal(err)
	}
}
func claim(t *testing.T, f *testApp) store.Job {
	t.Helper()
	job, err := f.DB.ClaimJob(context.Background(), uuid.NewString())
	if err != nil || job.ID == "" {
		t.Fatalf("claim %+v %v", job, err)
	}
	return job
}

func TestIntegrationConcurrentUploadAdmissionAndReservation(t *testing.T) {
	f := setup(t)
	c := client()
	me, _, _ := registerUser(t, f, c)
	channel := createChannel(t, f, c, "limits-"+uuid.NewString()[:8])
	ctx := context.Background()
	var wg sync.WaitGroup
	results := make(chan error, 12)
	ids := make(chan string, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, _, e := f.DB.CreateUpload(ctx, me.User.ID, channel.ID, uuid.NewString(), "A", "", []string{}, 10)
			results <- e
			if e == nil {
				ids <- u.ID
			}
		}()
	}
	wg.Wait()
	close(results)
	close(ids)
	admitted := 0
	for err := range results {
		if err == nil {
			admitted++
		} else if !errors.Is(err, store.ErrUploadLimit) {
			t.Fatal(err)
		}
	}
	if admitted != 1 {
		t.Fatalf("concurrent creator admission %d", admitted)
	}
	for id := range ids {
		if err := f.DB.AbortUpload(ctx, me.User.ID, id); err != nil {
			t.Fatal(err)
		}
	}
	f.App.reconcileMedia(ctx)
	// Concurrent equivalent setup requests must return one logical session, never a uniqueness error.
	key := uuid.NewString()
	same := make(chan string, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, _, e := f.DB.CreateUpload(ctx, me.User.ID, channel.ID, key, "A", "", []string{}, 10)
			if e != nil {
				t.Error(e)
			} else {
				same <- u.ID
			}
		}()
	}
	wg.Wait()
	close(same)
	first := ""
	for id := range same {
		if first != "" && id != first {
			t.Fatal("idempotency duplicated draft")
		}
		first = id
	}
	mustExec(t, f, "UPDATE catalog.upload_sessions SET reserved_bytes=$1 WHERE id=$2", store.StorageCeiling, first)
	another := uuid.NewString()
	mustExec(t, f, "INSERT INTO catalog.users(id,email,display_name,password_hash) VALUES($1,$2,'capacity','test-only')", another, another+"@example.test")
	cid := uuid.NewString()
	mustExec(t, f, "INSERT INTO catalog.channels(id,owner_id,handle,title) VALUES($1,$2,$3,'capacity')", cid, another, "cap-"+another[:8])
	_, _, err := f.DB.CreateUpload(ctx, another, cid, uuid.NewString(), "full", "", []string{}, 10)
	if !errors.Is(err, store.ErrUploadLimit) {
		t.Fatalf("storage ceiling %v", err)
	}
	mustExec(t, f, "UPDATE catalog.upload_sessions SET reserved_bytes=0 WHERE id=$1", first)
	// Four platform slots total, including the already-open creator.
	for i := 0; i < 4; i++ {
		owner := uuid.NewString()
		ch := uuid.NewString()
		mustExec(t, f, "INSERT INTO catalog.users(id,email,display_name,password_hash) VALUES($1,$2,'global','test-only')", owner, owner+"@example.test")
		mustExec(t, f, "INSERT INTO catalog.channels(id,owner_id,handle,title) VALUES($1,$2,$3,'global')", ch, owner, "global-"+owner[:8])
		_, _, e := f.DB.CreateUpload(ctx, owner, ch, uuid.NewString(), "global", "", []string{}, 10)
		if i < 3 && e != nil || i == 3 && !errors.Is(e, store.ErrUploadLimit) {
			t.Fatalf("global slot %d %v", i, e)
		}
	}
}
func TestIntegrationPartPermissionsCorruptionAndRepair(t *testing.T) {
	f := setup(t)
	c := client()
	payload := []byte("a verified source")
	u, me := newUpload(t, f, c, payload)
	ctx := context.Background()
	if status := putBytes(t, f, c, u, 1, payload, ""); status != 403 {
		t.Fatalf("missing permission %d", status)
	}
	token := partToken(t, f, c, u, 1)
	mustExec(t, f, "UPDATE catalog.upload_part_grants SET expires_at=now()-interval '1 second' WHERE upload_id=$1", u.ID)
	if status := putBytes(t, f, c, u, 1, payload, token); status != 403 {
		t.Fatalf("expired permission %d", status)
	}
	token = partToken(t, f, c, u, 1)
	if status := putBytes(t, f, c, u, 1, []byte("short"), token); status != 422 {
		t.Fatalf("wrong size %d", status)
	}
	wrong := bytes.Repeat([]byte("x"), len(payload))
	if status := putBytes(t, f, c, u, 1, wrong, token); status != 422 {
		t.Fatalf("wrong checksum %d", status)
	}
	if status := putBytes(t, f, c, u, 1, payload, token); status != 200 {
		t.Fatalf("valid chunk %d", status)
	}
	stored, err := f.DB.Upload(ctx, me.User.ID, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(f.App.Config.UploadDir, stored.Parts[0].StorageKey)
	if err = os.WriteFile(path, wrong, 0600); err != nil {
		t.Fatal(err)
	}
	status, _, _ := request(t, c, f.Server.URL, "POST", "/api/v1/uploads/"+u.ID+"/complete", nil, nil)
	if status != 409 {
		t.Fatalf("corrupt completion %d", status)
	}
	status, data, _ := request(t, c, f.Server.URL, "GET", "/api/v1/uploads/"+u.ID, nil, nil)
	var resumed store.Upload
	json.Unmarshal(data, &resumed)
	if status != 200 || len(resumed.Parts) != 0 {
		t.Fatal("resume must expose verified parts only")
	}
	if status := putBytes(t, f, c, u, 1, payload, token); status != 200 {
		t.Fatalf("repair %d", status)
	}
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/uploads/"+u.ID+"/complete", nil, nil)
	if status != 202 {
		t.Fatal("repaired completion")
	}
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/uploads/"+u.ID+"/complete", nil, nil)
	if status != 200 {
		t.Fatal("completion replay")
	}
	var jobs int
	f.DB.Pool.QueryRow(ctx, "SELECT count(*) FROM catalog.processing_jobs WHERE video_id=$1", u.VideoID).Scan(&jobs)
	if jobs != 1 {
		t.Fatal("completion duplicated jobs")
	}
}
func TestIntegrationWorkerLeaseRecoveryAndStaleCompletion(t *testing.T) {
	f := setup(t)
	c := client()
	payload := []byte("not MP4")
	u, me := newUpload(t, f, c, payload)
	completeBytes(t, f, c, u, payload)
	ctx := context.Background()
	old := claim(t, f)
	if err := f.DB.RecoverJobs(ctx); err != nil {
		t.Fatal(err)
	}
	other, e := f.DB.ClaimJob(ctx, uuid.NewString())
	if e != nil || other.ID != "" {
		t.Fatal("a live lease must survive another API starting")
	}
	mustExec(t, f, "UPDATE catalog.processing_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", old.ID)
	if err := f.DB.RecoverJobs(ctx); err != nil {
		t.Fatal(err)
	}
	current := claim(t, f)
	if current.AttemptID == old.AttemptID || current.GenerationID != old.GenerationID {
		t.Fatal("recovery must preserve generation and replace attempt")
	}
	err := f.DB.FinishProcessing(ctx, old, "old/master.m3u8", "old/integrity.json", "old/thumb.jpg", 2, []int{360}, 100, "")
	if !errors.Is(err, store.ErrUploadConflict) {
		t.Fatal("expired attempt accepted", err)
	}
	if err = f.DB.MutateJob(ctx, me.User.ID, u.VideoID, false); err != nil {
		t.Fatal(err)
	}
	err = f.DB.FinishProcessing(ctx, current, "new/master.m3u8", "new/integrity.json", "new/thumb.jpg", 2, []int{360}, 100, "")
	if !errors.Is(err, store.ErrUploadConflict) {
		t.Fatal("cancelled attempt accepted", err)
	}
	if err = f.DB.MutateJob(ctx, me.User.ID, u.VideoID, true); err != nil {
		t.Fatal(err)
	}
	last := claim(t, f)
	if err = f.DB.DeleteVideo(ctx, me.User.ID, u.VideoID); err != nil {
		t.Fatal(err)
	}
	err = f.DB.FinishProcessing(ctx, last, "new/master.m3u8", "new/integrity.json", "new/thumb.jpg", 2, []int{360}, 100, "")
	if !errors.Is(err, store.ErrUploadConflict) {
		t.Fatal("deleted video resurrected", err)
	}
	f.App.reconcileMedia(ctx)
	var reserved int64
	f.DB.Pool.QueryRow(ctx, "SELECT reserved_bytes FROM catalog.upload_sessions WHERE id=$1", u.ID).Scan(&reserved)
	if reserved != 0 {
		t.Fatal("deleted media reservation retained")
	}
}
func TestIntegrationExpiryAbortAndOrphanReconciliation(t *testing.T) {
	f := setup(t)
	c := client()
	payload := []byte("temporary bytes")
	u, _ := newUpload(t, f, c, payload)
	if status := putBytes(t, f, c, u, 1, payload, partToken(t, f, c, u, 1)); status != 200 {
		t.Fatal(status)
	}
	ctx := context.Background()
	mustExec(t, f, "UPDATE catalog.upload_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", u.ID)
	status, _, _ := request(t, c, f.Server.URL, "POST", "/api/v1/uploads/"+u.ID+"/complete", nil, nil)
	if status != 409 {
		t.Fatalf("expiry completion %d", status)
	}
	orphan := filepath.Join(f.App.Config.UploadDir, "sources", u.VideoID+"-orphan.mp4")
	os.MkdirAll(filepath.Dir(orphan), 0700)
	os.WriteFile(orphan, payload, 0600)
	f.App.reconcileMedia(ctx)
	stored, err := f.DB.Upload(ctx, identityID(t, f, c), u.ID)
	if err != nil || stored.State != "expired" {
		t.Fatal("expiry state", err)
	}
	if _, err = os.Stat(filepath.Join(f.App.Config.UploadDir, u.ID)); !os.IsNotExist(err) {
		t.Fatal("expired parts not removed")
	}
	if _, err = os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatal("completion orphan not removed")
	}
	status, _, _ = request(t, c, f.Server.URL, "DELETE", "/api/v1/uploads/"+u.ID, nil, nil)
	if status != 204 {
		t.Fatal("repeat abort must be safe")
	}
	stage := filepath.Join(f.App.Config.UploadDir, ".source-abandoned.tmp")
	os.WriteFile(stage, payload, 0600)
	at := time.Now().Add(-11 * time.Minute)
	os.Chtimes(stage, at, at)
	f.App.reconcileMedia(ctx)
	if _, err = os.Stat(stage); !os.IsNotExist(err) {
		t.Fatal("staging orphan retained")
	}
}
func identityID(t *testing.T, f *testApp, c *http.Client) string {
	t.Helper()
	status, data, _ := request(t, c, f.Server.URL, "GET", "/api/v1/me", nil, nil)
	var me store.Me
	json.Unmarshal(data, &me)
	if status != 200 {
		t.Fatal(status)
	}
	return me.User.ID
}
func TestIntegrationInvalidMediaAndBoundedRetries(t *testing.T) {
	f := setup(t)
	c := client()
	payload := []byte("this filename could be mp4 but these bytes are not")
	u, me := newUpload(t, f, c, payload)
	completeBytes(t, f, c, u, payload)
	ctx := context.Background()
	for attempt := 0; attempt < 3; attempt++ {
		job := claim(t, f)
		if err := f.App.processMediaJob(ctx, job); err == nil {
			t.Fatal("invalid media accepted")
		}
		stored, e := f.DB.Upload(ctx, me.User.ID, u.ID)
		if e != nil || stored.ProcessingState != "failed" || stored.ErrorCode == nil || *stored.ErrorCode != "unsupported_media" {
			t.Fatalf("failure %+v %v", stored, e)
		}
		err := f.DB.MutateJob(ctx, me.User.ID, u.VideoID, true)
		if attempt < 2 && err != nil || attempt == 2 && !errors.Is(err, store.ErrUploadConflict) {
			t.Fatalf("retry %d %v", attempt, err)
		}
	}
	status, _, _ := request(t, c, f.Server.URL, "POST", "/api/v1/videos/"+u.VideoID+"/publish", nil, nil)
	if status != 409 {
		t.Fatal("invalid media published")
	}
}
func TestIntegrationRealTranscodePrivatePreviewPublicationAndDeletion(t *testing.T) {
	f := setup(t)
	ctx, stop := context.WithTimeout(context.Background(), 40*time.Second)
	defer stop()
	source := filepath.Join(t.TempDir(), "actual.mp4")
	cmd := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=2.5", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", source)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("fixture %v %s", err, out)
	}
	payload, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	c := client()
	u, me := newUpload(t, f, c, payload)
	completeBytes(t, f, c, u, payload)
	job := claim(t, f)
	if err = f.App.processMediaJob(ctx, job); err != nil {
		t.Fatal(err)
	}
	stored, err := f.DB.Upload(ctx, me.User.ID, u.ID)
	if err != nil || stored.ProcessingState != "ready" || stored.PublicationState != "draft" {
		t.Fatalf("private result %+v %v", stored, err)
	}
	status, data, _ := request(t, c, f.Server.URL, "GET", "/api/v1/videos/"+u.VideoID+"/preview", nil, nil)
	if status != 200 {
		t.Fatalf("preview %d %s", status, data)
	}
	var preview struct {
		Playback store.Playback `json:"playback"`
	}
	json.Unmarshal(data, &preview)
	if preview.Playback.PeerSharingAvailable {
		t.Fatal("private preview sharing")
	}
	base := "videos/" + u.VideoID + "/" + job.GenerationID + "/" + job.AttemptID
	manifest := filepath.Join(f.App.Config.MediaDir, filepath.FromSlash(base), "master.m3u8")
	decode := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-nostdin", "-i", manifest, "-f", "null", "-")
	if out, err := decode.CombinedOutput(); err != nil {
		t.Fatalf("actual HLS decode %v %s", err, out)
	}
	var descriptor struct {
		Segments map[string]segmentIntegrity `json:"segments"`
	}
	raw, _ := os.ReadFile(filepath.Join(filepath.Dir(manifest), "integrity.json"))
	if err = json.Unmarshal(raw, &descriptor); err != nil {
		t.Fatal(err)
	}
	if len(descriptor.Segments) == 0 {
		t.Fatal("no verified segments")
	}
	for key, value := range descriptor.Segments {
		raw, e := os.ReadFile(filepath.Join(filepath.Dir(manifest), key))
		hash := sha256.Sum256(raw)
		if e != nil || hex.EncodeToString(hash[:]) != value.SHA256 || int64(len(raw)) != value.Bytes {
			t.Fatal("output descriptor mismatch")
		}
	}
	media := "/api/v1/media/" + base + "/master.m3u8"
	status, _, _ = request(t, client(), f.Server.URL, "GET", media, nil, nil)
	if status != 404 {
		t.Fatal("draft bytes exposed")
	}
	status, _, _ = request(t, c, f.Server.URL, "GET", media, nil, nil)
	if status != 200 {
		t.Fatal("owner draft inaccessible")
	}
	status, _, _ = request(t, c, f.Server.URL, "PATCH", "/api/v1/videos/"+u.VideoID, map[string]any{"title": "Updated film", "description": "Updated", "tags": []string{"edited"}, "revision": stored.Revision}, nil)
	if status != 204 {
		t.Fatal("metadata edit", status)
	}
	status, _, _ = request(t, c, f.Server.URL, "PATCH", "/api/v1/videos/"+u.VideoID, map[string]any{"title": "Stale edit", "description": "", "tags": []string{}, "revision": stored.Revision}, nil)
	if status != 409 {
		t.Fatal("stale metadata edit", status)
	}
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/videos/"+u.VideoID+"/publish", nil, nil)
	if status != 200 {
		t.Fatal("publish", status)
	}
	status, data, _ = request(t, client(), f.Server.URL, "GET", "/api/v1/videos/"+u.VideoID, nil, nil)
	if status != 200 || !strings.Contains(string(data), "Updated film") {
		t.Fatal("public metadata")
	}
	status, data, _ = request(t, client(), f.Server.URL, "GET", media, nil, map[string]string{"Range": "bytes=0-6"})
	if status != 206 || string(data) != "#EXTM3U" {
		t.Fatal("range media", status, string(data))
	}
	status, _, _ = request(t, c, f.Server.URL, "POST", "/api/v1/videos/"+u.VideoID+"/unpublish", nil, nil)
	if status != 200 {
		t.Fatal(status)
	}
	status, _, _ = request(t, client(), f.Server.URL, "GET", media, nil, nil)
	if status != 404 {
		t.Fatal("unpublished media exposed")
	}
	status, _, _ = request(t, c, f.Server.URL, "DELETE", "/api/v1/videos/"+u.VideoID, nil, nil)
	if status != 204 {
		t.Fatal("delete", status)
	}
	f.App.reconcileMedia(ctx)
	if _, err = os.Stat(manifest); !os.IsNotExist(err) {
		t.Fatal("deleted output not cleaned")
	}
}
