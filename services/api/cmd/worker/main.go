package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/mediasvc"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("worker_command_failed", "reason", err.Error())
		os.Exit(1)
	}
}
func run() error {
	if os.Getenv("APP_ENV") == "production" {
		return errors.New("public worker deployment requires the later TLS and broker-access configuration")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	client, err := mediasvc.Dial(os.Getenv("MEDIA_GRPC_ADDR"), os.Getenv("WORKER_RPC_TOKEN"))
	if err != nil {
		return err
	}
	defer client.Conn.Close()
	consumer, err := mediasvc.Consumer(os.Getenv("KAFKA_BOOTSTRAP_SERVERS"), mediasvc.DispatchTopic, "peerscreen-media-workers-v1")
	if err != nil {
		return err
	}
	defer consumer.CloseAllowingRebalance()
	producer, err := mediasvc.Producer(os.Getenv("KAFKA_BOOTSTRAP_SERVERS"))
	if err != nil {
		return err
	}
	defer producer.Close()
	mediasvc.RunWorker(ctx, client, consumer, producer, os.Getenv("UPLOAD_DIR"), os.Getenv("MEDIA_DIR"), slog.Default())
	if ctx.Err() == nil {
		return errors.New("worker stopped before shutdown")
	}
	return nil
}
