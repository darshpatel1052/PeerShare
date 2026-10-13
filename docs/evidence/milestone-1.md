# Phase 1 evidence: identity and persistent catalogue

Local Phase 1 is complete as of 13 October 2026. The product now registers/authenticates users, persists channels, enforces ownership/revisions, and loads catalogue/channel/watch metadata from a real Go API. The generated HLS fixture and verified peer/HTTP player remain working. This report connects each claim to a procedure and observation; the [learning guide](../learning/phase-1/README.md) explains the mechanisms behind them.

## Scope, source and environment

The backend foundation was committed/pushed as `7809eb3c8ebb04bf54a2012ea0fde58d1f837f97`. These connected-product runs were performed on the subsequent working tree before its checkpoint commit. [Source fingerprints](phase-1/source-fingerprint.json) enumerate exact SHA-256 implementation hashes; peer attachments also record the base revision, dirty state and player/watch/test/lock hashes. The fact that a record says “dirty” is preserved rather than claiming the new code was already committed during the run. Git history identifies the subsequent checkpoint containing these sources.

[Environment metadata](phase-1/environment.json) records the host, tool versions, exact container image IDs, loopback host ports, resource limits, runtime users, bridge attachment and health states without environment credentials. Local host: Linux, Intel i7-13700HX, 24 logical CPUs, 16,466,096,128 RAM bytes. This is one host and loopback networking, not a multi-host load test.

| Tool/component                | Observed version                         | Why this detail matters                                                        |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| Go                            | 1.27.2, linux/amd64                      | Compiler/toolchain for API, migration and race-detector checks                 |
| PostgreSQL                    | 18.6, Debian bookworm image              | Real persistent relational storage and constraint/transaction semantics        |
| Redis                         | 8.2.10, Debian bookworm image            | Real shared atomic authentication counters                                     |
| Node / npm                    | 22.23.3 / 10.9.9                         | Frontend/build/local gateway runtime and lockfile installation                 |
| Next.js / React               | 16.4.0 / 19.3.0                          | Static production export and browser components                                |
| TypeScript                    | 7.0.2 frontend; 5.9.3 contract generator | Generator compatibility is isolated rather than forced through a peer conflict |
| Playwright / Chromium         | 1.64.0 / 156.0.8078.4                    | Exact automated browser compatibility target                                   |
| hls.js / P2P loader / tracker | 1.7.3 / 4.0.0 / 11.2.3                   | Existing real media delivery integration                                       |
| FFmpeg                        | 6.1.1                                    | Generates the actual 60-second H.264/AAC test media                            |
| Docker / Compose              | 29.1.3 / 2.36.2                          | Local container and startup orchestration                                      |

Go module dependencies are pinned in `go.mod`/`go.sum`: pgx v5.11.0, go-redis v9.23.0, x/crypto v0.58.0 and UUID v1.6.0. OpenAPI generation uses openapi-typescript 7.13.0. Database/cache/Go/Node build images are pinned by digest in Compose/Dockerfiles. The separately imported metadata fixtures in pagination tests are real SQL rows for visibility/order checks, not additional playable videos or successful uploader jobs.

## How to reproduce

From the repository root, install the prerequisites described in the README, then:

```sh
npm ci
npx playwright install chromium --only-shell
npm run fixture
npm run web-build
npm run check
npm run contracts:check
npm run api:vet
npm run test:integration
npm run test:browser
npm run test:recovery
```

Run the last three sequentially. They use their own `peerscreen-test` PostgreSQL/Redis project, test ports and disposable volume. The normal `peerscreen` database is separate. The environment capture after completion found **zero remaining test containers**. Do not use application-volume deletion as a normal stop/reset command.

For development, run `npm run dev`, then `node scripts/preview-smoke.mjs development` in another terminal. Stop development before using `npm run compose:demo`, then run `node scripts/preview-smoke.mjs containers`. On this host, container builds required the documented `PEERSCREEN_BUILD_NETWORK=host` override; runtime services still used the private `peerscreen_default` bridge. Open `http://localhost:3000/account/` to try the product.

## Verification totals and raw records

