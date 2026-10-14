locals {
  runtime_names     = toset(["catalogue", "coordinator", "worker", "backup"])
  original_objects  = "${aws_s3_bucket.storage["originals"].arn}/*"
  processed_objects = "${aws_s3_bucket.storage["processed"].arn}/*"
}

resource "aws_iam_role" "host" {
  name               = "${var.name}-host"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_instance_profile" "host" {
  name = "${var.name}-host"
  role = aws_iam_role.host.name
}
resource "aws_iam_role" "runtime" {
  for_each             = local.runtime_names
  name                 = "${var.name}-${each.key}"
  max_session_duration = 3600
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { AWS = aws_iam_role.host.arn }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "host" {
  role = aws_iam_role.host.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["sts:AssumeRole"], Resource = [for role in aws_iam_role.runtime : role.arn] },
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = [for repo in aws_ecr_repository.images : repo.arn] },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.app.arn}:*" }
  ] })
}
resource "aws_iam_role_policy" "catalogue" {
  role = aws_iam_role.runtime["catalogue"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.storage["originals"].arn, aws_s3_bucket.storage["processed"].arn] },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = local.original_objects },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:DeleteObject"], Resource = local.processed_objects },
    { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.storage["processed"].arn}/images/*" }
  ] })
}
resource "aws_iam_role_policy" "worker" {
  role = aws_iam_role.runtime["worker"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.storage["originals"].arn}/sources/*" },
    { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.storage["processed"].arn}/videos/*" }
  ] })
}
resource "aws_iam_role_policy" "coordinator" {
  role = aws_iam_role.runtime["coordinator"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.storage["processed"].arn}/videos/*" }
  ] })
}
resource "aws_iam_role_policy" "backup" {
  role = aws_iam_role.runtime["backup"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.storage["originals"].arn, aws_s3_bucket.storage["processed"].arn, aws_s3_bucket.storage["backups"].arn] },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = [local.original_objects, local.processed_objects] },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.storage["backups"].arn}/*" }
  ] })
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}
resource "aws_iam_role" "build" {
  name = "${var.name}-github-build"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "sts:AssumeRoleWithWebIdentity", Principal = { Federated = aws_iam_openid_connect_provider.github.arn },
    # This repository uses GitHub's immutable subject format. IDs are verified
    # through its OIDC customization endpoint; name-only subjects are rejected.
    Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com", "token.actions.githubusercontent.com:sub" = "repo:darshpatel1052@147577241/Peer-Screen@1416673812:ref:refs/heads/main" } }
  }] })
}
resource "aws_iam_role_policy" "build" {
  role = aws_iam_role.build.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:DescribeImages", "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage"], Resource = [for repo in aws_ecr_repository.images : repo.arn] },
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.storage["frontend"].arn },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${aws_s3_bucket.storage["frontend"].arn}/releases/*", "${aws_s3_bucket.storage["frontend"].arn}/assets/*"] }
  ] })
}
