# Tenant Isolation Audit — End-to-End

**Auditor:** debug-expert
**Date:** 2026-05-06
**Task:** #2 (End-to-end tenant isolation audit)
**Stack tested:** local docker-compose (gateway, otel-collector, clickhouse, redis, postgres, dashboard)

## Scope

Tracing one fictional request from SDK → gateway → collector → ClickHouse → dashboard, verifying that `ward.tenant_id` is enforced at every hop, that a malicious SDK client cannot spoof another tenant's ID, and that the dashboard never leaks across tenants. Also verified the onboarding flow (signup → org creation → API key issuance → first trace appears).

## TL;DR

The **server-side tenant injection** in the gateway is **correct and enforced** — confirmed by adversarial probe (see Verified). The **dashboard's read path** consistently funnels every ClickHouse query through `requireTenantId(org.tenantId)` with `org` derived from the Supabase-authenticated user, so cross-tenant reads are not possible without bypassing Prisma.

**However, the onboarding flow is broken in three independent ways** that prevent any new user from getting a first trace into the dashboard, and there are several **defense-in-depth gaps** worth fixing before V1 ships.

---

## Verified (working as designed)

### V1. Gateway overwrites spoofed `ward.tenant_id` in resource attributes
- **File:** `gateway/internal/proxy/proxy.go:81-109`
- **Test:** Sent OTLP payloads using `audit_tenant_alpha`'s API key with the resource attribute `ward.tenant_id` set to (a) `audit_tenant_beta`, (b) `evil_tenant`. ClickHouse showed all spans stamped with `audit_tenant_alpha` regardless of payload contents. `upsertStringAttribute` correctly mutates an existing key in-place rather than appending a duplicate.
- **Result:** `audit_tenant_alpha` appears for all three test markers. ✓

### V2. Gateway handles missing/nil `Resource` and multiple `ResourceSpans`
- **Test:** Sent two `ResourceSpans` in one request — one spoofing `audit_tenant_beta`, one with `resource = nil`. Both ended up under `audit_tenant_alpha` in ClickHouse.
- **Result:** Iteration over `req.GetResourceSpans()` allocates a fresh `Resource` when nil, then upserts. ✓

### V3. OTel Collector is not exposed on the host
- **File:** `docker-compose.yaml` collector service uses `expose:` (intra-network only), not `ports:`.
- **Test:** `curl http://localhost:4318/v1/traces` → connection refused.
- **Result:** ✓ No host bypass route in dev.

### V4. Authentication rejects invalid / missing keys
- **Test:** `Authorization: Bearer ak_live_invalid_…` → 401. No `Authorization` header → 401. Empty bearer → 401.
- **File:** `gateway/internal/middleware/auth.go:21-37` + `gateway/internal/auth/auth.go:28-57`. ✓

### V5. Dashboard read path is uniformly tenant-scoped
- Every page under `dashboard/src/app/(dashboard)/**` resolves the org via `getOrCreateOrg()` (which itself uses Supabase server-side cookie auth and `prisma.orgMember.findFirst({ authUserId })`), short-circuits with `<TenantContextFallback />` when missing, and forwards `org.tenantId` to query helpers.
- Every helper in `dashboard/src/lib/queries/{overview,traces,sessions,costs}.ts` calls `requireTenantId(tenantId)` and parameterises ClickHouse queries with `{tenantId:String}`. No string interpolation; no path takes `tenantId` from URL/searchParams. ✓

### V6. Hashes are consistent between dashboard issuance and gateway lookup
- Both `dashboard/src/lib/api-keys.ts:13-15` and `gateway/internal/auth/auth.go:23-26` SHA-256 the plaintext key with no salt and store under `apikey:<hex>`. Confirmed by seeding via `gateway/cmd/seed` and re-using through the SDK ✓.

---

## Findings

