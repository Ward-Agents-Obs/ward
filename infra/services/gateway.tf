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
      # Shared secret with the otel-collector's bearertokenauth extension.
      # The gateway refuses to start without it (#25). Today plumbed via env;
      # #35 migrates this and `clickhouse_password` to ECS `secrets` array
      # sourced from AWS Secrets Manager.
      { name = "COLLECTOR_AUTH_TOKEN", value = var.collector_auth_token },
      # Postgres DSN for the startup API-key hydrate pass (#26). Empty
      # disables hydrate; the gateway then runs in Redis-only mode and
      # loses the Postgres↔Redis convergence guard. Same Secrets Manager
      # trajectory as the other secrets here — see #35.
      { name = "DATABASE_URL", value = var.gateway_database_url },
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
