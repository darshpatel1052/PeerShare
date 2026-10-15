# PeerScreen project review — 15 October 2026

**Overall assessment: 8/10 as a resume and portfolio project.** The implementation demonstrates substantial backend, media, distributed-systems and deployment work. It is suitable for a flagship project entry today with accurate wording. Five correctness issues and several unfinished validation steps prevent calling the complete original brief finished.

This review combines three specialist subagent reviews with the primary reviewer's source inspection, fresh checks and public-browser walkthrough. The starting checkout was `8609048` with pending changes. Those changes became commit `8bbe7042b58c47a1fe2ced8560ff1a9ba233a4c2` during review. Findings were checked against that newer source. Application source was not changed by this review. The accompanying [walkthrough](../learning/project-walkthrough.md) explains the project for interviews.

## What was verified

| Check                     | Result and scope                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production Next.js build  | Passed; all 12 exported pages generated                                                                                                            |
| Formatting                | Passed on `8bbe704`; a later full check stopped on formatting in newly added `docs/evidence/phase-6/public-stun.json`                              |
| Frontend type checking    | Passed                                                                                                                                             |
| JavaScript unit tests     | 9/9 passed, including media integrity, provider-credential isolation and retained static assets                                                    |
| OpenAPI generated types   | Match the checked-in contract                                                                                                                      |
| Generated protobuf        | Check passed                                                                                                                                       |
| Go vet and Go unit tests  | Passed; race detector used by the test command                                                                                                     |
| Real Go integration suite | 57 top-level tests, 82 including subcases, zero failures; PostgreSQL, two Redis instances, Kafka, gRPC and FFmpeg                                  |
| Production-browser suite  | 25/25 passed in Chromium; no skipped or flaky cases; approximately 4.1 minutes                                                                     |
| Dependency advisory check | Fresh `npm audit` reported zero findings for the locked JavaScript tree; this does not cover application logic or all OS/Go dependencies           |
| Public manual walkthrough | Actual HTTPS catalogue and original video at `https://peerscreen.darshpatel.dev`; HTTP playback advanced beyond one minute and paused successfully |
| Additional bug probes     | Isolated worker heartbeat/error-classification reproduction; targeted database probes described below                                              |

Initial sandbox restrictions prevented sockets, Docker access and Go checksum verification. The affected checks were rerun with the required access and passed. Those initial environment errors are not project defects.

Fresh browser output is in `.local/browser-results.json`; the full Go events are in `.local/evidence/phase-2-go-tests.jsonl` (the runner retains its historical filename). The additional public smoke record `.local/evidence/public-chromium.json` describes release `8609048`, genuine public HTTP/WSS and actual peer payload between two browsers on one workstation. It explicitly does not establish two-network delivery or completed Google authentication. The primary review independently checked public catalogue/playback, rather than re-executing that entire public smoke.

Historical failure, S3, restore, gateway and Kubernetes records were inspected. Their experiments were not all rerun in this review. In particular, this review did not create AWS resources, change DNS, deploy, restart the normal app, run the destructive process-failure scripts, or re-create the kind cluster.

## Newly available deployment measurements and evidence consistency

Additional release evidence appeared while this review was running. The [public Chromium](../evidence/phase-6/public-chromium.json) and [Firefox](../evidence/phase-6/public-firefox.json) records distinguish verified HTTP/controls from untested Firefox peer exchange. The [metadata raw results](../evidence/phase-6/performance/README.md) show 2,700 local and 1,800 public successful requests over a one-video catalogue. At eight concurrent public requests, the three finite rounds report p95 45.50–69.38 ms and approximately 180–203 successful responses/sec, with zero errors. These records were inspected, not independently rerun as part of this review. They do not establish maximum server capacity or concurrent-video-viewer support.

