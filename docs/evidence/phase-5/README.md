# Phase 5 networking and deployment foundation

The original networking foundation below was observed on **14 October 2026**. The subsequent [storage/release checkpoint](storage-and-release.md) adds verified S3 transport, origin routing and full local backup/restore. AWS has now issued the edge certificate and provisioned private buckets, scoped roles, image repositories and bounded logs. The active Free plan has USD 100 plan credits; no plan upgrade or paid subscription was enabled. Host/public rollout is in progress.

## Working networking path

- Cloudflare STUN enabled in normal runtime after viewer opt-in. The [real running-browser observation](stun-discovery.json) saw `host` and `srflx` candidate types, with no connection before opt-in. It records no addresses or SDP. This establishes discovery from this host, not cross-network media reachability.
- WebSocket-only tracker using pinned `ws`, bounded membership/signalling and origin checks. Removing the old tracker server removed the vulnerable dependency chain. [Current audit](dependency-audit.json): zero findings; this is a dated dependency observation, not a general production-security claim.
- All **25 native production browser cases passed** with the new tracker and routine STUN disabled, including actual uploaded peer delivery, corruption rejection, HTTP fallback, playlists, search and Analytics. [Named record](browser.json). Parallel player/thumbnail UI commits were preserved; the packaged rehearsal additionally exercised the newer UI.
- Full backend/race checks passed: **55 top-level cases, 80 including subcases**, with real local dependencies. [Named record](backend.json). New coverage checks direct-gateway address trust and metric labels using route patterns rather than user/video identifiers.

## Packaged HTTPS/WSS rehearsal

[Actual image observations](gateway.json) cover a generated creator and real 12-second MP4 processed/published through the existing pipeline, then production-mode routing through a localhost self-signed TLS gateway:

| Capability               | Observed                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Secure account session   | `__Host-` cookie, Secure and HttpOnly; same account across both API replicas                           |
| Public registration      | Closed in production preset                                                                            |
| Published media          | HTTPS manifest and integrity paths served through the catalogue's visibility checks                    |
| Tracker                  | WSS on the same origin through Envoy's WebSocket upgrade route                                         |
| Actual peer payload      | **1,046,596 bytes received and uploaded** between independent browser contexts; zero rejected segments |
| Browser security context | Secure context reported true                                                                           |
| Operational details      | Public `/metrics` blocked; real request/pool metrics readable internally                               |
| Healthy routing          | After stopping one disposable API, Envoy reported one healthy endpoint and the same session continued  |

The initial attempts exposed the first idle health timer: its default sixty-second interval delayed recognizing a stopped endpoint. Both normal/idle health intervals are now explicit; the final rehearsal passed. Rehearsal STUN remained off to isolate the TLS/signalling/media path. It does not establish public certificate issuance, two-network performance, universal NAT traversal or host-level high availability. The disposable project's volumes were removed; normal user data was preserved.

Runtime images now contain the required binaries/libraries, with build tools retained in build stages: API approximately **611 MB**, web **230 MB**, compared with approximately 1.40 GB and 829 MB before trimming. The normal app was upgraded. [Preservation checks](preserved-runtime.json) show unchanged original video segment, thumbnail and banner hashes and Google still enabled. Live Google login remains user-reported from the earlier checkpoint.

## AWS package

Terraform 1.16.6 and AWS provider 6.68.0 are pinned and locked. Offline initialization/schema validation and formatting passed. No account-specific plan/apply or EC2 bootstrap was executed. Resource declarations prepare Mumbai networking, one bounded 8 GiB host, encrypted disks, private buckets, retained image repositories and bounded logs; S3 application transport and public delivery are still future integration work.

The [official price extract](aws-prices.json), published 12 October and fetched 14 October, prices Linux shared `m7i-flex.large` at $0.10075/hour and gp3 at $0.0912/GB-month. The [cost chapter](../../learning/phase-5/02-aws-and-costs.md) calculates an illustrative **$2.7508 core subtotal for 24 hours**, including one public IPv4. It excludes variable services/delivery, tax and credits; it is not an all-in deployment quote or a resource-creation approval.

CI now includes the packaged gateway rehearsal and a separate Terraform validation job. Current local builds/types, eight JavaScript cases, contract/protobuf checks and Go vet are recorded before the checkpoint. Individual remote CI status is reported separately from local checks.

The original AWS paragraph records that earlier checkpoint's scope. Current work and remaining live checks are recorded in [storage and release](storage-and-release.md), [Redis and creator access](redis-and-access.md), [the full cost plan](../../runbooks/aws-cost-plan.md) and the [learning guide](../../learning/phase-5/README.md).
