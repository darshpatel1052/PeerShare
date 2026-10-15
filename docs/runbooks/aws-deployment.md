# Deploy the bounded PeerScreen showcase

The live resource/application evidence is separate from this procedure. The account remains on its active Free plan; do not upgrade it to make a command succeed. The first host has an absolute 24-hour shutdown deadline. [Cost and retained resources](aws-cost-plan.md).

## Private workstation inputs

`.local/aws-deployment.env` contains the selected CLI/profile paths, expected account, Mumbai region and domain. Its credentials are resolved by the user's local console-login credential process. It is mode 0600 and ignored. Real Terraform inputs/state/plans, the origin secret, SSH private key, Google configuration, database dump and runtime bundles also remain ignored/private.

Prepare/plan with `node scripts/aws-terraform.mjs prepare` and `plan`. The helper verifies the exact account, active FREE plan and at least USD 10 credits before mutations. A targeted `certificate` operation creates the free ACM certificate in us-east-1. Add its returned CNAME in Name.com, using the host relative to `darshpatel.dev`. Keep that record for renewal. The user completed this; ACM returned ISSUED/SUCCESS.

`foundation` creates private buckets, encryption/public blocks, scoped roles, immutable repositories and a bounded log group. It intentionally prepares publication before compute. Its partial Terraform targeting is followed by a full no-deletion plan/apply; a targeted result does not represent a completed stack.

## Publish a tested commit

Repository variables provide the region, build-role ARN, image repository URLs and frontend bucket. They are resource settings, not permanent credentials. The release workflow obtains its short-lived role through GitHub OIDC. This repository uses an immutable subject with owner/repository IDs, restricted to main; see the learning chapter.

Compatibility checks normally trigger publication on success. An explicitly requested initial deployment can dispatch the release workflow after its local checks. Record both the published commit and the actual CI/publication outcomes; a manual dispatch does not establish remote compatibility CI success.

## Snapshot and stage existing data

Run `npm run backup:local` while the normal Docker app is available. It briefly stops the writer containers, snapshots the database and both file volumes, resumes the exact containers, and verifies an isolated restore. Do not publish its archives or private account/session contents as CI artifacts.

`node scripts/aws-release.mjs stage FULL_COMMIT_SHA` is **initial bootstrap only**. It exports that exact Git revision, generates separate production database/RPC/Redis secrets, and includes the existing Google configuration only in the private runtime bundle. It copies the existing original/video/artwork files to private S3, downloads them and matches the snapshot hashes. It uploads the private dump/archives/manifest under the backup bucket's seven-day snapshot prefix. Retrying completed staging preserves the existing bundle; incomplete staging preserves the generated credentials. A different bootstrap release is refused once a staged initial release exists.

For later application versions, use `node scripts/aws-release.mjs update-host FULL_COMMIT_SHA`. It verifies the configured account, active Free plan, available credits and published images, then transfers only source and host/gateway configuration over the remembered SSH host key. It never transfers `runtime.env`, database dumps or media archives. The host retains the live database and credentials, stops writers for a short maintenance window, runs migrations and starts the new images. Envoy is recreated so route changes take effect. A failed migration requires inspecting the private operation log before attempting another rollout.

## Direct HTTPS while CloudFront approval is pending

On 15 October the user authorized direct HTTPS on the existing server and added the `peerscreen` A record. Set `enable_cloudfront=false` in private Terraform inputs. The full plan creates public IPv4 port 443 access and a TLS-only policy on the still-private frontend bucket; it does not create a distribution or another server. The original CloudFront configuration remains available for the later upgrade. Keep the existing origin and ACM validation DNS records.

Issue a free Certbot certificate for the **public** hostname, select that hostname as `certificate_domain` in the host settings, and run the installed renewal hook. The hook copies only the selected lineage and ignores the retained origin certificate. Verify renewal with `certbot renew --cert-name peerscreen.darshpatel.dev --dry-run --run-deploy-hooks`. In direct mode, Envoy accepts the public hostname and replaces the client-IP header from the actual connection. It does not trust CloudFront viewer headers sent by public clients. SQL media permissions, private storage, secure cookies and private metrics still apply.