**P3 evidence packaging issue:** the new `performance/README.md` describes three peer rounds, but `performance/media-three-rounds.json` currently contains only one baseline/peer pair and one comparison. Its numbers differ from that README's three rows. Earlier three-round data was inspected before the routine browser suite replaced the runner's fixed `.local/evidence/phase-4-uploaded-peer.json` output. The archive must retain the actual matching three-round file, or its summary must describe the single available round. The current archive still proves real peer bytes; it cannot reproduce the claimed three-round summary. Use run-specific filenames/copies to avoid losing benchmark evidence during regression runs.

## Findings to fix

P2 here means a correctness issue that should be fixed in normal development. None of the confirmed findings establishes unauthenticated code execution, a remote account takeover or a backend private-video authorization bypass. Absence of such a finding is not proof that none exists.

### 1. P2 — Temporary coordinator failures can permanently fail valid media

**Locations:** [worker.go](../../services/api/internal/mediasvc/worker.go), lines 165–170 and 205–215; [encoder.go](../../services/api/internal/encoder/encoder.go), lines 174–175.

While FFmpeg is running, one unsuccessful heartbeat cancels its context. The encoder classifies every FFmpeg failure as permanent `processing_failed`, including a subprocess stopped by that cancellation. The worker copies that classification into `FailJob`. If the coordinator is reachable again while the lease remains valid, it records terminal failure instead of scheduling an automatic transient retry. Normal worker shutdown during encoding can also retain `permanent=true` while changing only the error code to `shutdown`.

**Evidence:** an isolated expected-failing test executed the actual worker heartbeat and encoder classification paths with temporary FFmpeg/FFprobe shims. One `Unavailable` heartbeat produced `FailJob(error_code="processing_failed", permanent=true)`. This verifies the emitted request; the terminal database consequence follows from the coordinator's `Fail` implementation. It was not a real coordinator crash experiment.

**Fix direction:** distinguish interruption, shutdown, deadline and dependency errors from corrupt/unsupported source failures before selecting permanence. Preserve lease fencing and bounded retry budgets. Add tests that interrupt encoding and probing, then confirm retry eligibility.

### 2. P2 — A delayed cancellation can erase an accepted retry

**Location:** [store/media.go](../../services/api/internal/store/media.go), lines 136–143; related retry admission is in [store/jobs.go](../../services/api/internal/store/jobs.go), lines 147–185.

The catalogue immediately marks a locally requested cancellation as cancelled, allowing the creator to request retry before the coordinator's final cancellation has arrived. Retry records a new pending command. A later, higher-version cancelled snapshot passes the version checks, then unconditionally clears the command and sets the read model back to cancelled. The dispatcher has no retry left to send.

The relevant ordering is **cancel → accepted immediate retry → delayed newer cancellation snapshot**. Same-version replay guards do not protect this ordering. This is a distinction between newer coordinator state and newer user intent: they need independent correlation.

**Evidence:** independently traced by the backend and media reviewers, then reproduced against the disposable PostgreSQL test runtime with race detection. Applying version 1 queued, accepting local cancel/retry, and applying delayed version 2 cancelled produced `command="" state="cancelled"`. The new retry was lost.

**Fix direction:** retire a command only when its specific command ID has been resolved. Preserve a newer retry until its own coordinator acknowledgement. Deterministically test cancellation response/projection lag.

### 3. P2 — Studio drops management access to older videos

**Locations:** [store/uploads.go](../../services/api/internal/store/uploads.go), line 161; [studio.tsx](../../apps/web/components/studio.tsx), lines 43–46.

The owned list returns only the latest 30 nondeleted upload sessions, with no cursor. Aborted and expired attempts occupy that window. Studio filters this same truncated list for every publication state. Published cards elsewhere do not provide an alternative owner management interface.

One published video followed by 30 newer aborted uploads therefore loses its edit, thumbnail, unpublish and delete controls in Studio while remaining public. There is no need to upload 31 full videos. The README discloses the latest-30 limit, but a disclosure does not complete the owner management journey.

