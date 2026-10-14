# Private object storage and a reproducible release

This chapter describes the implementation built on 14–15 October 2026. Local S3 and origin rehearsals have passed. AWS has issued the public hostname's ACM certificate; the remaining live origin/application checks are recorded separately as they finish.

## What changes when files move to S3?

PostgreSQL still answers who owns a channel, whether a video is published, which generation was accepted, and which uploads reserve capacity. S3 stores bytes under keys. A key such as `videos/<video>/<generation>/<attempt>/480/segment-000.ts` is an address, not permission to view that video.

The new `objectstore.Remote` adapter wraps the official AWS SDK for Go v2. `FromEnvironment` selects local filesystem transport or S3, validates configuration, and uses the SDK's credential chain. A custom endpoint is allowed only for development; the deployed app uses AWS's regional HTTPS endpoint. The application does not create production buckets. Terraform owns that resource lifecycle.

`Put` sends bounded image/chunk bytes with an explicit SHA-256 checksum, content length and MIME type. `PutFile` hashes a file as a stream, rewinds it, and uploads through the SDK without retaining a 250 MiB source in memory. `Read`/`Open` reject oversized objects and close response bodies. Go's `context.Context` carries cancellation/deadlines into network calls. Two SDK attempts and a bounded HTTP timeout limit a stalled dependency.

## Follow one upload through the system

1. The browser computes part hashes and asks the catalogue to reserve an upload. Production also checks the creator's expiring approval.
2. The existing API grants a short-lived part token. The browser sends at most three 8 MiB parts at once to Go.
3. Go verifies a part's length/hash, writes its immutable S3 object, then records it in PostgreSQL. Resume checks the stored object against the expected bytes, so a missing local staging file does not lose an acknowledged part.
4. Completion assembles verified parts into a temporary source, uploads the source object, and commits the catalogue submission/outbox. Kafka carries the durable job notification to the independent coordinator.
5. The worker downloads that source into its private temporary directory, verifies the source hash, and invokes FFmpeg. It uploads the immutable attempt files and the integrity descriptor last.
6. The coordinator downloads the assigned attempt into an isolated validation directory and checks the complete output, including per-file hashes, before accepting the still-current lease. Its temporary copy is removed afterward.
7. A catalogue lifecycle event makes the verified output ready for private preview and publication. A later lease or abandoned attempt cannot replace the accepted output.

This release deliberately retains **API-mediated chunks stored as individual S3 objects**. It does not use native S3 multipart `UploadPart` URLs or transfer browser traffic directly to S3. That preserves the already-working admission/hash/token workflow and needs no browser bucket credentials/CORS. It also means the host carries upload traffic and temporary assembly; direct multipart upload remains a separate future optimization. The originals bucket's abort-incomplete-multipart lifecycle is preventive infrastructure configuration, not evidence of native multipart use.

## Follow a viewing request

The browser requests a manifest, descriptor, image or segment through `/media/...` or `/api/v1/images/...`. Go first checks the database's current ownership/publication and accepted attempt. Only then does it fetch the permitted S3 object. Four media-read slots bound buffered reads; one segment/object is capped at 16 MiB. HTTP range handling still works through `ServeContent`.

The buckets block public access. Go returns private/no-store media responses, and CloudFront's API/media/tracker behaviors have a zero TTL. Unpublishing therefore affects subsequent HTTP reads without waiting for a CDN invalidation. Already downloaded bytes and a peer's accepted local cache cannot be remotely recalled. This is the same practical boundary as local playback; no claim of instantaneous revocation of delivered bytes is made.

Deleting a video first hides it in PostgreSQL. Once its processing attempt is quiescent, reconciliation deletes chunk objects, every source filename scoped to that video, processed attempts and local staging. Only successful cleanup releases reserved capacity. This includes a source uploaded before an interrupted catalogue commit. The orphan sweep processes bounded pages after a grace period and checks references before removing an unowned object; an S3 error defers cleanup.

## Why separate AWS roles?

| Principal        | Allowed work                                                               | Intentionally absent capability                         |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Catalogue        | Read/write/delete originals; read/delete derivatives; write creator images | Publish processed video output                          |
| Worker           | Read sources; write immutable processed video objects                      | Database access, bucket listing/deletion, Google secret |
| Coordinator      | Read processed attempts for validation                                     | Upload/delete objects                                   |
| Backup           | Read source/processed buckets; write/read snapshot bucket                  | Delete live media                                       |
| GitHub publisher | Publish selected ECR images and frontend objects                           | Start hosts, read creator data, assume runtime roles    |
| EC2 host         | Assume those runtime roles, pull release images, write bounded logs        | Direct application object access                        |

