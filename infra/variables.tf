variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "ward"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "gateway_image" {
  description = "Docker image URI for the gateway (ECR)"
  type        = string
}

variable "gateway_cpu" {
  description = "Fargate CPU units for gateway (1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "gateway_memory" {
  description = "Fargate memory (MiB) for gateway"
  type        = number
  default     = 1024
}

variable "gateway_desired_count" {
  description = "Desired number of gateway tasks"
  type        = number
  default     = 2
}

variable "gateway_default_rate_limit" {
  description = "Default rate limit (spans/min) for API keys"
  type        = number
  default     = 10000
}

variable "collector_cpu" {
  description = "Fargate CPU units for OTel Collector"
  type        = number
  default     = 512
}

variable "collector_memory" {
  description = "Fargate memory (MiB) for OTel Collector"
  type        = number
  default     = 1024
}

variable "redis_cpu" {
  description = "Fargate CPU units for Redis"
  type        = number
  default     = 256
}

variable "redis_memory" {
  description = "Fargate memory (MiB) for Redis"
  type        = number
  default     = 512
}

variable "clickhouse_instance_type" {
  description = "EC2 instance type for ClickHouse"
  type        = string
  default     = "r6i.large"
}

variable "clickhouse_ebs_size" {
  description = "EBS volume size in GB for ClickHouse data"
  type        = number
  default     = 100
}

variable "clickhouse_password" {
  description = "ClickHouse password for the otel user"
  type        = string
  sensitive   = true
}

variable "collector_auth_token" {
  description = <<-EOT
    Shared bearer-token secret between the Go gateway and the OTel Collector
    (defense-in-depth on the collector socket — see #25 / `.agents/tenant-
    isolation-audit.md`). Both task definitions read this from
    COLLECTOR_AUTH_TOKEN and refuse to start without it.

    Generate with `openssl rand -hex 32`. **Operational note:** today this
    value is plumbed via the ECS task definition `environment` array, which
    matches how `clickhouse_password` ships. #35 will migrate both to the
    ECS `secrets` array sourced from AWS Secrets Manager.
  EOT
  type      = string
  sensitive = true
}

variable "domain_name" {
  description = "Domain name for the gateway (e.g. ingest.ward.dev). Leave empty to skip DNS."
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for the domain. Required if domain_name is set."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate ARN for TLS on ALB. Required if domain_name is set."
  type        = string
  default     = ""
}
