# ClickHouse runs on EC2-backed ECS for EBS persistent storage (high IOPS).
# Fargate only supports EFS which is too slow for ClickHouse's workload.

# ClickHouse credentials live in Secrets Manager so they never appear in
# `aws_ecs_task_definition.environment` plaintext (#35 — extends the redis
# pattern from #34). Both clickhouse and otel-collector tasks pull them via
# the ECS `secrets` array; the IAM execution role's
# `secretsmanager:GetSecretValue` permission scopes strictly to these ARNs
# (see `infra/ecs.tf::ecs_execution_secrets`). Username + password are
# separate secrets so rotation can swap one without churning the other.
resource "aws_secretsmanager_secret" "clickhouse_user" {
  name        = "${var.project_name}-clickhouse-user"
  description = "ClickHouse username (paired with clickhouse_password, #35)"
}

resource "aws_secretsmanager_secret_version" "clickhouse_user" {
  secret_id     = aws_secretsmanager_secret.clickhouse_user.id
  secret_string = var.clickhouse_user
}

resource "aws_secretsmanager_secret" "clickhouse_password" {
  name        = "${var.project_name}-clickhouse-password"
  description = "ClickHouse password for the otel user (#35)"
}

resource "aws_secretsmanager_secret_version" "clickhouse_password" {
  secret_id     = aws_secretsmanager_secret.clickhouse_password.id
  secret_string = var.clickhouse_password
}

resource "aws_service_discovery_service" "clickhouse" {
  name = "clickhouse"

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

# Launch template for the EC2 instance backing ClickHouse
resource "aws_launch_template" "clickhouse" {
  name_prefix   = "${var.project_name}-ch-"
  image_id      = data.aws_ssm_parameter.ecs_ami.value
  instance_type = var.clickhouse_instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.ecs_ec2.arn
  }

  vpc_security_group_ids = [aws_security_group.clickhouse.id]

  user_data = base64encode(<<-EOF
    #!/bin/bash
    echo ECS_CLUSTER=${aws_ecs_cluster.main.name} >> /etc/ecs/ecs.config
  EOF
  )

  block_device_mappings {
    device_name = "/dev/xvdf"

    ebs {
      volume_size           = var.clickhouse_ebs_size
      volume_type           = "gp3"
      iops                  = 3000
      throughput            = 125
      delete_on_termination = false
      encrypted             = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.project_name}-clickhouse"
    }
  }
}

data "aws_ssm_parameter" "ecs_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id"
}

resource "aws_iam_role" "ecs_ec2" {
  name = "${var.project_name}-ecs-ec2"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_ec2" {
  role       = aws_iam_role.ecs_ec2.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_instance_profile" "ecs_ec2" {
  name = "${var.project_name}-ecs-ec2-profile"
  role = aws_iam_role.ecs_ec2.name
}

resource "aws_autoscaling_group" "clickhouse" {
  name_prefix         = "${var.project_name}-ch-"
  desired_capacity    = 1
  max_size            = 1
  min_size            = 1
  vpc_zone_identifier = [aws_subnet.private[0].id]

  launch_template {
    id      = aws_launch_template.clickhouse.id
    version = "$Latest"
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = true
    propagate_at_launch = true
  }
}

resource "aws_ecs_capacity_provider" "clickhouse" {
  name = "${var.project_name}-ch-ec2"

  auto_scaling_group_provider {
    auto_scaling_group_arn = aws_autoscaling_group.clickhouse.arn

    managed_scaling {
      status          = "ENABLED"
      target_capacity = 100
    }
  }
}

resource "aws_ecs_task_definition" "clickhouse" {
  family                   = "${var.project_name}-clickhouse"
  requires_compatibilities = ["EC2"]
  network_mode             = "awsvpc"
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  volume {
    name      = "clickhouse-data"
    host_path = "/mnt/clickhouse"
  }

  container_definitions = jsonencode([{
    name      = "clickhouse"
    image     = "clickhouse/clickhouse-server:latest"
    essential = true
    cpu       = 0
    memory    = 3072

    portMappings = [
      { containerPort = 8123, hostPort = 8123, protocol = "tcp" },
      { containerPort = 9000, hostPort = 9000, protocol = "tcp" },
    ]

    environment = [
      { name = "CLICKHOUSE_DB", value = "default" },
    ]

    # ClickHouse credentials sourced from Secrets Manager (#35). The values
    # used to live in the `environment` array as plain `var.clickhouse_*`,
    # which leaked them via `ecs:DescribeTaskDefinition` and Terraform state.
    secrets = [
      {
        name      = "CLICKHOUSE_USER"
        valueFrom = aws_secretsmanager_secret.clickhouse_user.arn
      },
      {
        name      = "CLICKHOUSE_PASSWORD"
        valueFrom = aws_secretsmanager_secret.clickhouse_password.arn
      },
    ]

    mountPoints = [{
      sourceVolume  = "clickhouse-data"
      containerPath = "/var/lib/clickhouse"
      readOnly      = false
    }]

    ulimits = [{
      name      = "nofile"
      softLimit = 262144
      hardLimit = 262144
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "clickhouse"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget --spider -q localhost:8123/ping || exit 1"]
      interval    = 10
      timeout     = 5
      retries     = 5
      startPeriod = 30
    }
  }])
}

resource "aws_ecs_service" "clickhouse" {
  name            = "${var.project_name}-clickhouse"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.clickhouse.arn
  desired_count   = 1

  capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.clickhouse.name
    weight            = 1
    base              = 1
  }

  network_configuration {
    subnets         = [aws_subnet.private[0].id]
    security_groups = [aws_security_group.clickhouse.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.clickhouse.arn
  }
}
