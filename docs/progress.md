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

## Resolved tracker dependency finding

Earlier checkpoints reported two high findings through the old `bittorrent-tracker` server and its `ip` dependency (GHSA-2p57-rm9w-gvfp). The Phase 5 networking checkpoint replaces that server with bounded WebSocket-only signalling over pinned `ws`. The dependency chain is removed and the current audit reports zero findings. Historical evidence retains its earlier findings. Public TLS, resource bounds and deployment admission remain separate controls; an audit result does not establish complete production security.

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

## Started: milestone 5 — networking and deployment foundation

- Free Cloudflare STUN is enabled in normal runtime after explicit opt-in; it can be disabled with `PEER_STUN_URLS=off`. Routine tests remain offline.
- A real running-browser check observed a server-reflexive candidate without retaining addresses or SDP, and no connection before opt-in. Two-network media verification remains pending.
- WebSocket-only tracker, same-origin HTTPS/WSS Envoy routing, two catalogue replicas, shared secure sessions and current DNS endpoint discovery.
- Private Go request-duration/pool/runtime measurements, tracker counters and Envoy health statistics. Trusted client-address headers are accepted only from the configured direct gateway.
- Packaged HTTPS rehearsal served actual uploaded media and exchanged 1,046,596 peer payload bytes, retained a secure session across both replicas, and routed through the healthy endpoint after one API stopped. The initial idle health interval is explicit to avoid its default sixty-second first timer.
- API runtime reduced to approximately 611 MB and web to 230 MB by retaining compilers/build dependencies in build stages. Normal app containers upgraded with original media/artwork and Google configuration preserved.
- Backend verification passed 55 top-level cases (80 including subcases) with race detection. The new tracker passed all 25 production browser cases; the packaged rehearsal additionally exercised the newer committed player UI.
- Terraform 1.16.6 / AWS provider 6.68.0 starter validated locally, with encrypted bounded disks, private buckets, retained release repositories and bounded log retention. No AWS plan/apply, DNS edit, image push to AWS or paid-plan upgrade occurred.
- User selected `peerscreen.darshpatel.dev` and AWS preparation within Free-plan credits. Current credits/expiry, existing usage and demo duration remain unconfirmed; the official-rate 24-hour core subtotal is about USD 2.75 before variable delivery/services and credits.

See [the Phase 5 learning guide](learning/phase-5/README.md) and [current evidence](evidence/phase-5/README.md). This paragraph describes the first networking foundation checkpoint. Subsequent deployment slices below record their own verified scope.

## Product and Google identity follow-up

The following Phase 5 slice adds optional shared creator-analytics caching and production creator approval. Analytics uses a separate 32 MiB Redis instance with allkeys-lru, a 15-second TTL, per-request SQL ownership checks, metadata-versioned keys, explicit Refresh bypass and PostgreSQL fallback. The original noeviction rate-limiter memory remains separate. Production creation/upload/processing requests require a bounded PostgreSQL creator grant; expiry/revocation do not prevent owner cleanup. Upload setup/retries also use a shared per-user request limit. Development retains its existing creator workflow.

Verification passed 57 top-level Go cases (82 including named subcases) with real PostgreSQL, two Redis processes, Kafka, FFmpeg and race detection. The new cache case uses two independent clients, observes a shared hit/current refresh, checks ownership/metadata/deletion and cache failure fallback. The creator case checks grant, expiry, revocation and cleanup. Static build, formatting, types and eight existing JavaScript cases passed. This does not claim a measured cache latency improvement, production creator provisioning or an AWS deployment.

