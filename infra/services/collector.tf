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
      { name = "CLICKHOUSE_USERNAME", value = "otel" },
      { name = "CLICKHOUSE_PASSWORD", value = var.clickhouse_password },
      # Must match the gateway's COLLECTOR_AUTH_TOKEN. The bearertokenauth
      # extension verifies inbound OTLP requests against this value (#25).
      # See `clickhouse_password` note above re: #35 secrets-manager migration.
      { name = "COLLECTOR_AUTH_TOKEN", value = var.collector_auth_token },
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