| Verification                                     | Result                                                       | Evidence                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Frontend formatting/types + integrity unit cases | Passed; 5 unit cases                                         | [Final command output](phase-1/check-output.txt)                               |
| Generated API types match OpenAPI                | Passed                                                       | Deterministic `contracts:check`; checked-in generator/schema                   |
| Go static analysis                               | Passed                                                       | `npm run api:vet`, exit 0                                                      |
| Go with race detector + real dependencies        | 15 cases passed: 7 unit, 8 integration; no integration skips | [JSON event stream](phase-1/backend-tests.jsonl)                               |
| Production Chromium browser suite                | 12 passed, 0 skipped/unexpected/flaky, 65.717 seconds        | [Full report](phase-1/browser-results.json)                                    |
| Actual process/database/cache recovery           | Passed                                                       | [Request observations and identities](phase-1/recovery.json)                   |
| Native development preview                       | Passed                                                       | [API/playback/layout record](phase-1/development-smoke.json)                   |
| Complete app-container preview                   | Passed; 4 healthy services, 2 successful one-shot services   | [Smoke](phase-1/container-smoke.json), [environment](phase-1/environment.json) |

The totals describe local runs. The repository CI workflow independently installs/builds the product and repeats contract/static/integration/browser/recovery checks; GitHub Actions is the source of truth for a pushed revision's CI result. A local pass does not itself prove remote CI passed.

## Backend cases: procedure, invariant and observed result

The tests use actual SQL/Redis and HTTP handlers. They are not mocked repository implementations. The JSON stream lists each named case and duration, including package success/failure. Seven unit cases cover the helpers/configuration; eight integration cases cover the cross-component invariants.

| Case/group                                                | Procedure and expected invariant                                                                                                                                   | Observed result and practical implication                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password hashing/verification                             | Hash the same input twice; verify correct/wrong values and malformed/expensive recipes                                                                             | Distinct salted Argon2id hashes; correct value verifies, invalid recipes fail closed. A database hash is not the original password.                                                                     |
| Hash capacity/cancellation                                | Occupy the hash semaphore and cancel a waiter                                                                                                                      | Waiting returns cancellation instead of starting another expensive hash. Capacity is bounded per API process.                                                                                           |
| Session-token helper                                      | Generate two tokens, check canonical encoding and digest                                                                                                           | Distinct 43-character tokens; 32-byte SHA-256 digests. This is an entropy/format check, not a statistical cryptographic proof.                                                                          |
| Production configuration                                  | Load insecure defaults/registration enabled, then deliberate HTTPS/WSS settings                                                                                    | Unsafe production browser/admission configuration rejected; Secure host-cookie configuration selected. No TLS deployment is claimed.                                                                    |
| Cursor helpers (2 cases)                                  | Round-trip a timestamp/UUID tuple; reject malformed, trailing and excessive cursor data                                                                            | Exact ordering tuple preserved; bounded decoding rejects invalid data.                                                                                                                                  |
| Identity storage/revocation/expiry                        | Register/login, inspect persisted hashes and cookie flags; replay revoked token; expire the session in SQL; put test credentials in an invalid resource path/query | Password is Argon2id, token is stored as a digest, development cookie is HttpOnly/Lax. Replay and expiry return 401. Tested credentials/hashes absent from request logs, including malformed URL input. |
| Ownership/revision/duplicates                             | Bob supplies Alice's owner header; Alice edits; replay revision 1; attempt a second channel; read public channel                                                   | Bob gets 403; owner succeeds with revision 2; stale and duplicate writes get 409. Public channel omits owner email/ID. Ownership is server-derived.                                                     |
| Concurrent channel admission/FK                           | Race two channel creations for one owner; try inserting an orphan owner                                                                                            | Exactly one 201 and one 409; one channel row. Orphan rejected by PostgreSQL 23503. A pre-check alone would not protect this race.                                                                       |
| Input/Origin/method/errors                                | Wrong Origin, extra role field, short password, unknown login, limit 10000, malformed cursor, GET login                                                            | Expected 403/400/422/401/400/400/405. Origin error's body/header request IDs match. No client-supplied role admitted.                                                                                   |
| Registration rollback/migration replay/schema permissions | Force an invalid session digest during registration; run two migrations concurrently; create a table in `public`                                                   | No partial user persists; one migration-history row; foreign-schema DDL rejected with 42501. Catalogue-schema DDL remains permitted for its owner and is a documented limitation.                       |
| Visibility and equal-time cursor rows                     | Insert two published rows with identical timestamps plus a draft; page with limit 1; tombstone one row; publish incomplete draft                                   | Tie rows appear once each, page 2 ends; draft/deleted detail reads 404; incomplete publication rejected. No byte-processing pipeline was invoked.                                                       |
| Shared atomic rate budget                                 | Two independent Redis clients race 20 increments against limit 7; exercise HTTP rate rejection                                                                     | Exactly 7 admitted; HTTP 429 includes Retry-After. This proves one shared atomic counter, not production fairness across gateway clients.                                                               |
| Fresh API handler / logout all                            | Resolve original cookie through a newly constructed handler and revoke all sessions                                                                                | Same account/channel restored; original handler then returns 401. This case rebuilds a handler; actual OS-process replacement is proved separately below.                                               |

