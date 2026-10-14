output "public_ip" {
  value = aws_instance.app.public_ip
}
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