After approval, create/verify the CloudFront distribution, switch the gateway back to its private-header origin mode and origin certificate, point the public record to CloudFront, and remove direct 443 access. Review this cutover plan explicitly: removing the temporary ingress rule is an intended deletion, unlike deleting application data or compute. The generic apply helper deliberately refuses deletion plans.

## Provision and start the host

Set `release_sha` in the private Terraform inputs to the published full commit. `apply` verifies both ECR tags and the frontend index object exist, inspects a full plan with no deletions, rechecks account/credits, then provisions the remaining bounded stack. `outputs` gives the public EIP, origin hostname and CloudFront hostname without exposing the secret origin header.

In Name.com, add an **A** record for `origin-peerscreen` pointing to the returned EIP. Keep unrelated domain records. Once it resolves, run `prepare-host FULL_COMMIT_SHA`. SSH uses the generated key and a separate remembered host-key file. The host waits for cloud-init, installs the pinned signature-verified official CLI, starts isolated role refresh, pulls the immutable images and restores the initial database/file snapshot. A restoration marker prevents reruns from replacing live data.

On the host, issue the origin certificate with Certbot standalone for `origin-peerscreen.darshpatel.dev`, then run the installed deploy hook against that certificate lineage. The origin does not need a bought certificate. Certbot's system timer and successful-renewal hook copy its private certificate/key and recreate only Envoy. Verify a real renewal rehearsal before recording that capability as complete.

Run the staged `deploy/host/release.py FULL_COMMIT_SHA` as root. It prepares dependencies, runs migrations, starts services and waits for health. The exact source pointer and image tags are recorded. Grant the intended existing creator a bounded `creator-access` approval after migration; registration stays closed by default. Public viewing does not need an account.

Finally add a Name.com **CNAME** for `peerscreen` to the returned CloudFront hostname. The user already added `https://peerscreen.darshpatel.dev/api/v1/auth/google/callback` in Google alongside localhost. Verify the public static routes, API, original video/artwork, secure session, S3-backed publishing and WSS. Have the user test actual Google sign-in and the two-network peer flow; do not equate redirect configuration with successful authentication.

## Compatible rollback and teardown

For an application rollback, stage an already-published compatible source/images commit, run its host release procedure and select its frontend prefix in Terraform. Retained hashed assets support old open tabs. This preserves volumes and runs the selected migration code; it does not reverse an incompatible SQL migration. Database rollback requires restoring a verified snapshot deliberately, with writer processes stopped.

Stopping the EC2 host is reversible and leaves data. Its shutdown timer uses a fixed absolute deadline, so restarting it does not grant another 24-hour window. Terraform protects the data disk and refuses to empty nonempty buckets automatically. EBS, EIP, S3 and ECR retention can continue to consume credits after stop.

To remove the deployment, first choose/export and verify retained data. Disable/delete the distribution, then review a destroy plan; explicitly remove the data-disk protection and empty only the chosen project buckets/repositories after the retention decision. Remove the project EIP/disks and unused IAM/log/network resources. Remove the two public routing records if the site is retired. The retained ACM validation CNAME is harmless and can remain if the certificate will be reused. Never report a stopped VM or a failed protected destroy as complete teardown.

Direct HTTPS updates retain immutable `/_next/static` files from five releases under `/srv/peerscreen/assets`. Before stopping the old web image, the release helper extracts both its chunks and the incoming image's chunks. The web container mounts those files read-only. Its server tries the current export first, then only retained static chunks; HTML, API routes and private media cannot use this fallback. This keeps an already-open tab's lazy player/page imports available during routine updates. Tabs older than the five retained releases may need reloading. Retention does not imply multi-host availability or a migration rollback.
