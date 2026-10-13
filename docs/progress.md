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

## Next: milestone 2 — durable upload admission

Explain the upload model and request lifecycle before implementation: ownership, admission/quota reservations, immutable object keys, idempotency, multipart completion, authoritative database transitions, generation/attempt identity and failure recovery. Introduce storage/processing incrementally with concrete local evidence before provisioning cloud resources. Phase 1's fixture importer is an operator tool, not an uploader workflow.

## Product UI redesign

The user prioritized a complete interface redesign before uploads. The application now shares one graphite/lime theme and locally served typography across Explore, channels, watch, sign-in and the creator workspace. Development banners and the old build-commentary footer have been removed. Working additions include loaded-video search, light/dark persistence, keyboard channel tabs, canonical copy-link and live channel-title preview. Connection metrics start collapsed; publishing availability stays explicit.

See [the UI learning notes](learning/ui-design.md) and [UI evidence](evidence/ui-redesign.md). This checkpoint retains the existing authentication, ownership, conflict and verified HTTP/peer behavior. It does not implement uploads or invent catalogue content.
