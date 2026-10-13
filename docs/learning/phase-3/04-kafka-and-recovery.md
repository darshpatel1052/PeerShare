# Kafka, worker leases and recovery

## A notification is not the job

PostgreSQL stores the durable job. Kafka stores a notification that a consumer should try to claim it. This distinction allows the broker to restart, an offset to be replayed, or a worker to disappear without losing the processing decision.

The local Compose runtime uses Apache Kafka in KRaft mode: broker/controller metadata is handled without a separate ZooKeeper service. It has one broker, replication factor one, three partitions per configured topic, bounded retention and a persistent volume. These are local demonstration choices, not a highly available cluster.

`peerscreen.media.dispatch.v1` feeds the worker group. `peerscreen.media.lifecycle.v1` feeds the catalogue projection group. `peerscreen.events.dlq.v1` receives bounded quarantine metadata from invalid worker notifications. Topic keys use the aggregate video ID. Versions still protect catalogue state even when duplicate messages or recovery arrive in a surprising order.

## Producer and consumer decisions

The outbox relay asks for acknowledgement from the broker's in-sync replicas. With one broker this means one replica, not redundant storage. It marks an outbox record published only after that acknowledgement. Broker failure leaves it pending for another attempt.

Workers disable automatic offset commits. They poll one record at a time and ask the coordinator for a durable claim before committing. If the claim response is ambiguous, they retry the same request and do not advance past it. A notification for running or terminal work is a durable no-op. A queued job whose execution slot is occupied waits; it is not placed into an unprotected in-memory work queue.

After a claim is confirmed, the worker commits the offset and encodes. A lost commit response may redeliver the notification. Another consumer still cannot obtain a second live attempt because the coordinator owns the lease and global slot. The client releases its rebalance block after the short claim/commit decision; a Kafka rebalance does not itself revoke the independent PostgreSQL job lease.

## The acknowledged-work crash window

Suppose a worker claims job J, commits the notification offset and immediately crashes. Kafka may consider the notification consumed. The database still records J as running with its lease. Another worker must not reset that lease merely because it started.

The reaper uses database time. After the lease expires it returns eligible work to queued state and creates a new dispatch event in the same transaction. The next claim gets a new attempt ID and a higher epoch. The immutable job/generation stays the same. If the old worker somehow returns, heartbeat/failure/completion calls with its old capability fail.

Queued jobs are also redispatched after a bounded interval. This repairs a notification that was ineffective or lost after broker data loss. Current catalogue snapshots are periodically reconciled through RPC, so a missing lifecycle notification does not strand an unfinished Studio row forever.

## What an epoch fences

Every attempt mutation carries job ID, attempt ID, worker ID and epoch. The coordinator locks the job and checks that the tuple matches its current running attempt and has an unexpired lease. Neither a source path nor a worker's report of success is sufficient. The fence applies to progress, heartbeats, failure and completion.

Completion additionally verifies the actual immutable output descriptor. The verification happens before the final transaction; the transaction then rechecks the live capability before acceptance. A cancellation or reassignment during verification therefore wins over a stale result.

## Retry and cancellation

Unsupported/corrupted sources fail permanently. Transient storage/dependency failures enter `retry_wait` with a persisted due time, bounded backoff and jitter. The reaper emits new dispatch when due. Three attempts are the ceiling, including attempts consumed before migrating a pending Phase 2 job.

Cancellation is durable. A queued job can become cancelled directly. A running job becomes `cancel_requested` while retaining its lease. Its next heartbeat rejects further work, the worker kills/waits for the subprocess and reports stopping, and the coordinator finalizes cancellation. If the worker dies, lease expiry finalizes it. Deletion cleanup waits for quiescence before removing its source/output roots and releasing reservation.

If completion was already accepted before cancellation reaches the coordinator, the coordinator retains that accepted result. The catalogue's persisted cancellation/deletion intent independently prevents a delayed result from being shown or published. Job acceptance and product visibility are separate decisions.

## Invalid messages and shutdown

Malformed envelopes, identity mismatches and unknown job references do not become trusted product state. Quarantine stores bounded identifiers, reason and a content hash; raw credentials or arbitrary message contents are not copied into logs. An invalid worker notification is acknowledged only after its quarantine publication is confirmed. The catalogue records invalid lifecycle metadata before acknowledging it.

Consumer shutdown is part of correctness. A context cancellation must release a rebalance lock and close network clients. The first connected integration run exposed a blocked close; the corrected code uses the installed client's rebalance-aware shutdown method and tests bounded teardown.
