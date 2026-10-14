package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	pb "github.com/darshpatel1052/Peer-Screen/services/api/gen/peerscreen/media/v1"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/mediasvc"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/objectstore"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/telemetry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("media_command_failed", "reason", err.Error())
		os.Exit(1)
	}
}
func run() error {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if command == "healthcheck" {
		listen := os.Getenv("MEDIA_LISTEN_ADDR")
		if listen == "" {
			listen = "127.0.0.1:19090"
		}
		_, port, err := net.SplitHostPort(listen)
		if err != nil {
			return errors.New("invalid media listen address")
		}
		client, err := mediasvc.Dial(net.JoinHostPort("127.0.0.1", port), os.Getenv("CATALOG_RPC_TOKEN"))
		if err != nil {
			return err
		}
		defer client.Conn.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, err = client.GetJob(ctx, &pb.JobRequest{JobId: "00000000-0000-4000-8000-000000000001"})
		if status.Code(err) != codes.NotFound {
			return errors.New("media coordinator is unavailable")
		}
		return nil
	}
	if os.Getenv("APP_ENV") == "production" && os.Getenv("INTERNAL_TRANSPORT") != "private-compose" {
		return errors.New("the initial production coordinator requires its private Compose network")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	setup, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	store, err := mediasvc.Open(setup, os.Getenv("MEDIA_DATABASE_URL"), os.Getenv("MEDIA_DIR"))
	if err != nil {
		return errors.New("media database initialization failed")
	}
	defer store.Pool.Close()
	store.Objects, err = objectstore.FromEnvironment(setup)
	if err != nil {
		return err
	}
	if command == "migrate" {
		if err = store.Migrate(setup); err != nil {
			return errors.New("media migration failed")
		}
		slog.Info("media_migrations_applied")
		return nil
	}
	if command != "serve" {
		return errors.New("supported media commands: serve, migrate")
	}
	closeTracing, err := telemetry.Init(setup, "peerscreen-coordinator")
	if err != nil {
		return err
	}
	defer closeTracing()
	server, err := mediasvc.NewServer(store, os.Getenv("CATALOG_RPC_TOKEN"), os.Getenv("WORKER_RPC_TOKEN"))
	if err != nil {
		return err
	}
	listen := os.Getenv("MEDIA_LISTEN_ADDR")
	if listen == "" {
		listen = "127.0.0.1:19090"
	}
	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return errors.New("media listener unavailable")
	}
	defer listener.Close()
	producer, err := mediasvc.Producer(os.Getenv("KAFKA_BOOTSTRAP_SERVERS"))
	if err != nil {
		return err
	}
	defer producer.Close()
	done := make(chan struct{})
	go func() { defer close(done); store.RunMaintenance(ctx, producer, slog.Default()) }()
	stopped := make(chan error, 1)
	go func() { stopped <- server.Serve(listener) }()
	slog.Info("media_coordinator_started", "listen", listen)
	select {
	case <-ctx.Done():
		server.GracefulStop()
		<-done
		return nil
	case <-stopped:
		stop()
		server.Stop()
		<-done
		return errors.New("media listener stopped unexpectedly")
	}
}
