package httpapi

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/darshpatel1052/PeerShare/services/api/internal/auth"
	"github.com/darshpatel1052/PeerShare/services/api/internal/store"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
)

type providerCode struct {
	claims    map[string]any
	challenge string
	key       *rsa.PrivateKey
	fail      bool
	omit      bool
}
type signedProvider struct {
	server    *httptest.Server
	key       *rsa.PrivateKey
	mu        sync.Mutex
	codes     map[string]providerCode
	exchanges atomic.Int32
	t         *testing.T
}

func googleFixture(t *testing.T, f *testApp) *signedProvider {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	provider := &signedProvider{key: key, codes: map[string]providerCode{}, t: t}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /keys", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"keys": []map[string]string{{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": "test-key", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
	})
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		provider.exchanges.Add(1)
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if r.ParseForm() != nil {
			w.WriteHeader(400)
			return
		}
		provider.mu.Lock()
		code, found := provider.codes[r.Form.Get("code")]
		delete(provider.codes, r.Form.Get("code"))
		provider.mu.Unlock()
		digest := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		if !found || code.fail || r.Form.Get("client_id") != "fixture-client" || r.Form.Get("client_secret") != "fixture-server-secret" || r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("redirect_uri") != f.App.Config.AppOrigin+"/api/v1/auth/google/callback" || base64.RawURLEncoding.EncodeToString(digest[:]) != code.challenge {
			writeJSON(w, 400, map[string]string{"error": "invalid_grant"})
			return
		}
		result := map[string]any{"access_token": "fixture-access-token", "token_type": "Bearer", "expires_in": 300}
		if !code.omit {
			result["id_token"] = signIDToken(t, code.key, code.claims)
		}
		writeJSON(w, 200, result)
	})
	provider.server = httptest.NewServer(mux)
	t.Cleanup(provider.server.Close)
	client := &http.Client{Timeout: 3 * time.Second}
	keys := oidc.NewRemoteKeySet(oidc.ClientContext(context.Background(), client), provider.server.URL+"/keys")
	f.App.Google = &googleAuth{Issuer: googleIssuer, Client: client, Verifier: oidc.NewVerifier(googleIssuer, keys, &oidc.Config{ClientID: "fixture-client", SupportedSigningAlgs: []string{oidc.RS256}}), OAuth: oauth2.Config{ClientID: "fixture-client", ClientSecret: "fixture-server-secret", RedirectURL: f.App.Config.AppOrigin + "/api/v1/auth/google/callback", Scopes: []string{oidc.ScopeOpenID, oidc.ScopeEmail, oidc.ScopeProfile}, Endpoint: oauth2.Endpoint{AuthURL: provider.server.URL + "/authorize", TokenURL: provider.server.URL + "/token", AuthStyle: oauth2.AuthStyleInParams}}}
	return provider
}
func signIDToken(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "test-key", "typ": "JWT"})
	payload, _ := json.Marshal(claims)
	signing := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(signing))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return signing + "." + base64.RawURLEncoding.EncodeToString(signature)
}
func beginGoogle(t *testing.T, f *testApp, c *http.Client, path string, body any) *url.URL {
	t.Helper()
	status, data, _ := request(t, c, f.Server.URL, "POST", path, body, nil)
	if status != 200 {
		t.Fatalf("start %d %s", status, data)
	}
	var response struct {
		URL string `json:"authorization_url"`
	}
	if json.Unmarshal(data, &response) != nil {
		t.Fatal("invalid start response")
	}
	target, err := url.Parse(response.URL)
	if err != nil {
		t.Fatal(err)
	}
	query := target.Query()
	if !auth.ValidToken(query.Get("state")) || !auth.ValidToken(query.Get("nonce")) || query.Get("code_challenge_method") != "S256" || query.Get("scope") != "openid email profile" || query.Get("client_id") != "fixture-client" || query.Get("response_type") != "code" {
		t.Fatal("incomplete state/nonce/PKCE/basic-scope request")
	}
	return target
}
func (p *signedProvider) code(target *url.URL, subject, email string, edit func(*providerCode)) string {
	value := providerCode{key: p.key, challenge: target.Query().Get("code_challenge"), claims: map[string]any{"iss": googleIssuer, "aud": "fixture-client", "sub": subject, "iat": time.Now().Unix(), "exp": time.Now().Add(5 * time.Minute).Unix(), "nonce": target.Query().Get("nonce"), "email": email, "email_verified": true, "name": "Google creator"}}
	if edit != nil {
		edit(&value)
	}
	code := uuid.NewString()
	p.mu.Lock()
	p.codes[code] = value
	p.mu.Unlock()
	return code
}
func callbackGoogle(t *testing.T, f *testApp, c *http.Client, target *url.URL, code string, extra map[string]string) (string, *http.Response) {
	t.Helper()
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	q := url.Values{"state": {target.Query().Get("state")}, "code": {code}}
	for key, value := range extra {
		q.Set(key, value)
	}
	status, _, response := request(t, c, f.Server.URL, "GET", "/api/v1/auth/google/callback?"+q.Encode(), nil, nil)
	if status != 303 {
		t.Fatalf("callback status %d", status)
	}
	location := response.Header.Get("Location")
	if !strings.HasPrefix(location, f.App.Config.AppOrigin+"/") {
		t.Fatal("untrusted redirect")
	}
	return location, response
}
func meGoogle(t *testing.T, f *testApp, c *http.Client) store.Me {
	t.Helper()
	status, data, _ := request(t, c, f.Server.URL, "GET", "/api/v1/me", nil, nil)
	if status != 200 {
		t.Fatalf("me %d %s", status, data)
	}
	var me store.Me
	json.Unmarshal(data, &me)
	return me
}

