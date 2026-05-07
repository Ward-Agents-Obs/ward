# Ward V1 Ship Doc — skeleton

**Owner:** architect (compilation), team-lead (final approval)
**Status:** **draft skeleton** (2026-05-07). Final pass after Monitors batch lands.
**Read first:** `.agents/v1-scope.md`, `.agents/monitors-design.md`, `.agents/tenant-isolation-audit.md`, `.agents/infra-credential-audit.md`.

This doc is the pre-flight checklist for promoting V1 from local-demo to a real deployment. It does not duplicate the scope or design docs — it asks "what must be true on the day we ship, and how do we verify it."

---

## 1. V1 ship gate — what V1 actually delivers

A V1 ship means a new user can:

1. Sign up via Supabase auth → org auto-provisioned (`getOrCreateOrg`).
2. Create an API key from `/settings/keys`.
3. Copy the SDK onboarding snippet, paste into a Python script, and **see their first trace in the dashboard within ~60s**.
4. View tenant-scoped Overview, Tracing, and Monitors pages.
5. Create a Monitor with a threshold + scope, see it fire when the threshold is breached, and see the firing banner across all dashboard pages.

If any of those five flows is broken on ship day, V1 is not shipped.

### Tasks that gate the ship (must close)

| Task | Owner | Why it gates ship |
|---|---|---|
| #14 B7 (Monitor Prisma models) | backend | Unblocks #15–21; Monitors don't exist without it. |
| #15 B8 (Monitor server actions) | backend | Required for create/edit/delete/toggle. |
| #16 B9 (cron worker) | backend | Required for monitors to ever fire. |
| #17 B10 (preview query) | backend | Required for the create-modal preview pane. |
| #18 F7 (Monitors list page) | frontend | Required surface. |
| #20 F9 (Monitor detail page) | frontend | Required surface. |
| #9 B6 (tenant isolation regression test) | backend | Required to validate ship-grade isolation. |
| #24 (auto-apply Prisma migrations) | backend | Required so Vercel deploys don't hang on `<TenantContextFallback />`. |
| #27 B11 (seed → Postgres) | backend | Required for demo path; also closes the seed/dashboard divergence. |
| #31 (S3 portion: drop `clickhouse.ts` fallbacks) | backend | V1 priority per architect triage; prevents silent-dev-creds-in-prod. |

Tasks already closed that contribute to ship: #1, #2, #3, #4, #5, #6, #7, #8, #10, #11, #12, #13, #19, #21, #22, #23, #28, #29, #30, #32, #33, #43.

---

## 2. Pre-flight deployment checklist `[to-verify-with-product-owner]`

Working assumption: dashboard runs on **Vercel**, Postgres on **Supabase**, gateway/collector/clickhouse/redis on **AWS ECS** via `infra/*.tf`. See `.agents/v1-scope.md §6c`.

### 2.1 Vercel project env vars (required, no fallbacks)

