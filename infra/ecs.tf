resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 1
    capacity_provider = "FARGATE"
  }
}

# Shared execution role for all ECS tasks
resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Custom inline policy granting `secretsmanager:GetSecretValue` on the
# specific secret ARNs the ECS tasks reference via their `secrets` arrays.
# Started in #34 with the Redis password; #35 extended it with the
# ClickHouse credentials (paired user + password), the collector-auth
# bearer token, and the gateway's Postgres DSN. The remaining plaintext
# task `environment` entries (CLICKHOUSE_DB, REDIS_ADDR, etc.) are
# non-credential configuration and stay in the open.
#
# Scoped to the exact secret ARNs (not `arn:aws:secretsmanager:*:*:*`) so
# a future task that accidentally lands on this shared role can't read
# unrelated secrets in the account.
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${var.project_name}-ecs-execution-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.redis_password.arn,
        aws_secretsmanager_secret.clickhouse_user.arn,
        aws_secretsmanager_secret.clickhouse_password.arn,
        aws_secretsmanager_secret.collector_auth_token.arn,
        aws_secretsmanager_secret.gateway_database_url.arn,
      ]
    }]
  })
}

# Task role for services that need AWS API access
resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# CloudWatch log group for all services
resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${var.project_name}"
  retention_in_days = 30
}

# Service Discovery namespace (internal DNS for service-to-service communication)
resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${var.project_name}.local"
  vpc  = aws_vpc.main.id
}
