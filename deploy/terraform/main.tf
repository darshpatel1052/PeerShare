data "aws_availability_zones" "available" {
  state = "available"
}
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}
data "aws_caller_identity" "current" {}

resource "aws_vpc" "app" {
  cidr_block           = "10.86.0.0/24"
  enable_dns_support   = true
  enable_dns_hostnames = true
}
resource "aws_subnet" "app" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.86.0.0/25"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
}
resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id
}
resource "aws_route_table" "app" {
  vpc_id = aws_vpc.app.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app.id
  }
}
resource "aws_route_table_association" "app" {
  subnet_id      = aws_subnet.app.id
  route_table_id = aws_route_table.app.id
}
resource "aws_security_group" "app" {
  name   = var.name
  vpc_id = aws_vpc.app.id
}
resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.app.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
data "aws_ec2_managed_prefix_list" "cloudfront" { name = "com.amazonaws.global.cloudfront.origin-facing" }
resource "aws_key_pair" "admin" {
  key_name   = var.ssh_key_name
  public_key = var.ssh_public_key
}
resource "aws_vpc_security_group_ingress_rule" "acme" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP-01 certificate issuance and renewal for the origin hostname."
}
resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = var.admin_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}
resource "aws_vpc_security_group_egress_rule" "outbound" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.app.availability_zone
  size              = var.data_gib
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${var.name}-data" }
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_instance" "app" {
  ami                                  = data.aws_ssm_parameter.ubuntu.value
  instance_type                        = var.instance_type
  key_name                             = aws_key_pair.admin.key_name
  iam_instance_profile                 = aws_iam_instance_profile.host.name
  subnet_id                            = aws_subnet.app.id
  vpc_security_group_ids               = [aws_security_group.app.id]
  associate_public_ip_address          = true
  instance_initiated_shutdown_behavior = "stop"
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_size           = var.root_gib
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }
  user_data                   = templatefile("${path.module}/bootstrap.sh.tftpl", { volume_id = replace(aws_ebs_volume.data.id, "-", ""), demo_hours = var.demo_hours })
  user_data_replace_on_change = true
  tags                        = { Name = var.name, ApplicationDomain = var.app_domain }
}
resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "${var.name}-origin" }
}
resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id
}

# Browser access stays behind the catalogue's publication/ownership checks.
resource "aws_s3_bucket" "storage" {
  for_each      = toset(["originals", "processed", "frontend", "backups"])
  bucket        = "${var.name}-${data.aws_caller_identity.current.account_id}-${each.key}"
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "storage" {
  for_each                = aws_s3_bucket.storage
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "storage" {
  for_each = aws_s3_bucket.storage
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "originals" {
  bucket = aws_s3_bucket.storage["originals"].id
  rule {
    id     = "abandoned-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
resource "aws_ecr_repository" "images" {
  for_each             = toset(["api", "web"])
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}
resource "aws_ecr_lifecycle_policy" "images" {
  for_each   = aws_ecr_repository.images
  repository = each.value.name
  policy     = jsonencode({ rules = [{ rulePriority = 1, description = "Retain five release images", selection = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }, action = { type = "expire" } }] })
}
resource "aws_cloudwatch_log_group" "app" {
  name              = "/peerscreen/showcase"
  retention_in_days = 7
}
