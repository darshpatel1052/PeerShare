# Adaptive media and output acceptance

## One source, several playable renditions

The encoder chooses qualities from the actual probed height. A 360p source produces 360p. A 480p source produces 480p. A 640p source produces 480p and 640p. A 720p or larger source produces 480p and 720p. Odd heights are rounded down to an even value for H.264. Smaller sources are never upscaled just to fill a menu.

Each rendition uses H.264/AAC HLS VOD with a fixed frame-rate/keyframe recipe and approximately four-second segments. The master playlist advertises the actual encoded dimensions. The existing player reads that master and offers available qualities. The processing recipe has a version so changing encoding decisions cannot silently reinterpret an existing job ID.

The worker validates MP4 structure, actual source size and SHA-256 before probing. FFprobe enforces dimensions, stream count and duration policy. FFmpeg receives fixed argument arrays, never a shell command constructed from a creator's title or description. Output sizes, subprocess time and log buffering are bounded.

## Immutable paths

Outputs are written beneath `videos/{video}/{generation}/{attempt}/`. A replacement attempt has another directory. This prevents one stale worker from overwriting the current attempt's files. A cancelled/failed attempt removes its partial output when it can; a later reconciliation sweep handles crash leftovers with a grace period and current references.

On Linux, FFmpeg runs in its own process group, with a parent-death signal. Context cancellation kills the group and waits for it. Killing the standalone worker also kills its active FFmpeg child. The process-recovery runner checks that actual child process, rather than inferring termination from a database state change.

## Integrity and the output descriptor

`integrity.json` retains the player's supported schema: every media segment has a SHA-256 and exact byte length. The media version incorporates the recipe, generation, attempt and segment identities. The existing HTTP/peer validators use those entries before accepting segment bytes.

`output.json` is the coordinator's acceptance contract. It contains the assigned IDs, recipe, duration, qualities, master/integrity/thumbnail keys, and hashes/sizes for output files. It is written last after the output files are synced. It does not make the result public by itself.

The coordinator independently checks descriptor bounds, the exact assigned path, IDs/recipe, regular-file types, safe relative paths, hashes, sizes and total output budget. Required files must exist. The master must reference the listed renditions; each VOD playlist must terminate and reference covered segments; integrity entries must match the segment file entries. Partial output, missing playlists, corrupted segments and path traversal are rejected.

The final transaction then checks the current lease and epoch again. Only one current attempt can become ready. The accepted metadata and completion outbox commit together. The catalogue subsequently updates its accepted paths and quality list without changing publication permission.

## Storage accounting during recovery

Upload reservations continue covering source, assembly, derivative attempts and staging. A source completion acknowledgement does not mean all temporary chunks were removed. Cleanup precedes reservation release.

A catalogue read model can lag the coordinator's heartbeat. The orphan sweep therefore asks the coordinator whether a matching attempt still has a valid lease; a stale projected timestamp cannot delete a healthy worker's files. If that check is unavailable, cleanup defers and does not settle reservations based on an incomplete sweep.

Previously published Phase 2 outputs keep their accepted paths and remain playable. They gain no invented 720p file: only newly processed sources produce the new rendition set. The current shared-volume adapter remains local filesystem storage, not evidence of S3 operations.
