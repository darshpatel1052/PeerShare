# 4. Go concepts inside the media pipeline

## Methods, values and durable authority

`func (a *App) processMediaJob(parent context.Context, job store.Job) error` is a method on an application pointer. The pointer gives it the configured store, logger and storage roots. `store.Job` is a value describing the durable claim: job/video/source/generation/attempt/worker IDs and verified input size/hash. It is not a live SQL row. Each database update therefore rechecks that claim against current state.

Go does not use exceptions for ordinary errors. Calls return an `error`; `errors.Is` distinguishes expected conflicts from a database outage. HTTP handlers translate them into bounded API errors. Worker failures persist a code such as `unsupported_media` or `source_corrupt`; raw decoder diagnostics stay out of product responses.

`defer` schedules cleanup when a function exits. It closes files, removes temporary names, rolls back uncommitted transactions, unlocks dedicated PostgreSQL connections and stops heartbeat goroutines. Cleanup on cancellation uses a short fresh context because the original request/work context may already be cancelled.

## Goroutines, channels and cancellation

The main process starts the server and worker independently. `go` schedules a function as a goroutine; it is not a durable job queue. Work survives because jobs are in PostgreSQL before a goroutine claims them.

The worker executes one job at a time. A maintenance goroutine continues expiry/recovery while FFmpeg is busy. A per-attempt heartbeat goroutine updates the lease every two seconds. A `select` waits for either a ticker or `ctx.Done()`. The lease lasts 60 seconds, using PostgreSQL time. A second API process respects it. On an abrupt crash, the reaper waits until expiry, then queues a new attempt. Graceful shutdown cancels subprocess work and releases its claim when possible.

The worker's context has a 30-minute limit. `exec.CommandContext` starts FFprobe/FFmpeg with an argument list; it does not interpolate a shell command. Paths and filters are arguments, not shell executable text. If cancellation/deadline/lease loss occurs, context cancellation stops the command. Subprocess output is bounded so a malformed media file cannot create unlimited diagnostic logs. The container additionally has memory/CPU limits; native mode does not impose an OS memory quota.

The part receiver uses a buffered channel as a semaphore for up to twelve active body streams in the process. Database locks additionally prevent duplicate writers across processes. This is a concurrency bound, not storage authority; reservations and stored byte verification handle capacity.

See [Go's `os/exec` reference](https://pkg.go.dev/os/exec) for subprocess API semantics. The implementation is in `worker.go` and `main.go`.

## The processing recipe

1. Confirm private source is a regular file within size policy and matches its recorded SHA-256.
2. Check the MP4 `ftyp` box and probe with the MOV/MP4 demuxer. A renamed text/WebM/AVI file is not accepted just because its name ends in `.mp4`. External data references are disabled; input protocols are restricted to file/pipe.
3. Read actual duration and video dimensions. Reject over ten minutes, absent video, below 144 pixels high, over 3840 × 2160, or excessive streams. Duration is server-generated.
4. Encode one rendition, at most 480 pixels high without upscaling the source. H.264/libx264 video, AAC audio when present, even dimensions as required by the recipe, 30 fps, bounded video rate and two encoder threads form the practical local output.
5. Force four-second keyframe boundaries and generate a VOD MPEG-TS HLS playlist. A rendition is a separately encoded version; this phase creates one, not a full adaptive ladder. The earlier fixture still has two renditions for player compatibility tests.
6. Generate a JPEG thumbnail from the first frame, which also supports short clips.
7. Hash each complete segment, recording its relative key, SHA-256 and length. Generate the integrity descriptor and master playlist; probe encoded dimensions for the master rather than trusting original dimensions.
8. Count output bytes and enforce the 220 MiB derivative bound, sync outputs and directory entries, then request database acceptance.

Output paths are `videos/video-id/generation-id/attempt-id/...`. A retry preserves the generation and uses another attempt directory. It cannot overwrite a previous attempt's output. The integrity descriptor's `mediaVersion` is derived from encoded segment bytes; the player's swarm key additionally includes video/generation/attempt identity.

[FFmpeg's format documentation](https://ffmpeg.org/ffmpeg-formats.html) describes MP4 demuxer and HLS options. Actual installed commands and output checks are recorded in the evidence, because documentation alone cannot prove this project's output decodes.

## A lease is permission, not physical termination

A stale encoder can finish after its lease expires. Its CPU completion is not sufficient to publish anything. `FinishProcessing` locks the job and checks running state, worker ID, attempt ID and unexpired lease. It also locks the video and checks deletion. If any check fails, acceptance conflicts. Cancellation invalidates the current attempt; deletion's tombstone prevents resurrection.

If acceptance committed before cancellation, the ready result wins and cancellation conflicts. If cancellation committed first, completion conflicts. The row lock serializes the decision. Progress and heartbeat writes are fenced too, so an old worker cannot update a replacement attempt's UI state.

Successful acceptance changes processing to ready, not publication to published. The creator separately publishes. Failed attempts can retry within the three-claim bound; exhausted crash recovery becomes `recovery_exhausted`. Redis is not used as the queue, so losing Redis counters does not erase media jobs.

## What comes next

Milestone 3 can extract an authenticated media coordinator/worker with owned schema credentials, versioned gRPC messages, submission/lifecycle outboxes, Kafka notifications, claim epochs and a tested dispatcher. Those additions should preserve the durable-state and fencing rules already proved here. Kafka would notify workers of available jobs; it should not become the sole record of whether an encode is owed.
