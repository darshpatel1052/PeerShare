# PeerScreen

A video publishing application with opt-in peer-assisted delivery and verified HTTP fallback. The implementation follows the [project brief](docs/project-brief.md) in tested checkpoints.

**Phase 1 is complete locally:** Go authentication, PostgreSQL-backed accounts/channels/catalogue, Redis authentication limits and connected browser pages. The real Phase 0 HLS/peer player remains working. The published video is an explicitly generated fixture; upload/transcoding and AWS deployment are later phases.

## Start locally

Prerequisites: Node 22.18+ within 22.x, npm 10+, Go 1.27.2 (the wrapper can download this toolchain), Docker with Compose, and FFmpeg/FFprobe with libx264/AAC. Browser tests also require Playwright Chromium. Local credentials are generated into ignored `.local/local.env`; keep this file private and preserve it with the persistent database.

```sh
npm ci
npm run fixture
npm run web-build
npm run demo
```

Open `http://localhost:3000`. Visit **Account** to register, create a channel, edit it, reload and sign out/in. Your channel starts with an empty published-video list. The demo starts real PostgreSQL/Redis, applies the migration, imports the generated video, starts Go and serves the production static frontend with an API proxy.

Stop the native demo with Ctrl+C before choosing another mode:

```sh
npm run dev             # Next.js hot reload, native Go, local media/tracker
npm run compose:demo    # Go/web/database/cache containers; fixture required first
npm run stop            # Stop project containers; preserve the database volume
```

Only one app mode can occupy the local ports at a time. Stop app containers before returning to native demo/development. Host ports are web 3000, media 3001, tracker 8000, private API 18080, PostgreSQL 55432 and Redis 56379, all bound to loopback. Container-internal API port is 8080. On this machine Docker's default build bridge was absent; `PEERSCREEN_BUILD_NETWORK=host npm run compose:demo` makes build downloads work while runtime services still use the private Compose bridge.

## Learn the implementation

The [Phase 1 learning guide](docs/learning/phase-1/README.md) explains what each part does, how the code uses it and why it was chosen:

1. Component boundaries and the request journey.
2. SQL modelling, keys, constraints, transactions, revisions, indexes and cursor pagination.
3. Go modules/packages, structs, pointers, methods, interfaces, errors, contexts, goroutines and channels.
4. HTTP/API contracts, password hashing, opaque sessions, cookies, origin checks, ownership and rate limits.
5. React components, hooks, request state, typed API calls and preserving unsaved edits.
6. A practical lab with HTTP requests, safe SQL inspection and recovery experiments.

See [the detailed Phase 1 evidence](docs/evidence/milestone-1.md) for procedures, expected/observed results, raw records, source fingerprints and the limits of each claim. [Progress](docs/progress.md) records checkpoints; [ADR 0002](docs/adr/0002-identity-and-persistent-catalogue.md) records the architectural choices.

## Verify locally

```sh
npx playwright install chromium --only-shell
npm run check
npm run contracts:check
npm run api:vet
npm run test:integration
npm run test:browser
npm run test:recovery
```

Phase 1 verification passed 5 player unit cases, 7 Go unit cases, 8 real PostgreSQL/Redis integration cases and 12 production-browser cases. Go integration uses the race detector. Browser tests use the production export, not development mode. Integration, browser and recovery runners use the same separate disposable `peerscreen-test` project, so run them sequentially. They remove only that project's test volume; normal app data persists. CI recreates these checks and retains raw evidence.

## Try peer delivery

Open the same watch video in three separate browser profiles/contexts, choose 360p and enable **Help share this video** in each. Overlapping playback and cached segments improve the chance of sharing. The details panel shows verified received media bytes by source and uploaded peer payload separately. Peers/network conditions can prevent sharing; HTTP stays available.

Sharing starts off. Opting in spends upload bandwidth and exposes network addresses to connected peers. Turning it off closes peer connections and keeps HTTP playback. Current peer proof uses loopback, a local tracker and no external STUN. To exercise a separate media origin in the native production demo, use `MEDIA_BASE_URL=http://localhost:3001/ npm run demo`; these URLs now come from the API at runtime.

## Current limits

Uploads, processing workers, email verification/password recovery, backups/restore, multi-host failover and public deployment are not implemented in this phase. Runtime database credentials currently own the application's schema; production needs a narrower role split. Behind the local proxy, authentication limits share the proxy TCP-address bucket. Native HLS and other browsers have not been proved equivalent to the Chromium integrity/P2P path.

The tracker dependency has a known high advisory through `ip`. UDP/HTTP announces are disabled and this local proof stays on loopback; assess/replace the affected dependency before public exposure. Details are in [progress](docs/progress.md#dependency-finding). AWS resources have not been provisioned.

Phase 0's historical [evidence](docs/evidence/milestone-0.md) and [ADR](docs/adr/0001-static-export-and-verified-peer-delivery.md) remain available. Checkpoint commits are created and pushed after substantial validated progress.

## Product interface

The UI redesign adds a graphite/lime visual identity, a light theme, a media-led catalogue, branded channel pages, a creator workspace and a focused player. Search filters loaded videos; channel tabs, keyboard navigation, copy-link and theme persistence work. Publishing remains explicitly unavailable until its backend workflow is built.

See [the UI learning notes](docs/learning/ui-design.md) for design tokens, component responsibilities and browser state, and [the UI evidence](docs/evidence/ui-redesign.md) for screenshots and actual checks.
