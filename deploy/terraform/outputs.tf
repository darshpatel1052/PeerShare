output "public_ip" {
  value = aws_eip.app.public_ip
}
output "origin_domain" { value = "origin-${var.app_domain}" }
output "certificate_dns_records" {
  value = [for record in aws_acm_certificate.frontend.domain_validation_options : { name = record.resource_record_name, type = record.resource_record_type, value = record.resource_record_value }]
}
output "cloudfront_domain" { value = aws_cloudfront_distribution.frontend.domain_name }
output "cloudfront_id" { value = aws_cloudfront_distribution.frontend.id }
output "runtime_roles" { value = { for name, role in aws_iam_role.runtime : name => role.arn } }
output "build_role_arn" { value = aws_iam_role.build.arn }
output "app_domain" {
  value = var.app_domain
}
output "data_volume_id" {
  value = aws_ebs_volume.data.id
}
output "private_buckets" {
  value = { for key, bucket in aws_s3_bucket.storage : key => bucket.id }
}
output "image_repositories" {
  value = { for key, repository in aws_ecr_repository.images : key => repository.repository_url }
}
