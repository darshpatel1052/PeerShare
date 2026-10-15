# PeerShare through CloudFront

The public application is [peershare.darshpatel.dev](https://peershare.darshpatel.dev), deployed from `7b10aeee685dc4ce2fb2a1edeb0b048eb2c41f78`. CloudFront distribution `EDYJRQX7L4RDA` serves the private S3 frontend and forwards uncached application/media/WSS requests to the existing HTTPS origin. No additional host was created. The final full Terraform plan reported zero resource changes, creations or deletions. The account remained on its active Free plan with USD 118.83 remaining credits at the cutover check.

## Actual public checks

`checks.json` records normal public DNS and certificate verification, without a host-address override or TLS bypass:

- Eleven user-facing static routes returned 200 and PeerShare branding; the edge added security response headers.
- The live catalogue contained the 18 editorial videos plus the owner's original video. The approved temporary benchmark video returned anonymous 404 after unpublishing.
- Original thumbnail, HLS master and integrity descriptor hashes matched the earlier preservation record exactly. A previous-only JavaScript chunk remained available with its original hash.
- The old public watch URL redirected with 308 to the equivalent PeerShare path/query.
- Anonymous operator requests returned 401 and public metrics returned 403.
- Two fresh Chromium contexts played a published 480p video and exchanged verified peer payload over `wss://peershare.darshpatel.dev/tracker`, with zero rejected segments or page errors. After disabling sharing, seeking and playback continued.

This is a release smoke check on one workstation/network. It does not establish concurrent-viewer capacity or a separate cross-network benchmark. The larger [benchmark report](../../../benchmarks/report.md) describes earlier direct-HTTPS application revisions; its results are not relabelled as CDN measurements.

`auth-preflight.json` verifies that the real CloudFront API starts Google OIDC with the new callback and a Secure flow cookie. The user added the callback in Google Cloud. This config check is separate from the pending manual Google round trip on the new hostname. The previous production sign-in and cross-network confirmations remain in their original dated record.

`artwork-refresh.json` records updates to the six known editorial banners and eighteen thumbnails through revision-checked creator APIs. The original user's content was not changed. `compatibility-ci.json` records the passing remote browser/media, Kubernetes and Terraform jobs for the actual deployed source. Public screenshots show the running pages, rather than mockups.

## Operating state

The project owner's existing account has the persisted operator role. Editorial accounts retain normal creator roles. Host-only cookies require one sign-in on the new domain, while the same database user/channel and Google identity are retained.

The original absolute host shutdown remains **15 October 2026 at 19:53:31 UTC (16 October at 01:23:31 IST)**. It was not extended by the deployment. Static frontend objects can remain served after shutdown, but API, sign-in and media require the host. Retained disks, EIP and stored data can consume credits after stop. See the [cost plan](../../../runbooks/aws-cost-plan.md) and [deployment runbook](../../../runbooks/aws-deployment.md).
