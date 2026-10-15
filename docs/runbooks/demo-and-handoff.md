# Walk through PeerShare

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

- `npm run dev:observed` (or `npm run operations`) starts the monitored development app: Grafana at `http://localhost:3301`, Jaeger at `http://localhost:16686`, Prometheus at `http://localhost:19095`. Grafana's username is `admin`; its generated password is stored in ignored `.local/operations.env`. These links show development data when using this command. For live AWS metrics and traces, use `npm run operations:cloud`; its private SSH tunnel exposes the cloud dashboards at the same localhost addresses while the local application stays stopped.
- Browse the app, then inspect the real request-rate/latency/cache/connection charts. A new upload produces a private worker attempt trace with coordinator RPC children. The Kafka boundary starts a separate attempt trace; it is not presented as continuous HTTP-to-Kafka tracing.
- `npm run kube -- up`: run the same images in a separate local Kubernetes environment on port 3400. Follow the [Helm exercise](../learning/phase-6/02-kubernetes.md) to inspect probes, Services, migrations and API scaling.
- The packaged HTTPS rehearsal and prior real outage experiments are available when explaining routing and recovery. They support the product; they are not the first screen of its demonstration.

## PeerShare public release

The public product address is [peershare.darshpatel.dev](https://peershare.darshpatel.dev). CloudFront serves its static frontend from private S3 and routes uncached API, media and WebSocket traffic to the existing HTTPS origin. The old PeerScreen hostname is retained for the origin and a public redirect. The [deployment runbook](aws-deployment.md) records the exact cutover configuration and final verification evidence.

The user previously confirmed production Google sign-in and their existing workspace on the direct deployment, and reported successful cross-network peer playback. The [manual record](../evidence/phase-6/user-confirmations.json) distinguishes that report from instrumented browser evidence. Sign in again on the new hostname because session cookies belong to their specific host; the account and channel are unchanged.

The project owner's account also has **Platform operations** in the workspace navigation. It lists real processing jobs, storage and audited job actions. Ordinary creator accounts do not receive operator access. Start a demonstration with discovery, publishing and playback before opening these operating tools.

The host's fixed shutdown deadline is unchanged. A stopped host requires a deliberate bounded restart; waiting does not grant another free 24-hour window. Retained disks, storage and the address can still incur retention costs.

## Demonstrate the measured system

Use the [benchmark report](../benchmarks/report.md) and its raw evidence for resume figures. It separates the 100,000-record metadata campaign, actual upload/transcode jobs, paced fragment clients and real browser peer exchange. The [protocol](../benchmarks/protocol.md) provides reproduction commands and traffic bounds; [learning notes](../learning/phase-6/04-benchmarking-a-video-system.md) explain the data, Go queries, indexes, Redis and statistics.

Start with the visible product: the public Explore page now contains 18 original showcase videos across six channels, each uploaded, processed and published through real APIs. The showcase accounts are labelled editorial, and the large synthetic account/database fixture stays private. Demonstrate search, channels, Following and playlists before showing infrastructure or load results.

The old `benchmark:api` command remains useful for a small public read-only smoke test. Its short closed-loop results are not the sustained capacity campaign. Browser media measurements must retain complete matching raw output in a unique run directory; the test runner also writes a timestamped record to prevent later regression tests from destroying earlier evidence.

## Current scope

The initial topology uses one host/database/broker and bounded storage/queues. Extra API replicas demonstrate process scaling and shared sessions. Native HLS/other browsers, TURN relay service, password recovery/email verification and multi-host availability have separate scope and are not claimed by the Chromium demonstration. The learning guides and evidence records describe the implemented behavior and its measured limits.
