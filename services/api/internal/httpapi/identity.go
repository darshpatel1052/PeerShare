package httpapi

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
)

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
type registration struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func normalizeEmail(raw string) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(raw))
	parsed, err := mail.ParseAddress(email)
	return email, err == nil && parsed.Address == email && len(email) <= 254 && !strings.ContainsAny(email, "\x00\r\n")
}
func validText(value string, min, max int) bool {
	size := utf8.RuneCountInString(value)
	return utf8.ValidString(value) && size >= min && size <= max && !strings.ContainsRune(value, 0)
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	if !a.Config.RegistrationEnabled {
		a.error(w, r, 403, "registration_disabled", "Registration is disabled on this deployment.")
		return
	}
	if !a.authCapacity(w, r) {
		return
	}
	var body registration
	if !a.decode(w, r, &body) {
		return
	}
	email, valid := normalizeEmail(body.Email)
	name := cleanText(body.DisplayName)
	if !valid || !validText(name, 1, 80) {
		a.error(w, r, 422, "invalid_registration", "Use a valid email and a display name of 1–80 characters.")
		return
	}
	if utf8.RuneCountInString(body.Password) < 12 || len(body.Password) > 128 || !utf8.ValidString(body.Password) {
		a.error(w, r, 422, "invalid_password", auth.ErrInvalidPassword.Error())
		return
	}
	hash, err := a.Hasher.Hash(r.Context(), body.Password)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	token, tokenHash, err := auth.NewSessionToken()
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	user, expiry, err := a.Store.Register(r.Context(), store.User{ID: uuid.NewString(), Email: email, DisplayName: name}, hash, tokenHash, a.Config.SessionTTL)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	a.setCookie(w, token, expiry)
	writeJSON(w, 201, store.Me{User: user})
}
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.authCapacity(w, r) {
		return
	}
	var body credentials
	if !a.decode(w, r, &body) {
		return
	}
	email, valid := normalizeEmail(body.Email)
	if !valid || len(body.Password) == 0 || len(body.Password) > 128 {
		a.error(w, r, 422, "invalid_login", "Use a valid email and password.")
		return
	}
	user, hash, err := a.Store.UserForLogin(r.Context(), email)
	missing := errors.Is(err, store.ErrNotFound)
	if err != nil && !missing {
		a.storeError(w, r, err)
		return
	}
	missing = missing || hash == ""
	if missing {
		hash = a.dummyHash
	}
	matches, err := a.Hasher.Verify(r.Context(), hash, body.Password)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if missing || !matches {
		a.error(w, r, 401, "invalid_credentials", "The email or password is incorrect.")
		return
	}
	token, tokenHash, err := auth.NewSessionToken()
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	expiry, err := a.Store.CreateSession(r.Context(), user.ID, tokenHash, a.Config.SessionTTL)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	me, err := a.Store.Me(r.Context(), user)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	a.setCookie(w, token, expiry)
	if me.Channel != nil {
		a.decorateChannel(me.Channel)
	}
	writeJSON(w, 200, me)
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !a.decode(w, r, &body) {
		return
	}
	if cookie, err := r.Cookie(a.Config.CookieName); err == nil && auth.ValidToken(cookie.Value) {
		if err := a.Store.RevokeSession(r.Context(), auth.TokenHash(cookie.Value)); err != nil {
			a.storeError(w, r, err)
			return
		}
	}
	a.clearCookie(w)
	w.WriteHeader(204)
}
func (a *App) logoutAll(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !a.decode(w, r, &body) {
		return
	}
	if err := a.Store.RevokeAllSessions(r.Context(), identity(r).ID); err != nil {
		a.storeError(w, r, err)
		return
	}
	a.clearCookie(w)
	w.WriteHeader(204)
}
func (a *App) me(w http.ResponseWriter, r *http.Request) {
	me, err := a.Store.Me(r.Context(), identity(r))
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if me.Channel != nil {
		a.decorateChannel(me.Channel)
	}
	writeJSON(w, 200, me)
}
