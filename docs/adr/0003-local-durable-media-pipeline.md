# ADR 0003: local durable upload and media pipeline

Date: 13 October 2026. Status: accepted for the local Milestone 2 slice.

## Context

The user's partial Phase 2 implementation already used persistent local files, multipart metadata, a Go worker and a creator studio. The requested immediate outcome is a recoverable real-source upload that produces playable media and can be published. Cloud resources remain outside the authorized Free-plan/credit constraint. Milestone 3 owns service extraction, gRPC and Kafka/outbox recovery.

## Decision

Retain the local filesystem transport, with persistent upload/media roots and Docker named volumes. Use owner-authenticated scoped part endpoints plus database-backed ten-minute permissions. Preserve the first upload migration and extend it with a new checksummed migration.

PostgreSQL owns upload admission, pending storage reservations, idempotency, part metadata and a durable single-slot job queue. Completion commits source metadata and the queued job together. The worker uses stable generation IDs, new per-claim attempt IDs, database-time leases and fenced writes/acceptance. Immutable attempt directories and periodic orphan/expiry reconciliation handle storage/SQL failure windows. HTTP visibility checks apply to both media origins, and private preview uses the verified player without peer sharing.

Processing runs in a background goroutine of the same API binary, with bounded subprocesses; it does not run in a browser request handler. Processing tables remain in the catalog schema in this phase. The separation into media-owned tables and coordinator APIs must be an explicit migration/extraction later.

## Consequences and boundaries

The local exit criterion can be verified without S3 costs or pretending AWS infrastructure was deployed. The `parts/presign` name matches the protocol outline, but its returned permissions are local authenticated capabilities, not S3 signatures. Storage operations are confined to the adapter's configured roots; a future S3 implementation must provide real multipart IDs/list-parts/complete/HEAD/abort reconciliation rather than reusing local filenames as S3 evidence.

Source/output volumes must remain paired with their database. Native mode uses `.local` directories; container mode uses named volumes. Changing modes alone does not migrate media between these storage roots. Keep using the current mode for uploaded videos or explicitly migrate both roots; metadata/session portability alone does not imply file portability.

This phase has one rendition, a 30-entry recent studio list, staged processing progress, bounded retry and one global encode slot. It does not implement distributed media ownership, Kafka delivery, S3 presign semantics, public admission allowlists, off-host backups or public deployment. Production-mode new upload admission remains disabled pending that policy.
