# Follow a peer connection from the browser

STUN was already supported by the Go playback contract and the player configuration. The earlier phase deliberately left it empty. It now defaults to `stun:stun.cloudflare.com:3478` in normal runtime and when Go's variable is unset. Set `PEER_STUN_URLS=off` or explicitly empty to disable it. The isolated test runtime continues to supply an empty value. [Cloudflare's current documentation](https://developers.cloudflare.com/realtime/turn/faq/) describes this STUN endpoint as free and unlimited; no Cloudflare account or TURN allocation was created.

## Four concepts with different jobs

| Concept              | Job in PeerScreen                                        | Data involved                                                              |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Tracker / signalling | Introduce viewers of the same accepted rendition/version | Peer identifiers and offer/answer descriptions                             |
| STUN                 | Discover a network-mapped address candidate              | Small binding requests, not video segments                                 |
| ICE                  | Try candidate pairs and select a working connection      | Host and server-reflexive candidates; a relay candidate would require TURN |
| WebRTC data channel  | Transfer video payload directly between browsers         | Encrypted segment bytes, then integrity verification                       |

The viewer enables Help share this video. Only then does the player create its peer engine and supply the configured ICE servers. The engine gathers candidates and sends offers through the tracker; another viewer answers through the same WebSocket route. The selected connection carries segment bytes, which are checked against the accepted integrity descriptor before use.

`srflx` means server-reflexive: STUN reported the address mapping visible outside the local network. A successful STUN response proves address discovery, not that another network can reach that candidate or that video transferred. The real check on this host observed `host` and `srflx` after opt-in, with no peer connection created before opt-in. Its report excludes addresses and SDP.

Some NAT/firewall combinations cannot establish a direct path. TURN relays can help, but relay bandwidth changes the cost model. This checkpoint uses STUN and verified HTTP fallback. [WebRTC's peer connection guide](https://webrtc.org/getting-started/peer-connections) explains ICE servers and the role of relay candidates. Do not describe this setup as guaranteed P2P on every network.

## The tracker is a small signalling service

`services/tracker/server.mjs` now uses the maintained pinned `ws` transport and implements the WebTorrent WebSocket announce protocol used by the installed player. The old server dependency brought UDP/HTTP parsing and the vulnerable `ip` dependency into the server. Removing it removed that dependency chain; the dependency audit reported zero findings at this checkpoint. The real player compatibility check is more useful than just claiming protocol compatibility.

The tracker stores ephemeral swarm membership and outstanding introductions. It forwards offers to other members and correlates an answer to its intended introduction. It never fetches remote URLs or handles media payload. Its bounds cover sockets, swarms, memberships, message sizes/rates, pending offers and slow outgoing sockets. Closed/idle sockets lose their membership. Counts are available as private metrics; addresses and signalling descriptions are not logged.

Browser Origin is checked against the app origin, which prevents ordinary cross-site browser use. It is not authentication: a non-browser client can forge Origin. Resource limits and HTTP fallback remain necessary. The tracker is not a source of channel permissions, private video access or trusted analytics.

## One gateway, one browser origin

Envoy terminates TLS and routes requests by path:

| Browser path         | Destination                                   | Why                                                    |
| -------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `/api/v1/…`          | Round-robin catalogue replicas                | Product APIs and shared sessions                       |
| `/media/videos/…`    | Catalogue media handler with rewritten prefix | Retain publication/version checks                      |
| `/tracker`           | WebSocket tracker                             | Offers/answers through WSS                             |
| App pages and assets | Static web service                            | Existing Next.js export                                |
| `/metrics`           | 404                                           | Detailed operations are private                        |
| `/media/fixture/…`   | 404                                           | Production routing does not expose operator test media |

HTTPS app pages need WSS signalling and HTTPS media URLs. These URLs are generated from runtime configuration, not hardcoded into the frontend export. WebSocket upgrades are enabled only on the tracker route. Uploads and media stream through the router; there is no generic full-body buffering or automatic retry of mutations. [Envoy's upgrade guide](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/upgrades.html) explains why buffering and upgrades require different handling.

Docker DNS returns both API addresses. Envoy's current DNS cluster extension treats each address as an endpoint and checks `/health/ready`; round-robin chooses among healthy endpoints. A login cookie identifies a hashed session in shared PostgreSQL, so the next request may reach either API. Redis limits are shared too. Neither service needs sticky sessions.

The gateway overwrites `X-PeerScreen-Client-IP` with the direct client's address. Go accepts it only when the TCP peer matches the configured gateway `/32`; arbitrary forwarded headers do not identify a viewer. This prevents all public viewers sharing the gateway's rate-limit key while keeping client-controlled headers untrusted. A future CDN hop needs its own explicit trust policy; the current setup models direct gateway ingress.

## Hands-on

Read `gatewayConfig()` and follow one `/media/videos/…` request to its Go handler. Open the private gateway statistics and find healthy catalogue endpoint counts. In the rehearsal, one secure cookie works across both replicas. Then inspect `clientAddress()` and explain why the configured TCP peer matters more than the presence of a forwarded header.
