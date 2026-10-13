# Data model, transactions and outboxes

## Owned tables and references

| Table                       | Owner       | Purpose                                                       |
| --------------------------- | ----------- | ------------------------------------------------------------- |
| `catalog.upload_sessions`   | API         | Source upload state, checksums and storage reservation        |
| `catalog.processing_jobs`   | API         | Studio processing read model and accepted coordinator version |
| `catalog.media_submissions` | API         | Immutable job input and unsent submit/retry/cancel intent     |
| `catalog.media_event_inbox` | API         | Event IDs applied with catalogue state                        |
| `catalog.media_quarantine`  | API         | Bounded invalid-record metadata and content hash              |
| `media.jobs`                | Coordinator | Authoritative job snapshot, lease and retry schedule          |
| `media.claim_requests`      | Coordinator | Durable claim-request identity, attempt and epoch             |
| `media.command_inbox`       | Coordinator | Idempotent retry/cancel command IDs                           |
| `media.outbox`              | Coordinator | Outgoing dispatch and lifecycle records                       |
| `media.quarantine`          | Coordinator | Owned diagnostic record structure                             |

The database is one PostgreSQL instance, but credentials enforce separate schema permissions. Media rows carry catalogue UUIDs as protocol references; they do not have cross-schema foreign keys that require the coordinator to inspect product tables. The API validates ownership before submitting or cancelling work.

## Several IDs answer different questions

A video ID identifies the product record. A generation ID identifies one processing generation. A job ID identifies its immutable input and recipe. An attempt ID identifies one worker execution. A worker ID identifies one process boot. An epoch increases whenever the coordinator grants a new attempt. A claim request ID identifies one claim RPC operation, including its retries. An event ID identifies one outgoing event, including redeliveries.

Reusing the job ID is safe only if its input is equivalent. The coordinator serializes and hashes the protobuf specification deterministically. A repeated equivalent submission returns the existing state. The same ID with different source size, owner, checksum or recipe is a conflict. Reusing an old claim request cannot silently mint a fresh attempt after its lease expires.

## The first atomic handoff

Source completion changes upload state, records its source key/hash, creates the catalogue job read model, and inserts a media submission in the same PostgreSQL transaction. An error rolls all of those database changes back together. Filesystem assembly still has its separate reconciliation rules from Phase 2; SQL does not magically make a file write transactional.

The API dispatcher reads unsent submissions and calls gRPC. It records `submitted_at` only after a confirmed response. If the coordinator committed the job but the response was lost, the API retries the same immutable input. The coordinator's idempotency makes that ambiguity safe.

Retry and cancellation intent remain in the catalogue submission record until acknowledged. Each command has a stable UUID. An acknowledgement updates only the matching command ID, so an old response cannot mark a newer command sent.

## Why the second outbox is necessary

Creating a job and publishing a Kafka message cannot be one ordinary PostgreSQL transaction. Publishing first risks notifying a worker about a job that rolls back. Saving the job first and publishing directly afterward risks a crash that leaves a job with no notification.

Instead, the coordinator saves the job and a `media.outbox` record in the same transaction. A separate relay publishes the record, waits for broker acknowledgement, then marks it published. A crash after publish but before that mark can cause a duplicate. The event keeps its ID, and downstream state changes are idempotent. This is at-least-once delivery, not a blanket exactly-once guarantee.

The same pattern applies to completion: accepted state and the completion outbox commit together. An API timeout cannot undo a committed accepted result, and Kafka downtime cannot erase it.

## Snapshots and monotonic versions

The coordinator persists a bounded protobuf snapshot and indexed scheduling columns together. A snapshot includes state, progress, attempts, the active lease capability, an increasing version, the latest event ID and accepted output metadata. Indexed columns let the reaper find expired/due work without decoding every row.

Catalogue projection locks its read-model row, inserts the event-inbox record and applies a newer matching snapshot in one transaction. A duplicate event ID, an older version or a different generation does not regress product state. Deletion is checked under a row lock. Persisted cancellation intent prevents a delayed accepted result from becoming ready/public after the owner cancelled it.

Lifecycle consumers obtain the coordinator's current snapshot before applying a message. Kafka is a notification channel, not permission to invent accepted media. Periodic reconciliation also obtains current snapshots for unfinished product rows, repairing a missing lifecycle notification.

## Migration preserves existing media

The new migration adds tables/columns rather than rewriting earlier checksummed migrations. Accepted video paths stay unchanged. Identified queued/running sources receive submissions with their already-consumed attempt count. The coordinator retains that count, so changing the service boundary does not reset retry budgets. Older failed/cancelled jobs enter this pipeline through an explicit owner retry.
