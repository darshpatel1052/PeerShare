# Milestone 0: local media compatibility evidence

Recorded on 13 October 2026. This is a compatibility experiment, not an internet-scale capacity or cost benchmark.

## Source and environment

The tested working tree is included in the compatibility checkpoint following foundation commit `c34da4c` (see the exact base SHA in the raw evidence). Tests ran before committing that checkpoint, so the evidence explicitly records a dirty working tree and exact SHA-256 hashes of player, watch, test and lockfile sources. Those source hashes identify the tested implementation independently of documentation changes.

- Linux x86_64, Intel Core i7-13700HX, 24 exposed logical CPUs, about 15 GiB RAM.
- Node 22.23.3, npm 10.9.9, TypeScript 7.0.2, Next.js 16.4.0, React 19.3.0.
- HLS.js 1.7.3, P2P Media Loader HLS/Core 4.0.0, tracker 11.2.3.
- Playwright 1.64.0, Chromium Headless Shell 156.0.8078.4.
- FFmpeg/FFprobe 6.1.1, libx264/AAC.
- Generated 60-second, 24 fps test-pattern/tone fixture, 360p/480p, aligned four-second MPEG-TS segments. See [fixture metadata](fixture.json).
- Three isolated browser contexts on one host, overlapping playheads, first viewer warms its in-memory segment cache, no external STUN and no CDN. Origin responses use `no-store`; peers start with independent caches.

## Outcomes

All five integrity unit cases passed. Formatting, typechecking and static production build passed. Nine same-origin browser tests passed with no skipped or flaky cases in the recorded run, taking about 63 seconds. Three additional actual cross-origin HTTP/P2P/corruption tests passed, taking about 33 seconds.

| Check                             | Observed result                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Fixed static watch/channel routes | Direct navigation and fresh reload work from exported files                                                        |
| Sharing off                       | HTTP playback, seek and 480p switch work; no tracker WebSocket connections                                         |
| CORS/MIME                         | Real browser cross-origin playback works; explicit trusted origin allowed; untrusted origin receives no permission |
| Three viewers                     | Both later viewers receive completed, SHA-256-verified media through WebRTC                                        |
| Peers/tracker leave               | Remaining viewer seeks and changes quality through verified HTTP without a fatal playback error                    |
| Corrupted peer payload            | Deliberately changed bytes on an actual data channel fail validation; receiver continues using verified HTTP       |
| Opt-out and route departure       | Instrumented real RTCPeerConnection objects reach `closed`                                                         |
| Missing media/descriptor failure  | Useful state and retry action; successful retry loads the player                                                   |
| Different trusted versions        | Separate swarm namespaces; playback continues through HTTP                                                         |

In the recorded same-origin three-viewer sample, each later viewer had received **2,617,148 verified peer media bytes** at the first observation. After the seeder and the other viewer departed and the tracker was disconnected, the remaining viewer received **6,378,840 HTTP media bytes**, sought beyond 46 seconds and reported no fatal error. This is a point-in-time observation, not a guaranteed peer ratio. The samples exclude wire/signalling overhead and do not establish billed CDN savings.

The tamper sample changed nine outgoing media chunks in test instrumentation. The receiver recorded one rejected segment, **zero accepted peer bytes**, and **1,562,656 verified HTTP bytes** while playback continued. The test mutates outgoing data-channel bytes only; trusted metadata and HTTP copies remain intact. No production corruption switch or simulated peer counter exists.

## Raw records

- [Peer transfer/recovery measurements and source hashes](peer-delivery.json)
- [Tamper/recovery measurements and source hashes](tamper-recovery.json)
- [Full same-origin browser result record](results-same-origin.json)
- [Cross-origin browser result record](results-cross-origin.json)

Reproduce with `npm ci`, `npm run fixture`, `npm run web-build`, `npm run check`, `npx playwright install chromium --only-shell`, and `npm run test:browser`. The test runner starts and stops the actual local production server and tracker.

For the separate-origin experiment, build with `NEXT_PUBLIC_MEDIA_BASE_URL=http://localhost:3001/fixture/`, then run `npm run test:browser -- --grep 'HTTP playback, seek|three independent|corrupted bytes'`. Video manifests, segments and integrity descriptors are fetched by the real player from port 3001 while the exported frontend is served on port 3000.

## Remaining boundaries

Firefox, Safari/native HLS, mobile, physical devices and separate internet networks are unverified. No upload/publish, backend failure recovery, public tracker, AWS resource or large viewer-count result is claimed. Resolve public network configuration, deployment limits and the recorded tracker dependency advisory before public exposure. Milestone 1 begins the Go API, persistence and identity work.