Creator banners/thumbnails, Workspace Settings, custom player controls and separate Drafts/Published/Unpublished states are implemented and verified. Google OIDC supports explicit connection to an existing account and retains PeerScreen sessions/ownership. Shared-file credential loading was fixed in `b46f180`, whose complete [CI run passed](https://github.com/darshpatel1052/Peer-Screen/actions/runs/38462247614). On 14 October 2026, the user reported that live Google sign-in worked; this is user-reported validation, distinct from automated signed-provider tests. See [the implementation learning guide](learning/product-and-google/README.md).

## Product UI redesign

The user prioritized a complete interface redesign before uploads. The application now shares one graphite/lime theme and locally served typography across Explore, channels, watch, sign-in and the creator workspace. Development banners and the old build-commentary footer have been removed. Working additions include loaded-video search, light/dark persistence, keyboard channel tabs, canonical copy-link and live channel-title preview. Connection metrics start collapsed; publishing availability stays explicit.

See [the UI learning notes](learning/ui-design.md) and [UI evidence](evidence/ui-redesign.md). This checkpoint retains the existing authentication, ownership, conflict and verified HTTP/peer behavior. It does not implement uploads or invent catalogue content.

## Phase 5 private storage and release checkpoint

The official Go S3 adapter now covers resumable chunks, source assembly, worker attempts, coordinator verification, creator artwork, authorized playback and cleanup. Actual packaged S3 upload/480p/720p/publication/read/unpublish/delete passed, including after removing local chunk/output copies. This is API-mediated chunk storage, not native browser S3 multipart. CloudFront media/API remain uncached through the catalogue permission gate.

A real Envoy image validated and exercised the origin secret, trusted viewer-header replacement, media rewrite, private metrics and WSS upgrade with simulated CloudFront requests. A full backup of the normal database and both media/upload volumes restored into an isolated networkless database; all 85 media/source file hashes matched. The exact original local containers resumed.

AWS account-specific preflight confirmed the active Free plan with USD 100 plan credits and eligible compute/AMI/quota. The user's DNS validation produced an issued ACM edge certificate; the production Google callback is user-confirmed. Private S3 buckets, immutable ECR repositories, scoped IAM roles and a seven-day log group are now provisioned. The full workload plan estimates about USD 3.90 gross for the first day, allows USD 10 and records retained-resource costs. No plan upgrade or paid subscription occurred.

Pinned GitHub OIDC publication, role-refresh/renewal hooks and host release scripts are implemented. Actual publication, compute/data rollout, origin renewal, live AWS backup/restore, monitoring/tracing and the public/two-network checks remain. [Learning chapter](learning/phase-5/05-storage-and-release.md), [evidence](evidence/phase-5/storage-and-release.md), [ADR](adr/0005-private-s3-and-bounded-aws-release.md).

## Phase 5 operations and private AWS rollout

The immutable `4d40319` release was published through GitHub OIDC and deployed to the actual Mumbai EC2 origin. Original channel/video/artwork data is present; S3 manifests and integrity descriptors were verified through the real TLS gateway. The free origin certificate passed a Certbot renewal dry run and deploy hook. A snapshot downloaded from the actual private AWS backup bucket restored into an isolated PostgreSQL instance, with 85 matching file hashes. The host has an absolute 24-hour stop deadline; retained disks/storage/address still have retention costs.

CloudFront creation is blocked by AWS account verification. The user chose to wait, then explicitly authorized submitting an Account and billing case through their browser. The case was submitted on 15 October 2026 IST, with Basic Support and an explicit request to retain the Free plan. This is not successful public deployment. Its private case details are retained only in ignored local evidence.

The optional operator profile now provisions Prometheus, an eight-panel Grafana dashboard and bounded in-memory Jaeger. The actual-image HTTPS rehearsal observed both API replicas, a worker/client/coordinator parent-child trace, secure shared sessions and 701,428 received peer media payload bytes. It also served through the remaining API after one replica stopped. These are single-host local results; no cross-network or production latency claim follows. [Operations learning](learning/phase-5/06-observability.md), [local record](evidence/phase-5/operations.json), [private AWS origin/restore record](evidence/phase-5/aws-private-origin.json).

## Product finish while CloudFront verification is pending

The normal app now has a refined Manrope hierarchy, original-colour thumbnails, publication dates, real channel discovery, a responsive library invitation, request skeletons and Studio drag-and-drop selection with functional publication-state summaries. The user's original video/channel remain present; manifest, integrity, thumbnail and banner hashes matched before/after the normal container upgrade. Google remained enabled. The private monitoring profile is also running locally.

The production-browser run passed 24 of 25 journeys initially. The remaining journey exposed duplicate accessible names on the new Studio summaries; distinct summary labels corrected it, and the actual adaptive upload/preview/publish/quality/unpublish/delete journey passed again. The normal in-app-browser walkthrough also played and paused the original video. [Detailed concepts](learning/phase-6/01-product-finish.md), [evidence](evidence/phase-6/product.json), [desktop](evidence/phase-6/explore-desktop.jpg), [phone](evidence/phase-6/explore-mobile.png).

## Phase 6 local Kubernetes and handoff

The real Helm chart passed a clean kind 0.33.0 / Kubernetes 1.37.0 deployment with checksum-verified Helm 4.3.0 and kubectl 1.37.1. Its setup Job applies migrations and topics before app readiness, scoped role Secrets stay ignored, and PVCs hold the separate lab's database/broker/media. The actual API/worker pipeline uploaded a generated three-second 720p MP4, prepared 480p/720p, published a readable HLS manifest and retained one session across two APIs. Scaling produced three ready endpoints and three distinct responding replicas; Envoy discovery converged during the bounded check. The disposable cluster was removed afterward. No EKS or other AWS resource was added. [Learning](learning/phase-6/02-kubernetes.md), [actual record](evidence/phase-6/kubernetes.json).

The normal operator profile uses distinct ports from native test RPC, and the packaged operations rehearsal has its own operator ports. Native startup checks the actual authenticated coordinator RPC. Studio's completion notice now tracks preparation, its mobile status badge stays readable, and the publishing journey passed with the normal operator profile running. The bounded API benchmark harness passed its ten-request functional check; no capacity claim follows from that check. Full deployment measurements and external review remain after public release, as requested.

The [demo/handoff runbook](runbooks/demo-and-handoff.md) gives the creator/viewer journey first, operator and Helm exercises second, then the pending public release/device/benchmark sequence. CloudFront verification, final domain routing, live production Google authentication and two-network peer validation remain pending. The local AWS CLI session needs renewal before later AWS operations; the initial host's fixed stop deadline is not extended by waiting.
