terraform {
  required_version = "= 1.16.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.68.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "PeerScreen", ManagedBy = "Terraform", Environment = "showcase" }
  }
}

provider "aws" {
  alias  = "edge"
  region = "us-east-1"
  default_tags { tags = { Project = "PeerScreen", ManagedBy = "Terraform", Environment = "showcase" } }
}
