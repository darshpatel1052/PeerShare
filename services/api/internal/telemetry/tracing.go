// Package telemetry configures optional server-only tracing. It never records
// request bodies, cookies, capability tokens, emails or query strings.
package telemetry

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"net/url"
	"os"
	"strconv"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func Init(ctx context.Context, service string) (func(), error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		return func() {}, nil
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("trace endpoint must be a trusted HTTP(S) authority")
	}
	ratio := 0.1
	if service == "peerscreen-worker" {
		ratio = 1
	}
	if raw := os.Getenv("OTEL_SAMPLE_RATIO"); raw != "" {
		ratio, err = strconv.ParseFloat(raw, 64)
		if err != nil || math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 || ratio > 1 {
			return nil, errors.New("trace sampling ratio must be between zero and one")
		}
	}
	options := []otlptracegrpc.Option{otlptracegrpc.WithEndpointURL(endpoint), otlptracegrpc.WithTimeout(3 * time.Second)}
	if u.Scheme == "http" {
		options = append(options, otlptracegrpc.WithInsecure())
	}
	exporter, err := otlptracegrpc.New(ctx, options...)
	if err != nil {
		return nil, errors.New("trace exporter configuration failed")
	}
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithResource(resource.NewSchemaless(attribute.String("service.name", service))),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(ratio))),
		sdktrace.WithBatcher(exporter, sdktrace.WithMaxQueueSize(256), sdktrace.WithMaxExportBatchSize(64), sdktrace.WithBatchTimeout(2*time.Second), sdktrace.WithExportTimeout(3*time.Second)),
	)
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	// Dependency errors may contain endpoint details; keep operator logs bounded.
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(error) { slog.Warn("trace_export_deferred") }))
	return func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = provider.Shutdown(shutdown)
	}, nil
}