### F1 — CRITICAL: Hardcoded plaintext API key checked into the repo
- **Location (initial):** `scripts/test.py:10`, plus `scripts/test_session.py:11`, `scripts/load_test.py:46`, `scripts/verify_metrics.py:42`, `scripts/simulate_customer_journey.py:42`, `scripts/test_comprehensive_workflows.py:36`, `scripts/generate_test_data.py:38`, and as a fallback in `setup_test_environment.sh:161`.
- **Key:** `<leaked-key>` — sha256 = `e6f4b95838cd9f24e850ad7f6c7f1792ae923228fe922c0c73233564c938fe98`.
- **Severity:** **critical** (flagged to team-lead before any audit writes).
- **Reproduction:** `git log --all -S '<leaked-key>'` shows it introduced at commits `d5770d1` and `0ae6fa2` (still in history).
- **Status (2026-05-07):** team-lead patched `scripts/test.py` and `setup_test_environment.sh` (and apparently the other six scripts — confirmed by re-grep, no remaining literal occurrences in tracked source). Local stack confirmed clean: Postgres `api_keys` table doesn't exist (migrations unapplied — see F5) and Redis has no entry for `apikey:e6f4b958…`. **History retention remains:** the literal is still readable in `git show 0ae6fa2` and `d5770d1`. User decision pending on history rewrite vs. server-side revocation in production.
- **Recommended fix (still open):**
  1. Confirm revocation in any production-shaped Postgres/Redis pair (the local stack has nothing to flip).
  2. Add a pre-commit hook (`gitleaks` or similar) and a CI regex for `ak_live_[0-9a-f]{32}` so this can't recur.
  3. If history rewrite is on the table, do it before any public release; otherwise treat the value in history as permanently compromised and ensure server-side revocation is permanent.

### F2 — CRITICAL: SDK onboarding snippet uses the wrong header
- **Location:** `dashboard/src/components/sdk-onboarding.tsx:31` (Python) and `:53` (Node).
- **Symptom:** Snippet emits `otlp_headers={"x-api-key": "..."}`. The gateway only reads `Authorization: Bearer …` (`gateway/internal/middleware/auth.go:22`), so the very first SDK call from a new user returns 401.
- **Severity:** **critical** (blocks first-trace experience).
- **Reproduction:** `curl -i -H "x-api-key: ak_live_…" http://localhost:8080/v1/traces` → 401.
- **Recommended fix:** Replace both header forms with `{"Authorization": f"Bearer {apiKey}"}` / `{"Authorization": \`Bearer ${apiKey}\`}` to match `dashboard/src/app/(dashboard)/settings/page.tsx:66` and the gateway seed CLI's example.
- **Cross-ref:** Already filed as task #8 (B5).

### F3 — CRITICAL: SDK onboarding snippet points at the collector port, not the gateway
- **Location:** `dashboard/src/components/sdk-onboarding.tsx:16-18`.
- **Symptom:** In development the snippet sets `otlp_endpoint = "http://localhost:4318"`. Port 4318 is the **otel-collector** which (a) is not bound to the host in `docker-compose.yaml`, so localhost connections fail, and (b) even if exposed, would skip the gateway entirely — which means `ward.tenant_id` would not be injected and there is no auth.
- **Severity:** **critical** (any new user copy-pasting this gets connection-refused).
- **Recommended fix:** Use `http://localhost:8080` (gateway) in dev and the public ingress (e.g. `https://ingest.ward.dev`) in prod. Keep the collector strictly internal.

### F4 — HIGH: Onboarding shows the truncated key prefix as if it were the full key
- **Location:** `dashboard/src/app/(dashboard)/projects/[projectSlug]/page.tsx:33` passes `apiKey={apiKeys?.keyPrefix}`. `keyPrefix` is the value built in `dashboard/src/lib/api-keys.ts:9` — `plain.slice(0, 12) + "..."`, e.g. `ak_live_abcd...`. The plaintext is only ever returned once at creation (`actions.ts:28`).
- **Symptom:** First-time users with no traces but at least one issued key will see the snippet pre-filled with `ak_live_abcd...` and submit it; the gateway's SHA-256 lookup then misses → 401.
- **Severity:** **high** (silent failure that looks like a working onboarding).
- **Recommended fix:** Either (a) drop the auto-fill and force users to paste from the keys page, or (b) link out to `/settings/keys` to copy the plain key on creation. Do **not** persist the plain key.

