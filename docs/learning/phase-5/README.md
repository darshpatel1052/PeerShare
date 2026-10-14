# Phase 5: deploy and operate the product

Target hostname: **peerscreen.darshpatel.dev**, selected by the user on 14 October 2026. Account preflight confirmed the active Free plan and USD 100 remaining plan credits. The edge certificate is issued after the user's DNS validation; private storage, scoped roles and image repositories are provisioned. No plan upgrade or paid subscription was enabled. The private AWS origin is running with preserved data; public CloudFront delivery awaits AWS account verification.

This first checkpoint connects real peer discovery to a deployment foundation: STUN enabled after opt-in, a WebSocket-only tracker, one HTTPS/WSS gateway, two catalogue replicas, shared sessions and private operational measurements. The Terraform starter prepares a bounded Mumbai host, disks, private storage and image repositories. It is infrastructure preparation, not a finished public deployment.

1. [Peer discovery and the gateway](01-peer-and-gateway.md) explains STUN, ICE, signalling, HTTPS/WSS, replicas and trusted client addresses.
2. [AWS resources and costs](02-aws-and-costs.md) explains Terraform, the selected resources, the 24-hour cost example and safe deployment/teardown.
3. [Operating the local rehearsal](03-operations.md) explains readiness, Prometheus measurements, diagnosis and what remains before AWS provisioning.
4. [Redis caching and creator access](04-redis-and-creator-access.md) follows dashboard reads through shared caching, explains separate eviction policies, and shows production creator grants.
5. [Metrics, dashboards and traces](06-observability.md) explains the optional operator profile, histogram queries, sampling and worker/coordinator traces.
6. [Private storage and releases](05-storage-and-release.md) follows S3 uploads/playback, Go's storage adapter, scoped AWS roles, credential refresh, certificates, immutable images and the verified full-data backup.

```mermaid
flowchart LR
 Browser[Browser: peerscreen.darshpatel.dev] --> CDN[CloudFront]
 CDN --> Static[(Private frontend S3)]
 CDN --> Gateway[Envoy HTTPS origin]
 Gateway --> Web[Static web app]
 Gateway --> API1[Catalogue API 1]
 Gateway --> API2[Catalogue API 2]
 Gateway --> Tracker[WebSocket tracker]
 API1 --> DB[(Shared PostgreSQL)]
 API2 --> DB
 API1 --> Limits[(Shared Redis)]
 API2 --> Limits
 API1 --> Objects[(Private video S3)]
 Browser -. opted-in discovery .-> STUN[Free STUN]
 Browser <-. encrypted media .-> Peer[Other viewer]
```

The browser still receives verified HTTP media when direct peer connectivity is unavailable. Two API containers improve routing through an individual process outage; one host, database, broker and disk remain shared failure domains. Neither STUN nor two containers establishes universal connectivity or multi-host availability.

S3 transport, creator admission, the local full-data restore and origin-routing rehearsals have passed. Actual GitHub OIDC publication, host/data rollout, origin certificate issuance/renewal and AWS snapshot restore have passed. The local monitoring profile scraped both replicas, provisioned eight panels and captured a real worker/coordinator trace. Public CloudFront, live production Google sign-in and two-network validation remain pending. See the [full cost plan](../../runbooks/aws-cost-plan.md) for the 24-hour workload and retained-resource costs. Existing product workflows remain usable on the normal local app.
