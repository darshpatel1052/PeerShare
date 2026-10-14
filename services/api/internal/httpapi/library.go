package httpapi

import (
	"errors"
	"net/http"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
)

func (a *App) registerLibrary(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/channels/{id}/subscription", a.getSubscription)
	mux.Handle("POST /api/v1/channels/{id}/subscription", a.requireIdentity(http.HandlerFunc(a.followChannel)))
	mux.Handle("DELETE /api/v1/channels/{id}/subscription", a.requireIdentity(http.HandlerFunc(a.unfollowChannel)))
	mux.Handle("GET /api/v1/subscriptions", a.requireIdentity(http.HandlerFunc(a.listSubscriptions)))
	mux.Handle("GET /api/v1/playlists", a.requireIdentity(http.HandlerFunc(a.listPlaylists)))
	mux.Handle("POST /api/v1/playlists", a.requireIdentity(http.HandlerFunc(a.createPlaylist)))
	mux.HandleFunc("GET /api/v1/playlists/{id}", a.getPlaylist)
	mux.Handle("PATCH /api/v1/playlists/{id}", a.requireIdentity(http.HandlerFunc(a.editPlaylist)))
	mux.Handle("DELETE /api/v1/playlists/{id}", a.requireIdentity(http.HandlerFunc(a.deletePlaylist)))
	mux.Handle("POST /api/v1/playlists/{id}/items", a.requireIdentity(http.HandlerFunc(a.addPlaylistItem)))
	mux.Handle("DELETE /api/v1/playlists/{id}/items/{video_id}", a.requireIdentity(http.HandlerFunc(a.removePlaylistItem)))
	mux.Handle("PUT /api/v1/playlists/{id}/order", a.requireIdentity(http.HandlerFunc(a.reorderPlaylist)))
}

