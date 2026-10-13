# Milestone 2 evidence: durable local upload and HTTP video

Prepared 13 October 2026. Scope: actual local sources, persistent multipart state, processing, owner publication and HTTP playback. This completes the local milestone exit, not S3/Kafka/gRPC or public deployment. The user's original Phase 2 work and existing normal data were retained. [Learning guide](../learning/phase-2/README.md), [ADR](../adr/0003-local-durable-media-pipeline.md).

## Validation matrix

| Check                               | Procedure and observation                                                                                                                                                                                                   | Evidence                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Frontend/contract                   | Formatting and TypeScript passed; production export includes `/studio`; generated schemas match OpenAPI                                                                                                                     | CI reproduces `check`, `web-build`, `contracts:check`                                             |
| Player integrity                    | Five explicitly named Node tests pass: exact bytes, corruption, truncated/unknown/wrong-origin/version bytes, unsupported ranges/URLs and descriptor bounds                                                                 | `npm test`; in-process test isolation makes named cases visible                                   |
| Go foundation                       | Seven unit tests pass; race detector enabled                                                                                                                                                                                | [Raw Go events](phase-2/phase-2-go-tests.jsonl)                                                   |
| PostgreSQL/Redis integration        | Fifteen real integration cases pass, no skips; tests reset only the disposable database                                                                                                                                     | [Raw Go events](phase-2/phase-2-go-tests.jsonl)                                                   |
| Production browser regression       | Sixteen Chromium cases pass, zero skipped/flaky/unexpected; includes account/UI, HTTP and real peer corruption/departure/version isolation                                                                                  | [Case summary](phase-2/browser-summary.json)                                                      |
| Original upload model               | Equivalent setup retry returns the same session; changed request/key conflicts; other owner gets 404; identical part retry safe; publication before ready conflicts                                                         | `TestIntegrationUploadIdempotencyResumeOwnershipAndPublishGate`                                   |
| Concurrent admission                | Twelve distinct simultaneous requests admit one creator upload; eight equivalent simultaneous setup retries return one upload; four platform slots enforced; reservation ceiling rejects further admission                  | `TestIntegrationConcurrentUploadAdmissionAndReservation`                                          |
| Scoped permissions and repair       | Missing/expired part tokens return 403; wrong size/checksum rejected; deliberate disk corruption blocks completion; GET resume omits corrupt part; identical resend repairs it; completion replay yields one job            | `TestIntegrationPartPermissionsCorruptionAndRepair`                                               |
| Lease/fencing                       | Second worker respects a live lease; expired claim is replaced with same generation/new attempt; stale finish rejected; cancel/delete prevent late acceptance                                                               | `TestIntegrationWorkerLeaseRecoveryAndStaleCompletion`                                            |
| Abort/expiry/orphans                | Expired upload rejects completion; reconciliation removes source/part/temp orphans; repeated abort is safe; quota releases after successful cleanup                                                                         | `TestIntegrationExpiryAbortAndOrphanReconciliation`                                               |
| Invalid media/retries               | Real uploaded non-MP4 bytes persist a safe `unsupported_media` failure; remain private; only three total claims allowed                                                                                                     | `TestIntegrationInvalidMediaAndBoundedRetries`                                                    |
| Actual encoding                     | Generates an MP4, receives it through HTTP, processes with FFprobe/FFmpeg, independently decodes HLS, checks every descriptor entry, verifies private/public ranges, revisions and deletion                                 | `TestIntegrationRealTranscodePrivatePreviewPublicationAndDeletion`                                |
| Upgrade compatibility               | Original migration checksum preserved; original no-checksum setup fingerprint retained; existing ready output sizes measured before settling quota                                                                          | Same real transcode case injects a legacy missing output size; normal-container check below       |
| Private/public UI                   | Creator privately previews a real upload; anonymous context advances playback time past one second with positive HTTP payload and zero peer payload; unpublish blocks metadata and both media ports, including encoded path | Browser upload case; [desktop](phase-2/studio-desktop.png), [mobile](phase-2/studio-mobile.png)   |
| Multipart network/reload recovery   | 10-second MP4 larger than 8 MiB; part 2 network interrupted while part 1 reaches real storage; reload; wrong same-size file rejected; only part 2 transferred on resume; same upload/video becomes ready                    | Multipart browser case and CI test attachment                                                     |
| Creator operations                  | Failed source cannot publish; metadata edits persist; deletion can be declined then confirmed; draft disappears                                                                                                             | Third upload browser case                                                                         |
| Actual metadata/dependency recovery | Original cookie survives Go OS process replacement and PostgreSQL stop/start; Redis outage blocks login while public/session reads continue                                                                                 | [Metadata recovery record](phase-2/phase-2-metadata-recovery.json)                                |
| Actual media crash recovery         | SIGKILL after chunk one and during active encoding; replacement preserves live lease, reclaims after actual expiry, publishes replacement result and decodes HLS                                                            | [Process recovery record](phase-2/phase-2-process-recovery.json)                                  |
| Normal container app/data           | Final Go/web containers healthy; original `uncharted` channel and published `hi` video retained; original owner studio preview ready; anonymous first segment passes SHA-256/length; range returns 206                      | [Container record](phase-2/phase-2-containers.json), [current studio](phase-2/current-studio.png) |