**Evidence:** both backend and frontend source paths confirmed. A temporary PostgreSQL probe created 31 existing owner uploads, confirmed that the oldest remained individually readable, and reproduced its omission from the 30-item list. That probe used aborted uploads; the same query has no publication-state exemption, so the effect on an older published video follows from the confirmed listing and UI paths.

**Fix direction:** add stable cursor pagination for owner videos/uploads and connect it to Studio. Server-side publication-state/search filtering should operate over the owner's full collection. Verify with aborted sessions mixed among published videos.

### 4. P2 — Remote orphan bytes can escape the storage reservation

**Locations:** [httpapi/reconcile.go](../../services/api/internal/httpapi/reconcile.go), lines 22 and 117–118; [object_reconcile.go](../../services/api/internal/httpapi/object_reconcile.go), lines 16–28; [store/jobs.go](../../services/api/internal/store/jobs.go), lines 303–316.

The initial reservation includes multiple output attempts. After the grace period, settlement reduces it to source plus accepted output size when the local disk walk succeeds. The S3 sweep returns no success/completion status. Failed remote listing/deletion, and an unfinished paginated sweep, therefore cannot stop settlement.

If a crashed/rejected attempt left remote output objects, new uploads can use capacity already released from the logical budget while those objects still exist. This weakens the stated 20 GiB ceiling, particularly during a cleanup outage or large object backlog. Explicit deletion cleanup does check remote operations; the finding concerns terminal-attempt reservation settlement.

**Evidence:** source-traced error and pagination paths; no AWS fault injection or measured quota overrun was performed.

**Fix direction:** retain or account for orphan-attempt capacity until remote deletion is confirmed. Track per-attempt objects/bytes or durable cleanup tasks instead of treating a successful local sweep as remote storage proof. Test failed Delete/List operations and multiple pages.

### 5. P2 — A private playlist remains on Watch after logout

**Locations:** [playlist-queue.tsx](../../apps/web/components/playlist-queue.tsx), lines 13–15; [watch.tsx](../../apps/web/components/watch.tsx), lines 30–32 and 70–85; [navigation.tsx](../../apps/web/components/navigation.tsx), lines 43–45.

Sign in, open a public video through a private playlist, and choose Workspace → Sign out without navigating away. Logout updates the auth provider while both Watch queue resources remain keyed only by playlist URL. Their loaded private title, order and video metadata remain rendered; the automatic-next listener also retains the queue.

This is stale data on the signed-out screen. Subsequent requests still face backend ownership checks; it does not let a remote anonymous visitor fetch the private playlist. The standalone Playlist page already keys its content by user identity, but the Watch page does not.

**Evidence:** complete source flow confirmed by the frontend reviewer and primary reviewer. A focused manual browser reproduction was not executed; existing playlist tests do not cover signing out from this screen.

**Fix direction:** scope both playlist resources to the current identity, clear them and the ended listener on identity change, and add a sign-out/account-switch regression.

## How much of the brief is complete?

| Area                                                        | Assessment                                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts, owned channels, artwork, catalogue/search         | Implemented with real persisted data and meaningful tests                                                                                             |
| Upload/resume/abort, validation, HLS, preview/publication   | Implemented; several newly identified recovery/management issues remain                                                                               |
| Go service boundaries, gRPC, Kafka, leases/outboxes/fencing | Implemented and exercised against real dependencies; interrupted-error and cancel/retry findings need correction                                      |
| Actual peer media, consent, hashes, HTTP recovery           | Implemented and tested; local-browser and public same-workstation evidence exists                                                                     |
| Following, ordered private/public playlists, analytics      | Implemented; Watch queue logout state needs correction                                                                                                |
| Private S3                                                  | Implemented; API-mediated verified chunks are a documented deviation from native browser S3 multipart                                                 |
| Public deployment                                           | Direct HTTPS on AWS verified; CloudFront remains pending account approval                                                                             |
| CI/images/Terraform/roles/monitoring/tracing/restore        | Implemented with preserved execution records; current remote CI status was not independently queried in this review                                   |
| Kubernetes                                                  | Actual local single-node kind/Helm exercise, including 2→3 API replica scaling; no AWS Kubernetes claim                                               |
| Two physical networks/devices transferring media            | Still unverified by the reviewed records                                                                                                              |
| Completed production Google sign-in                         | Configured callback/PKCE/cookie checks exist; complete production login not independently confirmed                                                   |
| Defensible performance/cost conclusions                     | Local/public finite metadata benchmarks exist; equivalent-workload media offload, maximum deployment capacity and billed savings remain unestablished |
| Operator product screen                                     | Private dashboards/runbooks/SQL tooling exist; a complete in-app operator job/retry/cancel workspace from the original brief is not established       |

