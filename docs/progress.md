# PeerScreen progress

The implementation follows [the supplied brief](project-brief.md). This file records implemented behaviour and evidence, not intended resume claims.

## Completed: milestone 0 — local compatibility

- Repository inspected: empty private repository, default branch `main`.
- Local checkout: `peer-screen/` inside the Codex workspace; the parent is not a checkout.
- Production static Next.js workspace and catalogue/channel/watch routes created.
- Generated H.264/AAC fixture: 60 seconds, 360p/480p, 30 four-second HLS segments.
- Verified HTTP loader checks SHA-256 and byte length before playback.
- Foundation validation passed: five integrity unit tests, typecheck, production build, four Chromium workflow tests (direct routes/reload, playback/seek/quality, CORS/MIME, missing media/retry).
- Dependency versions checked against npm on 13 October 2026 and pinned.
- Reusable watch-page player: opt-in WebRTC delivery through a real self-hosted compatible tracker; verified HTTP fallback.
- Loader validation hooks verified in installed source and exercised with deliberately corrupted real data-channel media bytes.
- Final validation passed: five unit tests, typecheck/format checks, static production build, nine same-origin Chromium browser tests, three additional cross-origin playback/recovery tests.
- Peer departure, tracker disconnection, opt-out/unmount cleanup and media-version separation are exercised.
- Initial CI workflow validates the production export, media fixture and browser flows, retaining evidence. Remote CI status is tracked separately from local validation.
- See [the phase 0 evidence](evidence/milestone-0.md) and [ADR 0001](adr/0001-static-export-and-verified-peer-delivery.md).
- AWS resources: none provisioned. Preserve the Free plan and the stated credit constraint.

## Dependency finding

`npm audit` reports two high findings: `bittorrent-tracker` via `ip` and the `ip` SSRF classification advisory (GHSA-2p57-rm9w-gvfp). The installed tracker imports `ip` in its UDP parser. This proof disables UDP and HTTP announces, binds only loopback, and uses WebSocket signalling. Do not expose this local server publicly without assessing/replacing the affected dependency and implementing the deployment controls. Do not apply npm's suggested downgrade to tracker 0.7.3; it would change the compatibility target substantially.

## Checkpoints

1. Foundation: workspace, static frontend, original brief and reproducible commands.
2. Compatibility proof: reusable player, real generated HLS, tracker, integrity tests and measured browser evidence.

Foundation checkpoint pushed as `c34da4c`. The compatibility checkpoint contains the player integration, CI and raw evidence; use `git log` for its exact revision. Initial milestone completion refers to local feasibility; cross-network/public delivery and other browsers remain explicit later checks.

## Completed locally: milestone 1 — identity and persistent catalogue

The pre-build explanation covered component responsibilities, relationships, sessions, ownership, transactions, revisions and API contracts. Detailed learning chapters are in [the Phase 1 guide](learning/phase-1/README.md).

- Go API with real PostgreSQL persistence, Argon2id passwords, hashed opaque sessions, owner-only channel edits, revisions, public catalogue and cursor pagination.
- Checksummed transactional migrations, owned catalogue schema and pinned PostgreSQL/Redis Compose dependencies.
- Redis atomic authentication limits; conservative TCP-address descriptor policy documented for the local proxy.
- OpenAPI contract and generated TypeScript schemas; generator isolated with its supported TypeScript 5 compiler while the frontend stays on TypeScript 7.
- Backend checkpoint validated: seven unit cases and eight real integration cases passed with the Go race detector.
- Connected production frontend: registration/login/logout, owner channel management, public catalogue/channel/watch data, explicit conflicts and retries.
- All 12 production Chromium cases passed, including existing real peer-delivery/corruption/recovery cases and three account/ownership/form-recovery journeys.
- Real Go process replacement restored the original session/channel. PostgreSQL stop/start preserved metadata; Redis stop/start exercised fail-closed authentication while public/session reads continued.
- Native development and complete container app smoke checks include real API requests, verified HTTP playback and mobile layout inspection.
- [Detailed learning guide](learning/phase-1/README.md), [final evidence](evidence/milestone-1.md), raw records and source fingerprints explain the implementation and its limits.

See [Phase 1 evidence](evidence/milestone-1.md) for the scenario-by-scenario record. Commits continue at the validated backend and connected-product checkpoints.

