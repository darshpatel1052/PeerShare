# 5. Failure experiments and reading the evidence

Run the test commands sequentially: they share the disposable `peerscreen-test` database/cache project. Each runner deletes only its test volume and temporary media directories. Your normal account/channel and application volumes are preserved.

```sh
npm run check
npm run contracts:check
npm run api:vet
npm run test:integration
npm run test:browser
npm run test:recovery
npm run test:media-recovery
```

## What each layer proves

Go integration tests use real PostgreSQL and Redis with the race detector. Each case resets only the isolated test database. They test twelve simultaneous requests against one creator's upload limit, eight equivalent simultaneous idempotency requests, global capacity, reservations, token expiry, wrong sizes/checksums, corrupted disk repair, live-lease preservation, expiry, stale completion, cancellation/deletion precedence, bounded retries and actual transcoding.

The real transcoding case generates an MP4, sends it through HTTP, claims/processes the job, decodes the output HLS with FFmpeg, and independently verifies descriptor hashes against segment bytes. Direct SQL is used for controlled failure injection and the focused authorization fixture; that fixture is not offered as proof of real encoding. The real-media and browser cases cover the encode path independently.

Production-browser tests use the static export, real Go and storage. One creator signs up, uploads a real source, previews it privately, publishes it, and an anonymous Chromium context plays it. Playback time must advance and HTTP payload bytes must be positive. Unpublishing blocks watch metadata and both uploaded-media origins, including an encoded-path attempt. Desktop/mobile screenshots are retained.

A multipart browser case generates a 10-second MP4 larger than 8 MiB. It interrupts the second part's network request while part one really reaches the server, reloads the page, rejects a different same-size file, then resumes the original. The request record must show only part two transferred on resume, and the same upload/video IDs become ready. Network interception injects a failure; it does not mock successful storage or processing.

The metadata recovery runner actually replaces the Go OS process and stops/starts PostgreSQL and Redis. The media recovery runner actually sends `SIGKILL` during a partial upload and a running encode. It reuses the original cookie, storage root and database, observes the real 60-second lease, verifies the replacement uses the same logical job/generation with a new attempt, publishes the result and decodes recovered HLS. It does not shorten the lease by editing SQL time.

## Try learning experiments safely

Use an isolated test account. Inspect a session's `state`, part numbers, source hash, reservation and job IDs without printing tokens or credentials. Predict the result before each action:

- Kill/restart before all parts arrive: stored chunks remain; reselect the source and resume.
- Send the same create request/key twice: one video/session.
- Change the title while reusing that create key: conflict.
- Corrupt a recorded chunk on disk: completion conflicts; resume treats it as missing and an identical chunk repairs it.
- Start a second worker process with a live claim: no reset of the first worker's job.
- Expire a claim and try completing the old attempt: conflict, even if its files exist.
- Cancel before acceptance: late finish cannot mark ready.
- Publish before processing finishes: conflict; private draft remains absent from Explore.
- Unpublish after watching starts: new HTTP requests are blocked; already downloaded bytes are still in the viewer's buffer.
- Delete during processing: metadata disappears immediately; the late worker cannot resurrect it.

The automated cases already perform these injections. Do not run destructive SQL or delete volumes against your normal project to reproduce them.

## Read claims precisely

A database status is not the same as decoded media. A screenshot is not evidence of persistent recovery. A test that changes a lease timestamp proves the state transition, while a real process crash and expiry proves that scheduling finds it again. Local named-volume persistence is not off-host backup or multi-host availability. An HTTP byte counter measures completed media payload, not billing or network wire overhead.

[The Phase 2 evidence](../../evidence/milestone-2.md) links procedures, observations, screenshots and source fingerprints. Historical Phase 0/1 evidence remains unchanged. Raw current runs live under ignored `.local/evidence`, and CI retains its own artifacts so a local result is not confused with a remote result.

For relevant primitives, consult [PostgreSQL's locking reference](https://www.postgresql.org/docs/18/explicit-locking.html) and [Web Crypto digest documentation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest). The reservation/lease protocol is this application's design; those references document the tools it uses.
