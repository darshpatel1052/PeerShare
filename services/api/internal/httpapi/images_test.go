package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/darshpatel1052/PeerShare/services/api/internal/store"
	"github.com/google/uuid"
)

func imageBytes(t *testing.T) []byte {
	t.Helper()
	frame := image.NewRGBA(image.Rect(0, 0, 2000, 500))
	for y := 0; y < 500; y++ {
		for x := 0; x < 2000; x++ {
			frame.SetRGBA(x, y, color.RGBA{uint8(x % 255), uint8(y % 255), 80, 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, frame); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}
func putImage(t *testing.T, f *testApp, c *http.Client, path string, revision int64, data []byte, origin string) (int, []byte) {
	t.Helper()
	r, _ := http.NewRequest("PUT", f.Server.URL+path, bytes.NewReader(data))
	r.Header.Set("Content-Type", "image/png")
	r.Header.Set("Origin", origin)
	r.Header.Set("If-Match", strconv.FormatInt(revision, 10))
	response, err := c.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return response.StatusCode, body
}
func imagePath(raw string) string { value, _ := url.Parse(raw); return value.Path }

func TestIntegrationCreatorBannerValidationOwnershipRevisionAndPersistence(t *testing.T) {
	f := setup(t)
	owner, other := client(), client()
	registerUser(t, f, owner)
	registerUser(t, f, other)
	channel := createChannel(t, f, owner, "banner-"+uuid.NewString()[:8])
	path := "/api/v1/channels/" + channel.ID + "/banner"
	data := imageBytes(t)
	var oversizedPixels bytes.Buffer
	if err := png.Encode(&oversizedPixels, image.NewGray(image.Rect(0, 0, 8000, 800))); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name   string
		client *http.Client
		data   []byte
		origin string
		status int
	}{
		{"other owner", other, data, "http://localhost:3000", 403},
		{"anonymous", client(), data, "http://localhost:3000", 401},
		{"cross origin", owner, data, "https://other.test", 403},
		{"SVG", owner, []byte(`<svg><script>bad()</script></svg>`), "http://localhost:3000", 422},
		{"oversize", owner, make([]byte, maxImageBody+1), "http://localhost:3000", 413},
		{"too many pixels", owner, oversizedPixels.Bytes(), "http://localhost:3000", 422},
	} {
		t.Run(test.name, func(t *testing.T) {
			status, _ := putImage(t, f, test.client, path, 1, test.data, test.origin)
			if status != test.status {
				t.Fatalf("got %d, want %d", status, test.status)
			}
		})
	}
	status, body := putImage(t, f, owner, path, 1, data, "http://localhost:3000")
	if status != 200 {
		t.Fatalf("save %d %s", status, body)
	}
	var updated store.Channel
	if err := json.Unmarshal(body, &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || updated.BannerURL == "" {
		t.Fatal("missing persisted image/revision")
	}
	status, body, _ = request(t, client(), f.Server.URL, "GET", imagePath(updated.BannerURL), nil, nil)
	if status != 200 {
		t.Fatal("banner should be public")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil || format != "jpeg" || cfg.Width != 1920 || cfg.Height != 480 {
		t.Fatalf("normalized dimensions %v %s %v", cfg, format, err)
	}
	// Recreate the Go application with the same durable store and disk root.
	restarted, err := New(context.Background(), f.App.Config, f.DB, f.App.Redis, f.App.Logger)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(restarted.Handler())
	defer server.Close()
	status, body, _ = request(t, owner, server.URL, "GET", "/api/v1/me", nil, nil)
	if status != 200 || !bytes.Contains(body, []byte(updated.BannerURL)) {
		t.Fatal("banner did not survive application recreation")
	}
	status, _ = putImage(t, f, owner, path, 1, data, "http://localhost:3000")
	if status != 409 {
		t.Fatal("stale artwork write accepted")
	}
	status, _, _ = request(t, owner, f.Server.URL, "DELETE", path, map[string]any{}, map[string]string{"If-Match": "2"})
	if status != 200 {
		t.Fatal("reset failed")
	}
	status, _, _ = request(t, owner, f.Server.URL, "GET", imagePath(updated.BannerURL), nil, nil)
	if status != 404 {
		t.Fatal("retired banner still exposed")
	}
	key := updated.BannerURL[len(updated.BannerURL)-36:]
	filename := filepath.Join(f.App.Config.MediaDir, "images", key+".jpg")
	old := time.Now().Add(-20 * time.Minute)
	os.Chtimes(filename, old, old)
	mustExec(t, f, "UPDATE catalog.creator_images SET created_at=$1 WHERE id=$2", old, key)
	f.App.reconcileCreatorImages()
	if _, err = os.Stat(filename); !os.IsNotExist(err) {
		t.Fatal("retired file not cleaned")
	}
	var count int
	f.DB.Pool.QueryRow(context.Background(), "SELECT count(*) FROM catalog.creator_images").Scan(&count)
	if count != 0 {
		t.Fatal("image quota not released")
	}
}

func TestIntegrationThumbnailPrivacyPublicationResetAndDeletion(t *testing.T) {
	f := setup(t)
	owner := client()
	upload, _ := newUpload(t, f, owner, []byte("test source bytes"))
	path := "/api/v1/videos/" + upload.VideoID + "/thumbnail"
	status, body := putImage(t, f, owner, path, 1, imageBytes(t), "http://localhost:3000")
	if status != 200 {
		t.Fatalf("thumbnail %d %s", status, body)
	}
	var result struct {
		URL string `json:"thumbnail_url"`
	}
	json.Unmarshal(body, &result)
	for _, test := range []struct {
		client *http.Client
		want   int
	}{{owner, 200}, {client(), 404}} {
		status, _, _ = request(t, test.client, f.Server.URL, "GET", imagePath(result.URL), nil, nil)
		if status != test.want {
			t.Fatal("draft thumbnail privacy failure")
		}
	}
	status, body, _ = request(t, owner, f.Server.URL, "GET", "/api/v1/uploads", nil, nil)
	if status != 200 || !bytes.Contains(body, []byte(result.URL)) {
		t.Fatal("studio omitted custom artwork")
	}
	mustExec(t, f, `UPDATE catalog.videos SET processing_state='ready',duration_seconds=3,accepted_generation_id=$2,accepted_attempt_id=$3,manifest_key='fixture/master.m3u8',integrity_key='fixture/integrity.json',thumbnail_key='fixture/thumbnail.jpg',qualities=ARRAY[360] WHERE id=$1`, upload.VideoID, uuid.NewString(), uuid.NewString())
	status, _, _ = request(t, owner, f.Server.URL, "POST", "/api/v1/videos/"+upload.VideoID+"/publish", nil, nil)
	if status != 200 {
		t.Fatal("publish failed")
	}
	status, _, _ = request(t, client(), f.Server.URL, "GET", imagePath(result.URL), nil, nil)
	if status != 200 {
		t.Fatal("published thumbnail not public")
	}
	status, body, _ = request(t, client(), f.Server.URL, "GET", "/api/v1/videos/"+upload.VideoID, nil, nil)
	if status != 200 || !bytes.Contains(body, []byte(result.URL)) {
		t.Fatal("public metadata omitted custom artwork")
	}
	request(t, owner, f.Server.URL, "POST", "/api/v1/videos/"+upload.VideoID+"/unpublish", nil, nil)
	status, _, _ = request(t, client(), f.Server.URL, "GET", imagePath(result.URL), nil, nil)
	if status != 404 {
		t.Fatal("unpublished image exposed")
	}
	current, err := f.DB.Upload(context.Background(), uploadOwner(t, f, upload.ID), upload.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.PublicationState != "unpublished" {
		t.Fatal("unpublish returned video to draft")
	}
	status, _, _ = request(t, owner, f.Server.URL, "DELETE", path, map[string]any{}, map[string]string{"If-Match": strconv.FormatInt(current.Revision, 10)})
	if status != 200 {
		t.Fatal("thumbnail reset failed")
	}
	current, err = f.DB.Upload(context.Background(), uploadOwner(t, f, upload.ID), upload.ID)
	if err != nil || current.ThumbnailImageID != "" {
		t.Fatal("custom thumbnail not reset")
	}
	status, _, _ = request(t, owner, f.Server.URL, "DELETE", "/api/v1/videos/"+upload.VideoID, nil, nil)
	if status != 204 {
		t.Fatal("delete failed")
	}
	status, body, _ = request(t, owner, f.Server.URL, "GET", "/api/v1/uploads", nil, nil)
	if status != 200 || bytes.Contains(body, []byte(upload.VideoID)) {
		t.Fatal("deleted video remains in studio")
	}
}
func uploadOwner(t *testing.T, f *testApp, id string) string {
	t.Helper()
	var owner string
	if err := f.DB.Pool.QueryRow(context.Background(), "SELECT owner_id FROM catalog.upload_sessions WHERE id=$1", id).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	return owner
}