An **IAM permission policy** defines actions/resources. A **trust policy** defines who may assume the role. They are different checks. Runtime roles trust only the EC2 host role. GitHub's trust requires this repository's exact `main` subject and the STS audience.

The host obtains instance-role credentials using IMDSv2. Docker containers cannot use that endpoint through their bridge: the response hop limit is one, and their SDK metadata provider is disabled. A root-owned broker assumes each narrower role for one hour and atomically refreshes its separate file every fifteen minutes. Each service mounts only its own directory, read-only.

The Go `runtime-credentials` command implements AWS's **credential_process** JSON protocol. Its stdout is secret input to the SDK, never an operator diagnostic. The `Expiration` field tells the SDK when to rerun it. Static environment credentials would stay fixed for the lifetime of a process; this protocol supports refresh without restarting the app. The root-only backup provider follows the same protocol. [AWS process-credential protocol](https://docs.aws.amazon.com/sdkref/latest/guide/feature-process-credentials.html).

This is a single-host Compose tradeoff. A later ECS/EKS deployment should use native task/workload roles instead of this broker. Internal PostgreSQL, gRPC and Kafka use the private Docker bridge with existing scoped credentials; this release does not claim internal TLS or multi-host isolation.

## The two HTTPS connections

The browser connects to CloudFront using the free, non-exportable ACM certificate for `peerscreen.darshpatel.dev`. CloudFront separately connects over HTTPS to `origin-peerscreen.darshpatel.dev`, using a free Let's Encrypt origin certificate.

The EC2 security group permits origin HTTPS only from AWS's managed CloudFront origin-facing prefix list. Envoy additionally requires a private origin header. Both restrictions matter: the prefix list includes other customers' CloudFront origins too. The gateway overwrites the client-address header with CloudFront's generated viewer address, and Go accepts it only from the explicitly trusted gateway address. It does not accept a browser-supplied client address.

HTTP port 80 serves the origin's ACME challenge. Certbot renews through its system timer. A successful renewal copies the new files into the private TLS directory and recreates the gateway to load them. That can briefly reconnect a tracker; HTTP playback fallback remains available afterward. Renewal is verified separately on the real host rather than inferred from having installed a hook. [Certbot renewal hooks](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates), [CloudFront origin HTTPS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-cloudfront-to-custom-origin.html).

## What a release contains

`release.yml` publishes only the repository's main branch, normally after Compatibility checks succeed. It uses a pinned official AWS action and GitHub OIDC to obtain short-lived build credentials. It stores no permanent AWS access key in GitHub secrets. [Official AWS action](https://github.com/aws-actions/configure-aws-credentials).

Each image is tagged with the full Git commit. ECR refuses replacing that tag and retains five releases. The static frontend comes from the same web image; it is uploaded under `releases/<commit>/`. CloudFront selects that prefix. Hashed `_next` assets are retained in a shared `assets/` prefix so an old open tab can still fetch its original code after a rollout. Those retained bytes have storage cost and are included in later cleanup.

Publication and deployment are separate permissions. The host operator stages the exact source commit, pulls its images, runs the catalogue/media migrations and checks health before changing the public frontend release. Named PostgreSQL/Kafka/media/upload volumes remain in place. Rolling back means selecting an already-published compatible commit and frontend prefix. It does **not** automatically reverse SQL migrations. Take a full backup before schema changes; a destructive or incompatible rollback requires a deliberate database restore.

## Backup evidence means a restore

`backup-local.mjs` briefly stops the normal app's writer processes, exports a PostgreSQL custom-format dump, and snapshots both upload/media volumes. It resumes the exact same containers, then restores the dump into a separate database with no network and extracts both archives again. Database row counts and every extracted file hash must match.

The verified snapshot contains four users, two channels, four video records, three upload sessions, 84 media files and one source file. There were no media-service jobs or playlists in this original normal dataset. The dump contains account/session data, so it and all fingerprints stay in ignored mode-0600 files. No secrets or raw account responses are evidence artifacts in Git.

This proves a local full-data restore. It does not yet prove a restore from the live AWS backup bucket or a live Google sign-in on the public site. Those checks belong to the public rollout evidence.
