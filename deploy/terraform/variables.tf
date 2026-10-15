variable "region" {
  type    = string
  default = "ap-south-1"
  validation {
    condition     = var.region == "ap-south-1"
    error_message = "This initial worksheet and deployment target Mumbai. Re-cost before choosing another region."
  }
}
variable "app_domain" {
  type    = string
  default = "peerscreen.darshpatel.dev"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", var.app_domain))
    error_message = "Use a DNS hostname, without a scheme or path."
  }
}
variable "enable_cloudfront" {
  type        = bool
  default     = true
  description = "Use CloudFront after account approval; false serves the same public domain directly over HTTPS."
}
variable "admin_cidr" {
  type = string
  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && can(regex("/32$", var.admin_cidr))
    error_message = "SSH administration requires your current IPv4 /32."
  }
}
variable "ssh_key_name" {
  type        = string
  default     = "peerscreen-showcase"
  description = "The deployment key pair name. Only its public key enters Terraform."
}
variable "ssh_public_key" { type = string }
variable "origin_secret" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[a-f0-9]{64}$", var.origin_secret))
    error_message = "Use a freshly generated 32-byte origin secret."
  }
}
variable "release_sha" {
  type    = string
  default = "bootstrap"
  validation {
    condition     = var.release_sha == "bootstrap" || can(regex("^[a-f0-9]{40}$", var.release_sha))
    error_message = "Use the complete release commit SHA."
  }
}
variable "demo_hours" {
  type    = number
  default = 24
  validation {
    condition     = var.demo_hours >= 1 && var.demo_hours <= 72 && floor(var.demo_hours) == var.demo_hours
    error_message = "The initial demo is bounded to 1–72 hours."
  }
}
variable "instance_type" {
  type    = string
  default = "m7i-flex.large"
  validation {
    condition     = var.instance_type == "m7i-flex.large"
    error_message = "The current worksheet prices m7i-flex.large. Re-cost other types."
  }
}
variable "name" {
  type    = string
  default = "peerscreen-showcase"
}
variable "root_gib" {
  type    = number
  default = 30
  validation {
    condition     = var.root_gib >= 20 && var.root_gib <= 30
    error_message = "The initial root disk is bounded to 20–30 GiB."
  }
}
variable "data_gib" {
  type    = number
  default = 40
  validation {
    condition     = var.data_gib >= 30 && var.data_gib <= 40
    error_message = "The initial persistent disk is bounded to 30–40 GiB."
  }
}