Backend foundation checkpoint: `7809eb3c8ebb04bf54a2012ea0fde58d1f837f97`, pushed to `main`. The connected-product checkpoint includes browser integration, container images, the recovery runner and expanded teaching/evidence material; its exact revision is in Git history. Remote CI is reported independently of local runs.

## Completed locally: milestone 2 — durable upload and HTTP video

- Preserved the user's initial studio, upload migration, gateway and worker work; extended the migration without changing its checksum.
- Owner-scoped resumable 8 MiB chunks, three-request browser batches, ten-minute part permissions, source/part SHA-256, 24-hour expiry and idempotent create/complete/abort.
- Serialized creator/platform admission and a 20 GiB reservation budget including pending source, assembly, derivatives and retry/staging allowances. Physical cleanup precedes reservation release.
- Persistent single-slot job queue, 60-second leases, immutable generations/attempts, fenced progress/acceptance, cancellation/deletion precedence, bounded retries and recovery reconciliation.
- Actual MP4 validation, server-generated duration, one H.264/AAC HLS rendition, JPEG thumbnail and segment integrity descriptor; independent HLS decode/hash verification.
- Product studio with pause/resume, file identity checking, private verified preview, metadata revisions, publish/unpublish/delete and safe failure recovery.
- Uploaded media checks publication/deletion and accepted output on both media origins; encoded paths cannot bypass it.
- Validation: 7 Go unit and 15 real database integration cases with race detection, 5 explicitly named player unit cases and 16 production Chromium cases. Actual multipart/encoder SIGKILL recovery retained the job/generation, replaced the attempt and decoded the recovered output.
- Implementation checkpoint `22aa729a81af80b5b1ce395efafd1650dbaa3d49` pushed to main. The closing evidence/docs/CI checkpoint follows; exact revision is in Git history.
- [Detailed Phase 2 guide](learning/phase-2/README.md), [evidence](evidence/milestone-2.md) and [ADR 0003](adr/0003-local-durable-media-pipeline.md) explain procedures and boundaries.

This is the local milestone exit: interrupted upload recovery, actual processed publication and HTTP watch. The filesystem transport is not S3; media processing is still in the API binary/catalog schema. No AWS resources were provisioned.

## Completed locally: milestone 3 — media service and distributed recovery