// Public reads can enrich with the existing session without exposing private data.
// A database outage must not be mistaken for an anonymous visitor.
func (a *App) viewerID(w http.ResponseWriter, r *http.Request, required bool) (string, bool) {
	cookie, err := r.Cookie(a.Config.CookieName)
	if err == nil && auth.ValidToken(cookie.Value) {
		user, err := a.Store.SessionUser(r.Context(), auth.TokenHash(cookie.Value))
		if err == nil {
			return user.ID, true
		}
		if !errors.Is(err, store.ErrNotFound) {
			a.storeError(w, r, err)
			return "", false
		}
	}
	if required {
		a.error(w, r, 401, "authentication_required", "Sign in to continue.")
		return "", false
	}
	return "", true
}
func (a *App) libraryID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id, ok := canonicalID(r.PathValue("id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Use a canonical UUID resource identifier.")
	}
	return id, ok
}
func (a *App) getSubscription(w http.ResponseWriter, r *http.Request) {
	id, ok := a.libraryID(w, r)
	if !ok {
		return
	}
	user, ok := a.viewerID(w, r, false)
	if !ok {
		return
	}
	value, err := a.Store.Subscription(r.Context(), user, id)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	writeJSON(w, 200, value)
}
func (a *App) followChannel(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !a.decode(w, r, &body) {
		return
	}
	a.setSubscription(w, r, true)
}
func (a *App) unfollowChannel(w http.ResponseWriter, r *http.Request) { a.setSubscription(w, r, false) }
func (a *App) setSubscription(w http.ResponseWriter, r *http.Request, following bool) {
	id, ok := a.libraryID(w, r)
	if !ok {
		return
	}
	value, err := a.Store.SetSubscription(r.Context(), identity(r).ID, id, following)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	writeJSON(w, 200, value)
}
func (a *App) listSubscriptions(w http.ResponseWriter, r *http.Request) {
	items, err := a.Store.SubscribedChannels(r.Context(), identity(r).ID)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	for i := range items {
		a.decorateChannel(&items[i])
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (a *App) listPlaylists(w http.ResponseWriter, r *http.Request) {
	items, err := a.Store.Playlists(r.Context(), identity(r).ID)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

type playlistBody struct {
	Title      string `json:"title"`
	Visibility string `json:"visibility"`
	Revision   int64  `json:"revision"`
}

func (a *App) validPlaylist(w http.ResponseWriter, r *http.Request, b *playlistBody) bool {
	b.Title = cleanText(b.Title)
	if !validText(b.Title, 1, 100) || (b.Visibility != "private" && b.Visibility != "public") {
		a.error(w, r, 422, "invalid_playlist", "Use a title of 1–100 characters and private or public visibility.")
		return false
	}
	return true
}
func (a *App) createPlaylist(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title      string `json:"title"`
		Visibility string `json:"visibility"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	b := playlistBody{Title: body.Title, Visibility: body.Visibility}
	if !a.validPlaylist(w, r, &b) {
		return
	}
	key, ok := canonicalID(r.Header.Get("Idempotency-Key"))
	if !ok {
		a.error(w, r, 400, "invalid_idempotency_key", "Use a UUID Idempotency-Key for playlist creation.")
		return
	}
	value, err := a.Store.CreatePlaylist(r.Context(), identity(r).ID, key, b.Title, b.Visibility)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/api/v1/playlists/"+value.ID)
	writeJSON(w, 201, value)
}
func (a *App) decoratePlaylist(value *store.PlaylistDetail) {
	for i := range value.Items {
		if value.Items[i].Video != nil {
			a.decorateVideo(value.Items[i].Video, false)
		}
	}
}
func (a *App) getPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := a.libraryID(w, r)
	if !ok {
		return
	}
	user, ok := a.viewerID(w, r, false)
	if !ok {
		return
	}
	value, err := a.Store.Playlist(r.Context(), id, user, a.Config.ExposeOperatorFixture)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	a.decoratePlaylist(&value)
	writeJSON(w, 200, value)
}
func (a *App) playlistMutation(w http.ResponseWriter, r *http.Request, m store.PlaylistMutation) {
	id, ok := a.libraryID(w, r)
	if !ok {
		return
	}
	if m.Revision < 1 {
		a.error(w, r, 422, "invalid_revision", "Use the current playlist revision.")
		return
	}
	err := a.Store.MutatePlaylist(r.Context(), id, identity(r).ID, m, a.Config.ExposeOperatorFixture)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	value, err := a.Store.Playlist(r.Context(), id, identity(r).ID, a.Config.ExposeOperatorFixture)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	a.decoratePlaylist(&value)
	writeJSON(w, 200, value)
}
func (a *App) editPlaylist(w http.ResponseWriter, r *http.Request) {
	var b playlistBody
	if !a.decode(w, r, &b) || !a.validPlaylist(w, r, &b) {
		return
	}
	a.playlistMutation(w, r, store.PlaylistMutation{Action: "edit", Title: b.Title, Visibility: b.Visibility, Revision: b.Revision})
}
func (a *App) addPlaylistItem(w http.ResponseWriter, r *http.Request) {
	var b struct {
		VideoID  string `json:"video_id"`
		Revision int64  `json:"revision"`
	}
	if !a.decode(w, r, &b) {
		return
	}
	if _, ok := canonicalID(b.VideoID); !ok {
		a.error(w, r, 422, "invalid_video", "Choose a valid video.")
		return
	}
	a.playlistMutation(w, r, store.PlaylistMutation{Action: "add", VideoID: b.VideoID, Revision: b.Revision})
}
func (a *App) removePlaylistItem(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Revision int64 `json:"revision"`
	}
	if !a.decode(w, r, &b) {
		return
	}
	video, ok := canonicalID(r.PathValue("video_id"))
	if !ok {
		a.error(w, r, 400, "invalid_id", "Choose a valid video.")
		return
	}
	a.playlistMutation(w, r, store.PlaylistMutation{Action: "remove", VideoID: video, Revision: b.Revision})
}
func (a *App) reorderPlaylist(w http.ResponseWriter, r *http.Request) {
	var b struct {
		VideoIDs []string `json:"video_ids"`
		Revision int64    `json:"revision"`
	}
	if !a.decode(w, r, &b) {
		return
	}
	if len(b.VideoIDs) > 200 || b.VideoIDs == nil {
		a.error(w, r, 422, "invalid_order", "Send the complete playlist order, up to 200 videos.")
		return
	}
	for _, id := range b.VideoIDs {
		if _, ok := canonicalID(id); !ok {
			a.error(w, r, 422, "invalid_order", "Use valid video identifiers.")
			return
		}
	}
	a.playlistMutation(w, r, store.PlaylistMutation{Action: "reorder", VideoIDs: b.VideoIDs, Revision: b.Revision})
}
func (a *App) deletePlaylist(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Revision int64 `json:"revision"`
	}
	if !a.decode(w, r, &b) {
		return
	}
	id, ok := a.libraryID(w, r)
	if !ok {
		return
	}
	if b.Revision < 1 {
		a.error(w, r, 422, "invalid_revision", "Use the current playlist revision.")
		return
	}
	if err := a.Store.DeletePlaylist(r.Context(), id, identity(r).ID, b.Revision); err != nil {
		a.storeError(w, r, err)
		return
	}
	w.WriteHeader(204)
}