- [ ] `DATABASE_URL` — Supabase Postgres connection string.
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — auth.
- [ ] `CLICKHOUSE_URL` — gateway-fronted ingest URL **OR** direct ClickHouse URL for read path. (Confirm which the dashboard uses; today it's direct read against ClickHouse.)
- [ ] `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` — required after #31; module load fails without them.
- [ ] `CRON_SECRET` — required by `/api/cron/evaluate-monitors`; missing → 503.
- [ ] **No `*_FALLBACK` style vars.** Hard-fail on missing.

### 2.2 Vercel Cron

- [ ] `vercel.json` (set in Vercel UI or per-environment, not committed) configured to POST `/api/cron/evaluate-monitors` every 5 min with `x-cron-token: ${CRON_SECRET}` header.
- [ ] Smoke check: `curl -X POST … -H "x-cron-token: …"` returns 200 on a deployed preview.

### 2.3 Supabase

- [ ] Prisma migrations applied via #24's mechanism (Dockerfile entrypoint or one-shot init). Verify `\dt` shows `organizations`, `org_members`, `api_keys`, `monitors`, `monitor_triggers`.
- [ ] Row-level security review: NOT a V1 hard requirement (we enforce tenant scoping at the application layer via `requireTenantId()`), but flag for V1.1 if Supabase RLS would add defense-in-depth.

### 2.4 AWS infra (gateway + data plane)

- [ ] Terraform applied with `clickhouse_password` set. (`infra/variables.tf` requires it.)
- [ ] Redis Security Group: ingress allowed only from gateway SG. **No bastion/NAT/wide CIDR rules** — this is the only thing standing between an SG slip and total tenant impersonation until #34 lands.
- [ ] Gateway ALB has TLS cert (`certificate_arn` Terraform var).
- [ ] Gateway `/health` returns 200 from outside the VPC.
- [ ] Collector is `expose:`-only on its private network (already in `infra/services/collector.tf` — no public ALB, no NAT mapping).

### 2.5 End-to-end smoke (after the above)

- [ ] Sign up a fresh user, confirm org auto-creation. (validates Supabase + Prisma + auth.)
- [ ] Create an API key. (validates Prisma + Redis sync.)
- [ ] Run a Python script with the onboarding snippet, send 3 OpenAI calls. (validates SDK + gateway + collector + ClickHouse.)
- [ ] Confirm the 3 spans appear on `/overview` and `/traces` for that tenant within 30s.
- [ ] Create a monitor with `cost > 0.0001` over 5min, send a $0.01 call. Wait for next cron tick. Confirm banner fires across all pages within 30s. Confirm `/monitors/[id]` shows trigger row.
- [ ] Sign in as a **second** tenant; confirm the first tenant's traces are NOT visible. (validates #9 in production.)

If 2.5 fails on any line, do not ship — diagnose and re-run.

---

## 3. Known-acceptable V1 limitations

These are documented punts. We ship despite them and link this section in the V1 release notes so users aren't surprised.

| Area | Limitation | Mitigation / when this changes |
|---|---|---|
| Projects | No `Project` entity; one tenant = one dataset. Sidebar workbench nav is feature-flagged off. | V1.1+ adds Prisma `Project` model + `gen_ai.project` resource attribute. |
| Monitor metrics | Three only: `cost`, `latency_p95`, `error_rate`. No custom evals. | V1.1+ widens (allowlist constant in cron worker). |
| Monitor windows | Five fixed windows (5m/15m/1h/6h/24h). | V1.1+ allows custom intervals. |
| Monitor scope | Single env + single model filter. No regex, no JSON-key extraction. | V1.1+ if user demand emerges. |
| Monitors per tenant | Hard cap of 10. | Bump cap when we know the cron worker tolerates more. |
| Notifications | In-app banner only. No email, Slack, webhook, PagerDuty. | V1.1+ — see `monitors-design.md §4`. |
| Banner refresh | 30s polling when count > 0; nav-only when count === 0. | Real-time push (Supabase Realtime / SSE) is V1.1+. |
| Tracing pagination | LIMIT/OFFSET; degrades past ~10k rows. | V1.1+ keyset pagination on `Timestamp DESC`. |
| Trace search | No full-text content search. Sessions page has substring on prompt/completion only. | V1.1+ if needed. |
| Per-key rate limits | None — rate limit lives on Organization. | V1.1+ via `ApiKey.rateLimit` column. |
| Auth roles | `OrgMember.role` exists but is not enforced anywhere; everyone is effectively owner. | V1.1+ wire admin/member/viewer split. |
| Multi-org switching | One org per user (first member row wins). | V1.1+ org switcher. |
| Demo seeding | Operator-only via `setup_test_environment.sh`. New orgs see truthful empty state. | Confirmed correct by team-lead; not changing. |

---

## 4. V1.1 backlog (prioritized)

Anything beyond this list is V1.2+ and not yet on the radar.

### Tier 1 — hardening before next promotion to a higher-trust environment

| # | Task | Why tier 1 |
|---|---|---|
| **#34** | Redis auth in prod | **Hard prerequisite for prod-grade deployment.** SG-only ingress is the single line of defense today. |
| #35 | ClickHouse password → AWS Secrets Manager | Plaintext in ECS task def is readable via `ecs:DescribeTaskDefinition`. |
| #25 | OTel Collector requires shared-secret auth | Defense-in-depth; today bounded by `expose:`-only but one config slip is critical. |
| #26 | Atomic Postgres↔Redis API key writes + reconcile | Today a Redis flush silently resurrects revoked keys, or a Postgres-only write leaves a key unusable. |

### Tier 2 — UX / feature gaps callers will notice

| # | Task | Why tier 2 |
|---|---|---|
| #38 | Swap hand-rolled primitives → Radix where a11y matters | Dialog/Select/Tooltip etc. need real focus management for keyboard users. |
| #39 | Parameterise `getOverviewMetrics` on time range + prev-window deltas | Today the overview is hard-coded to 24h, no comparison. |
| #40 | Per-bucket cost-over-time query for overview chart | Granularity for the cost line. |
| #41 | Environment filter on overview queries | Today overview ignores env. |
| #31 (V1.1 portion) | Compose `${VAR:-default}` substitution + production profile docs | Local hygiene. |

### Tier 3 — long-term hygiene

| # | Task | Why tier 3 |
|---|---|---|
| #42 | gitleaks regression fixtures suite | Lock in #30's coverage. |
| (new) | Vercel deployment runbook + Vercel Cron `vercel.json` template | Captures §2 above as an executable doc. |
| (new) | Supabase RLS evaluation: do we layer it under our app-level scoping? | Defense-in-depth audit, possibly no-op. |
| (new) | ClickHouse keyset pagination on traces | Replaces OFFSET when scale demands it. |

---

## 5. Verification matrix

When we run §2.5 the day of ship, fill this in:

| Check | Result | Evidence |
|---|---|---|
| Vercel env audit | ☐ pass / ☐ fail | screenshot of project settings, redacted |
| Vercel Cron 200 | ☐ pass / ☐ fail | curl output |
| Prisma migrations applied | ☐ pass / ☐ fail | `\dt` output |
| Terraform applied + outputs | ☐ pass / ☐ fail | `terraform output` |
| Redis SG ingress audit | ☐ pass / ☐ fail | `aws ec2 describe-security-groups` |
| Sign-up → org provision | ☐ pass / ☐ fail | screenshot of `/overview` for new user |
| API key creation | ☐ pass / ☐ fail | screenshot + Redis hash check |
| Onboarding snippet → first trace | ☐ pass / ☐ fail | screenshot of `/traces` showing the 3 spans |
| Cross-tenant negative test | ☐ pass / ☐ fail | screenshot + ClickHouse direct query confirmation |
| Monitor creates + fires + banner | ☐ pass / ☐ fail | screenshots: create modal, list page firing, banner across pages |
| Monitor resolves | ☐ pass / ☐ fail | banner disappears after threshold returns to ok within ~30s |

---

## 6. Rollback plan

If §2.5 reveals a regression after partial deploy:

1. **Vercel:** revert to previous deployment (one-click in Vercel UI). Reverts dashboard + API routes + cron route.
2. **Vercel Cron:** disable the cron in Vercel UI to stop monitor evaluation if it's the source of the regression.
3. **Supabase:** Prisma migrations are forward-only. If a migration introduced the regression, **do NOT auto-rollback** — file an incident task, use a manual SQL down-migration scripted by backend, and freeze deploys until resolved. Migrations should be small and isolated (#14 is a clean additive case — drop tables if the V1 ship is aborted entirely).
4. **AWS:** revert to prior Terraform commit and `terraform apply`. State stays in S3; no data loss on gateway/collector restart. ClickHouse data persists across task restarts via EBS.
5. **Worst case:** disable Vercel Cron + revert Vercel deploy. App shows monitors as static state from Postgres (no new fires, no new resolutions) until next deploy. Acceptable degraded mode for a few hours.

---

## 7. Open items before this doc is final

- [ ] Confirm Vercel + Supabase + AWS as the actual prod posture (`[to-verify-with-product-owner]` from `v1-scope.md §6c`).
- [ ] Confirm whether Redis auth (#34) is required for **the V1 ship target** or only for "production-grade." If V1 ships to demo only, defer #34. If V1 ships to a customer-facing URL, gate ship on #34.
- [ ] Update §2.4 if the prod posture answer changes.
- [ ] Final pass after Monitors batch (#14–18, #20) closes — fold in any acceptance findings.
- [ ] Add release notes draft / changelog entry (separate doc or section here).
