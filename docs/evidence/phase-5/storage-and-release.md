# Storage and deployment checkpoint

Observed 14 October UTC / 15 October 2026 India time.

The packaged local S3 rehearsal used pinned Versity 1.9.0 and the official Go SDK. An actual generated MP4 became verified 480p/720p output. Removing acknowledged local chunks did not lose resume state. Removing the local processed-video directory did not prevent S3-backed manifest and segment HTTP reads. Private preview, public denial, publication, creator banner, unpublish and deletion passed. The final SDK audit saw zero source/processed objects for the deleted video. The raw disposable request record stays in `.local/evidence/phase-5-s3-container.json`.

The full backend integration/race pass recorded **57 top-level cases, 82 including subcases, zero failures**. The packaged S3 pass was repeated after the scoped source-cleanup change. No new playback benchmarking or remote-network result is implied.

An actual Envoy 1.39.4 container validated the production origin configuration and exercised missing/wrong origin-header rejection (403), accepted routing (200), overwriting a spoofed viewer-address header, media-path rewriting, blocked public metrics (404) and WSS upgrade. This uses simulated CloudFront headers, stub upstreams and local TLS. It is explicitly not live CloudFront evidence. Summary: [origin.json](origin.json).

The normal local dataset was paused, dumped and archived; the exact original containers resumed. An isolated, networkless PostgreSQL restore matched four users, two channels, four videos, three upload sessions, zero playlists and zero independent media jobs. A second extraction matched all **84 media and one source file** hashes. Private archives, account/session data and hashes stay under `.local/backups/`; the public summary is [backup.json](backup.json).

AWS account preflight confirmed active FREE plan, USD 100 plan credits and eligible host/AMI/quota. The cost plan gives the workload/retention assumptions. The user added ACM's DNS CNAME and the production Google callback. A read-only ACM check returned **ISSUED** and domain-validation **SUCCESS** for `peerscreen.darshpatel.dev`. This proves the edge certificate; it does not prove Google sign-in on the deployed site or the origin certificate.

Terraform formatting/schema validation and an account-specific no-deletion plan passed. The private state/plan contains the origin header and remains ignored. Runtime-role refresh, release publication, the actual host, origin renewal, public data migration and live AWS backup/restore require their own runtime records; source declarations alone do not establish those results.
