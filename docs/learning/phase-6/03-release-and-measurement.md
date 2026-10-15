# From working code to a measured public product

This chapter first describes the verified direct HTTPS release, then its transition to PeerShare through CloudFront. The distribution is now deployed; the current hostname cutover is recorded in the deployment runbook. The original delivery path was browser → HTTPS Envoy gateway → Go catalogue or static frontend/tracker. Media requests still pass Go's current PostgreSQL ownership/publication check before it reads private S3 objects.

## HTTPS and CloudFront solve different problems

HTTPS authenticates the server hostname and encrypts the connection. The free public certificate belongs to `peerscreen.darshpatel.dev`; the older origin certificate belongs to `origin-peerscreen.darshpatel.dev`. A valid certificate for one does not validate the other. DNS must point the requested hostname to the server before HTTP-01 issuance can succeed.

A CDN places delivery closer to viewers and can cache selected responses. It is not necessary to have HTTPS, secure cookies, OIDC or WSS. Direct mode serves these through the existing EC2 host while AWS reviews the CloudFront case. It has one-region latency and the host's capacity. No additional VM or load balancer was provisioned for the change.

Terraform's `enable_cloudfront` input makes the chosen path explicit. Direct mode adds public 443 access and creates no distribution. CloudFront mode uses its managed origin-facing prefix list and a private origin header. In direct mode, client-IP information comes from the real connection; a viewer cannot supply a trusted CloudFront address. Database ports, metrics and operator panels remain private. All S3 public-access blocks remain enabled.

The eventual CDN cutover needs coordinated DNS, gateway trust, certificate and network-rule changes. Creating a distribution alone would not finish it. The [deployment runbook](../../runbooks/aws-deployment.md) records that procedure.

## Authentication is not registration or publishing permission

Authentication verifies an existing account and creates a PeerShare session. Google uses authorization code + PKCE and a validated OIDC ID token. The callback checks issuer, audience, nonce and identity, then uses our own session cookie. HTTPS production cookies use the `__Host-` prefix, Secure, HttpOnly and SameSite=Lax.

Registration creates a local user. This bounded deployment keeps public registration closed; the normal development environment permits it. The account page now reads the backend's policy before offering the email registration form. A disabled server feature should not leave a tempting form that can only fail.

Publishing permission is another decision. An existing production creator needs a bounded creator grant before creating channels/uploads. This prevents expensive processing from following automatically from authentication. Owners can still clean up their own data after a grant expires. The local development workflow remains open for learning. Public viewers can watch without an account.

An available Google button and correct redirect are useful checks, but they do not prove a real Google login completed. The public browser reached Google with the correct production callback. The user subsequently confirmed the production account round trip and reported successful cross-network playback. [Their confirmations](../../evidence/phase-6/user-confirmations.json) do not include device counters.

## An update should preserve the things the product owns

The initial bootstrap restored accounts, channels, media and artwork from a verified snapshot and created production-only credentials. Repeating that bootstrap with fresh passwords during an update would break existing PostgreSQL roles and could rewind live data.

`update-host` therefore transfers only the exact Git source plus host/gateway settings. It checks account/credits and both immutable image tags first. The remote release process retains `runtime.env`, the database and media volumes, accepts a short maintenance window, stops writers, applies migrations and starts the new images. It does not pretend to offer zero downtime on one host. Migration failure requires reading the private log; automatically restoring an old database could lose newer user changes.

Open browser tabs also carry state. Their JavaScript may lazily import another hashed file long after the HTML loaded. Replacing a web image and removing every old chunk can break those tabs. The host now keeps static chunks from five releases. The server first tries the current export and then the retained directory **only for `/_next/static/`**. HTML and private media cannot use this fallback. The mount is read-only to the web process; per-release manifests keep retention bounded. A regression check requests an old-only lazy chunk while confirming private files remain unavailable.

## Read the measurements correctly

[Raw results and conditions](../../evidence/phase-6/performance/README.md) are part of the result. The metadata harness measures `/api/v1/videos?limit=12`; it does not load a page, decode a video or exercise the analytics cache. Its response comes from the Go catalogue and PostgreSQL. Redis still serves the separate rate-limit and analytics-cache responsibilities explained in Phase 5.

| Term        | What we measured                                    | What it helps explain                               |
| ----------- | --------------------------------------------------- | --------------------------------------------------- |
| Concurrency | Requests allowed to be in flight together           | Overlapping work and network waiting                |
| Latency     | Start → full response body → JSON validation        | How long one successful request takes               |
| p95         | Value at or above 95% of successful samples         | The slower part of the observed distribution        |
| Throughput  | Successful responses / complete round wall time     | Work completed under this finite workload           |
| Warmup      | Ten unmeasured requests before the rounds           | Avoiding the first connection dominating the sample |
| Errors      | Non-200 status, timeout, transport/contract failure | Whether the performance result hides failures       |

With concurrency one, requests largely wait for each round trip before the next starts. That is why roughly 38 ms typical public latency produces about 26 responses/sec. With eight requests in flight, network waiting overlaps and measured throughput increases. It does not mean a single response becomes eight times faster. Local loops have much less network delay and share hardware with the server, making their numbers unsuitable as an AWS capacity claim.

The production measurement had two APIs on one Mumbai server and one published video. All 1,800 public metadata requests succeeded; at concurrency eight, p95 ranged from 45–69 ms over the three rounds. A bigger catalogue, concurrent transcodes, a distant viewer or sustained load could produce different numbers. That historical check preceded the original showcase uploads and the separate 100,000-record synthetic catalogue campaign. The [larger benchmark](../../benchmarks/report.md) keeps synthetic metadata separate from actual playable media.

Peer delivery needs a different experiment. It measures verified media payload received from HTTP and peers, uploaded payload, playback progress and gateway response bodies. The archived preliminary local record retains one actual exchange/HTTP-fallback pair with explicit sharing setup costs. Later campaigns use unique output directories to prevent another test from replacing raw evidence. The actual public HTTPS/WSS check also transferred peer payload, but its browsers shared one workstation. STUN discovering a public candidate is a network discovery result. Two devices exchanging verified video on different internet connections is a stronger result and must be measured separately.

## What the independent review changed

One separately authorized review agent inspected representative product, authentication, media authorization, proxy trust and release paths. It found the unavailable signup form and missing old-chunk retention. Both were fixed and checked again by that reviewer. The review did not find a practical ownership bypass in the inspected paths; it is not a claim that every line or every browser/network condition was exhaustively proven.

Firefox received a separate public HTTP playback/custom-control/mobile assessment rather than inheriting the Chromium claim. The assessment moves the pointer into the player before clicking its auto-hidden controls, as a viewer would. Native Safari HLS and Firefox peer exchange are not implied by this HTTP/controls result.
