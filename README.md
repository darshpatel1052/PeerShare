# PeerScreen

A video platform for publishing films, following creators and building playlists, with opt-in peer delivery and a creator analytics workspace.

Creators upload an MP4, choose artwork, preview it and publish a watch link. Viewers search the catalogue, follow channels, save private or public playlists and play them in order. Creators can see watch time, qualified plays and HTTP/peer delivery in Analytics. Google sign-in and email accounts use the same owned channel and workspace.

The app runs locally with persistent data, and an initial immutable release has been deployed and verified at the private AWS origin. Its host has a fixed stop deadline. New supported uploads produce 480p/720p HLS; the production storage adapter uses private S3. Public CloudFront delivery awaits AWS account verification. Real two-network peer validation remains pending.

| Build a feature                       | Learn the concepts behind it                                      |
| ------------------------------------- | ----------------------------------------------------------------- |
| Follow a creator and browse Following | Many-to-many relationships, uniqueness, filtered SQL queries      |
| Search videos beyond the current page | PostgreSQL text search, indexes, cursor pagination                |
| Save and share an ordered playlist    | Parent/child tables, transactions, ownership, revisions           |
| Watch a playlist with custom controls | React effects, URL state, media events, component composition     |
| Inspect creator analytics             | Go structs, nullable values, cumulative measurements, aggregation |
| Receive verified peer video           | HLS, WebRTC, explicit consent, segment hashing, HTTP fallback     |

Start learning with the [Phase 4 feature guide and hands-on exercises](docs/learning/phase-4/README.md).

## Start locally

Prerequisites: Node 22.18+ within 22.x, npm 10+, Go 1.27.2 (the wrapper can download this toolchain), Docker with Compose, and FFmpeg/FFprobe with libx264/AAC. Browser tests also require Playwright Chromium. Local credentials are generated into ignored `.local/local.env`; keep this file private and preserve it with the persistent database.

```sh
npm ci
npm run fixture
npm run web-build
npm run demo
```

Open `http://localhost:3000`. Sign in/create a channel through **Workspace**, then open **Studio**. Select an MP4 up to 250 MiB/10 minutes, add metadata, upload, preview the processed draft, and publish it. It appears on your channel and Explore with a public watch link. For an interrupted upload, reselect the original file and choose **Resume with selected file**. Pause, cancel, bounded retry, metadata edits, unpublish and delete are available. The demo starts real PostgreSQL/Redis, applies migrations, retains the operator fixture, starts Go and serves the exported frontend with an API proxy.

On another creator's channel, choose **Follow** to populate **Following**. On a watch page, choose **Save** and select a playlist created in **Library**. Open that playlist to reorder videos, change its visibility or choose **Play playlist**. **Workspace → Analytics** shows your channel's last 30 days of playback reports. Empty dashboards stay empty until somebody watches your published videos.

Stop the native demo with Ctrl+C before choosing another mode:

```sh
npm run dev             # Next.js hot reload, native Go, local media/tracker
npm run compose:demo    # Web/API/coordinator/worker/Kafka containers; fixture required first
npm run stop            # Stop project containers; preserve the database volume
```

Only one app mode can occupy the local ports at a time. Stop app containers before returning to native demo/development. Host ports are web 3000, media 3001, tracker 8000, private API 18080, PostgreSQL 55432, Redis 56379 and Kafka 19092, all bound to loopback. Container-internal API port is 8080; coordinator RPC stays on the private Compose network. On this machine Docker's default build bridge was absent; `PEERSCREEN_BUILD_NETWORK=host npm run compose:demo` makes build downloads work while runtime services still use the private Compose bridge.

Container startup builds images first, stops app writers, then applies migrations and starts the new services. Database and media volumes persist. This ordering prevents an old worker from racing migration of unfinished jobs. Keep the ignored local credential files with that persistent database; do not regenerate their passwords while retaining its volumes.

## Learn the implementation

