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

## Next phase

Milestone 1 adds the Go catalogue API, PostgreSQL migrations, real sessions/ownership, channels and persisted catalogue metadata. Explain its implementation before building it.