func TestIntegrationGoogleSignedLoginStableSubjectAndExistingSessions(t *testing.T) {
	f := setup(t)
	p := googleFixture(t, f)
	c := client()
	target := beginGoogle(t, f, c, "/api/v1/auth/google/start", map[string]any{})
	location, response := callbackGoogle(t, f, c, target, p.code(target, "stable-google-sub", "google@example.test", nil), nil)
	if !strings.Contains(location, "google_signed_in") {
		t.Fatal("login failed")
	}
	for _, cookie := range response.Cookies() {
		if cookie.Name == f.App.Config.CookieName && (!cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/") {
			t.Fatal("Google bypassed existing session cookie policy")
		}
	}
	first := meGoogle(t, f, c)
	channel := createChannel(t, f, c, "google-"+uuid.NewString()[:8])
	var nullableHash *string
	f.DB.Pool.QueryRow(context.Background(), "SELECT password_hash FROM catalog.users WHERE id=$1", first.User.ID).Scan(&nullableHash)
	if nullableHash != nil {
		t.Fatal("Google user has synthetic password")
	}
	status, _, _ := request(t, client(), f.Server.URL, "POST", "/api/v1/auth/login", map[string]string{"email": "google@example.test", "password": "arbitrary incorrect password"}, nil)
	if status != 401 {
		t.Fatal("Google-only password attempt must fail generically")
	}
	request(t, c, f.Server.URL, "POST", "/api/v1/auth/logout", map[string]any{}, nil)
	f.App.Config.RegistrationEnabled = false
	target = beginGoogle(t, f, c, "/api/v1/auth/google/start", map[string]any{})
	location, _ = callbackGoogle(t, f, c, target, p.code(target, "stable-google-sub", "changed@example.test", nil), nil)
	if !strings.Contains(location, "google_signed_in") {
		t.Fatal("existing account rejected when registration closed")
	}
	second := meGoogle(t, f, c)
	if second.User.ID != first.User.ID || second.User.Email != first.User.Email || second.Channel == nil || second.Channel.ID != channel.ID {
		t.Fatal("email change replaced user or channel ownership")
	}
	request(t, c, f.Server.URL, "POST", "/api/v1/auth/logout-all", map[string]any{}, nil)
	status, _, _ = request(t, c, f.Server.URL, "GET", "/api/v1/me", nil, nil)
	if status != 401 {
		t.Fatal("Google session ignored logout-all")
	}
	another := client()
	target = beginGoogle(t, f, another, "/api/v1/auth/google/start", map[string]any{})
	location, _ = callbackGoogle(t, f, another, target, p.code(target, "new-closed-sub", "new@example.test", nil), nil)
	if !strings.Contains(location, "registration_closed") {
		t.Fatal("Google bypassed admission policy")
	}
	logs := f.Logs.text()
	for _, secret := range []string{"fixture-server-secret", "fixture-access-token", target.Query().Get("state"), target.Query().Get("nonce")} {
		if strings.Contains(logs, secret) {
			t.Fatal("authentication secret leaked to logs")
		}
	}
}

