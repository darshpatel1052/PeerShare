# AWS preparation and a dated cost example

Prepared **14 October 2026** for `peerscreen.darshpatel.dev` in Mumbai (`ap-south-1`). The user requested preparation within the AWS Free plan and credits. The earlier reported balance was USD 100; **the current balance, expiry, existing usage and chosen demo duration are not yet confirmed**. The 24-hour duration below is a planning example, not authorization to create resources.

## What Terraform models

`deploy/terraform` pins Terraform 1.16.6 and AWS provider 6.68.0, with a checked-in provider lock. `init -backend=false` and `validate` succeeded locally. No account plan/apply, bootstrap execution or infrastructure deployment has been claimed.

| Resource                                 | Purpose                                                 | Initial choice                                         |
| ---------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| VPC, subnet, internet gateway and routes | A defined network boundary                              | One public subnet; no charged NAT gateway              |
| Security group                           | Limit inbound reachability                              | HTTPS, reserved ACME HTTP, SSH from one supplied `/32` |
| EC2                                      | Run the small Compose stack                             | `m7i-flex.large`, 2 vCPU / 8 GiB                       |
| Root/data EBS                            | Persist OS/images and application volumes               | Encrypted gp3, 30 + 40 GiB                             |
| Private S3 buckets                       | Prepare originals, processed media and frontend storage | Public access blocked and encryption enabled           |
| ECR repositories                         | Store immutable API/web releases                        | Five-image retention per repository                    |
| CloudWatch log group                     | Prepare bounded logging                                 | Seven-day retention                                    |

The host bootstrap installs Docker/Compose and prepares Docker's data root on the selected EBS volume. The volume identity is explicit, and formatting occurs only when that selected device has no filesystem signature. It has not been exercised on EC2. The instance uses IMDSv2 with hop limit one; application IAM access still requires a deliberate next-step design. No IAM/container isolation, CloudFront serving, S3 transport or automated application deployment is implied by these resource declarations.

AWS currently lists `m7i-flex.large` as Free-tier eligible for the newer account program. Eligibility does not mean unlimited zero-price compute. Account eligibility, regional offering/quota and the chosen AMI still require account-specific checks. [AWS EC2 Free Tier guidance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html).

## Current rates and arithmetic

The official Mumbai EC2 price list, published 12 October 2026 and fetched 14 October, gives Linux shared on-demand `m7i-flex.large` at **USD 0.10075/hour** and gp3 capacity at **USD 0.0912/GB-month**. The extracted SKUs and attributes are in the Phase 5 pricing record. [Official regional price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-south-1/index.json).

| Core resource                                           | 24-hour example before credits |
| ------------------------------------------------------- | -----------------------------: |
| EC2: 24 × 0.10075                                       |                        $2.4180 |
| 70 GiB gp3: 70 × 0.0912 ÷ 30-day illustrative proration |                        $0.2128 |
| One in-use public IPv4: 24 × 0.005                      |                        $0.1200 |
| **Core subtotal**                                       |                    **$2.7508** |

The public IPv4 rate comes from [AWS VPC pricing](https://aws.amazon.com/vpc/pricing/). EBS is billed for provisioned storage, not just bytes occupied. Calendar-period/second billing can differ slightly from this simple 30-day arithmetic. Existing domain ownership is assumed; no Route 53 hosted zone or domain purchase is included.

This is **not an all-in project quote**. Variable S3 requests/storage, ECR storage, CloudWatch ingestion, internet delivery, taxes and any later CloudFront/TURN choices still need a bounded workload estimate. The runtime images were reduced from approximately 1.40 GB to 611 MB for the API and from 829 MB to 230 MB for web, by keeping the Go compiler and frontend build dependencies in build stages; ECR charges compressed/shared layers, so these are sizing observations rather than registry bills. Its published storage example uses $0.10/GB-month. [ECR pricing](https://aws.amazon.com/ecr/pricing/).

An always-running month consumes substantially more than a one-day exercise: 730 compute hours alone are about $73.55 before disks, addresses and delivery. The project does not promise several free hosting months. Credits must be treated as a budget source with an expiry, not as a substitute for gross cost measurement. [AWS plan lifecycle](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

## Before provisioning

Complete the workload/credit worksheet, confirm eligible resources in the selected account, finish the application S3/publication behavior, creator admission, scoped IAM/image delivery, ACME issuance/renewal and full backup/restore, and inspect an account-specific Terraform plan. Preparation does not upgrade the account or create resources. Do not run `apply` on this starter as though those application steps were finished.

The existing `darshpatel.dev` DNS provider will need an A/alias record for the selected entry point. No DNS record has been changed. Google will also need the production callback `https://peerscreen.darshpatel.dev/api/v1/auth/google/callback` configured in its OAuth client before live sign-in there.

## Teardown is part of the design

Terraform deliberately protects the persistent data disk with `prevent_destroy` and refuses automatic deletion of nonempty buckets. These protections make a blanket destroy fail until data retention is explicitly resolved. They do **not** stop billing. After an approved finite exercise, export/verify the needed data, review removal of the protection, empty or retain explicitly chosen buckets and inspect the destroy plan. Stopping EC2 leaves EBS charges; retained data must be included in the final cost record.

Real tfvars, plans, state and provider caches are ignored. The committed `example.tfvars` contains the selected domain and documentation-only administrative address; never put private keys or app credentials into it. Terraform state can contain sensitive information even if an output is marked sensitive, so keep it private.
