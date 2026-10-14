# First AWS deployment cost plan

Account preflight used the user's local `peerscreen-deploy` console-credential profile. The Free Tier API returned **FREE / ACTIVE**, **USD 100** remaining plan credits, and plan expiration **21 March 2027, 17:22 UTC**. This is the plan's expiration, not a separately confirmed expiry for every individual credit award. No plan upgrade is part of this deployment.

Mumbai reports `m7i-flex.large` as Free-Tier eligible (2 vCPU, 8 GiB). The standard On-Demand vCPU quota is 5; the read-only inventory returned no running/stopped EC2 instances or existing key pairs there. Canonical's Ubuntu 24.04 image `ami-065d2b03fb493085a`, published 4 October 2026, also reports Free-Tier eligibility. These are account-specific observations, not generic eligibility assumptions.

## Proposed workload and duration

The first run uses **24 hours** unless the user changes the pending duration input. The host installs an automatic shutdown timer. Stopping compute does not remove disks, the IP address, buckets, images or logs. No EKS, NAT Gateway, ALB, RDS, managed Kafka, ElastiCache or paid CloudFront flat-rate plan is included. The PostgreSQL/Kafka/Redis/app containers and optional operational profile run on the same host.

This worksheet assumes an average 10 GB of S3 data including the demonstration backup, 20,000 S3 writes/list requests, 100,000 S3 reads, 2 GB of retained ECR images, 1 GB of log ingestion and 2 GB of uploads through CloudFront. Viewer delivery is assumed to stay within the account's available 1 TB / 10 million request / 2 million function monthly CloudFront allowances. These workload values are planning allowances, not measured project performance or enforced spending caps.

## Gross costs before credits and tax

| Item                                              | Rate / assumption                                        |     First 24 hours |
| ------------------------------------------------- | -------------------------------------------------------- | -----------------: |
| EC2 Linux `m7i-flex.large`                        | USD 0.10075/hour × 24                                    |         USD 2.4180 |
| gp3 disks                                         | 70 GiB × USD 0.0912/GB-month ÷ 30                        |         USD 0.2128 |
| One public Elastic IP                             | USD 0.005/hour × 24                                      |         USD 0.1200 |
| S3 storage                                        | 10 GB × USD 0.025/GB-month ÷ 30                          |         USD 0.0083 |
| S3 writes/listing                                 | 20,000 × USD 0.000005                                    |         USD 0.1000 |
| S3 reads                                          | 100,000 × USD 0.0000004                                  |         USD 0.0400 |
| ECR storage                                       | 2 GB × USD 0.10/GB-month ÷ 30                            |         USD 0.0067 |
| CloudWatch log ingestion                          | 1 GB × USD 0.67/GB, conservatively before log allowances |         USD 0.6700 |
| Log storage                                       | 1 GB × USD 0.03/GB-month × 7/30                          |         USD 0.0070 |
| CloudFront upload transfer toward origin          | 2 GB × India's USD 0.16/GB                               |         USD 0.3200 |
| CloudFront viewer delivery / requests / functions | Within available monthly allowances                      |         USD 0.0000 |
| **Planning total**                                | Variable workload above                                  | **about USD 3.90** |

Allow **USD 10 gross for the active day**, leaving room for variance. That allowance is below the verified USD 100 credits; it is not a guarantee that arbitrary public traffic is capped at USD 10. Credits offset eligible usage according to AWS's account terms. The deployment must remain on the Free plan; it does not authorize an upgrade or a paid subscription.

A daily gross-cost budget excludes credits and refunds, so credited usage remains visible. AWS Budgets is delayed observation rather than a real-time circuit breaker. No notification email, SNS recipient or other external message subscription is created.

## Costs after the host stops

If the 70 GiB disks and public IP remain for six further days, they add approximately **USD 2.00**. Image/data retention adds several further cents under the assumptions above, bringing a one-day run plus six days of retained infrastructure to roughly **USD 5.94** before tax/variance. The root disk and EIP are also retained on an EC2 stop. The retained data disk deliberately blocks accidental Terraform destruction.

After verification, explicitly choose whether to keep the deployment or export backups and remove it. The teardown runbook must address retained disks, bucket contents, images, the distribution and the IP, rather than reporting EC2 stop as complete cleanup. Automatic stopping is reversible; removal of the saved data requires the user's teardown decision.

## Delivery and trust choices

CloudFront uses pay-as-you-go pricing, an ACM certificate in `us-east-1`, private S3 frontend access through OAC, and an HTTPS EC2 origin. Static frontend files are cached. Authenticated API, tracker and media paths bypass the CDN cache. Media still passes a current PostgreSQL publication/ownership check; an unpublish affects subsequent HTTP reads without depending on a CDN invalidation delay. This first release does not claim cached public media or proven CDN bill savings.

The origin is `origin-peerscreen.darshpatel.dev`. Only CloudFront's managed origin-facing prefix list can reach origin HTTPS, and the gateway also checks a private origin header. HTTP port 80 is used for the free origin certificate's HTTP-01 issuance/renewal; SSH is limited to the operator's current IPv4 /32. The runtime roles are separate for catalogue, coordinator, worker and backups, using rotating temporary credentials. GitHub's build role is restricted to this repository's `main` ref and release image/frontend publication.

## Sources and rates

- [Mumbai EC2 official price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-south-1/index.json), publication 12 October 2026; [existing extracted rate record](../evidence/phase-5/aws-prices.json).
- [Mumbai S3 official price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-south-1/index.json), publication 12 October 2026: standard storage USD 0.025/GB-month, writes/listing USD 0.005/1,000, reads USD 0.0004/1,000.
- [Mumbai CloudWatch official price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-south-1/index.json), publication 7 October 2026: standard log ingestion USD 0.67/GB and storage USD 0.03/GB-month.
- [Public IPv4 pricing](https://aws.amazon.com/vpc/pricing/), [ECR pricing](https://aws.amazon.com/ecr/pricing/), [CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/).
- [Free-plan state API](https://docs.aws.amazon.com/cli/latest/reference/freetier/get-account-plan-state.html), [Free-plan FAQ](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-FAQ.html).

The private AWS environment/profile files and raw account responses stay outside Git. The public evidence records rates, eligibility and summarized resource/workload facts without credentials or the account ID.