func TestIntegrationGoogleRejectsInvalidSignedClaimsAndReplay(t *testing.T) {
	f := setup(t)
	p := googleFixture(t, f)
	evil, _ := rsa.GenerateKey(rand.Reader, 2048)
	cases := []struct {
		name string
		edit func(*providerCode)
	}{
		{"nonce", func(c *providerCode) { c.claims["nonce"] = "different-nonce" }},
		{"audience", func(c *providerCode) { c.claims["aud"] = "another-client" }},
		{"issuer", func(c *providerCode) { c.claims["iss"] = "https://another-provider.test" }},
		{"expiry", func(c *providerCode) { c.claims["exp"] = time.Now().Add(-time.Minute).Unix() }},
		{"future-issued", func(c *providerCode) { c.claims["iat"] = time.Now().Add(time.Hour).Unix() }},
		{"signature", func(c *providerCode) { c.key = evil }},
		{"unverified-email", func(c *providerCode) { c.claims["email_verified"] = false }},
		{"empty-subject", func(c *providerCode) { c.claims["sub"] = "" }},
		{"authorized-party", func(c *providerCode) { c.claims["azp"] = "another-client" }},
		{"multi-audience-no-party", func(c *providerCode) { c.claims["aud"] = []string{"fixture-client", "another-client"} }},
		{"missing-id-token", func(c *providerCode) { c.omit = true }},
		{"token-endpoint-error", func(c *providerCode) { c.fail = true }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			c := client()
			target := beginGoogle(t, f, c, "/api/v1/auth/google/start", map[string]any{})
			code := p.code(target, "invalid-"+test.name, "invalid@example.test", test.edit)
			location, _ := callbackGoogle(t, f, c, target, code, nil)
			if !strings.Contains(location, "auth_error=") {
				t.Fatal("invalid identity accepted")
			}
			status, _, _ := request(t, c, f.Server.URL, "GET", "/api/v1/me", nil, nil)
			if status != 401 {
				t.Fatal("invalid token issued a session")
			}
			location, _ = callbackGoogle(t, f, c, target, code, nil)
			if !strings.Contains(location, "invalid_flow") {
				t.Fatal("callback replay accepted")
			}
		})
	}
	var users int
	f.DB.Pool.QueryRow(context.Background(), "SELECT count(*) FROM catalog.users").Scan(&users)
	if users != 0 {
		t.Fatal("invalid identities created local users")
	}
}

func TestIntegrationGoogleBrowserBindingExpiredStateAndCancellation(t *testing.T) {
	f := setup(t)
	p := googleFixture(t, f)
	c := client()
	target := beginGoogle(t, f, c, "/api/v1/auth/google/start", map[string]any{})
	code := p.code(target, "browser-sub", "browser@example.test", nil)
	location, _ := callbackGoogle(t, f, client(), target, code, nil)
	if !strings.Contains(location, "invalid_flow") || p.exchanges.Load() != 0 {
		t.Fatal("unbound browser exchanged code")
	}
	location, _ = callbackGoogle(t, f, c, target, code, map[string]string{"error": "access_denied"})
	if !strings.Contains(location, "cancelled") || p.exchanges.Load() != 0 {
		t.Fatal("cancelled authorization exchanged code")
	}
	location, _ = callbackGoogle(t, f, c, target, code, nil)
	if !strings.Contains(location, "invalid_flow") {
		t.Fatal("cancelled flow replayable")
	}
	target = beginGoogle(t, f, c, "/api/v1/auth/google/start", map[string]any{})
	mustExec(t, f, "UPDATE catalog.oauth_flows SET expires_at=now()-interval '1 second'")
	location, _ = callbackGoogle(t, f, c, target, p.code(target, "expired-sub", "expired@example.test", nil), nil)
	if !strings.Contains(location, "invalid_flow") || p.exchanges.Load() != 0 {
		t.Fatal("expired flow exchanged code")
	}
	target = beginGoogle(t, f, c, "/api/v1/auth/google/start", map[string]any{})
	var count int
	f.DB.Pool.QueryRow(context.Background(), "SELECT count(*) FROM catalog.oauth_flows").Scan(&count)
	if count != 1 {
		t.Fatal("expired flow secrets were not pruned")
	}
}