## Actual process crash observations

The source was **18,671,566 bytes**, divided into three chunks. API process IDs were 1535745, 1535979 and 1536364. The first replacement resumed the upload with part one already stored. The second replacement followed a kill during the encoding stage.

| Identifier    | Before crash                           | After recovery                            |
| ------------- | -------------------------------------- | ----------------------------------------- |
| Job           | `07b0c09b-57b9-427e-b574-9b8473abfc34` | Same                                      |
| Generation    | `c9755c30-1b57-42e5-992d-c8b23e181cdf` | Same                                      |
| Attempt       | `90ae033b-b5d8-4a40-8f96-d528d10e5f01` | `13e82108-0ecd-4d8e-be01-4be6e77f8fbe`    |
| Attempt count | 1                                      | 2                                         |
| State         | running                                | ready, still draft until explicit publish |

Recovery took **67,363 ms**, including the real 60-second lease. The script did not shorten it through SQL. An independent FFmpeg decode succeeded on the recovered HLS. These IDs and timings describe this recorded run; other runs will generate different identities and timings.

## Procedures and isolation

`test:integration` starts real test PostgreSQL/Redis, runs Go `-race -count=1 -json`, verifies integration cases were not skipped and removes only the test project. HTTP/worker tests use separate temporary upload/media directories. The focused authorization fixture uses controlled SQL ready metadata; actual transcode/browser tests independently prove encoding.

`test:browser` starts the production export on 3100, media on 3101, tracker on 8100 and the native Go API on 8081. It uses temporary media roots and the test database. The multipart case intercepts a request only to force network failure; successes use the real API, database, storage and encoder.

`test:media-recovery` starts the API on 8092, keeps its generated temporary storage root across replacements, kills actual OS processes, waits for durable lease expiry, and verifies logical identity and output decode. The old encoder may finish computation; it cannot commit acceptance. All test credentials and part tokens are omitted from the committed record.

The normal container check does not create/modify accounts, titles or publication state. The existing user video is 355 seconds long. Its accepted media remains readable after the upgrade; the current owner session and private preview were inspected after a reload. The in-app screenshot captures the visible panel; the isolated desktop/mobile images show the full responsive layout.

## Findings corrected during verification

- Unserialized count-and-insert admission could admit multiple requests; advisory transaction locking now protects the decision.
- Part metadata alone did not detect changed stored bytes; source assembly now independently verifies each object.
- Startup-wide job requeue could steal live work; lease expiry and fenced claims replace it.
- The auxiliary static media origin could expose drafts; both media paths now pass visibility checks before serving.
- Private integrity descriptor fetches omitted credentials; explicit same-origin authenticated preview fixes this while public descriptor fetches still omit them.
- A generic revision-conflict message broke an existing channel assertion. Resource-specific messages preserve the channel behavior and explain video conflicts. The first checkpoint's remote browser run caught that same regression; the closing revision contains the correction.
- The local Node runner counted one TypeScript file rather than exposing its five named cases. Test isolation is explicitly disabled for this small suite, and all five named checks now execute/report.
- A fresh container npm install omitted a native CSS dependency while exiting successfully. Container installs explicitly include optional packages and load the required native CSS modules before allowing the dependency layer to pass.
- Older ready jobs lacked derivative byte counts; their accepted output directories are measured before quota settlement.

## Reproduce

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
npm run test:media-recovery
```

Run the database/browser/recovery suites sequentially. Normal app data is not the disposable test database. Native and container storage roots differ; changing startup mode does not migrate media. [Source fingerprints](phase-2/source-fingerprints.json) identify the closing implementation files. CI installs FFmpeg and runs all these checks, including media crash recovery, retaining its raw artifacts. The closing commit's exact CI result is reported separately after its run finishes.

## Boundaries

The storage transport uses local authenticated chunk permissions, not AWS S3 multipart/presigned requests. Jobs remain in the API binary/catalog schema, with one valid execution slot. No gRPC, Kafka/outboxes, distributed service ownership, off-host backups, multi-host recovery or public uploader allowlist is claimed. AWS resources were not provisioned.

This phase outputs one rendition, at most 480p. Processing progress is staged checkpoint progress, not a live frame-completion percentage. The studio lists 30 recent uploads. The 20 GiB reservation budget is not an operating-system disk quota. Source/derivative volumes must be retained with the database. Unpublishing stops future HTTP access but cannot recall already delivered buffers. Existing native-HLS/other-browser and tracker-advisory limitations remain as recorded in earlier evidence.
