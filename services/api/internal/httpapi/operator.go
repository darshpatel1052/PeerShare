package httpapi

import (
	"github.com/darshpatel1052/PeerShare/services/api/internal/store"
	"net/http"
	"strings"
)

func (a *App) registerOperator(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/operator/jobs", a.requireIdentity(http.HandlerFunc(a.operatorJobs)))
	mux.Handle("POST /api/v1/operator/jobs/{id}/{action}", a.requireIdentity(http.HandlerFunc(a.operatorAction)))
}
func (a *App) operatorAccess(w http.ResponseWriter, r *http.Request) bool {
	if identity(r).Role != "operator" {
		a.error(w, r, 403, "operator_required", "This workspace is restricted to platform operators.")
		return false
	}
	return true
}
func (a *App) operatorJobs(w http.ResponseWriter, r *http.Request) {
	if !a.operatorAccess(w, r) {
		return
	}
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "all"
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	cursor, err := store.DecodeCursor(r.URL.Query().Get("cursor"))
	if err != nil || !validText(query, 0, 100) || (state != "all" && state != "active" && state != "attention" && state != "ready") {
		a.error(w, r, 400, "invalid_filter", "Choose a valid processing filter or page.")
		return
	}
	page, err := a.Store.OperatorJobs(r.Context(), state, query, cursor)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	writeJSON(w, 200, page)
}
func (a *App) operatorAction(w http.ResponseWriter, r *http.Request) {
	if !a.operatorAccess(w, r) {
		return
	}
	id, ok := canonicalID(r.PathValue("id"))
	action := r.PathValue("action")
	if !ok || (action != "retry" && action != "cancel") {
		a.error(w, r, 400, "invalid_action", "Choose a valid processing action.")
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	body.Note = cleanText(body.Note)
	if !validText(body.Note, 1, 500) {
		a.error(w, r, 422, "note_required", "Add a short operator note for this action.")
		return
	}
	if err := a.Store.OperatorMutateJob(r.Context(), identity(r).ID, id, action, body.Note); err != nil {
		a.storeError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "accepted"})
}