### F5 — HIGH: Migrations not applied means `getOrCreateOrg` silently degrades to "no tenant"
- **Location:** `dashboard/src/lib/org.ts:13-26, 71-77`.
- **Symptom:** On the running stack, `\dt` in Postgres shows zero relations. `getOrCreateOrg` catches `P1001`/`P2021` and returns `null`, which means every dashboard page renders the `<TenantContextFallback />` instead of the real UI. There is no startup migration step in `docker-compose.yaml`'s `dashboard` service definition; `prisma migrate deploy` is not run anywhere.
- **Severity:** **high** (the local stack and any future fresh deploy is broken until somebody manually runs Prisma migrations).
- **Recommended fix:** Add `prisma migrate deploy` either as a Dockerfile entrypoint pre-step or as a one-shot init container in compose. Confirm the production deploy pipeline does the same.

### F6 — MEDIUM: Collector accepts unauthenticated OTLP traffic on its private network
- **Location:** `configs/otel-collector-config.yaml:1-7` — `otlp` receiver binds `0.0.0.0:4317/4318` with no auth extension.
- **Symptom:** Today this is fine because the collector is `expose:`-only and only the gateway sits in front. But in production any sibling pod / service mesh leak / misconfigured ingress that can reach 4317/4318 can publish spans for any `ward.tenant_id` because there's no auth processor and the gateway is the only thing enforcing tenant injection.
- **Severity:** **medium** (defense-in-depth; no current exposure but one config slip away from being critical).
- **Recommended fix:** (a) Bind the collector listener to the gateway's network namespace only (NetworkPolicy in k8s, or 127.0.0.1-only in compose), and/or (b) require a shared-secret header with the OTel `bearertokenauth` extension between gateway and collector and reject any other source.

### F7 — MEDIUM: Postgres `api_keys` is the source of truth but Redis is the only thing the gateway consults
- **Location:** `dashboard/src/app/(dashboard)/settings/keys/actions.ts:9-29` writes to both stores; `gateway/internal/auth/auth.go:28` only reads Redis.
- **Symptom 1:** If `syncKeyToRedis` fails after `prisma.apiKey.create` succeeds, the key is "issued" but unusable, with no reconciliation. Symmetric on revoke.
- **Symptom 2:** A Redis flush/restore from a stale snapshot resurrects revoked keys silently.
- **Severity:** **medium** (no current bug, but operationally fragile).
- **Recommended fix:** Wrap the create/revoke in a try/rollback that deletes the Postgres row if Redis write fails, and add a periodic reconcile job (or a startup hydrate from Postgres into Redis on gateway boot).

### F8 — LOW: Stale-binary mismatch in `gateway/seed`
- **Location:** Compiled binary at `gateway/seed` is out of sync with `gateway/internal/auth/keys.go:14`. Source emits `ward_<48 hex>`, but the checked-in binary emits `ak_live_<32 hex>` and prints `import anchor` / `anchor.init` in its example output.
- **Severity:** **low** (cosmetic + dev confusion; the binary still produces a SHA-256-compatible key that the gateway accepts).
- **Recommended fix:** Stop committing the compiled binary; add a `make seed` target. Fix the source's example printout to use `ward.init`.

### F9 — LOW: SDK trusts the host of `otlp_endpoint` blindly
- **Location:** `src/ward/otel/tracer.py:65-72`.
- **Symptom:** A user could be tricked into pointing the SDK at a malicious collector that captures their prompts. Not a tenant-isolation issue per se, but worth callout.
- **Severity:** **low** (configuration responsibility belongs to the operator).
- **Recommended fix:** Document explicitly in the README that `otlp_endpoint` must be a Ward-controlled host, and consider TLS-required defaults in production builds.

