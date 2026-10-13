# PeerScreen progress

The implementation follows [the supplied brief](project-brief.md). This file records implemented behaviour and evidence, not intended resume claims.

## Current phase: milestone 0 — compatibility

- Repository inspected: empty private repository, default branch `main`.
- Local checkout: `peer-screen/` inside the Codex workspace; the parent is not a checkout.
- Production static Next.js workspace and catalogue/channel/watch routes created.
- Generated H.264/AAC fixture: 60 seconds, 360p/480p, 30 four-second HLS segments.
- Verified HTTP loader checks SHA-256 and byte length before playback.
- Foundation validation passed: five integrity unit tests, typecheck, production build, four Chromium workflow tests (direct routes/reload, playback/seek/quality, CORS/MIME, missing media/retry).
- Dependency versions checked against npm on 13 October 2026 and pinned.
- Player validation hook, actual peer bytes, fallback and browser tests: in progress.
- AWS resources: none provisioned. Preserve the Free plan and the stated credit constraint.

## Dependency finding

`npm audit` reports two high findings: `bittorrent-tracker` via `ip` and the `ip` SSRF classification advisory (GHSA-2p57-rm9w-gvfp). The installed tracker imports `ip` in its UDP parser. This proof disables UDP and HTTP announces, binds only loopback, and uses WebSocket signalling. Do not expose this local server publicly without assessing/replacing the affected dependency and implementing the deployment controls. Do not apply npm's suggested downgrade to tracker 0.7.3; it would change the compatibility target substantially.

## Checkpoints

1. Foundation: workspace, static frontend, original brief and reproducible commands.
2. Compatibility proof: reusable player, real generated HLS, tracker, integrity tests and measured browser evidence.

## Next phase

Milestone 1 adds the Go catalogue API, PostgreSQL migrations, real sessions/ownership, channels and persisted catalogue metadata. Explain its implementation before building it.
