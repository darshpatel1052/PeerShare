package httpapi

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/config"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"golang.org/x/oauth2"
)

const googleIssuer = "https://accounts.google.com"

type googleAuth struct {
	OAuth    oauth2.Config
	Verifier *oidc.IDTokenVerifier
	Client   *http.Client
	Issuer   string
}

func newGoogleAuth(cfg config.Config) *googleAuth {
	if cfg.GoogleClientID == "" {
		return nil
	}
	client := &http.Client{Timeout: 6 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	keys := oidc.NewRemoteKeySet(oidc.ClientContext(context.Background(), client), "https://www.googleapis.com/oauth2/v3/certs")
	return &googleAuth{Issuer: googleIssuer, Client: client, Verifier: oidc.NewVerifier(googleIssuer, keys, &oidc.Config{ClientID: cfg.GoogleClientID, SupportedSigningAlgs: []string{oidc.RS256}}), OAuth: oauth2.Config{ClientID: cfg.GoogleClientID, ClientSecret: cfg.GoogleClientSecret, RedirectURL: cfg.AppOrigin + "/api/v1/auth/google/callback", Scopes: []string{oidc.ScopeOpenID, oidc.ScopeEmail, oidc.ScopeProfile}, Endpoint: oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token", AuthStyle: oauth2.AuthStyleInParams}}}
}
func (a *App) registerGoogle(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/auth/options", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]bool{"google_enabled": a.Google != nil, "registration_enabled": a.Config.RegistrationEnabled})
	})
	mux.HandleFunc("POST /api/v1/auth/google/start", a.startGoogleSignIn)
	mux.Handle("POST /api/v1/auth/google/link", a.requireIdentity(http.HandlerFunc(a.startGoogleLink)))
	mux.HandleFunc("GET /api/v1/auth/google/callback", a.finishGoogle)
	mux.Handle("GET /api/v1/auth/methods", a.requireIdentity(http.HandlerFunc(a.authMethods)))
}
func (a *App) authMethods(w http.ResponseWriter, r *http.Request) {
	methods, err := a.Store.AuthMethods(r.Context(), identity(r).ID, googleIssuer)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	writeJSON(w, 200, methods)
}
func (a *App) startGoogleSignIn(w http.ResponseWriter, r *http.Request) {
	if a.Google == nil {
		a.error(w, r, 503, "google_unavailable", "Google sign-in is currently unavailable. You can sign in with email instead.")
		return
	}
	if !a.authCapacity(w, r) {
		return
	}
	var body struct{}
	if !a.decode(w, r, &body) {
		return
	}
	if _, ok := a.currentUser(r); ok {
		a.error(w, r, 409, "already_signed_in", "Connect Google to your current account from Settings.")
		return
	}
	a.startGoogle(w, r, "signin", nil, nil)
}
func (a *App) startGoogleLink(w http.ResponseWriter, r *http.Request) {
	if a.Google == nil {
		a.error(w, r, 503, "google_unavailable", "Google sign-in is currently unavailable.")
		return
	}
	if !a.authCapacity(w, r) {
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if len(body.Password) < 1 || len(body.Password) > 128 {
		a.error(w, r, 422, "password_required", "Confirm your current password to connect Google.")
		return
	}
	user, hash, err := a.Store.UserForLogin(r.Context(), identity(r).Email)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if user.ID != identity(r).ID || hash == "" {
		a.error(w, r, 409, "link_unavailable", "This account already uses Google sign-in.")
		return
	}
	matches, err := a.Hasher.Verify(r.Context(), hash, body.Password)
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	if !matches {
		a.error(w, r, 401, "invalid_credentials", "Your password is incorrect.")
		return
	}
	cookie, _ := r.Cookie(a.Config.CookieName)
	id := user.ID
	a.startGoogle(w, r, "link", &id, auth.TokenHash(cookie.Value))
}
func (a *App) startGoogle(w http.ResponseWriter, r *http.Request, purpose string, user *string, session []byte) {
	state, stateHash, err := auth.NewSessionToken()
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	browser, browserHash, err := auth.NewSessionToken()
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	nonce, _, err := auth.NewSessionToken()
	if err != nil {
		a.storeError(w, r, err)
		return
	}
	verifier := oauth2.GenerateVerifier()
	flow := store.OAuthFlow{StateHash: stateHash, BrowserHash: browserHash, Nonce: nonce, Verifier: verifier, Purpose: purpose, UserID: user, SessionHash: session}
	if err = a.Store.SaveOAuthFlow(r.Context(), flow); err != nil {
		a.storeError(w, r, err)
		return
	}
	a.googleCookie(w, browser, 600)
	target := a.Google.OAuth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier), oauth2.SetAuthURLParam("prompt", "select_account"))
	writeJSON(w, 200, map[string]string{"authorization_url": target})
}
func (a *App) currentUser(r *http.Request) (store.User, bool) {
	c, err := r.Cookie(a.Config.CookieName)
	if err != nil || !auth.ValidToken(c.Value) {
		return store.User{}, false
	}
	user, err := a.Store.SessionUser(r.Context(), auth.TokenHash(c.Value))
	return user, err == nil
}
func (a *App) googleCookie(w http.ResponseWriter, value string, age int) {
	name := "peerscreen_google_flow"
	if a.Config.SecureCookies {
		name = "__Host-peerscreen_google_flow"
	}
	expiry := time.Now().Add(10 * time.Minute)
	if age < 0 {
		expiry = time.Unix(1, 0)
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: a.Config.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: age, Expires: expiry})
}
func (a *App) finishGoogle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Referrer-Policy", "no-referrer")
	destination := "/account/"
	fail := func(code string) {
		a.googleCookie(w, "", -1)
		http.Redirect(w, r, a.Config.AppOrigin+destination+"?auth_error="+code, http.StatusSeeOther)
	}
	if a.Google == nil {
		fail("google_unavailable")
		return
	}
	name := "peerscreen_google_flow"
	if a.Config.SecureCookies {
		name = "__Host-peerscreen_google_flow"
	}
	cookie, err := r.Cookie(name)
	state := r.URL.Query().Get("state")
	if err != nil || !auth.ValidToken(cookie.Value) || !auth.ValidToken(state) {
		fail("invalid_flow")
		return
	}
	flow, err := a.Store.ConsumeOAuthFlow(r.Context(), auth.TokenHash(state), auth.TokenHash(cookie.Value))
	if err != nil {
		fail("invalid_flow")
		return
	}
	a.googleCookie(w, "", -1)
	if flow.Purpose == "link" {
		destination = "/settings/"
		current, ok := a.currentUser(r)
		session, sessionErr := r.Cookie(a.Config.CookieName)
		if !ok || flow.UserID == nil || current.ID != *flow.UserID || sessionErr != nil || subtle.ConstantTimeCompare(auth.TokenHash(session.Value), flow.SessionHash) != 1 {
			fail("session_changed")
			return
		}
	} else if _, ok := a.currentUser(r); ok {
		fail("session_changed")
		return
	}
	if r.URL.Query().Get("error") != "" {
		fail("cancelled")
		return
	}
	if issuer := r.URL.Query().Get("iss"); issuer != "" && issuer != a.Google.Issuer {
		fail("invalid_identity")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" || len(code) > 2048 {
		fail("invalid_flow")
		return
	}
	ctx := oidc.ClientContext(r.Context(), a.Google.Client)
	tokens, err := a.Google.OAuth.Exchange(ctx, code, oauth2.VerifierOption(flow.Verifier))
	if err != nil {
		fail("google_failed")
		return
	}
	raw, ok := tokens.Extra("id_token").(string)
	if !ok || len(raw) > 64*1024 {
		fail("invalid_identity")
		return
	}
	token, err := a.Google.Verifier.Verify(ctx, raw)
	if err != nil {
		fail("invalid_identity")
		return
	}
	if token.IssuedAt.IsZero() || token.IssuedAt.After(time.Now().Add(time.Minute)) {
		fail("invalid_identity")
		return
	}
	if subtle.ConstantTimeCompare([]byte(token.Nonce), []byte(flow.Nonce)) != 1 || token.Subject == "" || len(token.Subject) > 255 {
		fail("invalid_identity")
		return
	}
	var claims struct {
		Email           string `json:"email"`
		Verified        bool   `json:"email_verified"`
		Name            string `json:"name"`
		AuthorizedParty string `json:"azp"`
	}
	if err = token.Claims(&claims); err != nil || !claims.Verified {
		fail("invalid_identity")
		return
	}
	if (len(token.Audience) > 1 && claims.AuthorizedParty == "") || (claims.AuthorizedParty != "" && claims.AuthorizedParty != a.Google.OAuth.ClientID) {
		fail("invalid_identity")
		return
	}
	email, valid := normalizeEmail(claims.Email)
	if !valid {
		fail("invalid_identity")
		return
	}
	if flow.Purpose == "link" {
		err = a.Store.LinkGoogle(ctx, *flow.UserID, a.Google.Issuer, token.Subject, email, flow.SessionHash)
		if errors.Is(err, store.ErrIdentityLinked) {
			fail("identity_in_use")
			return
		}
		if err != nil {
			fail("link_failed")
			return
		}
		http.Redirect(w, r, a.Config.AppOrigin+"/settings/?auth_notice=google_connected", http.StatusSeeOther)
		return
	}
	display := cleanText(claims.Name)
	if !validText(display, 1, 80) {
		display = strings.Split(email, "@")[0]
		if !validText(display, 1, 80) {
			display = "PeerScreen member"
		}
	}
	user, err := a.Store.GoogleUser(ctx, a.Google.Issuer, token.Subject, email, display, a.Config.RegistrationEnabled)
	if errors.Is(err, store.ErrAccountLinkRequired) {
		fail("link_required")
		return
	}
	if errors.Is(err, store.ErrRegistrationDisabled) {
		fail("registration_closed")
		return
	}
	if err != nil {
		fail("google_failed")
		return
	}
	session, hash, err := auth.NewSessionToken()
	if err != nil {
		fail("google_failed")
		return
	}
	expiry, err := a.Store.CreateSession(ctx, user.ID, hash, a.Config.SessionTTL)
	if err != nil {
		fail("google_failed")
		return
	}
	a.setCookie(w, session, expiry)
	http.Redirect(w, r, a.Config.AppOrigin+"/account/?auth_notice=google_signed_in", http.StatusSeeOther)
}