The strict JSON decoder/body limit and request/database/server timeouts are also implemented configuration boundaries. The table does not claim every decoder branch, timeout scenario or production security threat was exhaustively tested.

## Browser journeys and component behavior

The 12-case suite serves the **production export** with real Go and isolated PostgreSQL/Redis. Three newly added account cases exercise the actual browser/API relationship:

1. Register through labels/buttons, create a channel, visit its public page, reload, edit, reload, sign out and sign in. Observed channel ID stayed `c8d88536-3a9c-4b26-8f22-c5cef7073f21`; revision advanced 1 → 2; title became “Updated learning channel.” The channel's published-video list remained empty. Logout made `/me` return 401; login restored the saved metadata. [Identity journey](phase-1/identity-journey.json) retains both actual `/me` bodies and cookie **flags**, excluding token/password values. `document.cookie` did not expose the session.
2. Use Alice's two tabs and Bob's separate context. Bob's forged owner edit returned 403. Alice saved one tab, then submitted an unsaved stale edit in the other. The 409 message appeared, the unsaved text remained, canonical metadata stayed at the first saved title, and explicit reload replaced the form with that canonical value.
3. Intercept one create request with a **simulated HTTP 503** and verify handle/title/description survive. Retry reaches the real API and succeeds. Inject a separate catalogue HTTP 503; the page displays the error and retry loads the real fixture. This proves UI error handling and preservation, not an actual database outage.

Four existing HTTP cases passed: direct channel/watch URLs and reload; playback/seek/quality with no tracker connections while sharing is off; media MIME and allowed-origin CORS; missing resource and integrity-descriptor failure/retry. The CORS case fetches the separate media port from the browser. It does not alone prove every peer scenario across separate media origins; Phase 0's historical cross-origin runs remain available separately.

Five existing peer cases also passed: three independent contexts share verified bytes and recover after departure/tracker disconnect; real data-channel corruption is rejected; opt-out/unmount closes connections; tracker failure leaves HTTP playback; distinct trusted versions use separate swarms.

## Actual peer measurements after API integration

[Peer attachment](phase-1/peer-delivery-evidence.json), captured 10:57:10 UTC:

| Viewer before departure | Verified HTTP bytes | Verified peer bytes | Uploaded peer payload | Connected peers |
| ----------------------- | ------------------: | ------------------: | --------------------: | --------------: |
| Seed                    |           2,109,172 |                   0 |             3,190,172 |               2 |
| Receiver 1              |                   0 |           2,109,172 |             1,028,172 |               2 |
| Receiver 2              |                   0 |           2,109,172 |                     0 |               2 |

After seed/receiver 2 departure and tracker disconnection, receiver 1 had zero peers, 6,338,796 verified HTTP bytes and 2,109,172 verified peer bytes; playback continued past the later seek position. These counters are completed media payload, not total wire traffic, unique bandwidth saved, CDN billing or a production offload percentage. Buffered/cached segments and request timing affect the totals.

[Corruption attachment](phase-1/tamper-evidence.json), captured 10:57:19 UTC: the test changed **8 outgoing RTCDataChannel media chunks** while leaving signalling and trusted HTTP data unchanged. Receiver rejected 1 completed segment, accepted **0 peer bytes**, fetched **1,562,656 HTTP bytes**, verified 3 segments and continued playback. This exercises the actual loader validation boundary rather than merely calling a hash helper.

## Actual process and dependency recovery