---

## Onboarding flow trace (signup → first trace)

1. **Sign in** — `dashboard/src/middleware.ts` redirects unauthenticated paths to `/sign-in`. After Supabase callback, the user lands on `/overview`.
2. **Org auto-creation** — `dashboard/src/app/(dashboard)/layout.tsx:17` calls `getOrCreateOrg()` which inserts an `Organization` + `OrgMember` for first-time users (assuming Prisma migrations are applied — see F5).
3. **API key issuance** — `/settings/keys` → `createApiKey(name)` → Prisma insert + `syncKeyToRedis(hash, tenantId, rateLimit, tier, true)`. Plain key is returned **only once** in the action's response. ✓
4. **SDK init** — Onboarding snippet currently fails because of F2/F3/F4. With those fixed, `ward.init(otlp_endpoint="http://localhost:8080", otlp_headers={"Authorization": f"Bearer {key}"})` works end-to-end and traces show up under `ResourceAttributes['ward.tenant_id'] == <org.tenantId>`.
5. **Dashboard render** — Reads via `requireTenantId(org.tenantId)` ✓.

**Conclusion:** the onboarding logic on the server side is correct; the **client-facing instructions are wrong** in three independent ways (F2, F3, F4) and the local stack ships without applied migrations (F5).

---

## Cleanup performed

- Seeded two ephemeral keys in dev Redis for adversarial probing: `ak_live_568bb…` (tenant `audit_tenant_alpha`) and `ak_live_d31ed…` (tenant `audit_tenant_beta`).
- Generated 5 trace rows in ClickHouse with `SpanName='audit.spoof_test'` / `'audit.multi_rs'` for verification.
- These belong to tenants that exist only in Redis and ClickHouse — no Postgres rows. Safe to leave; will be wiped on next `docker-compose down -v`. No production-shaped data was mutated.

## Tasks created

