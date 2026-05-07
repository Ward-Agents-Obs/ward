# Postgres DSN for the gateway's #26 hydrate. Migrated to Secrets Manager
# in #35 — DSN strings often embed credentials (`postgresql://user:pass@…`)
# so they get the same treatment as the rest of the secret pile. When
# `var.gateway_database_url` is empty (default — disables hydrate per #26),
# the secret_version is created with empty contents; the gateway's
# `runHydrate` self-disables at runtime when DATABASE_URL == "".
resource "aws_secretsmanager_secret" "gateway_database_url" {
  name        = "${var.project_name}-gateway-database-url"
  description = "Postgres DSN for the gateway's API-key hydrate (#26, migrated in #35)"
}

resource "aws_secretsmanager_secret_version" "gateway_database_url" {
  secret_id     = aws_secretsmanager_secret.gateway_database_url.id
  secret_string = var.gateway_database_url
}

resource "aws_ecs_task_definition" "gateway" {
  family                   = "${var.project_name}-gateway"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.gateway_cpu
  memory                   = var.gateway_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "gateway"
    image     = var.gateway_image
    essential = true

    portMappings = [{
      containerPort = 8080
      hostPort      = 8080
      protocol      = "tcp"
    }]

    environment = [
      { name = "GATEWAY_PORT", value = "8080" },
      { name = "COLLECTOR_ADDR", value = "http://collector.${var.project_name}.local:4318" },
      { name = "REDIS_ADDR", value = "redis.${var.project_name}.local:6379" },
      { name = "DEFAULT_RATE_LIMIT", value = tostring(var.gateway_default_rate_limit) },
    ]

    # All three runtime secrets sourced from Secrets Manager — #34 brought
    # `REDIS_PASSWORD` over, #35 finished the sweep with `COLLECTOR_AUTH_TOKEN`
    # and `DATABASE_URL`. Nothing credential-shaped survives in the
    # `environment` block above. The gateway's `cmd/gateway/main.go` and
    # `internal/config/config.go::requireEnv()` hard-fail at boot if
    # REDIS_PASSWORD or COLLECTOR_AUTH_TOKEN is empty; an operator
    # misconfig that leaves the upstream task running anonymously surfaces
    # immediately rather than as a silent compromise.
    #
    # `DATABASE_URL` is allowed-empty by design (#26) — when the var is
    # unset the secret_version stores an empty string, the env injects an
    # empty value, and `runHydrate` self-disables. Operators who want
    # hydrate must populate `var.gateway_database_url`.
    secrets = [
      {
        name      = "REDIS_PASSWORD"
        valueFrom = aws_secretsmanager_secret.redis_password.arn
      },
      {
        name      = "COLLECTOR_AUTH_TOKEN"
        valueFrom = aws_secretsmanager_secret.collector_auth_token.arn
      },
      {
        name      = "DATABASE_URL"
        valueFrom = aws_secretsmanager_secret.gateway_database_url.arn
      },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "gateway"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget --spider -q http://localhost:8080/health || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 10
    }
  }])
}

resource "aws_ecs_service" "gateway" {
  name            = "${var.project_name}-gateway"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.gateway.arn
  desired_count   = var.gateway_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.gateway.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.gateway.arn
    container_name   = "gateway"
    container_port   = 8080
  }

  depends_on = [aws_lb_listener.http]
}

# Auto-scaling for the gateway
resource "aws_appautoscaling_target" "gateway" {
  max_capacity       = 10
  min_capacity       = var.gateway_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.gateway.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "gateway_cpu" {
  name               = "${var.project_name}-gateway-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.gateway.resource_id
  scalable_dimension = aws_appautoscaling_target.gateway.scalable_dimension
  service_namespace  = aws_appautoscaling_target.gateway.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
