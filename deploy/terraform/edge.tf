resource "aws_acm_certificate" "frontend" {
  provider          = aws.edge
  domain_name       = var.app_domain
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}
resource "aws_acm_certificate_validation" "frontend" {
  provider                = aws.edge
  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for record in aws_acm_certificate.frontend.domain_validation_options : record.resource_record_name]
  timeouts { create = "45m" }
}
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.name}-frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_cache_policy" "static" {
  name        = "${var.name}-static"
  default_ttl = 60
  min_ttl     = 0
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}
resource "aws_cloudfront_cache_policy" "dynamic" {
  name        = "${var.name}-dynamic"
  default_ttl = 0
  min_ttl     = 0
  max_ttl     = 0
  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}
resource "aws_cloudfront_origin_request_policy" "application" {
  name = "${var.name}-application"
  cookies_config { cookie_behavior = "all" }
  query_strings_config { query_string_behavior = "all" }
  headers_config {
    header_behavior = "whitelist"
    # Stay within the default ten-header quota. The tracker uses no subprotocol
    # or compression extension; cookies/query strings are forwarded separately.
    headers { items = ["Content-Type", "Origin", "Idempotency-Key", "If-Match", "Upload-Token", "Playback-Token", "Cache-Control", "CloudFront-Viewer-Address", "Sec-WebSocket-Key", "Sec-WebSocket-Version"] }
  }
}
resource "aws_cloudfront_function" "static_routes" {
  name    = "${var.name}-static-routes"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
  function handler(event) {
    var request = event.request;
    if (request.uri.endsWith('/')) request.uri += 'index.html';
    else if (request.uri.indexOf('.') === -1) request.uri += '/index.html';
    return request;
  }
  JS
}
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  comment             = "PeerScreen bounded showcase: static CDN and uncached authorized media/API"
  aliases             = [var.app_domain]
  price_class         = "PriceClass_All"
  is_ipv6_enabled     = true
  wait_for_deployment = true
  origin {
    domain_name              = aws_s3_bucket.storage["frontend"].bucket_regional_domain_name
    origin_id                = "frontend"
    origin_path              = "/releases/${var.release_sha}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }
  origin {
    domain_name              = aws_s3_bucket.storage["frontend"].bucket_regional_domain_name
    origin_id                = "assets"
    origin_path              = "/assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }
  origin {
    domain_name = "origin-${var.app_domain}"
    origin_id   = "application"
    custom_header {
      name  = "X-PeerScreen-Origin"
      value = var.origin_secret
    }
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 10
    }
  }
  default_cache_behavior {
    target_origin_id       = "frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.static.id
    compress               = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.static_routes.arn
    }
  }
  ordered_cache_behavior {
    path_pattern           = "/_next/*"
    target_origin_id       = "assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.static.id
    compress               = true
  }
  dynamic "ordered_cache_behavior" {
    for_each = ["/api/*", "/media/*", "/tracker*", "/health/*"]
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = "application"
      viewer_protocol_policy   = "https-only"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = aws_cloudfront_cache_policy.dynamic.id
      origin_request_policy_id = aws_cloudfront_origin_request_policy.application.id
      compress                 = false
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.frontend.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
resource "aws_s3_bucket_policy" "storage" {
  for_each = { for key, bucket in aws_s3_bucket.storage : key => bucket if key != "frontend" }
  bucket   = each.value.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [each.value.arn, "${each.value.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.storage["frontend"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.storage["frontend"].arn, "${aws_s3_bucket.storage["frontend"].arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject", Resource = ["${aws_s3_bucket.storage["frontend"].arn}/releases/*", "${aws_s3_bucket.storage["frontend"].arn}/assets/*"], Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn } } }
  ] })
}
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.storage["backups"].id
  rule {
    id     = "bounded-backup-retention"
    status = "Enabled"
    filter { prefix = "snapshots/" }
    expiration { days = 7 }
  }
}
resource "aws_budgets_budget" "daily" {
  name         = "${var.name}-daily-gross"
  budget_type  = "COST"
  limit_amount = "10"
  limit_unit   = "USD"
  time_unit    = "DAILY"
  cost_types {
    include_credit = false
    include_refund = false
  }
}
