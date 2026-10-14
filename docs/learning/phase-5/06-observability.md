# See what the running services are doing

The operator tools are separate from the public creator/viewer interface. A creator's Analytics reports video usage; the operator dashboard reports service health, latency and resource use. They have different audiences and permissions.

## Three useful kinds of evidence

| Signal  | What it answers                                                      | Implementation                                                                       |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Metrics | How often, how slow, how much?                                       | Go/tracker/Envoy measurements scraped by Prometheus                                  |
| Traces  | Which operations consumed time in one request or processing attempt? | OpenTelemetry spans exported to Jaeger                                               |
| Logs    | What event did this process report?                                  | Structured service logs, bounded Docker buffering and seven-day CloudWatch retention |

A chart is not a benchmark. These tools show actual ordinary product requests; controlled workload measurement remains a later exercise, as the user requested.

## Prometheus and the provisioned dashboard

Prometheus scrapes every five seconds, with a three-second timeout. DNS discovery expands the headless list of Compose `api` addresses into distinct targets, so two replicas are measured separately. A single static target through a load balancer would merge/miss individual processes. Tracker and Envoy have separate internal targets.

The eight Grafana panels display healthy catalogue replicas, request rate, p95 latency, server-error rate, analytics cache results, database connections, Go heap and tracker connections. The dashboard and Prometheus data source are provisioned from Git. They use real metric queries rather than seeded chart values.

For example, `rate(peerscreen_http_request_duration_seconds_count[5m])` turns a cumulative request counter into a recent per-second rate. A histogram records cumulative latency bucket counts. `histogram_quantile(0.95, sum by(le)(rate(..._bucket[5m])))` estimates the 95th percentile across those buckets. This is an estimate at the configured bucket resolution, and a quiet/new instance may have insufficient samples to show a value.

Metric labels use method, route template, status class, instance and fixed cache-result names. A UUID, title, cookie or query is not a label. The database pool gauges expose total/acquired/max connections; these describe the Go clients, not a complete PostgreSQL server exporter. There is no claimed Redis/Kafka infrastructure exporter or alert-routing integration in this profile.

Prometheus has 24-hour/128 MB sample retention and smaller 32 MB WAL segments. The active WAL/head has its own overhead; retention size is not an exact whole-volume disk cap. Grafana, Prometheus and Jaeger have explicit container memory/CPU budgets and loopback-only operator ports. No public gateway route exposes them.

## A span is a timed operation

The official Go SDK's tracer starts a span and returns a new `context.Context`. Passing that context to a child operation makes the child part of the same trace. The context still carries the existing deadlines/cancellation; tracing does not replace them.

The HTTP middleware starts an operation, executes the normal handler, then names it using the matched route template and records the response status. Health/metrics reads are excluded. It records no body, query, email, cookie or capability token, and it does not accept public trace headers/baggage that could force sampling.

The maintained `otelgrpc` stats handlers inject/extract W3C trace context for internal gRPC calls. The existing bearer credentials, role checks, deadlines and message limits remain the authority. A trace ID cannot authenticate a service. RPC metadata/payloads are not recorded as tracing attributes.

Each worker processing attempt starts `process_video_attempt`, with its job and attempt IDs in the **private trace**, then child heartbeat/completion RPCs carry that context into the coordinator. Its result is accepted/stopped; failures use a fixed status rather than raw dependency errors. These IDs are useful correlation attributes in a trace, not unbounded Prometheus labels.

The asynchronous catalogue outbox/Kafka dispatch does not currently persist the originating HTTP trace context. The processing attempt therefore has its own root trace, correlated by job ID. Do not claim a single continuous browser-to-Kafka-to-worker trace. The real worker/coordinator child relationship is checked independently of HTTP requests.

By default the API/coordinator sample ten percent of new root operations; worker attempts are sampled fully because the encode queue is bounded and each attempt is useful to inspect. Parent sampling continues across internal RPCs. The rehearsal uses full sampling to make its small real workflow observable. Configure the ratio explicitly for a different workload.

Export is asynchronous with a 256-span queue, 64-span batches and bounded timeouts. A collector outage can drop observations and emit a fixed warning; it does not make tracing a required database/HTTP dependency. This is a demonstration telemetry pipeline, not a lossless audit log.

## Jaeger stores a bounded recent window

Jaeger 2.22 uses an explicit minimal configuration: OTLP/gRPC reception, memory limiter, batch export, memory storage and query UI. Its 1,000-trace memory store resets on restart; this is not permanent trace retention. Optional external agents, AI/MCP integrations, remote sampling and other receiver protocols from the upstream example are omitted.

Jaeger's own UI lets you inspect the actual attempt duration and child coordinator RPCs. The pinned release uses its v3 query API and returns OTLP JSON. We use that release-matched API to verify a worker span, its child RPC client span, and the coordinator server span sharing the same trace and parent relationship. Grafana's legacy Jaeger data source is omitted; the dashboard links to the native Jaeger UI. The operator ports remain private; on AWS, use an SSH tunnel rather than opening their security-group ports.

## Run and learn locally

`npm run operations` starts the normal app with the optional operator overlay and preserves its existing volumes. Open Grafana at `http://localhost:3301` with username **admin**; its generated password stays in `.local/operations.env`. Jaeger is at `http://localhost:16686`; Prometheus is at `http://localhost:19091`. The normal local app has one API replica; the isolated HTTPS rehearsal has two.

Browse/watch a video and refresh its Analytics to produce ordinary requests. A new upload produces a worker attempt trace. Select `peerscreen-worker` in Jaeger and inspect `process_video_attempt`; its child completion RPC appears under `peerscreen-coordinator`. `npm run operations -- stop` stops only the operator services, retaining their data. If tracing remains enabled in the app, an unavailable collector only defers/drops observations; bring the profile back or restart the ordinary app without the overlay to disable it.

Compose profiles must be explicitly enabled in both startup and teardown. An explicit `--profile app` otherwise excludes operator services even when an environment default mentions them. Grafana's admin password initializes its database only once; changing an environment password is not a password reset for a retained database. The disposable runner removes its own operator volumes so retries have a fresh database; the normal operator helper preserves its generated settings and volume.

The gateway's fixed trusted address is now `.250` in the rehearsal subnet, away from dynamic initial service allocation. The added Redis/cache/operator containers exposed the earlier low-address collision. AWS's currently deployed initial source still uses its earlier consistent `.10` pair; the next source rollout changes both gateway address and API trust together. No broad container-network trust is introduced.

Sources: [OpenTelemetry Go instrumentation](https://opentelemetry.io/docs/languages/go/instrumentation/), [Prometheus DNS discovery](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#dns_sd_config), [Jaeger 2.22 deployment](https://www.jaegertracing.io/docs/2.22/deployment/). Releases and immutable image digests were checked against the official projects on 15 October 2026 India time.
