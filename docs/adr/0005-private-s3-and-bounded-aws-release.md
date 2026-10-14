# ADR 0005: private S3 and a bounded single-host AWS release

Status: accepted for the first deployment, 15 October 2026 (local time).

Keep the existing API-mediated resumable chunk protocol while changing the server-side storage adapter to private S3. PostgreSQL remains authoritative for publication, ownership, accepted generations and quotas. The worker writes immutable attempts; the coordinator independently validates them. Do not expose bucket credentials or object keys as browser access grants.

Serve static frontend releases through CloudFront/OAC. Keep API, tracker and permission-checked media uncached for the first release. This gives CDN frontend delivery while preserving subsequent-request unpublish behavior. It does not claim native S3 multipart, media CDN savings, or recall of downloaded/peer-cached bytes.

Deploy on one eligible 8 GiB Mumbai host using the user's active AWS Free plan and credits. Keep databases/broker/Redis internal to the Compose network, use scoped temporary service roles, immutable commit-tagged images, independent edge/origin certificates, private operator surfaces and a 24-hour stop deadline. Avoid managed-service fixed costs in this first exercise.

The cost worksheet budgets approximately USD 3.90 gross for its bounded first-day workload, with USD 10 allowance and explicit retained-resource costs. A shutdown and AWS budget are not complete teardown or a real-time traffic spending cap. No plan upgrade, paid subscription or notification recipient is authorized by this design.

Consequences: one host/database/disk remain shared failure domains; media upload/read traffic crosses the host; private internal transport lacks TLS; role refresh is a single-host broker instead of native task roles. Native multipart, authenticated media CDN caching, workload-native roles and multiple failure domains require separate future work and evidence. A full local database/media restore passed before staging the user's existing data.

See [the storage/release chapter](../learning/phase-5/05-storage-and-release.md) and [the cost plan](../runbooks/aws-cost-plan.md).
