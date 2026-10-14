# Milestone 3: separate media services and durable recovery

Verified on 14 October 2026 (Asia/Kolkata). Phase 3 is complete locally: normal processing uses independent catalogue, coordinator and worker processes, real gRPC/Kafka and PostgreSQL-owned recovery decisions. Existing account, creator and player flows remain connected. This is the service/recovery milestone; the full project still requires product, deployment and final benchmark milestones.

Backend checkpoint: `bf010df45186de5ae1a966258027ae869f442182`, pushed to `main`. Its [GitHub CI run completed successfully](https://github.com/darshpatel1052/Peer-Screen/actions/runs/38475893519), including production browser, historical API/media recovery and distributed process recovery. The closing checkpoint fixes container packaging and requires an actual-image upload check in CI. Its exact revision and subsequent CI status are in Git history/GitHub; the successful backend CI run alone does not establish container packaging.

Read [the Phase 3 learning chapters](../learning/phase-3/README.md) for the data model, Go concepts, RPCs, Kafka behavior, adaptive encoding and verification procedures. [ADR 0004](../adr/0004-media-services-and-durable-events.md) records the implementation choices.

## Observed results

| Area                            | Procedure and observed result                                                                                                                                                                                              | Evidence                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Repository checks               | Formatting, TypeScript and all 8 named JavaScript unit cases pass; OpenAPI/generated TypeScript, generated protobuf comparison and Go vet pass                                                                             | Required local checks and successful backend CI steps                     |
| Go suite                        | 43 top-level cases, 67 including named subcases, zero failures or skipped tests; race detector; real PostgreSQL/Redis/Kafka/gRPC/FFmpeg where applicable                                                                   | [Named case record](phase-3/backend-integration.json)                     |
| Service permissions             | Catalogue and media roles are denied writes to each other's schema; catalogue/worker credentials have distinct RPC method permissions                                                                                      | `TestIntegrationMediaRPCRolesAndDatabaseOwnership` in the named record    |
| Durable submission              | Concurrent equivalent submissions preserve one job; conflicting immutable input is rejected                                                                                                                                | `TestIntegrationConcurrentSubmitAndConflictingInputs`                     |
| Claims and fencing              | Claim replay preserves one attempt; live lease/global slot prevents another worker; recovery advances epoch; stale heartbeat/completion/failure is rejected                                                                | `TestIntegrationDurableClaimReplayAndEpochFencing`                        |
| Cancellation and retry          | Running cancellation retains the lease until stopped acknowledgement/expiry; retry command replay is safe; transient failures persist due time; total attempt budget remains three across import                           | Cancellation, transient retry and imported-budget cases                   |
| Connected pipeline              | Owner HTTP upload reaches catalogue submission, coordinator, real Kafka and worker; verified output becomes ready; publication succeeds; replay/version guards and deletion are enforced                                   | `TestIntegrationDistributedUploadKafkaAcceptanceAndProjection`            |
| Poison notifications            | Malformed records and unknown job references are quarantined without blocking later valid processing; lifecycle application fetches authoritative coordinator state                                                        | Connected pipeline case and implementation paths                          |
| Output acceptance               | Generated 720p source produces actual 480p/720p output that decodes; wrong attempt, missing playlist, corrupted segment and traversal descriptor are rejected                                                              | `TestIntegrationAdaptiveMediaAndDescriptorValidation`                     |
| Production browser              | All 19 Chromium cases pass: accounts, ownership/conflicts, Settings/artwork, custom controls, uploads/resume, direct routes, HTTP and real peer/fallback regressions                                                       | [Named browser record](phase-3/backend-browser.json)                      |
| Quality switching               | Actual uploaded video is privately previewed, published, loaded anonymously, switched to decoded height 720 and then 480, and sought; unpublish revokes access                                                             | Adaptive upload browser case and [screenshot](phase-3/adaptive-watch.png) |
| Broker/coordinator interruption | Broker is actually stopped; completed source persists a queued job and two pending outbox records; coordinator SIGKILL/restart preserves both while broker remains down                                                    | [Raw process record](phase-3/backend-process-recovery.json)               |
| Worker interruption             | Real FFmpeg child observed; worker SIGKILL stops it; live sixty-second lease remains respected; a replacement completes the same job/generation with a new attempt and epoch                                               | Same process record                                                       |
| Stale completion                | Authenticated diagnostic client submits the old completion tuple and receives `FailedPrecondition`                                                                                                                         | Same process record                                                       |
| API-only restart                | After recovery/publication, only API is killed/restarted; original test session and public video still work                                                                                                                | Same process record                                                       |
| Actual images                   | Startup, static account route, real owner upload, packaged worker, publication and both rendition playlists/segments pass through Docker containers                                                                        | [Container record](phase-3/container-smoke.json)                          |
| Existing normal app             | Original channel/video and 480p manifest return 200 before/after upgrade; original segment length/SHA-256 matches; Google availability remains enabled; normal API/web/coordinator/dependencies healthy and worker running | [Preservation record](phase-3/local-preservation.json)                    |

The Go total includes foundation unit cases and integration cases; it is not a count of 43 database-only scenarios. Automated identity tests use a signed test provider. Live Google sign-in success was reported by the user on 14 October; the normal upgrade check confirms configuration availability, not a new live OAuth round trip.

## Actual process crash observations

The owned generated source was **27,981,442 bytes**, thirty seconds at 720p. This run used actual process kills and broker stop/start. The script did not shorten the lease through SQL.

| Identifier    | Before worker crash                    | After recovered acceptance               |
| ------------- | -------------------------------------- | ---------------------------------------- |
| Job           | `59fc73d3-cd5a-48c2-a582-d875c4481a32` | Same                                     |
| Generation    | `ef1dcce5-b985-40ab-a7ed-ae71abe5e54e` | Same                                     |
| Attempt       | `e372d423-d62c-4163-85f2-b30f34c3811d` | `8c725cb2-357f-45f1-9abf-f3c06306a1a5`   |
| Epoch         | 1                                      | 2                                        |
| Attempt count | 1                                      | 2                                        |
| State         | running                                | ready, private until creator publication |

The recorded **70,410 ms** covers recovery and subsequent validation, including the actual sixty-second lease. It is not an isolated recovery latency or encoding benchmark. Both recovered renditions were independently decoded by FFmpeg. The original worker's completion was explicitly rejected, demonstrating that successful computation cannot bypass current ownership of acceptance.

The broker-outage observation precedes the worker crash: queued job/version/generation and two pending outbox records survive coordinator replacement. Kafka recovery enables relay/claim; worker lease recovery handles a later interruption. These are separate failure windows with different repair mechanisms.

## Container and existing-data checks

The image check uses the same `startContainerApp` helper as normal container startup. It builds first, stops app writers before migrations, then starts web/API/coordinator/worker and their dependencies. It uploads an owned generated three-second 720p MP4 through real endpoints and checks actual nonempty segment responses for both qualities. Native encoder/browser cases independently establish decode and quality switching; the container check focuses on packaged startup and the complete media-serving path.

The disposable `peerscreen-test` project uses separate database/Kafka/upload/media volumes and alternate app ports. It clears live Google credentials. Its cleanup removes only that test project. Normal app data is never used for destructive tests.

For the normal upgrade, a private mode-600 PostgreSQL metadata snapshot was created before migration. It remains ignored. This is not a complete media backup or restore drill. Existing volumes were retained, and an original segment passed independent byte-length/SHA-256 verification after the final startup sequence. Original `uncharted` channel and published `hi` video remain available; the existing video stays 480p because accepted outputs are preserved rather than re-encoded. A running worker has no separate Docker health probe; the successful real upload provides functional worker evidence in the isolated image test.

## Findings corrected during verification

- Kafka consumers configured with `BlockRebalanceOnPoll` stalled on ordinary close. `CloseAllowingRebalance` plus bounded teardown checks corrected shutdown; the final connected integration suite passed.
- Compose `--wait` treated an exited top-level setup container as a failure even with exit 0. Dependency startup now waits for long-lived services, then runs bootstrap/topic setup to completion.
- Go output targeting `/media` collided with a Linux directory, leaving a directory at the intended Docker entrypoint. Build outputs now use explicit files under `/artifacts`; runtime entrypoints use `/peerscreen-media` and `/peerscreen-worker`. Actual container uploads passed after this correction.
- Building/migrating while old writers remain active can race unfinished-job import. Normal startup now builds images first and stops app writers before migrations and restart.

These findings explain why passing native compilation was insufficient to close the milestone. The CI container step now exercises the package boundary as well.

## Source binding and reproduction

[Backend fingerprints](phase-3/backend-fingerprints.json) record SHA-256 for the backend checkpoint's 65 source files. They are historical and deliberately remain unchanged after packaging fixes. [Closing fingerprints](phase-3/closing-fingerprints.json) bind the final runtime scripts, Docker/Compose/workflow and evidence files; compare them with the files in the closing checkpoint. Generated UUIDs/timings describe recorded runs; future runs will differ.

```sh
npm run fixture
npm run web-build
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

Run dependency/browser/recovery/container suites sequentially: they share the disposable project. Historical `test:recovery`/`test:media-recovery` explicitly select the development-only legacy executor to retain Phase 1/2 regression coverage. Normal startup and Phase 3 browser/distributed/container tests use separate services. On the current host, image downloads require `PEERSCREEN_BUILD_NETWORK=host`; runtime traffic remains on the private Compose network.

CI retains raw JSON, browser attachments and recovery observations for seven days. Committed records omit passwords, session cookies, upload/RPC tokens, Google credentials and real creator email. Test screenshots use generated sources and disposable accounts.

## Remaining project scope

This evidence covers one host, one PostgreSQL instance and one Kafka broker with replication factor one. It establishes service/process recovery and actual media behavior within that scope. Filesystem volumes remain the storage adapter. S3 multipart, cross-host TLS, public admission, multi-host availability, backup/restore drills, telemetry dashboards and cross-network peer measurements still require their later milestones. No AWS resources were provisioned and the Free plan was preserved.

Next is the product milestone: subscriptions, playlists, search/analytics and connected viewer/creator journeys. Deployment and final measurements follow; completing this local service milestone does not finish the flagship project.
