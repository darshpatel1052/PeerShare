# ADR 0001: static frontend and verified opt-in peer delivery

Date: 13 October 2026. Status: accepted for the local compatibility phase.

## Context

PeerScreen needs reliable playback before accounts, uploads and distributed processing are built. The AWS plan favours a static frontend, and peer-supplied bytes must be validated before entering playback or the peer cache.

## Decisions

Use a Next.js static export with `/watch/?v=…` and `/channel/?id=…`. Query parameters are read in client components inside Suspense boundaries. The export contains real HTML for each fixed route. The local production server serves directory indexes, including direct visits and reloads; a future CloudFront deployment must implement the equivalent URI handling.

Keep playback in `packages/player`, used by the actual watch page. The compatibility fixture is a static record, clearly labelled in the UI. Milestone 1 replaces the fixture metadata with API data; milestone 2 supplies accepted immutable media URLs. There is no simulated creator workflow or processing service.

The caller supplies a media ID and accepted-version ID; the swarm namespace also includes the descriptor's content version. The production adapter must supply the accepted generation and attempt as the accepted-version ID. Distinct accepted versions must never share a swarm merely because their signed URLs look alike.

Use HLS.js 1.7.3, P2P Media Loader HLS/Core 4.0.0, and a WebTorrent-compatible `bittorrent-tracker` 11.2.3 server. Versions were verified from npm and locked on 13 October 2026. The tracker uses WebSocket signalling; UDP, HTTP announces, public statistics and address logging are disabled. All demo listeners bind loopback.

Inspect the **installed** loader rather than assuming an older API. Core 4.0.0 provides `validateP2PSegment(url, byteRange, data)` and `validateHTTPSegment` returning `Promise<boolean>`. In `src/p2p/peer.ts`, validation runs before `completeOnSuccess`; failures close the peer and clear rejected request bytes. Accepted bytes subsequently enter segment storage in `src/hybrid-loader.ts`. These paths were checked in the installed package source and exercised with an actual corrupted data-channel payload.

Sharing starts off and is not remembered as an implicit consent. The sharing-off player uses ordinary HLS.js with a verified HTTP loader; it does not import or instantiate peer networking. Core's `isP2PDisabled` delegates fragments to the ordinary HLS loader, bypassing Core's validation/events, so that setting alone cannot establish verified HTTP delivery. The adapter suppresses progressive delivery until complete-object validation. The same HTTP adapter protects fallback fragments in the assisted player.

Generate exact-byte SHA-256 hashes and lengths for every MPEG-TS segment. Retrieve the bounded descriptor from the configured trusted media origin before starting the player. Reject unknown paths, other origins, other output prefixes, unexpected lengths, hash mismatches and byte ranges. This recipe uses complete TS objects; byte-range/fMP4 requires a separate explicit contract. Production must use trusted HTTPS for descriptor/media metadata and WSS for the tracker.

The local fixture is generated with FFmpeg `testsrc2` and `sine`, H.264 High/AAC LC, 24 fps, 60 seconds, aligned four-second segments, 360p and 480p. The larger worker recipe and its no-upscaling policy belong to milestone 2/3.

Assisted playback initially allows HTTP a 1.5-second discovery window, then retains normal fallback. Bound the peer cache to 64 MiB and connections to eight per stream. The proof overrides the library's public tracker/STUN defaults with our local tracker and no external ICE servers. This isolates the test from internet services. Public/cross-network operation still requires deliberately configured STUN, HTTPS/WSS, networking tests and capacity controls.

Destroy and recreate the player when sharing changes, preserving playhead/play intent and resetting diagnostic counters. Destroying HLS also destroys the bound peer engine. Cleanup is exercised with instrumented real RTCPeerConnection instances after opt-out and client-side route departure.

## Measurements

Count received HTTP/peer payload from completed verified segments. `onSegmentLoaded` reports completed source-attributed media, while `onChunkDownloaded` can include rejected/partial bytes; those event semantics cannot be interchanged. Uploaded peer payload comes from `onChunkUploaded`. Counters exclude manifests, signalling, retransmissions and wire overhead, reset on player recreation and are not billing data. Never sum uploaded peer bytes into the delivery denominator.

Keep raw browser results and attached JSON evidence, with code revision/base, dirty status, exact source hashes, browser and host details. A loopback test with isolated contexts proves real WebRTC transfer and the adapter's recovery behaviour; it establishes no internet viewer capacity, offload guarantee or CDN savings.

## Consequences and limits

- Static hosting does not provide server actions, dynamic server routes or runtime image optimisation. Product data belongs to the Go API.
- Native-HLS browsers receive HTTP-only playback. Their segment validation, telemetry and quality behaviour are unverified; no P2P support is claimed for them.
- Chromium is the tested browser. Firefox, Safari, mobile and separate devices/networks remain explicit future checks.
- The local server uses `no-store` while testing and generated fixture paths. Deployment must use immutable accepted output keys and an intentional CDN cache policy.
- A known `ip` dependency advisory is recorded in [progress](../progress.md). This loopback proof is not a public tracker deployment.
- Go services, authentication, persisted catalogue data, uploads, Kafka/gRPC recovery and cloud infrastructure are subsequent milestones.

## Primary references

- [Next.js static export documentation](https://nextjs.org/docs/app/guides/static-exports)
- [P2P Media Loader API documentation](https://github.com/Novage/p2p-media-loader/blob/main/api_documentation.md), checked against installed 4.0.0 source
- [WebTorrent tracker server documentation](https://github.com/webtorrent/bittorrent-tracker#server)
