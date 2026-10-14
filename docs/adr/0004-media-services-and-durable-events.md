# ADR 0004: media services, durable RPC submission, and Kafka notifications

Date: 14 October 2026. Status: implemented and verified locally.

## Context

Phase 2 established recoverable source uploads and immutable accepted output attempts, but the API binary also encoded media and owned all job tables. The next milestone requires real service boundaries, gRPC controls, Kafka events, and recovery after an acknowledged notification is interrupted.

## Decision

Keep one Go module for shared compilation and generated contracts. Build three independent executables: `peerscreen`, `media`, and `worker`. Separate processes and database permissions define the service boundary; separate Go modules would not enforce that boundary.

The API uses the catalogue role and writes only `catalog`. The coordinator uses a distinct media role and writes only `media`. The worker has neither database credential. Versioned protobuf RPCs authenticate catalogue and worker roles with separate generated private credentials on the private local transport. Every call has a deadline and a message-size bound. Public/cross-host TLS and broker access configuration remain deployment work.

Source completion commits a stable catalogue submission beside its source metadata. The dispatcher retries an ambiguous `SubmitProcessingJob` result with the same job/input. The coordinator rejects conflicting immutable input and commits a new job with its dispatch/lifecycle outbox records. The relay publishes to real Apache Kafka before marking an outbox record acknowledged. Repeated events carry stable IDs.

A worker polls one notification at a time, obtains a durable claim, and then commits its Kafka offset. Each claim has a boot-specific worker ID, stable request ID, immutable attempt ID, increasing epoch, and a database-time lease. Replaying a valid claim returns the same attempt. Reusing an expired request cannot create another attempt. A one-second reaper recovers expired leases, schedules persisted retries, and redispatches queued jobs after a bounded interval; acknowledged notification loss therefore cannot lose the durable job.

Worker encoding remains bounded to one slot per process, and the coordinator serializes the initial global slot. Heartbeats occur every ten seconds with a sixty-second lease. Transient failures schedule persisted bounded backoff with jitter; three attempts are the maximum. Cancellation retains a running lease as `cancel_requested` until the worker acknowledges stopping or the lease expires. Attempt IDs, worker IDs and epochs fence all progress and result operations.

The worker writes source-appropriate 480p/720p HLS, a thumbnail, integrity hashes and an output descriptor beneath its immutable attempt path. The coordinator independently verifies all listed bytes and required playlists before accepting a completion. Acceptance and its lifecycle outbox commit together.

Catalogue processing rows remain a read model, with a coordinator version and an event inbox. The API consumes lifecycle notifications and fetches the authoritative coordinator snapshot before applying an update. This prevents a broker message from fabricating acceptance. Inbox recording and product changes share a transaction; older versions, another generation, cancellation intent and deletion cannot resurrect a video. Periodic RPC reconciliation repairs a missed lifecycle notification. Filesystem cleanup consults current coordinator leases and waits for deletion cancellation to become quiescent before releasing storage.

## Migration and retained boundaries

The new catalogue migration leaves accepted Phase 2 paths untouched. Fully identified unfinished sources receive durable submissions; previously consumed attempt counts are retained. Failed/cancelled older jobs enter the new pipeline when the owner retries them. Existing migrations retain their checksums. The container start command builds first, then stops application writers before migration/seed and startup; old executors must not mutate an in-flight job while the new migration imports it.

The filesystem transport and paired named volumes remain the local storage adapter. This is a single-host service/recovery exercise, not S3 multipart storage or multi-host availability. The S3 storage implementation, public admission/TLS, cloud cost record, telemetry, and deployment operations remain their explicit later milestones.

The historical Phase 1/2 failure runners explicitly select the retained development-only legacy executor. Normal native/container startup and production-browser tests use the distributed path. Separate Phase 3 process tests must demonstrate the new service boundaries; the legacy runners do not establish them.

## Verification and references

Real tests cover signed-in HTTP uploads, gRPC authentication, PostgreSQL ownership, Kafka publication, FFmpeg decoding, claim replay, stale epochs, retry limits, cancellation, projection replay and deletion. All 43 top-level Go cases (67 including subcases), 19 production Chromium cases, standalone-process crash recovery and packaged-container uploads passed. Original local media and Google availability were preserved. See [the milestone evidence](../evidence/milestone-3.md) for source binding, actual observations and scope.

Dependencies were checked on 14 October 2026: gRPC Go 1.84.0, protobuf 1.36.12, Go gRPC generator 1.6.2, franz-go 1.22.2, and Apache Kafka 4.2.2 pinned by image digest. Contract generation uses the pinned pure-Go protobuf compiler and the official Go plugins, with a byte-comparison CI check.

See [gRPC deadlines](https://grpc.io/docs/guides/deadlines/), [gRPC authentication](https://grpc.io/docs/guides/auth/), [franz-go's client documentation](https://pkg.go.dev/github.com/twmb/franz-go/pkg/kgo), and [Apache Kafka's supported releases](https://kafka.apache.org/community/downloads/). The Kafka consumer shutdown path follows the installed client's `CloseAllowingRebalance` contract when `BlockRebalanceOnPoll` is enabled.
