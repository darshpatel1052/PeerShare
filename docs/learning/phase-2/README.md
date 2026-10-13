# Phase 2: from a file on your laptop to a published video

This phase completes the local upload → processing → preview → publication → HTTP playback slice. Your initial Phase 2 studio, endpoints, multipart tables and FFmpeg worker were retained and strengthened. Read this guide alongside the implementation; the examples describe actual code, rather than an architecture that has not been built.

Start at [the product walkthrough](01-product-and-components.md), then read [the data model](02-data-model-and-transactions.md), [HTTP and upload recovery](03-upload-and-api.md), [Go and the media worker](04-go-and-processing.md), and [the failure lab](05-recovery-and-evidence.md). The [Phase 1 guide](../phase-1/README.md) explains the existing authentication, database pool, Go foundation and frontend state.

The important boundary is **local durability**. Source files and derivatives persist in directories or Docker named volumes. This transport uses owner-authenticated HTTP chunks and database-backed short-lived permissions. It does not call S3, and its `parts/presign` endpoint does not produce an AWS presigned URL. The durable database job runs in the Go API binary for this phase. Separate media-schema ownership, gRPC, Kafka/outboxes and distributed scheduling belong to Milestone 3. [ADR 0003](../../adr/0003-local-durable-media-pipeline.md) records this choice.

```mermaid
sequenceDiagram
    participant B as Creator browser
    participant A as Go HTTP API
    participant D as PostgreSQL
    participant S as Persistent local storage
    participant W as Media worker
    B->>B: Hash 8 MiB chunks
    B->>A: Create upload with idempotency key
    A->>D: Reserve space + create private draft/session
    B->>A: Request up to 3 part permissions
    A->>D: Store hashed, scoped tokens with expiry
    B->>A: PUT each missing chunk
    A->>S: Write + hash + sync + rename
    A->>D: Record verified part
    B->>A: Complete upload
    A->>S: Recheck chunks and assemble checksummed source
    A->>D: Commit source metadata + one queued job together
    W->>D: Claim job and persist attempt/lease
    W->>S: Validate MP4, encode HLS, thumbnail, hashes
    W->>D: Accept current attempt; video ready, still private
    B->>A: Preview, then publish
    A->>D: Change publication visibility
    B->>A: Public watch metadata/media
```

A useful mental exercise: stop at any arrow and ask what happens if the process dies before the next arrow. Filesystem writes and SQL commits cannot share one transaction. Immutable identities, retry-safe operations, reservations and reconciliation close those gaps.