- Independent catalogue, coordinator and worker executables, with versioned generated protobuf/gRPC contracts and separate method-scoped credentials.
- Separate `catalog`/`media` PostgreSQL ownership; the worker has no database or Google credential.
- Transactional catalogue submissions, coordinator dispatch/lifecycle outboxes, real pinned Apache Kafka, explicit offset commits and durable catalogue inbox/version checks.
- Replay-safe claims, sixty-second database-time leases, ten-second heartbeats, increasing epochs, bounded persisted retries, two-step cancellation and pending-job redispatch.
- Real source-appropriate 480p/720p encoding and independent output descriptor/file verification. Existing accepted media paths remain intact.
- Actual broker outage, coordinator SIGKILL, worker SIGKILL with observed FFmpeg termination, lease-respecting recovery, stale completion rejection and API-only restart have passed locally.
- Validation passed: 8 JavaScript unit cases, 43 top-level Go cases (67 including named subcases) with real dependencies/race detection, and all 19 production Chromium cases. Adaptive uploads actually decode and switch between 720p and 480p.
- Packaged-container upload/publication and media serving passed. Explicit build artifact paths fix a Linux `/media` directory collision; this actual-image check is now required in CI.
- Normal containers upgraded with their existing volumes. Original channel/video/480p manifest still return 200; Google remains enabled. A private metadata snapshot was created, without claiming a full media backup/restore exercise.
- Backend checkpoint `bf010df45186de5ae1a966258027ae869f442182` pushed to main; its complete [CI run passed](https://github.com/darshpatel1052/Peer-Screen/actions/runs/38475893519), including historical and distributed recovery. The closing packaging/evidence checkpoint adds the container check; its exact revision and CI status are available in Git history/GitHub.
- See [the Phase 3 learning guide](learning/phase-3/README.md), [detailed evidence](evidence/milestone-3.md) and [ADR 0004](adr/0004-media-services-and-durable-events.md).

The current adapter remains the local filesystem with paired volumes. S3-compatible operations and public deployment require their own explicit verification; no AWS resources were provisioned.

## Implemented locally: milestone 4 product — network exercise pending

The pre-build explanation covered subscriptions as unique relationships, transactional ordered playlists, optimistic revisions, PostgreSQL search, bounded telemetry capabilities and retry deduplication. The [Phase 4 learning guide](learning/phase-4/README.md) records the data/API implementation as it becomes verified.

Following, server catalogue/channel search, Library and private/public playlists now have connected screens. Viewers can follow channels, save videos, reorder/remove entries, edit visibility, share a public collection and play its queue with automatic advancement. Unavailable video entries can be removed by owners and are hidden from public readers.

The watch page reports actual active playback and verified payload into bounded anonymous playback sessions. Creator Analytics displays channel/video plays, watch time, startup, rebuffering and HTTP/peer attribution for the last 30 days. One logical watch session survives sharing/retry reconnections. Optional STUN configuration is available but disabled by default; no TURN or external network service was provisioned.

The five supplied review findings are fixed: completed coordinator output wins late cancellation, upload-stream admission precedes database acquisition, peer opt-out remains usable after initialization failure, search remains mounted for loading/empty results, and thumbnail responses affect only their selected video. The normal containers have been upgraded with preserved data. The original video segment, thumbnail and channel banner bytes are unchanged; Google remains configured. Live Google sign-in remains user-reported, rather than re-exercised here.

Verification: 53 top-level Go cases (78 including subcases) with the race detector passed. The production browser pass passed 23 of 25 cases; mobile channel wrapping and a thumbnail-test selector were corrected, then all five affected product cases passed. The distinct workflows cover all 25 cases. A further small mobile Analytics heading adjustment is recorded separately in current evidence. Builds, types and eight JavaScript cases passed. Actual uploaded-video WebRTC transferred verified payload among three local browser contexts, then continued via HTTP with a 720p seek after opt-out. The short comparison showed lower HTTP during the measured peer interval but no overall saving after consent setup; no billing or cross-network claim is made.

The README now presents the product and learning features first. The Phase 4 guide teaches the end-to-end data/API/component journeys and includes hands-on exercises. Existing service-recovery evidence is retained; no new speculative crash matrix was added during this product checkpoint.

Regression verification exposed a concurrent media-submission unique-index race and stale profiled test containers joining a later Kafka consumer group. Submission locking and complete profiled teardown passed the full 46-case (70 including subcases) suite and the actual-image library/upload check. The Phase 3 closing [CI run succeeded](https://github.com/darshpatel1052/Peer-Screen/actions/runs/38533968360).

The library foundation checkpoint `6b1a9c9` passed [CI](https://github.com/darshpatel1052/Peer-Screen/actions/runs/38542338598). The connected-product/review-fix checkpoint follows; Git history gives its exact revision. The user confirmed two devices/networks can be used for the real cross-network exercise. Local results remain single-host until that measurement is recorded, so the full milestone exit remains pending. No AWS resources have been provisioned.

## Product and Google identity follow-up

Creator banners/thumbnails, Workspace Settings, custom player controls and separate Drafts/Published/Unpublished states are implemented and verified. Google OIDC supports explicit connection to an existing account and retains PeerScreen sessions/ownership. Shared-file credential loading was fixed in `b46f180`, whose complete [CI run passed](https://github.com/darshpatel1052/Peer-Screen/actions/runs/38462247614). On 14 October 2026, the user reported that live Google sign-in worked; this is user-reported validation, distinct from automated signed-provider tests. See [the implementation learning guide](learning/product-and-google/README.md).

## Product UI redesign

The user prioritized a complete interface redesign before uploads. The application now shares one graphite/lime theme and locally served typography across Explore, channels, watch, sign-in and the creator workspace. Development banners and the old build-commentary footer have been removed. Working additions include loaded-video search, light/dark persistence, keyboard channel tabs, canonical copy-link and live channel-title preview. Connection metrics start collapsed; publishing availability stays explicit.

See [the UI learning notes](learning/ui-design.md) and [UI evidence](evidence/ui-redesign.md). This checkpoint retains the existing authentication, ownership, conflict and verified HTTP/peer behavior. It does not implement uploads or invent catalogue content.
