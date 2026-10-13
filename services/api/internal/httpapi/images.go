package httpapi

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
	"golang.org/x/image/draw"
)

const maxImageBody = 5 * 1024 * 1024

func (a *App) registerImages(mux *http.ServeMux) {
	mux.Handle("PUT /api/v1/channels/{id}/banner", a.requireIdentity(http.HandlerFunc(a.setBanner)))
	mux.Handle("DELETE /api/v1/channels/{id}/banner", a.requireIdentity(http.HandlerFunc(a.setBanner)))
	mux.Handle("PUT /api/v1/videos/{id}/thumbnail", a.requireIdentity(http.HandlerFunc(a.setThumbnail)))
	mux.Handle("DELETE /api/v1/videos/{id}/thumbnail", a.requireIdentity(http.HandlerFunc(a.setThumbnail)))
	mux.HandleFunc("GET /api/v1/images/{id}", a.getCreatorImage)
}
func (a *App) setBanner(w http.ResponseWriter, r *http.Request) { a.setCreatorImage(w, r, "banner") }
func (a *App) setThumbnail(w http.ResponseWriter, r *http.Request) {
	a.setCreatorImage(w, r, "thumbnail")
}

func (a *App) setCreatorImage(w http.ResponseWriter, r *http.Request, kind string) {
	id, valid := canonicalID(r.PathValue("id"))
	if !valid {
		a.error(w, r, 400, "invalid_id", "Use a valid resource identifier.")
		return
	}
	revision, err := strconv.ParseInt(r.Header.Get("If-Match"), 10, 64)
	if err != nil || revision < 1 {
		a.error(w, r, 422, "revision_required", "Reload this item before updating its image.")
		return
	}
	// Check ownership before allocating or decoding an upload.
	if kind == "banner" {
		c, e := a.Store.Channel(r.Context(), id)
		if e != nil {
			a.storeError(w, r, e)
			return
		}
		if c.OwnerID != identity(r).ID {
			a.storeError(w, r, store.ErrNotOwner)
			return
		}
		if c.Revision != revision {
			a.storeError(w, r, store.ErrRevisionConflict)
			return
		}
	} else {
		var owned bool
		e := a.Store.Pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM catalog.videos v JOIN catalog.channels c ON c.id=v.channel_id WHERE v.id=$1 AND c.owner_id=$2 AND v.deleted_at IS NULL)`, id, identity(r).ID).Scan(&owned)
		if e != nil {
			a.storeError(w, r, e)
			return
		}
		if !owned {
			a.storeError(w, r, store.ErrNotFound)
			return
		}
	}
	var imageID *string
	var encoded []byte
	var imagePath string
	if r.Method == "PUT" {
		select {
		case a.imageSlots <- struct{}{}:
			defer func() { <-a.imageSlots }()
		default:
			a.error(w, r, 429, "image_busy", "Another image is being saved. Please try again shortly.")
			return
		}
		body, e := io.ReadAll(http.MaxBytesReader(w, r.Body, maxImageBody))
		if e != nil {
			var large *http.MaxBytesError
			if errors.As(e, &large) {
				a.error(w, r, 413, "image_too_large", "Choose a JPG or PNG under 5 MiB.")
			} else {
				a.error(w, r, 400, "invalid_image", "The image could not be read.")
			}
			return
		}
		encoded, e = normalizeCreatorImage(body, kind)
		if e != nil {
			a.error(w, r, 422, "invalid_image", "Choose a JPG or PNG under 5 MiB and 6 million pixels. Try a smaller image if it cannot be saved.")
			return
		}
		value := uuid.NewString()
		imageID = &value
		root := filepath.Join(a.Config.MediaDir, "images")
		if e = os.MkdirAll(root, 0755); e != nil {
			a.storeError(w, r, e)
			return
		}
		imagePath = filepath.Join(root, value+".jpg")
		file, e := os.OpenFile(imagePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if e != nil {
			a.storeError(w, r, e)
			return
		}
		_, e = file.Write(encoded)
		if e == nil {
			e = file.Sync()
		}
		closeErr := file.Close()
		if e == nil {
			e = closeErr
		}
		if e == nil {
			dir, e2 := os.Open(root)
			if e2 == nil {
				e = dir.Sync()
				dir.Close()
			} else {
				e = e2
			}
		}
		if e != nil {
			os.Remove(imagePath)
			a.storeError(w, r, e)
			return
		}
	} else {
		var body struct{}
		if !a.decode(w, r, &body) {
			return
		}
	}
	if err = a.Store.SetCreatorImage(r.Context(), identity(r).ID, id, kind, revision, imageID, len(encoded)); err != nil {
		// A timeout may have committed. Reference-aware reconciliation removes leftovers.
		// Known admission failures happen before commit: don't leave rejected artwork on disk.
		if imagePath != "" && (errors.Is(err, store.ErrNotOwner) || errors.Is(err, store.ErrNotFound) || errors.Is(err, store.ErrRevisionConflict) || errors.Is(err, store.ErrUploadLimit)) {
			_ = os.Remove(imagePath)
		}
		a.storeError(w, r, err)
		return
	}
	if kind == "banner" {
		c, e := a.Store.Channel(r.Context(), id)
		if e != nil {
			a.storeError(w, r, e)
			return
		}
		a.decorateChannel(&c)
		writeJSON(w, 200, c)
	} else {
		// Return the new revision so the following metadata edit can be checked correctly.
		var rev int64
		var image string
		e := a.Store.Pool.QueryRow(r.Context(), "SELECT revision,COALESCE(thumbnail_image_id::text,'') FROM catalog.videos WHERE id=$1", id).Scan(&rev, &image)
		if e != nil {
			a.storeError(w, r, e)
			return
		}
		writeJSON(w, 200, map[string]any{"revision": rev, "thumbnail_url": a.creatorImageURL(image), "has_custom_thumbnail": image != ""})
	}
}

func normalizeCreatorImage(body []byte, kind string) ([]byte, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil || (format != "jpeg" && format != "png") || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 6_000_000 {
		return nil, errors.New("unsupported image")
	}
	original, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	maxWidth, maxHeight := 1280, 720
	if kind == "banner" {
		maxWidth, maxHeight = 1920, 640
	}
	width, height := cfg.Width, cfg.Height
	if width > maxWidth {
		height = max(1, height*maxWidth/width)
		width = maxWidth
	}
	if height > maxHeight {
		width = max(1, width*maxHeight/height)
		height = maxHeight
	}
	resized := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(resized, resized.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.CatmullRom.Scale(resized, resized.Bounds(), original, original.Bounds(), draw.Over, nil)
	var output bytes.Buffer
	if err = jpeg.Encode(&output, resized, &jpeg.Options{Quality: 88}); err != nil {
		return nil, err
	}
	if output.Len() > 1024*1024 {
		return nil, errors.New("encoded image too large")
	}
	return output.Bytes(), nil
}

func (a *App) creatorImageURL(id string) string {
	if id == "" {
		return ""
	}
	return a.Config.AppOrigin + "/api/v1/images/" + id
}
func (a *App) decorateChannel(c *store.Channel) { c.BannerURL = a.creatorImageURL(c.BannerImageID) }
func (a *App) decorateUpload(u *store.Upload) {
	if u.ThumbnailImageID != "" {
		u.ThumbnailURL = a.creatorImageURL(u.ThumbnailImageID)
		u.HasCustomThumbnail = true
	} else if u.ThumbnailKey != "" {
		u.ThumbnailURL = a.Config.MediaBaseURL + u.ThumbnailKey
	}
}
func (a *App) getCreatorImage(w http.ResponseWriter, r *http.Request) {
	id, valid := canonicalID(r.PathValue("id"))
	if !valid {
		a.error(w, r, 404, "not_found", "This image is unavailable.")
		return
	}
	owner := ""
	if c, e := r.Cookie(a.Config.CookieName); e == nil && auth.ValidToken(c.Value) {
		if u, e := a.Store.SessionUser(r.Context(), auth.TokenHash(c.Value)); e == nil {
			owner = u.ID
		}
	}
	visible, err := a.Store.CanReadCreatorImage(r.Context(), owner, id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if !visible {
		a.error(w, r, 404, "not_found", "This image is unavailable.")
		return
	}
	file, err := os.Open(filepath.Join(a.Config.MediaDir, "images", id+".jpg"))
	if err != nil {
		a.error(w, r, 404, "not_found", "This image is unavailable.")
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() {
		a.error(w, r, 404, "not_found", "This image is unavailable.")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeContent(w, r, id+".jpg", stat.ModTime(), file)
}

func (a *App) reconcileCreatorImages() {
	ctx, cancel := cleanupContext()
	defer cancel()
	cutoff := time.Now().Add(-store.OrphanGrace)
	rows, err := a.Store.Pool.Query(ctx, `SELECT id FROM catalog.creator_images i WHERE created_at<$1 AND NOT EXISTS(SELECT 1 FROM catalog.channels WHERE banner_image_id=i.id) AND NOT EXISTS(SELECT 1 FROM catalog.videos WHERE thumbnail_image_id=i.id AND deleted_at IS NULL)`, cutoff)
	if err == nil {
		ids := []string{}
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
		for _, id := range ids {
			if e := os.Remove(filepath.Join(a.Config.MediaDir, "images", id+".jpg")); e == nil || os.IsNotExist(e) {
				_ = a.Store.ForgetCreatorImage(ctx, id, cutoff)
			}
		}
	}
	entries, err := os.ReadDir(filepath.Join(a.Config.MediaDir, "images"))
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, e := entry.Info()
		if e != nil || info.ModTime().After(cutoff) {
			continue
		}
		name := entry.Name()
		if filepath.Ext(name) != ".jpg" {
			continue
		}
		id := name[:len(name)-4]
		if _, valid := canonicalID(id); !valid {
			continue
		}
		referenced, e := a.Store.CreatorImageReferenced(ctx, id)
		if e != nil || referenced {
			continue
		}
		if e = os.Remove(filepath.Join(a.Config.MediaDir, "images", name)); e == nil || os.IsNotExist(e) {
			_ = a.Store.ForgetCreatorImage(ctx, id, cutoff)
		}
	}
}
