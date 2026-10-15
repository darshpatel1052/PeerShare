package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/darshpatel1052/PeerShare/services/api/internal/ratelimit"
)

func (a *App) creatorAccess(w http.ResponseWriter, r *http.Request) bool {
	if !a.Config.CreatorApprovalRequired {
		return true
	}
	allowed, err := a.Store.CreatorAllowed(r.Context(), identity(r).ID)
	if err != nil {
		a.storeError(w, r, err)
		return false
	}
	if !allowed {
		a.error(w, r, 403, "creator_approval_required", "Publishing access is by invitation. Your account can still watch and save videos.")
	}
	return allowed
}
func (a *App) uploadCapacity(w http.ResponseWriter, r *http.Request) bool {
	limiter := ratelimit.Limiter{Client: a.Redis, Prefix: a.Config.RatePrefix + ":upload", Limit: 10, Window: time.Minute}
	allowed, retry, err := limiter.Check(r.Context(), identity(r).ID)
	if err != nil {
		a.error(w, r, 503, "uploads_unavailable", "Uploads are temporarily unavailable. Please try again shortly.")
		return false
	}
	if !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		a.error(w, r, 429, "upload_rate_limited", "Please wait a moment before starting another upload.")
	}
	return allowed
}
