package httpapi

import (
	"net/http"
	"net/url"
	"regexp"
	"strconv"

	"github.com/darshpatel1052/PeerShare/services/api/internal/store"
	"github.com/google/uuid"
)

var handlePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,28}[a-z0-9]$`)

type createChannelBody struct {
	Handle      string `json:"handle"`
	Title       string `json:"title"`
	Description string `json:"description"`
}
type editChannelBody struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Revision    int64  `json:"revision"`
}

func (a *App) createChannel(w http.ResponseWriter, r *http.Request) {
	if !a.creatorAccess(w, r) {
		return
	}
	var body createChannelBody
	if !a.decode(w, r, &body) {
		return
	}
	title, description := cleanText(body.Title), cleanText(body.Description)
	if !handlePattern.MatchString(body.Handle) || !validText(title, 1, 100) || !validText(description, 0, 1000) {
		a.error(w, r, 422, "invalid_channel", "Use a 3–30 character lowercase handle, a title of 1–100 characters, and a description of at most 1000 characters.")
		return
	}
	if body.Handle == "admin" || body.Handle == "support" {
		a.error(w, r, 422, "reserved_handle", "That handle is reserved. Choose another.")
		return
	}
	channel, err := a.Store.CreateChannel(r.Context(), uuid.NewString(), identity(r).ID, body.Handle, title, description)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/channels/"+channel.ID)
	a.decorateChannel(&channel)
	writeJSON(w, 201, channel)
}
func (a *App) editChannel(w http.ResponseWriter, r *http.Request) {
	id, valid := canonicalID(r.PathValue("id"))
	if !valid {
		a.error(w, r, 400, "invalid_id", "Use a canonical UUID resource identifier.")
		return
	}
	var body editChannelBody
	if !a.decode(w, r, &body) {
		return
	}
	title, description := cleanText(body.Title), cleanText(body.Description)
	if !validText(title, 1, 100) || !validText(description, 0, 1000) || body.Revision < 1 {
		a.error(w, r, 422, "invalid_channel", "Use a title of 1–100 characters, a description of at most 1000 characters, and the current revision.")
		return
	}
	channel, err := a.Store.EditChannel(r.Context(), id, identity(r).ID, title, description, body.Revision)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	a.decorateChannel(&channel)
	writeJSON(w, 200, channel)
}
func (a *App) getChannel(w http.ResponseWriter, r *http.Request) {
	id, valid := canonicalID(r.PathValue("id"))
	if !valid {
		a.error(w, r, 400, "invalid_id", "Use a canonical UUID resource identifier.")
		return
	}
	channel, err := a.Store.Channel(r.Context(), id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	a.decorateChannel(&channel)
	writeJSON(w, 200, channel)
}
func canonicalID(raw string) (string, bool) {
	id, err := uuid.Parse(raw)
	return raw, err == nil && id.String() == raw
}
func (a *App) listVideos(w http.ResponseWriter, r *http.Request) {
	query := cleanText(r.URL.Query().Get("q"))
	if !validText(query, 0, 120) {
		a.error(w, r, 400, "invalid_query", "Search must contain at most 120 characters.")
		return
	}
	feed := r.URL.Query().Get("feed")
	if feed != "" && feed != "following" {
		a.error(w, r, 400, "invalid_feed", "Choose the following feed or leave feed empty.")
		return
	}
	userID := ""
	if feed == "following" {
		var ok bool
		userID, ok = a.viewerID(w, r, true)
		if !ok {
			return
		}
	}
	limit := 12
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 30 {
			a.error(w, r, 400, "invalid_limit", "Limit must be between 1 and 30.")
			return
		}
		limit = parsed
	}
	var channelID *string
	if raw := r.URL.Query().Get("channel_id"); raw != "" {
		id, valid := canonicalID(raw)
		if !valid {
			a.error(w, r, 400, "invalid_id", "Use a canonical UUID channel identifier.")
			return
		}
		channelID = &id
	}
	cursor, err := store.DecodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		a.error(w, r, 400, "invalid_cursor", "The pagination cursor is invalid.")
		return
	}
	page, err := a.Store.SearchVideos(r.Context(), limit, channelID, cursor, a.Config.ExposeOperatorFixture, query, userID)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	for i := range page.Items {
		a.decorateVideo(&page.Items[i], false)
	}
	writeJSON(w, 200, page)
}
func (a *App) getVideo(w http.ResponseWriter, r *http.Request) {
	id, valid := canonicalID(r.PathValue("id"))
	if !valid {
		a.error(w, r, 400, "invalid_id", "Use a canonical UUID video identifier.")
		return
	}
	video, err := a.Store.Video(r.Context(), id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if video.SourceKind == "fixture" && !a.Config.ExposeOperatorFixture {
		a.storeError(w, r, store.ErrNotFound)
		return
	}
	a.decorateVideo(&video, true)
	writeJSON(w, 200, video)
}
func (a *App) decorateVideo(video *store.Video, playback bool) {
	base, _ := url.Parse(a.Config.MediaBaseURL)
	objectURL := func(key string) string { target, _ := url.Parse(key); return base.ResolveReference(target).String() }
	video.ThumbnailURL = objectURL(video.ThumbnailKey)
	if video.ThumbnailImageID != "" {
		video.ThumbnailURL = a.creatorImageURL(video.ThumbnailImageID)
	}
	if playback {
		video.Playback = &store.Playback{ManifestURL: objectURL(video.ManifestKey), IntegrityURL: objectURL(video.IntegrityKey), TrackerURL: a.Config.TrackerURL, PeerSharingAvailable: true, STUNURLs: a.Config.STUNURLs}
	}
}
