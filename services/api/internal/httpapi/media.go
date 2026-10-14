package httpapi

import (
	"errors"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/google/uuid"
)

func (a *App) getProcessedMedia(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	parts := strings.Split(key, "/")
	if len(parts) < 5 || len(parts) > 6 || parts[0] != "videos" || strings.Contains(key, "\\") || strings.Contains(key, "..") {
		a.error(w, r, 404, "not_found", "This media file is unavailable.")
		return
	}
	ids := make([]string, 3)
	for i := range ids {
		id, err := uuid.Parse(parts[i+1])
		if err != nil || id.String() != parts[i+1] {
			a.error(w, r, 404, "not_found", "This media file is unavailable.")
			return
		}
		ids[i] = id.String()
	}
	fileName := parts[len(parts)-1]
	ext := filepath.Ext(fileName)
	if ext != ".m3u8" && ext != ".ts" && ext != ".json" && ext != ".jpg" {
		a.error(w, r, 404, "not_found", "This media file is unavailable.")
		return
	}
	ownerID := ""
	if cookie, err := r.Cookie(a.Config.CookieName); err == nil && auth.ValidToken(cookie.Value) {
		if user, sessionErr := a.Store.SessionUser(r.Context(), auth.TokenHash(cookie.Value)); sessionErr == nil {
			ownerID = user.ID
		}
	}
	allowed, err := a.Store.CanReadProcessedMedia(r.Context(), ownerID, ids[0], ids[1], ids[2])
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if !allowed {
		a.error(w, r, 404, "not_found", "This media file is unavailable.")
		return
	}
	if a.Objects != nil {
		a.serveObject(w, r, key, 16<<20)
		return
	}
	relative := filepath.Clean(filepath.FromSlash(key))
	root, err := filepath.Abs(a.Config.MediaDir)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	path := filepath.Join(root, relative)
	if !strings.HasPrefix(path, root+string(filepath.Separator)) {
		a.error(w, r, 404, "not_found", "This media file is unavailable.")
		return
	}
	realRoot, rootErr := filepath.EvalSymlinks(root)
	realPath, pathErr := filepath.EvalSymlinks(path)
	if rootErr != nil || pathErr != nil || !strings.HasPrefix(realPath, realRoot+string(filepath.Separator)) {
		a.error(w, r, 404, "not_found", "This media file is unavailable.")
		return
	}
	file, err := os.Open(realPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			a.error(w, r, 404, "not_found", "This media file is unavailable.")
		} else {
			a.storeError(w, r, err)
		}
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		a.error(w, r, 404, "not_found", "This media file is unavailable.")
		return
	}
	contentType := mime.TypeByExtension(ext)
	if ext == ".m3u8" {
		contentType = "application/vnd.apple.mpegurl"
	} else if ext == ".ts" {
		contentType = "video/mp2t"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, fileName, info.ModTime(), file)
}