The [recovery runner](../../scripts/recovery.mjs) operates only on the disposable test stack. It registers one account/channel and keeps the original cookie in memory. It stops Go, starts a different Go process, stops/starts PostgreSQL and then stops/starts Redis. [Raw observations](phase-1/recovery.json), captured 10:50:18 UTC, preserve request IDs/statuses and safe identity metadata.

- Actual Go PIDs changed **468060 → 468289**. The original cookie loaded user `f45f068e-15c9-4ddd-8edd-2b67d51f0a9e` and channel `508f008c-be0e-474a-93dd-d970e1119031` after replacement without registering again.
- With PostgreSQL stopped: live 200, ready 503, public catalogue 503 `dependency_unavailable`. After start: ready 200 and original account/channel restored. Measured restart-to-observed-readiness interval: **755 ms**, including the container-start command and polling.
- With Redis stopped: live 200, ready 503, catalogue 200 and existing `/me` 200. New login returned 503 `limits_unavailable`. After start: readiness/login 200; original channel still resolved. Measured interval: **462 ms**.

These are individual local observations, not recovery-time objectives or performance distributions. Redis counters can disappear on restart because Redis is deliberately ephemeral; accounts/sessions remain in PostgreSQL. Readiness checks require both dependencies, even though some reads remain usable without Redis. The experiment has no running media server and claims metadata/session recovery only; browser media delivery is tested separately. It does not restore a backup, fail over a host or recover a media worker/job.

## Container and visual inspection

The full app runs PostgreSQL, Redis, Go and the web/media/tracker gateway. Migration/import exited 0; all four long-running services were healthy. The API runs as UID 10001, web as `node`; both have read-only root filesystems, dropped capabilities and no-new-privileges. The web has no database/cache credentials. Media is mounted read-only; PostgreSQL has its own persistent volume. Exact safe settings are in the environment record.

Both preview smokes checked readiness 200, anonymous `/me` 401, a generic wrong login 401, wrong-Origin login 403, real catalogue 200 and actual HTTP playback with zero peer bytes. Development used the separate media origin; full containers used the same-origin media route. Each observed **12,877,248 verified HTTP bytes** and advancing video time, with zero page exceptions. This is buffered fixture payload, not a startup-bandwidth benchmark.

Desktop account/home/watch screenshots were visually inspected. Account layout at 390×844 had no horizontal overflow; labels, inputs, actions and navigation were readable. [Desktop screenshot](phase-1/account-desktop.png) and [mobile screenshot](phase-1/account-mobile.png) show the final container export. This inspection does not substitute for an exhaustive accessibility audit.

## Issues discovered and resolved

- An older PeerScreen preview still held 3000/3001/8000, and an unrelated application held 8080. The old project preview was stopped; the private API host port moved to 18080. Other applications were preserved.
- Next.js development initially redirected API paths with the export's trailing-slash policy. Development uses paths without that policy and includes API/health rewrites. The real development smoke then passed.
- Native shutdown waited for the tracker callback before stopping Go. Shutdown now terminates local tracker sockets and stops Go directly; the verified development process exited 0 and released its ports.
- Docker retained a failed-bind application container with no attached network. Only the stopped API/web containers were recreated; the database volume was preserved. Fresh full-profile startup and the container smoke passed.
- The initial browser label selector failed after textarea content changed. An explicit description label/input association was added; all three account cases and the full 12-case suite passed afterward.
- Root TypeScript 7 conflicted with the contract generator's supported peer range. The generator has an isolated TypeScript 5 dependency, and deterministic generation/frontend typecheck pass.

## Remaining boundaries

This phase does not implement uploads, object storage, processing jobs, email verification/reset, global session sweeping, backup restoration, multi-host failover or public deployment. The runtime role owns the catalogue schema; a production migrator/runtime privilege split remains. The local proxy's TCP address gives a gateway-wide auth bucket; production client descriptors/admission need their own policy. Production public registration is rejected by configuration until that policy exists.

The tracker dependency's known `ip` advisory remains documented in [progress](../progress.md#dependency-finding). No claim is made that a cached/offline zero-advisory install clears it. Current compatibility is Chromium on loopback, with native HLS/other browsers and public networking outside this proof. No AWS resources were provisioned. The next phase will add durable upload admission with its own explanation, invariants and recovery evidence.
