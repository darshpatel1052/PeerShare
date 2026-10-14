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
variable "admin_cidr" {
  type = string
  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && can(regex("/32$", var.admin_cidr))
    error_message = "SSH administration requires your current IPv4 /32; broad SSH access is not allowed."
  }
}
variable "ssh_key_name" {
  type        = string
  description = "An existing EC2 key pair in Mumbai. No private key enters Terraform."
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