func TestIntegrationGoogleExplicitLinkPreservesChannelAndRefusesAccountMerge(t *testing.T) {
	f := setup(t)
	p := googleFixture(t, f)
	owner := client()
	original, email, password := registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "linked-"+uuid.NewString()[:8])
	visitor := client()
	target := beginGoogle(t, f, visitor, "/api/v1/auth/google/start", map[string]any{})
	location, _ := callbackGoogle(t, f, visitor, target, p.code(target, "link-sub", email, nil), nil)
	if !strings.Contains(location, "link_required") {
		t.Fatal("email collision silently linked")
	}
	status, _, _ := request(t, owner, f.Server.URL, "POST", "/api/v1/auth/google/link", map[string]string{"password": "incorrect"}, nil)
	if status != 401 {
		t.Fatal("link did not require password confirmation")
	}
	target = beginGoogle(t, f, owner, "/api/v1/auth/google/link", map[string]string{"password": password})
	location, _ = callbackGoogle(t, f, owner, target, p.code(target, "link-sub", email, nil), nil)
	if !strings.Contains(location, "google_connected") {
		t.Fatal("explicit connection failed")
	}
	after := meGoogle(t, f, owner)
	if after.User.ID != original.User.ID || after.Channel == nil || after.Channel.ID != channel.ID {
		t.Fatal("link replaced user/channel")
	}
	status, body, _ := request(t, owner, f.Server.URL, "GET", "/api/v1/auth/methods", nil, nil)
	if status != 200 || !bytes.Contains(body, []byte(email)) || !bytes.Contains(body, []byte(`"password":true`)) {
		t.Fatal("connected methods incorrect")
	}
	request(t, owner, f.Server.URL, "POST", "/api/v1/auth/logout", map[string]any{}, nil)
	target = beginGoogle(t, f, owner, "/api/v1/auth/google/start", map[string]any{})
	location, _ = callbackGoogle(t, f, owner, target, p.code(target, "link-sub", "provider-changed@example.test", nil), nil)
	if !strings.Contains(location, "google_signed_in") || meGoogle(t, f, owner).User.ID != original.User.ID {
		t.Fatal("Google did not restore existing local owner")
	}
	other := client()
	registerUser(t, f, other)
	target = beginGoogle(t, f, other, "/api/v1/auth/google/link", map[string]string{"password": password})
	location, _ = callbackGoogle(t, f, other, target, p.code(target, "link-sub", email, nil), nil)
	if !strings.Contains(location, "identity_in_use") {
		t.Fatal("provider identity moved to another owner")
	}
	target = beginGoogle(t, f, other, "/api/v1/auth/google/link", map[string]string{"password": password})
	request(t, other, f.Server.URL, "POST", "/api/v1/auth/logout-all", map[string]any{}, nil)
	location, _ = callbackGoogle(t, f, other, target, p.code(target, "logout-sub", "logout@example.test", nil), nil)
	if !strings.Contains(location, "session_changed") {
		t.Fatal("revoked session completed linking")
	}
	var count int
	f.DB.Pool.QueryRow(context.Background(), "SELECT count(*) FROM catalog.external_identities").Scan(&count)
	if count != 1 {
		t.Fatal("failed links created identities")
	}
}

func TestIntegrationGoogleDisabledConfigurationAndOrigin(t *testing.T) {
	f := setup(t)
	status, body, _ := request(t, client(), f.Server.URL, "GET", "/api/v1/auth/options", nil, nil)
	if status != 200 || !bytes.Contains(body, []byte(`"google_enabled":false`)) {
		t.Fatal("unconfigured provider advertised as ready")
	}
	status, _, _ = request(t, client(), f.Server.URL, "POST", "/api/v1/auth/google/start", map[string]any{}, nil)
	if status != 503 {
		t.Fatal("unconfigured sign-in allowed")
	}
	googleFixture(t, f)
	status, _, _ = request(t, client(), f.Server.URL, "POST", "/api/v1/auth/google/start", map[string]any{}, map[string]string{"Origin": "https://another.test"})
	if status != 403 {
		t.Fatal("cross-origin flow created")
	}
}

func TestIntegrationGoogleFlowConsumptionAndIdentityAdmissionAreAtomic(t *testing.T) {
	f := setup(t)
	googleFixture(t, f)
	c := client()
	target := beginGoogle(t, f, c, "/api/v1/auth/google/start", map[string]any{})
	apiURL, _ := url.Parse(f.Server.URL)
	var browser string
	for _, cookie := range c.Jar.Cookies(apiURL) {
		if cookie.Name == "peerscreen_google_flow" {
			browser = cookie.Value
		}
	}
	if !auth.ValidToken(browser) {
		t.Fatal("missing browser binding")
	}
	var wait sync.WaitGroup
	var consumed atomic.Int32
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := f.DB.ConsumeOAuthFlow(context.Background(), auth.TokenHash(target.Query().Get("state")), auth.TokenHash(browser))
			if err == nil {
				consumed.Add(1)
			} else if !errors.Is(err, store.ErrNotFound) {
				failures <- err
			}
		}()
	}
	wait.Wait()
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	if consumed.Load() != 1 {
		t.Fatal("flow was not consumed exactly once")
	}
	ids := make(chan string, 8)
	failures = make(chan error, 8)
	for i := 0; i < 8; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			user, err := f.DB.GoogleUser(context.Background(), googleIssuer, "concurrent-sub", "concurrent@example.test", "Concurrent creator", true)
			if err != nil {
				failures <- err
			} else {
				ids <- user.ID
			}
		}()
	}
	wait.Wait()
	close(ids)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	unique := map[string]bool{}
	for id := range ids {
		unique[id] = true
	}
	if len(unique) != 1 {
		t.Fatal("same subject created multiple users")
	}
	var count int
	f.DB.Pool.QueryRow(context.Background(), "SELECT count(*) FROM catalog.external_identities").Scan(&count)
	if count != 1 {
		t.Fatal("duplicate provider identities admitted")
	}
}
