# Walk through PeerScreen

Start with the product. The implementation details explain capabilities the viewer can actually use.

## Local product walkthrough

1. Open `http://localhost:3000`. Explore uses the real published catalogue. Search a title or tag and open a creator's channel.
2. Sign in using the already configured Google option or an existing email account. Open **Workspace → Channel & account** to edit your channel, description and banner. Appearance and connected sign-in methods live under **Settings**.
3. Open **Studio**. Drop/select an owned MP4 up to 250 MiB and ten minutes, fill its title/description/tags, then choose **Start upload**. The upload remains private. Select the original file again if you need to resume later.
4. When preparation finishes, choose a thumbnail under **Edit details**, open the private preview and publish. Check the real public watch link, then unpublish it. It moves to Unpublished; it is not also a draft. Drafts and other videos have an explicit delete action with confirmation.
5. On the watch page, use the custom Play/Pause, Seek, Volume, Fullscreen and quality controls. Follow the channel and save the video in a playlist. Reorder it in Library and try **Play playlist**.
6. Watch normally, then inspect the owner's Analytics. Qualified plays, watch time and received media payload come from bounded playback reports; empty/new data remains empty. They are not fabricated popularity figures.
7. For peer assistance, open the same accepted video/rendition in independent browser profiles and explicitly enable **Help share this video**. Open Connection details for actual received/uploaded media bytes. Turn sharing off and continue through HTTP. A tracker connection alone is not evidence of shared video.

The normal user's original video, channel and artwork were preserved through the current upgrade. The generated browser/Kubernetes fixtures live only in their separate isolated runtimes.

## Optional engineering walkthrough

- `npm run operations`: Grafana at `http://localhost:3301`, Jaeger at `http://localhost:16686`, Prometheus at `http://localhost:19095`. Grafana's username is `admin`; its generated password is stored in ignored `.local/operations.env`. These are private operator tools.
- Browse the app, then inspect the real request-rate/latency/cache/connection charts. A new upload produces a private worker attempt trace with coordinator RPC children. The Kafka boundary starts a separate attempt trace; it is not presented as continuous HTTP-to-Kafka tracing.
- `npm run kube -- up`: run the same images in a separate local Kubernetes environment on port 3400. Follow the [Helm exercise](../learning/phase-6/02-kubernetes.md) to inspect probes, Services, migrations and API scaling.
- The packaged HTTPS rehearsal and prior real outage experiments are available when explaining routing and recovery. They support the product; they are not the first screen of its demonstration.

## Public release sequence after AWS approval

CloudFront account verification is the external dependency. The support case has been submitted; keep the existing Free plan. The initial immutable release and restored data were verified at the private AWS origin, with a fixed compute stop deadline. A stopped host needs a deliberate bounded restart; it is not a new free 24-hour window.

1. Refresh the local AWS CLI login when required; the previous temporary operator session expired. Do not paste credentials into chat or Git.
2. Select and publish the tested final commit. Stage compatible source/images and deploy through the existing [AWS runbook](aws-deployment.md), preserving database/media state.
3. Review the full Terraform plan and complete CloudFront when AWS permits it. Add the final `peerscreen` routing record at Name.com using the actual returned distribution hostname. Keep the ACM validation record.
4. Verify public HTTPS/static direct links/API/WSS, the existing video/artwork, cookie/session behavior and a bounded new upload. The configured Google callback still needs a real production sign-in check.
5. Run the user's two-device/two-network exercise and retain the downloaded reports. Then perform the planned deployment benchmarks and final external review.

## Benchmark preparation

The bounded metadata-load harness is ready for that later measurement:

```sh
npm run benchmark:api -- --help
npm run benchmark:api -- --base https://peerscreen.darshpatel.dev --requests 200 --concurrency 8 --repeats 3
```

It performs public catalogue GETs, consumes the whole response, and records commit/dirty state, Node/CPU/RAM, page size, concurrency, repeats, successes/errors, successful throughput and p50/p95/p99 response latency. Ten warmup requests run before measurement. Each round has a finite request count and a sixty-second deadline. The private output is `.local/evidence/api-benchmark.json`. No account cookie, email, source payload or AWS credentials are used.

These measurements describe metadata requests under that workload, not browser rendering, HLS startup or WebRTC. The existing `tests/browser/uploaded-peer.spec.ts` is the separate controlled real-media experiment: three independent viewers, HTTP baseline/peer-assisted rounds, actual gateway body-byte observations, fixed renditions and explicit cache/consent conditions. Its `.local/evidence/phase-4-uploaded-peer.json` includes source/host/browser details and repeated samples. Keep local and public-device results separate.

Use repeated runs and record other workload on the host. A percentile is a value below which a specified fraction of observations falls; throughput is completed requests divided by elapsed time. A fast quiet local run does not establish a production capacity limit or billed CDN savings. Full deployment benchmarking remains after public release, as requested.

## Current scope

The initial topology uses one host/database/broker and bounded storage/queues. Extra API replicas demonstrate process scaling and shared sessions. Native HLS/other browsers, TURN relay service, password recovery/email verification and multi-host availability have separate scope and are not claimed by the Chromium demonstration. The learning guides and evidence records describe the implemented behavior and its measured limits.