- B5 (#8) already covered F2 — confirmed/expanded.
- B6 (#9) already covers a regression test (recommend the spoof harness used here as the basis).
- New tasks filed for F3, F4, F5, F6, F7 — see TaskList.

---

## Secret / credential sweep (added 2026-05-07)

Pattern grep across `*.py *.go *.ts *.tsx *.js *.sh *.json *.yaml *.yml *.toml *.md *.env*`, excluding `node_modules`, `.git`, `venv`, `.next`. Patterns: `ak_live_*`, `sk-*`, `sk-ant-*`, `sk-proj-*`, `AKIA…`, `ghp_…`, `gho_…`, `ghu_…`, `xoxb-*`, `hf_*`, JWT-shaped strings (`eyJ…\.eyJ…\.…`), Postgres URLs with embedded credentials, and assignments to `password|secret|api_key|token|bearer`.

### Live API key literals matching `ak_live_…` in tracked source
- After team-lead's patches, **zero hits** for the leaked literal in scripts. Audit doc reference redacted above.

### Live secrets that look real
- **None found.** No AWS, GitHub, OpenAI (`sk-`), Anthropic (`sk-ant-`), Slack, HuggingFace, or JWT/Supabase service-role tokens are checked into the tree.

### Hardcoded development credentials (not real secrets, but worth flagging)

| Sev | Location | What |
|---|---|---|
| medium (S1) | `docker-compose.yaml:55-56, 80-81, 100-101, 128-129, 146-147` | `CLICKHOUSE_PASSWORD=otelpass`, `POSTGRES_PASSWORD=postgres`, `GF_SECURITY_ADMIN_PASSWORD=admin`. These are dev defaults but they ship in the same compose file used to bring up local stacks. If anyone stands up this compose against a non-dev network, the credentials are public. |
| medium (S2) | `docker-compose.yaml:126` | `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ward` hardcoded for dashboard service. Same risk as S1. |
| low (S3) | `dashboard/src/lib/clickhouse.ts:5-6` | `process.env.CLICKHOUSE_USER \|\| "otel"` and `… \|\| "otelpass"` — fallbacks in source. Dev-only; in prod the env should always be set, but having compiled-in defaults invites accidents. |
| low (S4) | `configs/grafana/provisioning/datasources/clickhouse.yml:20` | `secureJsonData: { password: "otelpass" }` — Grafana provisioning ships the password literal because Grafana's provisioning format only accepts plaintext at this stage. Acceptable for local dev; for prod, switch to `${env:CLICKHOUSE_PASSWORD}` and require it to be set. |
| info (S5) | `gateway/internal/config/config.go:25` | `RedisPassword: envOr("REDIS_PASSWORD", "")` — gateway runs against an unauth'd Redis by default. Matches the compose file (no Redis password). Fine for local; in prod, Redis should require auth. |

### .env hygiene
- `.gitignore` covers `.env` and `.env*` (lines 11, 34). Confirmed `git ls-files | grep '\.env'` returns only `.env.example`. ✓
- `.env.example` only contains placeholder Supabase URL/anon-key (the anon key is *publicly* shareable by Supabase design — not a secret).
- Working-tree `.env` and `dashboard/.env` exist locally but are correctly ignored.

### False positives noted (no action)
- `dashboard/src/components/sdk-onboarding.tsx:39` — `OpenAI(api_key="your-openai-key")` is a placeholder string in a code-sample template, not a real key.
- `src/ward/conventions/__init__.py:1155` — `MCP_SESSION_PROGRESS_TOKEN` is a constant *name*, not a token value.

### Recommended follow-ups
- New tasks created: **#30** (gitleaks/CI secret scan, backend), **#31** (move docker-compose dev credentials to `.env` with no fallback in prod profiles, backend), **#32** (audit the production deploy manifest for the same dev defaults, architect).

---

## Secret sweep — Round 2: `infra/` Terraform (added 2026-05-07)

After completing round 1, I extended the sweep into `infra/` (Terraform/AWS ECS deploy manifests) which I'd previously only spot-checked. There are real hardening gaps in the production manifest. Tagging these specifically because task #32 (already `in_progress`) is the right owner.

### S6 — CRITICAL: Production Redis runs without authentication
- **Location:** `infra/services/redis.tf:42` — `command = ["redis-server", "--appendonly", "yes", "--dir", "/data"]`. No `--requirepass`. The gateway task at `infra/services/gateway.tf:21-26` correspondingly has no `REDIS_PASSWORD` env. `gateway/internal/config/config.go:25` defaults `RedisPassword` to `""`.
- **Impact:** Redis is the source of truth for `apikey:<sha256> → tenant_id` mappings. Anything that can reach `redis.${var.project_name}.local:6379` from inside the VPC can read every tenant's API key hash and either (a) impersonate any tenant by inserting a fresh key under the target hash, or (b) revoke arbitrary keys by flipping `active=false`. The blast radius is "every tenant's traces, all-time."
- **Severity:** **critical** in any environment where the VPC has more than just the gateway tasks reachable on the redis security group. Defense in depth says even single-tenant VPCs should authenticate Redis.
- **Recommended fix:**
  1. Generate a Redis password via `random_password` resource, store it in AWS Secrets Manager, reference it from both the redis task (`command = ["redis-server", "--appendonly", "yes", "--dir", "/data", "--requirepass", "$REDIS_PASSWORD"]` via shell-form) and the gateway task (`secrets` array referencing the same Secrets Manager ARN).
  2. Tighten `aws_security_group.redis` to only allow ingress from the gateway's security group on 6379. (Not verified yet — recommend round 3 reads `infra/main.tf` security groups.)

### S7 — HIGH: ClickHouse password is plaintext in ECS task environment, not in `secrets`
- **Location:** `infra/services/clickhouse.tf:147` and `infra/services/collector.tf:45` — both inject `var.clickhouse_password` into the `environment` array of their `aws_ecs_task_definition`. The Terraform variable is correctly marked `sensitive = true` (`infra/variables.tf:96-100`), which redacts plan output, **but the value still lands in plaintext** in:
  - The ECS task definition itself — readable by anyone with `ecs:DescribeTaskDefinition`.
  - Terraform state (S3 backend per `infra/main.tf:13`) — depends on bucket encryption + IAM lockdown.
  - CloudTrail `RegisterTaskDefinition` audit logs (limited retention but real).
  - The container's runtime environment — `cat /proc/<pid>/environ` inside the container exposes it.
- **Severity:** **high** (secret hygiene; not a tenant-isolation breach by itself but a foothold escalator).
- **Recommended fix:** Move to the ECS `secrets` array referencing AWS Secrets Manager / SSM SecureString. Pattern:
  ```hcl
  secrets = [
    { name = "CLICKHOUSE_PASSWORD", valueFrom = aws_secretsmanager_secret_version.clickhouse_password.arn }
  ]
  ```
  Both `clickhouse` and `collector` task definitions need the change. The execution role (`aws_iam_role.ecs_execution`) must be granted `secretsmanager:GetSecretValue` on the secret.

### S8 — INFO: `infra/` does not deploy Postgres or Grafana
- No `aws_ecs_*` for Postgres → confirms the dashboard's Prisma client points at Supabase-managed Postgres in prod (matches the Supabase auth model in `dashboard/src/middleware.ts`). Out of scope for this audit; flagging so future architect doesn't accidentally deploy a duplicate.
- No Grafana → S4 ("`secureJsonData: password: \"otelpass\"`") is local-stack only. ✓ no prod exposure.

### S9 — INFO: No hardcoded AWS access keys, JWTs, or other tokens in `infra/`
- Scan for `AKIA[A-Z0-9]{16}`, `aws_access_key`, `aws_secret`, JWT-shaped strings, `Bearer …`, `ghp_`/`gho_`, `sk-ant-` across `infra/**`: zero hits. ✓ Authentication relies entirely on the ECS task role / execution role IAM bindings.

### S10 — Final clean of test artifacts (tracking)
- Removed Redis hashes `apikey:54baa7c8…` and `apikey:e1d4caf2…` (the two ephemeral keys for `audit_tenant_alpha` / `audit_tenant_beta`) — verified empty afterward.
- Removed 5 ClickHouse rows where `SpanName IN ('audit.spoof_test', 'audit.multi_rs')` via `ALTER TABLE … DELETE`. Verified count = 0 post-mutation.
- No production-shaped data was ever modified.

### Round-2 closeout: gitleaks scanner wired (#30, 2026-05-07)

Added secret-scanning to close the F1 regression vector. Files (untracked, awaiting commit):
- `.gitleaks.toml` — extends default rules; adds two custom rules:
  - `ward-api-key` — exact `ak_live_<32 hex>` pattern.
  - `bearer-token-literal` — generic `(Authorization:)? Bearer <≥20 chars>`. Catches future bearer-shaped literals regardless of payload format.
  Path allowlist for `.next/`, `node_modules/`, `venv/`, `.git/`, lockfiles, audit doc, egg-info. Stopword + regex allowlist for known test placeholders. **Commit allowlist** for the F1 historical-leak commits with full SHAs (`0ae6fa2eb3fa273a49024466d16a0dbfd116361f`, `d5770d12c54a894b79a24163a3c43fb82920c3e5`) so full-history scans skip them rather than re-flagging the known compromised key.
- `.pre-commit-config.yaml` — pins `gitleaks v8.30.1`.
- `.github/workflows/secret-scan.yml` — three modes:
  - **Pull request**: shallow clone, diff-only, **advisory** (`continue-on-error: true`). Findings appear as code-scanning alerts; merge isn't blocked.
  - **Push to `main`**: full clone, full-history, **fail-fast**. Stops a leaky merge from shipping. Allowlisted commits skipped.
  - **Weekly schedule** (Sunday 09:00 UTC): full clone, full-history, advisory. Backstop for anything that bypassed the prior modes.
  All runs use `--redact` so leak content never surfaces in CI logs. Output is SARIF uploaded via `github/codeql-action/upload-sarif@v3` for inline PR review and the Security tab.
- `.gitignore` — adds `.gitleaks-*.json` so scratch reports don't get committed.

Validation (gitleaks v8.30.1 via docker):
- Config loads cleanly. (Hit one TOML gotcha: `[allowlist].regexes` must be a `[…]` array, not a list of `[[regexes]]` tables. Fixed.)
- Path allowlist reduces a `--no-git --source .` scan from **65 → 1** finding. The lone remaining hit is `.env:8` (Supabase anon JWT) which is gitignored, so CI's git-mode scan never sees it.
- **Catch verified**:
  - `KEY = "ak_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"` → `ward-api-key` fired.
  - `Authorization: Bearer Zm9vYmFyZGVhZGJlZWZ1bmlxdWVwYXlsb2Fkc3RyaW5nMTIz` → `bearer-token-literal` fired (twice — once per regex variant; gitleaks exits non-zero either way).
  - `gitleaks protect --staged` exits **1** so pre-commit blocks; CI fails fast on push-to-main.
- **No false positives**: placeholder strings (`Bearer your-api-key-here`, `<your-ward-api-key>`, etc.) all pass cleanly via stopword/regex allowlist.

Files left untracked rather than committed — consistent with the hard rule of no commits from this role.

#### v3 (2026-05-07): Switched commit allowlist → fingerprint-based `.gitleaksignore`

Per team-lead direction, the F1 historical-leak suppression now lives in `.gitleaksignore` (fingerprint-level) rather than `commits = […]` (whole-commit-level) in `.gitleaks.toml`. The fingerprint approach is surgical: only the specific (commit, file, rule, line) findings are skipped, so any future leak that happens to land in the same commits would still fire.

Capture process:
1. Temporarily stripped the `commits` allowlist; ran `gitleaks detect --config .gitleaks.toml --redact` on full history. 30 commits / 32MB / 7s.
2. Result: **16 findings**, all in commits `0ae6fa2` (14) and `d5770d1` (2) — exactly the F1 footprint, no surprises elsewhere in history.
3. Pasted the 16 fingerprints into `.gitleaksignore` with a header that documents source, sha256 of the leaked literal, capture date, and the link to F1 in this audit doc.
4. Restored `.gitleaks.toml` (without the `commits = […]` block — replaced with a comment pointing at `.gitleaksignore` so a future maintainer doesn't add both mechanisms by accident).
5. Re-ran the same scan: **`leaks found: 0`, exit 0**. ✓
6. Re-validated catch: a fresh staged `ak_live_*` literal still triggers (`leaks found: 1`). The fingerprint allowlist is keyed on the historical commit SHAs, so it cannot accidentally suppress new leaks. ✓

---

### Round-2 tasks (post-architect-triage 2026-05-07)

The architect closed task #32 with their own findings doc at `.agents/infra-credential-audit.md`. Their I1 and I2 are the same gaps as S6 and S7 here, filed as:

- **#34** — B-harden (V1.1): Add password auth to production Redis. (covers S6/I1)
- **#35** — B-harden (V1.1): Move ECS task secrets to AWS Secrets Manager. (covers S7/I2)

Architect rated both V1.1 (medium/low) because the redis security-group is gateway-only ingress today, bounding the practical blast radius. I had originally rated S6 critical assuming any VPC-internal pod could reach 6379; that's stricter than reality if the SG is correctly scoped — defer to architect's call. My duplicate tasks #36 and #37 were deleted to avoid double-counting.

