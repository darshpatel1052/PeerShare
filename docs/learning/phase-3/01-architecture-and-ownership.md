# Architecture and ownership

## Why extract processing from the API?

An API request needs a bounded answer: did this upload complete, may this creator publish, what is the current state? Encoding has a different lifetime and resource profile. It can consume CPU for minutes and must survive the browser disconnecting or the API restarting. Phase 2 already ran encoding outside request handlers. Phase 3 makes it a separate process with an explicit durable handoff.

Three executables come from one Go module. `cmd/peerscreen` starts the catalogue HTTP server. `cmd/media` starts the coordinator gRPC server and its scheduling/outbox loops. `cmd/worker` consumes dispatch notifications and invokes the encoder. Docker runs them in separate containers; native development starts the same binaries as separate child processes. A shared source module saves repeated generated-contract and dependency configuration. It does not give a worker database access.

The API continues to own users, sessions, channels, uploads, publication and media HTTP visibility. Google identifies a PeerShare user; it does not authorize internal worker commands. Your reported successful Google sign-in belongs to the product identity work, while the new services use independent credentials generated in ignored `.local/media.env`.

The coordinator owns work scheduling, leases, retries, cancellation and acceptance. Its PostgreSQL login owns only the `media` schema. It cannot create or update catalogue tables. The API's login cannot write the media schema. The worker receives an RPC credential and filesystem roots but no PostgreSQL URL. Real permission tests exercise these denials rather than merely inspecting configuration names.

## Follow an upload through the boundary

The browser sends its final upload request to the API. The API verifies parts, assembles the source, hashes it, and commits source metadata with a durable submission. It returns without waiting for FFmpeg. A dispatcher later calls `SubmitProcessingJob` using the persisted job ID and immutable input.

The coordinator creates the job and outgoing notification records in one transaction. A relay publishes a dispatch notification to Kafka. A worker receives that notification and asks the coordinator for a claim. It may start encoding only after the coordinator has durably granted an attempt. The worker sends progress and heartbeats through gRPC, writes immutable files, then requests completion using an output-descriptor key.

The coordinator verifies the files and decides whether this exact attempt still owns a valid lease. If so, it persists acceptance and an outgoing lifecycle event together. The API's projection consumer receives the notification, obtains the current authoritative snapshot, and updates the catalogue. The existing Studio shows ready. The video remains a draft until the creator publishes it.

## Control traffic and media traffic

gRPC and Kafka carry identifiers, source metadata and bounded descriptors. They do not carry MP4 files or video segments. Source and output bytes stay in the configured storage roots. Viewers use the existing HTTP delivery and optional peer path after publication. This keeps long byte transfers away from short scheduling commands and prevents event logs from filling with video data.

The local runtime still uses paired persistent filesystem volumes. Independent processes on one host share those volumes. That is sufficient to prove service crash/replay behavior; it does not prove multi-host availability. An S3-compatible storage adapter, cross-host TLS, broker access policies and AWS costs require their own later verification.

## Go boundaries to notice

`internal/encoder` accepts a job specification, roots and a progress callback. It imports neither PostgreSQL nor HTTP. `internal/mediasvc` owns media SQL and RPC decisions. `internal/store/media.go` writes catalogue submissions and applies read-model updates. `internal/httpapi/distributed.go` connects catalogue storage to the typed coordinator client and Kafka consumer.

These boundaries make dependencies visible in function arguments and imports. The encoder can be tested with a real generated source without starting Kafka. The coordinator can be tested with a real database and gRPC connection without a browser. The connected integration test then proves that these components actually work together.
