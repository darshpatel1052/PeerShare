package httpapi

import (
	"bytes"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"time"
)

func (a *App) openOriginal(r *http.Request, key string, limit int64) (io.ReadCloser, error) {
	if a.Objects != nil {
		return a.Objects.Open(r.Context(), a.Objects.Originals, key, limit)
	}
	return os.Open(filepath.Join(a.Config.UploadDir, filepath.FromSlash(key)))
}

// The caller checks publication/ownership before this transport function.
func (a *App) serveObject(w http.ResponseWriter, r *http.Request, key string, limit int64) {
	select {
	case a.mediaSlots <- struct{}{}:
		defer func() { <-a.mediaSlots }()
	default:
		a.error(w, r, 503, "media_busy", "This video is busy. Please try again shortly.")
		return
	}
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
