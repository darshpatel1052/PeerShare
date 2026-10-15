# Phase 6: product finish and engineering handoff

1. [Product finish](01-product-finish.md): layout, reusable tokens, catalogue data, upload interactions and preservation evidence.
2. [Local Kubernetes exercise](02-kubernetes.md): Helm, Deployments, Services, setup Jobs, probes, scoped configuration, persistent volumes and scaling.

The [demo and handoff runbook](../../runbooks/demo-and-handoff.md) connects the creator/viewer walkthrough to the operator tools and the prepared benchmark harness.

3. [Public release and measurement](03-release-and-measurement.md): HTTPS, safe updates, static-asset retention and measurement scope.
4. [Benchmarking a video system](04-benchmarking-a-video-system.md): synthetic relationships, arrival rate, tail latency, Go/SQL optimization, Redis and honest resume claims.

The direct HTTPS deployment is live. The user confirmed production Google sign-in and reported successful cross-network playback; no device counters were supplied. The [benchmark report](../../benchmarks/report.md) records the larger isolated dataset and actual media experiments. CloudFront is deployed, with the PeerShare domain/application cutover tracked in the deployment runbook.

5. [Operator workspace](05-operator-workspace.md): processing queue, existing role model, audited actions, private state and the shared Go mutation path.
