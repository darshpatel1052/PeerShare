# Verification lab

Run these commands from the repository root. The shared test project is disposable; run database/browser/failure suites sequentially so one runner cannot remove another's dependencies.

```sh
npm run check
npm run contracts:check
npm run proto:check
npm run api:vet
npm run test:integration
npm run test:browser
npm run test:distributed-recovery
```

## What each layer establishes

Unit tests check source-appropriate quality selection, storage-path rejection, segment integrity and credential loading. Type/format checks protect the frontend contract and repository consistency. Protobuf comparison checks that generated clients/servers match the versioned source.

The integration suite uses real PostgreSQL/Redis/Kafka and real gRPC connections with the Go race detector. Packages run serially because their fixtures share isolated schemas. It generates actual MP4 sources, decodes actual renditions, and verifies descriptor rejection. Service tests exercise schema permissions, method roles, duplicate submissions, conflicting immutable inputs, claim replay, increasing epochs, retry budgets and cancellation acknowledgement.

The connected HTTP integration test uploads through the real owner-authenticated endpoints. The API commits its submission, the coordinator publishes through Kafka, the worker claims and encodes, and the catalogue becomes ready. It verifies both qualities, publication, projection replay/version handling and deletion protection. It also exercises bounded shutdown of the running consumer loops.

Production-browser tests build the static Next.js export and use the separate native media/coordinator/worker processes. Existing sign-in, channel, Studio, custom controls, artwork and peer/fallback journeys must still pass. Simulated Google availability checks remain distinct from your reported successful live Google sign-in.

## Process recovery is stronger than changing a state in a unit test

`npm run test:distributed-recovery` creates an owned generated source and a disposable creator. It stops the test Kafka broker, completes an upload, and verifies that the coordinator's job/outbox persist. It actually kills/restarts the coordinator while the broker is down. After broker recovery it starts a worker, observes the worker's real FFmpeg child and kills the worker with SIGKILL.

The test verifies that FFmpeg stops, the existing lease remains respected, and a new epoch/attempt eventually completes the same job and generation. It submits the old worker's completion capability through an authenticated diagnostic gRPC client and requires `FailedPrecondition`. It then publishes the recovered output, decodes both renditions, and kills/restarts only the API while checking that the original session and public video remain available.

This runner does not shorten the sixty-second lease by editing SQL. The coordinator unit-level integration tests separately force expired timestamps to exercise transitions quickly; their results are labelled as database transition tests rather than process-crash measurements.

Raw process evidence is written to `.local/evidence/phase-3-process-recovery.json`. It contains generated fixture IDs, states, elapsed observations and HTTP outcomes. It contains no cookies, passwords, RPC tokens, Google client values or real creator email. The final milestone evidence should bind results to source fingerprints and record runtime/dependency scope.

## Useful reading experiments

Read `CompleteUpload` and follow `queueSubmission`: identify exactly where the source and submission share a transaction. Then follow the dispatcher and ask which identifier remains stable after a lost response.

Read `Claim`, `Heartbeat`, `Complete` and `Reap`: list the conditions that reject an old worker. Compare an attempt ID to a lease epoch; neither a completed subprocess nor a Kafka offset grants acceptance.

Read `RelayOnce` and catalogue `ApplyMediaSnapshot`: locate the publish-before-mark window and the inbox-before-commit window. Explain why each possible duplicate is safe. Observe that the API asks for authoritative coordinator state before trusting a lifecycle notification.

Finally, read the descriptor validator and the process runner together. A "ready" state is useful evidence only when the accepted files exist and actually decode, and a recovery claim is useful only when an actual interrupted process was observed.

## Current scope

The environment is one host, one PostgreSQL instance and one Kafka broker. Tests establish service/process recovery and real media behavior in that scope. They do not establish multi-host availability, public TLS, S3 multipart behavior, cross-network peer performance or cloud cost. Those need the later product/deployment/evidence milestones.
