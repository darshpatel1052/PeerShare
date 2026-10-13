# PeerScreen

A video publishing application with opt-in peer-assisted delivery and verified HTTP fallback. The implementation follows the [project brief](docs/project-brief.md) in tested checkpoints.

**Phase 2 is complete locally:** authenticated resumable MP4 uploads, verified source assembly, a durable fenced FFmpeg worker, private previews, owner publishing/editing/deletion, and real HTTP playback. The existing identity/catalogue and verified HLS/peer player remain working. Storage uses persistent local directories or Docker volumes; S3, Kafka/gRPC service extraction and public deployment are later work.

## Start locally

Prerequisites: Node 22.18+ within 22.x, npm 10+, Go 1.27.2 (the wrapper can download this toolchain), Docker with Compose, and FFmpeg/FFprobe with libx264/AAC. Browser tests also require Playwright Chromium. Local credentials are generated into ignored `.local/local.env`; keep this file private and preserve it with the persistent database.

```sh
npm ci
npm run fixture
npm run web-build
npm run demo
```

Open `http://localhost:3000`. Sign in/create a channel through **Workspace**, then open **Studio**. Select an MP4 up to 250 MiB/10 minutes, add metadata, upload, preview the processed draft, and publish it. It appears on your channel and Explore with a public watch link. For an interrupted upload, reselect the original file and choose **Resume with selected file**. Pause, cancel, bounded retry, metadata edits, unpublish and delete are available. The demo starts real PostgreSQL/Redis, applies migrations, retains the operator fixture, starts Go and serves the exported frontend with an API proxy.

Stop the native demo with Ctrl+C before choosing another mode:

```sh
npm run dev             # Next.js hot reload, native Go, local media/tracker
npm run compose:demo    # Go/web/database/cache containers; fixture required first
npm run stop            # Stop project containers; preserve the database volume
```

Only one app mode can occupy the local ports at a time. Stop app containers before returning to native demo/development. Host ports are web 3000, media 3001, tracker 8000, private API 18080, PostgreSQL 55432 and Redis 56379, all bound to loopback. Container-internal API port is 8080. On this machine Docker's default build bridge was absent; `PEERSCREEN_BUILD_NETWORK=host npm run compose:demo` makes build downloads work while runtime services still use the private Compose bridge.

## Learn the implementation

The [Phase 2 learning guide](docs/learning/phase-2/README.md) explains upload components, the new tables/transactions, HTTP contracts, Go worker/lease concepts, FFmpeg/HLS, and recovery experiments. See [Phase 2 evidence](docs/evidence/milestone-2.md) for actual byte counts, attempt identities, screenshots, procedures and limits.

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
npm run test:media-recovery
```

Phase 2 verification covers 5 named player unit cases, 7 Go unit cases, 15 real PostgreSQL/Redis integration cases and 16 production-browser cases, plus actual API/database/cache and media-process crash recovery. Go integration uses the race detector. Browser tests use the production export, not development mode. Integration, browser and recovery runners use the same separate disposable `peerscreen-test` project, so run them sequentially. They remove only that project's test volume; normal app data persists. CI recreates these checks and retains raw evidence.

## Try peer delivery

Open the same watch video in three separate browser profiles/contexts, choose 360p and enable **Help share this video** in each. Overlapping playback and cached segments improve the chance of sharing. The details panel shows verified received media bytes by source and uploaded peer payload separately. Peers/network conditions can prevent sharing; HTTP stays available.

Sharing starts off. Opting in spends upload bandwidth and exposes network addresses to connected peers. Turning it off closes peer connections and keeps HTTP playback. Current peer proof uses loopback, a local tracker and no external STUN. To exercise a separate media origin in the native production demo, use `MEDIA_BASE_URL=http://localhost:3001/ npm run demo`; these URLs now come from the API at runtime.

## Current limits

The normal local runtime uses separate catalogue, media coordinator and worker processes, typed authenticated gRPC and real Kafka notifications. New media produces 480p/720p when the source supports them; smaller sources remain smaller. Existing accepted outputs keep their current qualities. Studio lists the latest 30 uploads. Read [the Phase 3 guide](docs/learning/phase-3/README.md) and [ADR 0004](docs/adr/0004-media-services-and-durable-events.md) for service ownership, outboxes, leases, epochs and recovery.

The local transport remains filesystem storage. S3 multipart operations, public upload allowlists, email verification/password recovery, backups/restore, multi-host failover and public deployment require later work. Production-mode new upload admission remains disabled pending its policy. Native mode stores media under `.local`; container mode retains named volumes. Switching modes does not migrate uploaded media between roots. Each runtime database credential owns only its service schema; a production deployment still needs a separate restricted migration/runtime-role split. Behind the local proxy, authentication limits share the proxy TCP-address bucket. Native HLS and other browsers have not been proved equivalent to the Chromium integrity/P2P path.

The tracker dependency has a known high advisory through `ip`. UDP/HTTP announces are disabled and this local proof stays on loopback; assess/replace the affected dependency before public exposure. Details are in [progress](docs/progress.md#dependency-finding). AWS resources have not been provisioned.

Phase 0's historical [evidence](docs/evidence/milestone-0.md) and [ADR](docs/adr/0001-static-export-and-verified-peer-delivery.md) remain available. Checkpoint commits are created and pushed after substantial validated progress.

## Product interface

The UI redesign adds a graphite/lime visual identity, a light theme, a media-led catalogue, branded channel pages, a creator workspace and a focused player. Search filters loaded videos; channel tabs, keyboard navigation, copy-link and theme persistence work. The creator studio now provides actual source upload, private preview and owner publication.

See [the UI learning notes](docs/learning/ui-design.md) for design tokens, component responsibilities and browser state, and [the UI evidence](docs/evidence/ui-redesign.md) for screenshots and actual checks.

## Creator settings and Google sign-in

Open **Workspace → Settings** for Appearance and connected sign-in methods. Choose channel artwork under **Channel & account**, and video thumbnails under **Studio → Edit details**. Studio separates drafts, published videos, and unpublished videos; deleting a draft removes it after confirmation.

Google sign-in uses the existing PeerScreen sessions and ownership checks. It becomes available after a Google OAuth Web client is configured in ignored `.local/google.env` or `.local/local.env`. Existing password accounts connect Google explicitly from Settings. See the [Google setup and implementation guide](docs/learning/product-and-google/02-google-sign-in.md).

For the data model, image APIs, custom player components and detailed validation, read the [product learning guide](docs/learning/product-and-google/README.md) and [evidence report](docs/evidence/product-and-google/README.md).
