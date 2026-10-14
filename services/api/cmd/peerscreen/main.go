package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/auth"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/config"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/httpapi"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
		if attr.Key == slog.TimeKey && attr.Value.Kind() == slog.KindTime {
			attr.Value = slog.TimeValue(attr.Value.Time().UTC())
		}
		return attr
	}})))
	if err := run(); err != nil {
		slog.Error("command_failed", "reason", err.Error())
		os.Exit(1)
	}
}
func run() error {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if command == "runtime-credentials" {
		return runtimeCredentials()
	}
	if command == "healthcheck" {
		client := http.Client{Timeout: 3 * time.Second}
		listen := os.Getenv("API_LISTEN_ADDR")
		if listen == "" {
			listen = "127.0.0.1:18080"
		}
		_, port, splitError := net.SplitHostPort(listen)
		if splitError != nil {
			return errors.New("invalid health-check listen address")
		}
		response, err := client.Get("http://127.0.0.1:" + port + "/health/ready")
		if err != nil {
			return errors.New("health endpoint unavailable")
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			return errors.New("service is not ready")
		}
		return nil
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return errors.New("database initialization failed; check local dependencies and configuration")
	}
	defer db.Pool.Close()
	switch command {
	case "creator-access":
		if len(os.Args) < 4 {
			return errors.New("use creator-access grant USER_ID HOURS or creator-access revoke USER_ID")
		}
		id, err := uuid.Parse(os.Args[3])
		if err != nil || id.String() != os.Args[3] {
			return errors.New("use a canonical PeerScreen user ID")
		}
		if os.Args[2] == "revoke" && len(os.Args) == 4 {
			return db.RevokeCreator(ctx, id.String())
		}
		if os.Args[2] != "grant" || len(os.Args) != 5 {
			return errors.New("use creator-access grant USER_ID HOURS or creator-access revoke USER_ID")
		}
		hours, err := strconv.Atoi(os.Args[4])
		if err != nil {
			return errors.New("creator access hours must be an integer")
		}
		return db.GrantCreator(ctx, id.String(), hours)
	case "migrate":
		if err := db.Migrate(ctx); err != nil {
			return errors.New("catalogue migration failed")
		}
		slog.Info("catalog_migrations_applied")
		return nil
	case "seed-fixture":
		path := ".local/media/fixture/fixture.json"
		if len(os.Args) > 2 {
			path = os.Args[2]
		}
		bytes, err := os.ReadFile(path)
		if err != nil {
			return errors.New("generate the fixture before seeding")
		}
		var fixture store.Fixture
		if json.Unmarshal(bytes, &fixture) != nil {
			return errors.New("invalid fixture metadata")
		}
		token, _, err := auth.NewSessionToken()
		if err != nil {
			return errors.New("fixture identity initialization failed")
		}
		hash, err := auth.NewHasher(1).Hash(ctx, token)
		if err != nil {
			return errors.New("fixture identity initialization failed")
		}
		if err := db.SeedFixture(ctx, fixture, hash); err != nil {
			return errors.New("fixture metadata could not be seeded")
		}
		slog.Info("fixture_seeded", "video_id", store.FixtureVideoID)
		return nil
	case "serve":
	default:
		return errors.New("supported commands: serve, migrate, seed-fixture, healthcheck")
	}
	options, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return errors.New("invalid REDIS_URL")
	}
	options.DialTimeout = 2 * time.Second
	options.ReadTimeout = 2 * time.Second
	options.WriteTimeout = 2 * time.Second
	options.MaxRetries = 1
	cache := redis.NewClient(options)
	defer cache.Close()
	if cache.Ping(ctx).Err() != nil {
		return errors.New("Redis initialization failed")
	}
	logger := slog.Default()
	app, err := httpapi.New(ctx, cfg, db, cache, logger)
	if err != nil {
		return errors.New("API initialization failed")
	}
	defer app.Close()
	server := http.Server{Addr: cfg.ListenAddr, Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 2 * time.Minute, WriteTimeout: 2 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 8 * 1024}
	signalCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	workerCtx, workerCancel := context.WithCancel(signalCtx)
	defer workerCancel()
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); app.RunMediaWorker(workerCtx) }()
	playbackDone := make(chan struct{})
	go func() { defer close(playbackDone); app.RunPlaybackRelay(workerCtx) }()
	defer func() {
		workerCancel()
		select {
		case <-workerDone:
		case <-time.After(5 * time.Second):
		}
		select {
		case <-playbackDone:
		case <-time.After(5 * time.Second):
		}
	}()
	stopped := make(chan error, 1)
	go func() { stopped <- server.ListenAndServe() }()
	logger.Info("api_started", "listen", cfg.ListenAddr)
	select {
	case err := <-stopped:
		if !errors.Is(err, http.ErrServerClosed) {
			return errors.New("API listener failed")
		}
	case <-signalCtx.Done():
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if server.Shutdown(shutdownCtx) != nil {
			_ = server.Close()
			return errors.New("API graceful shutdown timed out")
		}
		logger.Info("api_stopped")
	}
	return nil
}
