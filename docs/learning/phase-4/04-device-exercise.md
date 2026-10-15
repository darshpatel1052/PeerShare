# Try peer playback on two networks

The user can provide two devices on different networks. Automated browser results on this machine do not establish cross-network reachability. This exercise remains manual until device results are collected; it does not delay using Following, playlists or Analytics locally.

Use an existing private SSH/VPN route to the PeerShare host if available. An SSH client can forward local ports 3000 and 8000 to the host's corresponding loopback ports, so the remote browser still opens `http://localhost:3000` and contacts `ws://localhost:8000`. Replace the host/user placeholder with a real privately reachable machine:

```sh
ssh -N -L 3000:127.0.0.1:3000 -L 8000:127.0.0.1:8000 user@private-host
```

Do not forward PostgreSQL, Redis, Kafka or the internal API. Localhost provides the browser's secure-context treatment required by the verified player. No public tunnel or VPN has been installed or published as part of this phase. If no private route exists, choose its setup separately before trying this procedure.

For NAT discovery, the runtime accepts up to three comma-separated `stun:hostname:port` addresses through `PEER_STUN_URLS`. The later Phase 5 checkpoint enables Cloudflare STUN by default in normal runtime, only after sharing opt-in. Routine tests keep it off, and PEER_STUN_URLS=off explicitly disables it. One available free endpoint is `stun:stun.cloudflare.com:3478`, described in [Cloudflare's FAQ](https://developers.cloudflare.com/realtime/turn/faq/) and [network requirements](https://developers.cloudflare.com/realtime/realtimekit/network-allowlist/). You can override the discovery endpoints in the ignored local environment and restart the app. This only discovers connection candidates; [WebRTC peer connection guidance](https://webrtc.org/getting-started/peer-connections) explains why some NAT combinations require a TURN relay. No TURN service or AWS resource has been provisioned.

Publish your own video of at least a minute. On both devices, use the same rendition, enable Help share this video, and play overlapping sections. Connection details should show actual peer payload and an uploader should show uploaded payload. Download a report from each device. Record browser versions, connection types, duration/quality, received HTTP/peer bytes and peer uploads; omit credentials and public IPs from shared notes.

Turn sharing off, seek to another point and confirm the video continues over HTTP. Repeat the same playback interval with sharing off on both devices. Treat observed payload ratios as measurements under those conditions. They are not billed bandwidth savings, and startup/consent downloads can affect an apparent comparison. Zero peer bytes is a real result that may require investigating connectivity; do not replace it with a connection icon or claim cross-network success before media transfers.
