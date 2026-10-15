package httpapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"time"
)

var errMediaBusy = errors.New("media admission is full")

// Four active buffers retain the existing memory bound. At most 32 further
// reads may wait for two seconds, smoothing viewer starts without an unbounded
// queue. A disconnected viewer releases its admission immediately.
func (a *App) acquireMediaRead(ctx context.Context) (func(), error) {
	select {
	case a.mediaAdmission <- struct{}{}:
	default:
		return nil, errMediaBusy
	}
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	select {
	case a.mediaSlots <- struct{}{}:
		return func() { <-a.mediaSlots; <-a.mediaAdmission }, nil
	case <-ctx.Done():
		<-a.mediaAdmission
		return nil, ctx.Err()
	case <-timer.C:
		<-a.mediaAdmission
		return nil, errMediaBusy
	}
}

func (a *App) openOriginal(r *http.Request, key string, limit int64) (io.ReadCloser, error) {
	if a.Objects != nil {
		return a.Objects.Open(r.Context(), a.Objects.Originals, key, limit)
	}
	return os.Open(filepath.Join(a.Config.UploadDir, filepath.FromSlash(key)))
}

// The caller checks publication/ownership before this transport function.
func (a *App) serveObject(w http.ResponseWriter, r *http.Request, key string, limit int64) {
	release, err := a.acquireMediaRead(r.Context())
	if err != nil {
		if r.Context().Err() != nil {
			return
		}
		a.error(w, r, 503, "media_busy", "This video is busy. Please try again shortly.")
		return
	}
	defer release()
	data, err := a.Objects.Read(r.Context(), a.Objects.Processed, key, limit)
	if err != nil {
		if os.IsNotExist(err) {
			a.error(w, r, 404, "not_found", "This media file is unavailable.")
		} else {
			a.error(w, r, 503, "media_unavailable", "This media file is temporarily unavailable.")
		}
		return
	}
	typeName := mime.TypeByExtension(path.Ext(key))
	if path.Ext(key) == ".ts" {
		typeName = "video/mp2t"
	}
	if path.Ext(key) == ".m3u8" {
		typeName = "application/vnd.apple.mpegurl"
	}
	w.Header().Set("Content-Type", typeName)
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, path.Base(key), time.Time{}, bytes.NewReader(data))
}
