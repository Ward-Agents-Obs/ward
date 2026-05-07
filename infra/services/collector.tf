# Shared collector-auth bearer token. Lives in Secrets Manager (#35) so it
# never appears in either gateway or collector ECS task definition `environment`
# blocks. Declared here on the collector side because the collector is the
# enforcement point — the `bearertokenauth` extension validates inbound
# tokens against this value; the gateway just sets the matching header.
# Both task defs reference this same ARN via Terraform module-level resolution.
resource "aws_secretsmanager_secret" "collector_auth_token" {
  name        = "${var.project_name}-collector-auth-token"
  description = "Bearer token shared between gateway and otel-collector (#25, migrated to Secrets Manager in #35)"
}

resource "aws_secretsmanager_secret_version" "collector_auth_token" {
  secret_id     = aws_secretsmanager_secret.collector_auth_token.id
  secret_string = var.collector_auth_token
}

resource "aws_service_discovery_service" "collector" {
  name = "collector"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_ecs_task_definition" "collector" {
  family                   = "${var.project_name}-collector"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.collector_cpu
  memory                   = var.collector_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([{
    name      = "collector"
    image     = "otel/opentelemetry-collector-contrib:latest"
    essential = true

    command = ["--config=/etc/otel-collector-config.yaml"]

    portMappings = [
      { containerPort = 4317, hostPort = 4317, protocol = "tcp" },
      { containerPort = 4318, hostPort = 4318, protocol = "tcp" },
      { containerPort = 13133, hostPort = 13133, protocol = "tcp" },
    ]

    environment = [
      { name = "CLICKHOUSE_HOST", value = "clickhouse.${var.project_name}.local" },
      { name = "CLICKHOUSE_DATABASE", value = "default" },
    ]

    # All three secrets injected via Secrets Manager (#35). The OTel
    # Collector's clickhouse exporter reads CLICKHOUSE_USERNAME (note: the
    # collector exporter uses `_USERNAME` whereas clickhouse-server itself
    # reads `_USER` — different env name, same underlying secret). The
    # bearertokenauth extension reads COLLECTOR_AUTH_TOKEN.
    secrets = [
      {
        name      = "CLICKHOUSE_USERNAME"
        valueFrom = aws_secretsmanager_secret.clickhouse_user.arn
      },
      {
        name      = "CLICKHOUSE_PASSWORD"
        valueFrom = aws_secretsmanager_secret.clickhouse_password.arn
      },
      {
        name      = "COLLECTOR_AUTH_TOKEN"
        valueFrom = aws_secretsmanager_secret.collector_auth_token.arn
      },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "collector"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget --spider -q http://127.0.0.1:13133 || exit 1"]
      interval    = 10
      timeout     = 5
      retries     = 5
      startPeriod = 15
    }
  }])
}

resource "aws_ecs_service" "collector" {
  name            = "${var.project_name}-collector"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.collector.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.collector.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.collector.arn
  }
}
