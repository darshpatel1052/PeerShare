# Benchmark protocol — PeerScreen

This protocol is written before the capacity campaign. It describes synthetic workloads, not customer traction.

## Deployment and data

Use the existing Mumbai `m7i-flex.large`: 2 vCPU, 8 GiB RAM, with the normal product services still running. Add two read-only Go API replicas (each limited to 1 CPU and 384 MiB) and an Envoy gateway. PostgreSQL and Redis remain on this same host; this is a single-host deployment, not a distributed cluster capacity claim. Pin each server image to a full Git SHA.

The private benchmark database has 10,000 synthetic accounts, 1,000 channels, 100,000 published **metadata-only** video records, 100,000 subscriptions, 10,000 playlists, 100,000 playlist entries and 20,000 synthetic playback summaries. It has no playable media. The public catalogue separately contains 18 original playable showcase uploads across six clearly identified editorial accounts, plus the owner's original video. No fake view counts or customer growth are presented publicly.

Separate database/role, Redis database index 2, no Kafka consumers, no background workers, no S3 credentials and private temporary media roots prevent synthetic metadata from affecting production media. The benchmark APIs reject writes. The gateway listens only on host loopback; one SSH tunnel carries verified HTTPS from the external workstation. Results include that tunnel and network path, and do not isolate pure server processing time.

## Catalogue load

Use checksum-pinned k6 1.8.2 with constant arrival rate, so a slowing server cannot silently reduce the offered request rate. One iteration is one validated HTTP operation. Validate response status and the expected JSON contract. Sample users from 256 private synthetic sessions; sample videos/channels across the whole dataset. The mix is:

| Operation                                          | Weight |
| -------------------------------------------------- | -----: |
| Full-text/channel search, including an absent term |    20% |
| Catalogue first page or cursor page                |    30% |
| Channel feed                                       |    15% |
| Video details                                      |    15% |
| Following feed                                     |    10% |
| Private playlist                                   |     5% |
| Creator analytics                                  |     5% |

Offer 25, 50, 100, 200, 400, 800, then 1,200 operations/sec for 60 seconds each, stopping the ramp at the first failed criterion. The highest passing level is a **candidate**, confirmed only if all three further 120-second runs pass. Run a 30-second spike at four times that level (maximum 1,200), followed by 60 seconds of recovery at 25 or the candidate rate, whichever is smaller. If the first level fails, report that result and diagnose it before claiming capacity. A separate 5/sec, 10-second smoke run verifies the fixture and contracts; it is not a capacity result.

Predeclared passing criteria: failure rate below 1%, successful-operation p95 below 250 ms, p99 below 500 ms, zero dropped iterations, and at least 98% of offered operations completed. Latency is measured through response consumption and JSON validation, including connection/TLS work. Report successful latency separately from failures. Keep completed operations divided by scenario seconds distinct from k6's whole-run rate, which includes setup and drain. Up to eight seconds of graceful drain is allowed; completion counts include it.

Retain status-class counters, endpoint latency distributions, raw summaries, whole-run duration, source/dataset hashes, local generator CPU/RAM and host/container CPU/RAM/OOM/throttling samples. Record errors and overload results, not only best runs. Cache/bypass analytics profiles use the same channel at 10/sec for 60 seconds; verify cache counters before attributing a difference to Redis.

Each campaign is bounded to 3 GiB received by the load generator. No extra paid server or managed service is created. Repeated campaigns can consume shared monthly egress allowance and existing credits; inspect account/credit state before launch. Stop benchmark containers and the tunnel after completing the measurements. Do not extend the existing server shutdown timer.

## Media measurements

Report upload/transcode, HTTP delivery and actual browser peer exchange separately from catalogue operations. Low-motion showcase explainers are not a heavy transcoding benchmark. Use owned generated moving-video sources, record source hashes/resolution/frame rate/bytes, actual upload and processing times and resulting renditions. Simulated segment download clients must not be described as decoded video viewers. Browser comparisons must use matching content/rendition/work, retain setup costs and integrity failures, and distinguish same-host contexts from independent networks. A user-reported cross-network success is recorded as such unless instrumented counters were captured.

## Reproduce

```sh
node scripts/benchmark/setup.mjs FULL_PUBLISHED_API_SHA
node scripts/benchmark/run.mjs smoke --smoke
node scripts/benchmark/run.mjs baseline
```

The setup deliberately requires the configured private AWS checkout, SSH key and published ECR image. Sessions and database credentials remain under ignored `.local/benchmark`; never commit them. Publish sanitized evidence with checksums, hardware, source revisions and limitations. Keep each campaign directory unique so later tests cannot overwrite earlier raw results.

Protocol references: [k6 constant arrival rate](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/), [open versus closed workloads](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/), [dropped iterations](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/dropped-iterations/), [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/).

## Concrete media profiles

The moving inputs are FFmpeg `testsrc2`, H.264/yuv420p, 30 fps: 1280×720 for 30 seconds at 2.5 Mb/s, and 1920×1080 for 60 and 120 seconds at 5 Mb/s. Run these sequentially, then submit four copies of the 720p source through four showcase identities together. The worker's configured processing concurrency remains unchanged. Record observed queue/encoding/indexing states, upload-completion-to-ready time and total time; these include polling and remote storage and are not isolated encoder FPS. Verify both output renditions and first/last segment SHA-256 hashes afterward. Preserve private uploads.

For delivery only, temporarily publish the known Frame by Frame burst upload. `delivery-fixture.mjs` obtains its actual manifest and descriptor. Unpublish this exact video when experiments finish; do not remove the owner's media or showcase catalogue.

The segment workload runs one client for a ten-second fixture check, then 25, 50 and 100 virtual segment clients for 30 seconds each, stopping at the first failed criterion. Each requests a 480p fragment and checks its complete length and SHA-256. Pace by that fragment's declared duration, with staggered starting fragments; a slow request can delay the next operation, so this is a client-count delivery exercise, not an open arrival-rate server-capacity claim. Pass: failures and fragment-deadline misses below 1%, verified-fragment p95 below two seconds. Combined received-traffic limit is 1 GiB. Report actual completion/error counts, timing and verified bytes; virtual clients do not decode video.

The browser comparison uses eight independent cache-disabled Chromium contexts, fixed 480p rendition and **complete 30-second playback for every viewer**, not a short variable buffering window. Start the first viewer four seconds ahead in both conditions. Run three fresh HTTP-only/peer-assisted pairs. Peer consent is set through the real checkbox in a prior visit; its media setup cost is separately counted and included in a second reduction calculation. All players must reach 29.5 seconds, report verified media and zero integrity rejections. Capture actual peer/upload payload, browser frame counts and origin media-route body counters summed across the public replicas. These counters include partial writes and manifests/descriptors; they exclude transport overhead. Unrelated public media requests could inflate a window, so interpret this as a quiet-demo experiment, not invoice savings. Keep the setup cost and every failed/partial experiment. Bound aggregate measured/setup body bytes to 1 GiB. Same-workstation browser contexts establish real exchange, not independent-network performance.

```sh
node scripts/benchmark/media.mjs prepare
MEDIA_SOURCE_RELEASE=FULL_DEPLOYED_SHA node scripts/benchmark/media.mjs pipeline-v1
node scripts/benchmark/verify-media.mjs pipeline-v1
node scripts/benchmark/delivery-fixture.mjs prepare
node scripts/benchmark/segments-run.mjs segments-v1
node scripts/benchmark/peers.mjs peers-v1
node scripts/benchmark/delivery-fixture.mjs close
```