The [Phase 3 learning guide](docs/learning/phase-3/README.md) explains service boundaries, the catalogue/media data model, generated protobuf, Go gRPC handlers, Kafka offsets, outboxes/inboxes, leases, epochs, cancellation and adaptive encoding. The [Phase 3 evidence](docs/evidence/milestone-3.md) records named checks, actual crashes, preservation checks and their limits.

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
npm run proto:check
npm run api:vet
npm run test:integration
npm run test:browser
npm run test:recovery
npm run test:media-recovery
npm run test:distributed-recovery
npm run test:containers
```

The checks protect ownership, publication, uploads and the viewer journeys. Go integration uses real PostgreSQL/Redis/Kafka/gRPC/FFmpeg; browser checks use the production frontend. Run dependency-based suites sequentially: they share the disposable `peerscreen-test` project and remove only its volumes. Normal app data persists. Current results and their scope are in [Phase 4 evidence](docs/evidence/phase-4/README.md); historical service-recovery experiments remain in the Phase 3 record.

## Try peer delivery

Open the same uploaded video in separate browser profiles, choose the same quality and enable **Help share this video** in each. Overlapping playback and cached segments improve the chance of sharing. **Connection details** shows received HTTP/peer payload and uploaded peer payload. You can download a playback report for a device exercise. Peers/network conditions can prevent sharing; HTTP stays available.

Sharing starts off for each video/version in a new tab. Your choice is remembered for that video within the tab. Opting in spends upload bandwidth and exposes network addresses to peers/discovery services. Turning it off closes peer connections and keeps HTTP playback, including after an initialization error. Normal playback now defaults to Cloudflare's free STUN discovery after opt-in. A real browser check observed a server-reflexive candidate without retaining addresses. Routine tests remain offline; see the [device exercise](docs/learning/phase-4/04-device-exercise.md) and [Phase 5 guide](docs/learning/phase-5/README.md).

## Current limits

The normal local runtime uses separate catalogue, media coordinator and worker processes, typed authenticated gRPC and real Kafka notifications. New media produces 480p/720p when the source supports them; smaller sources remain smaller. Existing accepted outputs keep their current qualities. Studio lists the latest 30 uploads. Read [the Phase 3 guide](docs/learning/phase-3/README.md) and [ADR 0004](docs/adr/0004-media-services-and-durable-events.md) for service ownership, outboxes, leases, epochs and recovery.

Normal local transport uses filesystem storage; the optional S3 rehearsal and AWS use the official Go S3 adapter. Uploads are API-mediated verified chunks stored as S3 objects, rather than native browser S3 multipart. Production creators need expiring approval; public registration is closed. Full local and AWS-downloaded snapshots have passed isolated restore checks. Email verification/password recovery and multi-host availability are future extensions. Native mode stores media under `.local`; container mode retains named volumes. Switching modes does not migrate uploaded media between roots. Each runtime database credential owns only its service schema; a production deployment still needs a separate restricted migration/runtime-role split. Behind the local proxy, authentication limits share the proxy TCP-address bucket. Native HLS and other browsers have not been proved equivalent to the Chromium integrity/P2P path.

The tracker now uses a bounded WebSocket-only implementation; removing the old server dependency removed its vulnerable `ip` chain. The locked JavaScript dependencies currently audit with zero findings. AWS storage, images, scoped roles, certificates and the bounded compute origin are provisioned; the account remains on its Free plan.

Phase 0's historical [evidence](docs/evidence/milestone-0.md) and [ADR](docs/adr/0001-static-export-and-verified-peer-delivery.md) remain available. Checkpoint commits are created and pushed after substantial validated progress.

## Product interface

The UI shares graphite/lime colours, a light theme, creator artwork and custom player controls. Catalogue search runs on the server before pagination. Following, Library, playlists and Analytics use the same components and responsive styling. Appearance lives under Workspace Settings.

See [the UI learning notes](docs/learning/ui-design.md) for design tokens, component responsibilities and browser state, and [the UI evidence](docs/evidence/ui-redesign.md) for screenshots and actual checks.

## Deployment preparation

Phase 5 has started with STUN discovery, an HTTPS/WSS Envoy gateway rehearsal, two catalogue replicas, private operational metrics and smaller runtime images. The AWS deployment targets **peerscreen.darshpatel.dev** in Mumbai. Its private origin is provisioned and restored; public delivery awaits CloudFront account verification. Read the [Phase 5 learning and deployment guide](docs/learning/phase-5/README.md) for the resource model, current cost example and remaining deployment work. The local gateway rehearsal is available through `npm run test:gateway`; `npm run test:operations` includes real monitoring and worker/coordinator tracing. Intentional public STUN discovery uses `npm run check:stun`. Read the [deployment runbook](docs/runbooks/aws-deployment.md) and [cost plan](docs/runbooks/aws-cost-plan.md).

Run `npm run operations` for the normal app plus private Grafana (`localhost:3301`), Jaeger (`localhost:16686`) and Prometheus (`localhost:19095`). Grafana uses username `admin`; its generated password stays in ignored `.local/operations.env`. [Learn what each signal means](docs/learning/phase-5/06-observability.md).

## Creator settings and Google sign-in

Open **Workspace → Settings** for Appearance and connected sign-in methods. Choose channel artwork under **Channel & account**, and video thumbnails under **Studio → Edit details**. Studio separates drafts, published videos, and unpublished videos; deleting a draft removes it after confirmation.

Google sign-in uses the existing PeerScreen sessions and ownership checks. It becomes available after a Google OAuth Web client is configured in ignored `.local/google.env` or `.local/local.env`. Existing password accounts connect Google explicitly from Settings. See the [Google setup and implementation guide](docs/learning/product-and-google/02-google-sign-in.md).

For the data model, image APIs, custom player components and detailed validation, read the [product learning guide](docs/learning/product-and-google/README.md) and [evidence report](docs/evidence/product-and-google/README.md).

## Finish and demonstrate the project

The [Phase 6 guide](docs/learning/phase-6/README.md) explains the product finish and the real local Helm/kind deployment. Use `npm run kube -- up` for a separate port-3400 lab; `npm run test:kubernetes` performs the disposable upload/processing/scaling exercise. Pinned local tool downloads are checksum verified. No EKS resources are created.

Follow the [product/demo handoff](docs/runbooks/demo-and-handoff.md) for a creator-to-viewer walkthrough, private operator tools and the post-approval AWS steps. The metadata benchmark harness is prepared through `npm run benchmark:api -- --help`; deployment benchmarking and the final external review remain in the requested post-release sequence. Public Google authentication and actual two-network peer playback still need their public-device checks.
