package config

import "testing"

func TestProductionRejectsUnsafeBrowserDefaults(t *testing.T) {
	t.Setenv("EXPOSE_OPERATOR_FIXTURE", "false")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("APP_ENV", "production")
	t.Setenv("REGISTRATION_ENABLED", "false")
	if _, err := Load(); err == nil {
		t.Fatal("HTTP/WSS defaults must not be accepted in production")
	}
	t.Setenv("APP_ORIGIN", "https://peerscreen.example")
	t.Setenv("MEDIA_BASE_URL", "https://media.peerscreen.example/")
	t.Setenv("TRACKER_URL", "wss://peerscreen.example/tracker")
	cfg, err := Load()
	if err != nil || !cfg.SecureCookies || cfg.CookieName != "__Host-peerscreen_session" || cfg.RegistrationEnabled || cfg.UploadsEnabled {
		t.Fatal("production cookie/admission configuration invalid")
	}
	t.Setenv("REGISTRATION_ENABLED", "true")
	if _, err := Load(); err == nil {
		t.Fatal("production signup must stay disabled until an admission policy exists")
	}
}

func TestGoogleCredentialsMustBeConfiguredTogether(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("APP_ENV", "development")
	t.Setenv("GOOGLE_CLIENT_ID", "test-client")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("partial Google configuration accepted")
	}
	t.Setenv("GOOGLE_CLIENT_SECRET", "test-server-secret")
	cfg, err := Load()
	if err != nil || cfg.GoogleClientID != "test-client" {
		t.Fatal("complete Google configuration rejected")
	}
}

func TestOperatorFixtureCannotAppearInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("APP_ENV", "production")
	t.Setenv("REGISTRATION_ENABLED", "false")
	t.Setenv("APP_ORIGIN", "https://peerscreen.example")
	t.Setenv("MEDIA_BASE_URL", "https://peerscreen.example/media/")
	t.Setenv("TRACKER_URL", "wss://peerscreen.example/tracker")
	t.Setenv("EXPOSE_OPERATOR_FIXTURE", "true")
	if _, err := Load(); err == nil {
		t.Fatal("production exposed test media")
	}
}
