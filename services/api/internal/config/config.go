package config

import (
	"errors"
	"net"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	TrustedProxies          []netip.Prefix
	ReplicaDiagnostics      bool
	ReadOnly                bool
	STUNURLs                []string
	MediaAddress            string
	CatalogRPCToken         string
	KafkaServers            string
	ExposeOperatorFixture   bool
	GoogleClientID          string
	GoogleClientSecret      string
	DatabaseURL             string
	RedisURL                string
	AnalyticsRedisURL       string
	ListenAddr              string
	AppOrigin               string
	MediaBaseURL            string
	TrackerURL              string
	Environment             string
	RegistrationEnabled     bool
	UploadsEnabled          bool
	CreatorApprovalRequired bool
	CookieName              string
	SecureCookies           bool
	SessionTTL              time.Duration
	AuthLimit               int64
	RatePrefix              string
	UploadDir               string
	MediaDir                string
}

const DefaultSTUNURL = "stun:stun.cloudflare.com:3478"

func Load() (Config, error) {
	cfg := Config{GoogleClientID: os.Getenv("GOOGLE_CLIENT_ID"), GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"), DatabaseURL: os.Getenv("DATABASE_URL"), RedisURL: os.Getenv("REDIS_URL"),
		ListenAddr: value("API_LISTEN_ADDR", "127.0.0.1:18080"), AppOrigin: value("APP_ORIGIN", "http://localhost:3000"),
		MediaBaseURL: value("MEDIA_BASE_URL", "http://localhost:3000/media/"), TrackerURL: value("TRACKER_URL", "ws://localhost:8000"),
		Environment: value("APP_ENV", "development"), SessionTTL: 7 * 24 * time.Hour, AuthLimit: 60,
		RatePrefix: value("RATE_PREFIX", "peerscreen:auth"), CookieName: "peerscreen_session",
		UploadDir: value("UPLOAD_DIR", ".local/uploads"), MediaDir: value("MEDIA_DIR", ".local/media")}
	cfg.MediaAddress = os.Getenv("MEDIA_GRPC_ADDR")
	cfg.AnalyticsRedisURL = os.Getenv("ANALYTICS_REDIS_URL")
	cfg.CatalogRPCToken = os.Getenv("CATALOG_RPC_TOKEN")
	cfg.KafkaServers = os.Getenv("KAFKA_BOOTSTRAP_SERVERS")
	if raw := os.Getenv("TRUSTED_PROXY_CIDRS"); raw != "" {
		for _, item := range strings.Split(raw, ",") {
			prefix, err := netip.ParsePrefix(strings.TrimSpace(item))
			if err != nil || prefix.Bits() == 0 || len(cfg.TrustedProxies) >= 4 {
				return cfg, errors.New("TRUSTED_PROXY_CIDRS requires up to four explicit proxy network prefixes")
			}
			cfg.TrustedProxies = append(cfg.TrustedProxies, prefix)
		}
	}
	cfg.ReplicaDiagnostics = os.Getenv("API_REPLICA_DIAGNOSTICS") == "true"
	if raw := os.Getenv("READ_ONLY_MODE"); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return cfg, errors.New("READ_ONLY_MODE must be a boolean")
		}
		cfg.ReadOnly = enabled
	}
	cfg.STUNURLs = make([]string, 0)
	raw, configured := os.LookupEnv("PEER_STUN_URLS")
	if !configured {
		raw = DefaultSTUNURL
	}
	if raw != "" && raw != "off" {
		for _, value := range strings.Split(raw, ",") {
			value = strings.TrimSpace(value)
			host, port, err := net.SplitHostPort(strings.TrimPrefix(value, "stun:"))
			number, parseErr := strconv.Atoi(port)
			if !strings.HasPrefix(value, "stun:") || err != nil || parseErr != nil || number < 1 || number > 65535 || !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$`).MatchString(host) || len(cfg.STUNURLs) >= 3 {
				return cfg, errors.New("PEER_STUN_URLS requires up to three STUN hostname:port URLs without credentials or query parameters")
			}
			cfg.STUNURLs = append(cfg.STUNURLs, value)
		}
	}
	if cfg.MediaAddress != "" && (len(cfg.CatalogRPCToken) != 64 || cfg.KafkaServers == "") {
		return cfg, errors.New("distributed media requires internal RPC authentication and Kafka configuration")
	}
	if (cfg.GoogleClientID == "") != (cfg.GoogleClientSecret == "") {
		return cfg, errors.New("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together")
	}
	if cfg.DatabaseURL == "" || cfg.RedisURL == "" {
		return cfg, errors.New("DATABASE_URL and REDIS_URL are required")
	}
	if cfg.Environment != "development" && cfg.Environment != "production" {
		return cfg, errors.New("APP_ENV must be development or production")
	}
	if cfg.ReadOnly && (cfg.MediaAddress != "" || cfg.KafkaServers != "") {
		return cfg, errors.New("read-only catalogue must not join media RPC or Kafka consumers")
	}
	cfg.SecureCookies = cfg.Environment == "production"
	cfg.RegistrationEnabled = !cfg.SecureCookies
	cfg.UploadsEnabled = !cfg.SecureCookies
	if raw := os.Getenv("CREATOR_APPROVAL_REQUIRED"); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return cfg, errors.New("CREATOR_APPROVAL_REQUIRED must be a boolean")
		}
		cfg.CreatorApprovalRequired = enabled
	}
	if raw := os.Getenv("UPLOADS_ENABLED"); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return cfg, errors.New("UPLOADS_ENABLED must be a boolean")
		}
		cfg.UploadsEnabled = enabled
	}
	if raw := os.Getenv("REGISTRATION_ENABLED"); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return cfg, errors.New("REGISTRATION_ENABLED must be a boolean")
		}
		cfg.RegistrationEnabled = enabled
	}
	if raw := os.Getenv("EXPOSE_OPERATOR_FIXTURE"); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return cfg, errors.New("EXPOSE_OPERATOR_FIXTURE must be a boolean")
		}
		cfg.ExposeOperatorFixture = enabled
	}
	if cfg.SecureCookies && cfg.ExposeOperatorFixture {
		return cfg, errors.New("operator test media cannot be exposed in production")
	}
	if cfg.SecureCookies {
		cfg.CookieName = "__Host-peerscreen_session"
		cfg.AuthLimit = 10
		if cfg.RegistrationEnabled {
			return cfg, errors.New("public registration requires a future explicit admission policy; keep REGISTRATION_ENABLED=false in production")
		}
	}
	if raw := os.Getenv("AUTH_LIMIT_PER_MINUTE"); raw != "" {
		count, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || count < 1 || count > 120 {
			return cfg, errors.New("AUTH_LIMIT_PER_MINUTE must be between 1 and 120")
		}
		cfg.AuthLimit = count
	}
	for _, item := range []struct {
		name, raw string
		schemes   []string
	}{{"APP_ORIGIN", cfg.AppOrigin, []string{"http", "https"}}, {"MEDIA_BASE_URL", cfg.MediaBaseURL, []string{"http", "https"}}, {"TRACKER_URL", cfg.TrackerURL, []string{"ws", "wss"}}} {
		parsed, err := url.Parse(item.raw)
		if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return cfg, errors.New(item.name + " must be a trusted absolute URL without credentials, query or fragment")
		}
		validScheme := false
		for _, scheme := range item.schemes {
			validScheme = validScheme || parsed.Scheme == scheme
		}
		if !validScheme {
			return cfg, errors.New(item.name + " has an unsupported scheme")
		}
		if item.name == "APP_ORIGIN" && parsed.Path != "" {
			return cfg, errors.New("APP_ORIGIN must contain only scheme and authority")
		}
		if cfg.SecureCookies && parsed.Scheme != "https" && parsed.Scheme != "wss" {
			return cfg, errors.New("production browser endpoints require HTTPS/WSS")
		}
	}
	if !strings.HasSuffix(cfg.MediaBaseURL, "/") {
		return cfg, errors.New("MEDIA_BASE_URL must end with a slash")
	}
	return cfg, nil
}

func value(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
