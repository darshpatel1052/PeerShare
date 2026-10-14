package config

import "testing"

func TestSTUNConfigurationIsBoundedAndDisabledByDefault(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("APP_ENV", "development")
	t.Setenv("PEER_STUN_URLS", "")
	cfg, err := Load()
	if err != nil || len(cfg.STUNURLs) != 0 {
		t.Fatal("STUN must be disabled by default")
	}
	t.Setenv("PEER_STUN_URLS", "stun:stun.cloudflare.com:3478")
	cfg, err = Load()
	if err != nil || len(cfg.STUNURLs) != 1 {
		t.Fatal("valid STUN configuration rejected")
	}
	for _, invalid := range []string{"https://example.test", "turn:example.test:3478", "stun:user:secret@example.test:3478", "stun:example.test:0", "stun:example.test:3478?transport=udp", "stun:a.test:3478,stun:b.test:3478,stun:c.test:3478,stun:d.test:3478"} {
		t.Setenv("PEER_STUN_URLS", invalid)
		if _, err = Load(); err == nil {
			t.Fatal("invalid STUN configuration accepted")
		}
	}
}