The tracker is a bounded custom **WebTorrent-compatible** implementation using `ws`, rather than the `bittorrent-tracker` server package. Successful loader interoperability and actual bytes are the relevant evidence. The architecture has one AWS host/database/broker as shared failure domains. API replicas demonstrate process routing and shared state; they do not provide multi-host availability. Internal gRPC transport and schema-owning runtime credentials are documented deployment limitations.

## Rating rationale and resume value

| Dimension             | Assessment                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Backend/system design | Strong: ownership boundaries, database authority, durable handoffs, leases/fences and transaction design are visible in code    |
| Reliability           | Strong foundations and genuine tests; the two newly found recovery races/errors matter                                          |
| Product/UI            | Coherent, responsive, real workflows, useful errors and preserved edits; long-term Studio management and logout state need work |
| Security boundaries   | Thoughtful sessions/OAuth/ownership, bounded media work and integrity; no full security certification is implied                |
| Operations            | Substantial release, storage, restore, monitoring and local Kubernetes work; intentionally bounded single-host topology         |
| Measurement quality   | Actual peer bytes and honest caveats are good; equivalent-workload and physical-network evidence should come next               |

The strongest resume story is **reliable asynchronous video processing plus verified peer-assisted playback**. Name the product outcome first, then explain the hard guarantees. A list of Go/Kafka/Redis/Kubernetes names alone is less persuasive than explaining what happens when a worker dies after acknowledging dispatch.

The current repeated peer record proves actual payload transfer, not a defensible savings percentage. It compares different segment counts, buffering and playback progress; the quality selection happens after loading starts. Do not claim reduced CDN costs from those differences. Likewise, a short metadata benchmark over one catalogue entry does not establish a supported concurrent-viewer count.

For the public demo, replace placeholder content such as the current video title “hi” with a clear owned demonstration video, useful metadata and artwork when preparing the presentation. Show a recoverable upload, actual processing, publication, measured peer bytes and fallback. Fix these five findings, verify two-network transfer and complete the production sign-in check before describing the original flagship acceptance as complete.

Resume-ready wording and a full explanation path are in the [project walkthrough](../learning/project-walkthrough.md).

## Review completion note

Three findings have focused runtime evidence: interrupted-heartbeat error classification, cancellation erasing retry, and the owned-list truncation. The S3 accounting and Watch logout findings are source-traced and remain candidates for fault-injection/focused browser regressions. The existing build, type, unit, integration and browser suites passed despite these missing scenarios. The final aggregate check later stopped at formatting in a newly added evidence JSON file; it did not rerun its subsequent type/unit stages.

[Review evidence and source fingerprints](2026-10-15-review-evidence.json) records the verification summary. Temporary Go overlay files under `/tmp/peerscreen-review-*` and `/tmp/peerscreen_review_media_*` injected review-only tests without adding tests to application packages. The two database probes asserted the observed buggy behavior and passed; the heartbeat test asserted the desired transient classification and failed as expected. Those outcomes must not be confused with failures of the pre-existing regression suite.

Application source remains unchanged by this review. Normal application data was preserved; the disposable test project's containers and volumes were removed by the runners. The review adds this report, its evidence summary and the interview walkthrough, and does not commit or publish them.
