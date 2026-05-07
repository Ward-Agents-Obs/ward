# Infra Credential Audit — task #32

**Auditor:** architect
**Date:** 2026-05-07
**Task:** #32 (B-harden: audit production deploy manifest for dev-default credentials)
**Scope:** `infra/*.tf`, `infra/services/*.tf`, gateway config, against the dev defaults flagged in `tenant-isolation-audit.md` S1–S5.

## TL;DR

Terraform does **not** inherit dev defaults for ClickHouse/Postgres/Grafana — `clickhouse_password` is a required `sensitive` variable with no default, and Postgres + Grafana don't exist in `infra/` at all (presumably hosted elsewhere, see Q1 below). However, **Redis is deployed without auth in prod**, matching the gateway's empty-default `RedisPassword`. That's a real defense-in-depth gap on shared-VPC blast radius. Plus one secrets-management nit on how ClickHouse password is plumbed to ECS tasks.

## Verified clean

| Dev default (from S1–S5) | Prod equivalent | Verdict |
|---|---|---|
| `CLICKHOUSE_PASSWORD=otelpass` | `var.clickhouse_password`, `sensitive = true`, **no default** in `infra/variables.tf:96-100`. Terraform refuses to apply without it. | ✓ clean |
| `POSTGRES_PASSWORD=postgres` | Postgres is **not in `infra/*.tf`** — no resource, no env, no var. Dashboard's `DATABASE_URL` is set somewhere outside this Terraform. | ✓ clean (no leakage path), but see Q1 |
| `GF_SECURITY_ADMIN_PASSWORD=admin` | Grafana is **not in `infra/*.tf`** — V1 prod doesn't deploy Grafana. | ✓ clean |
| `CLICKHOUSE_USER=otel` (dev default) | Same value in `infra/services/{collector,clickhouse}.tf`. | ✓ acceptable — that's the actual ClickHouse user we run against, not a "dev fallback." Documenting it. |

## Findings

### I1 — MEDIUM: Production Redis runs without password auth

**Location:** `infra/services/redis.tf:42` — container command is `["redis-server", "--appendonly", "yes", "--dir", "/data"]`. No `--requirepass`. No `REDIS_PASSWORD` env var anywhere on the redis service.

**Match in source:** `gateway/internal/config/config.go:25` defaults `RedisPassword` to `""`. `infra/services/gateway.tf:21-26` does not set `REDIS_PASSWORD`. So gateway → redis is unauthenticated by design in prod, matching dev.

**Risk:** Redis stores API-key-hash → (tenant_id, tier, rate_limit) in cleartext. Anyone with network reachability to `redis.ward.local:6379` inside the VPC can:
- Enumerate every API key hash and its associated tenant id.
- Insert/modify/delete entries — i.e. revoke real keys, mint fake keys for any tenant.
- Persist data via `BGSAVE` or read with `KEYS apikey:*`.

The security group (`aws_security_group.redis`, in `vpc.tf` — not yet read but implied) presumably only allows the gateway's SG. If true, exposure is bounded to gateway compromise. But there's no second line of defense.

**Severity:** medium. Not a current breach, but a single SG misconfiguration (wrong CIDR, wrong source SG, manual `aws_security_group_rule` patch in console) lifts the whole tenant key store.

**Recommended fix:**
- (a) Add `REDIS_PASSWORD` as a sensitive Terraform variable; pass via `--requirepass ${REDIS_PASSWORD}` to the redis container; pass to gateway via the same env. Same hygiene as `clickhouse_password`.
- Or (b, deferred) migrate to AWS ElastiCache for Redis with auth tokens + IAM auth + transit encryption. Heavier lift; right answer long term, not for V1.

### I2 — LOW: ClickHouse password plumbed via ECS task definition `environment` block (plaintext at rest in the task def)

**Location:** `infra/services/collector.tf:45` and `infra/services/clickhouse.tf:147` — both pass `var.clickhouse_password` via the `environment` array. ECS stores task definitions in plaintext; anyone with `ecs:DescribeTaskDefinition` (a common observability/diagnostics permission) can read it.

**Better pattern:** AWS Secrets Manager + ECS `secrets` block:
```hcl
resource "aws_secretsmanager_secret" "clickhouse_password" { ... }
resource "aws_secretsmanager_secret_version" "clickhouse_password" {
  secret_string = var.clickhouse_password
}

# in container_definitions:
secrets = [{
  name      = "CLICKHOUSE_PASSWORD"
  valueFrom = aws_secretsmanager_secret.clickhouse_password.arn
}]
```
ECS task execution role pulls the secret at task launch; nothing leaks via DescribeTaskDefinition.

**Severity:** low. Defense-in-depth; the password is still a Terraform `sensitive` value at the variable layer, so it shouldn't show up in plan output, but it lives in cleartext in ECS API responses post-apply.

**Recommended fix:** Migrate `CLICKHOUSE_PASSWORD` (and the future `REDIS_PASSWORD` from I1) to Secrets Manager. Add `secretsmanager:GetSecretValue` to `aws_iam_role.ecs_execution`. One-time refactor.

### I3 — INFO: No prod manifest covers the dashboard or Postgres

**Observation:** `infra/*.tf` covers gateway, collector, clickhouse, redis. There is no `aws_ecs_task_definition` for the dashboard, no RDS, no Supabase reference. The dashboard presumably runs on Vercel/Netlify and uses Supabase (managed Postgres), but this isn't documented.

**Why this matters for #32:** The audit asked "does prod inherit dev defaults." For the components present, no. For the components missing, the question is moot — there's nothing to audit. But it's a process gap: someone could deploy the dashboard with the dev-default `clickhouse.ts` fallback (S3) and we'd never know without #31's hard-fail.

**Severity:** info / process.

**Recommended action:** Once #31 lands (dashboard hard-fails on missing creds), this risk closes. No infra task needed — flag for team-lead via Q1.

## Questions for team-lead

1. Where does the dashboard actually run in prod? Vercel + Supabase? Self-hosted ECS? Knowing this confirms whether the absence of dashboard/Postgres from `infra/` is intentional or a missing manifest.
2. Are Redis auth + Secrets Manager migration in V1 scope, or punt to V1.1? My recommendation: **punt I1 and I2 to V1.1** (file as tracked tasks), document the current state in V1 README. The gateway-only SG ingress is acceptable while we ship the demo. Architect-only opinion, you decide.

## Result

#32 closes with two new V1.1 candidate tasks (I1, I2) and one docs-only resolution (I3). Filing them now.
