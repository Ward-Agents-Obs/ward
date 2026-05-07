# Ward V1 Ship Doc

**Owner:** architect (compilation), team-lead (final approval) · 2026-05-07
**Companions:** `v1-scope.md`, `monitors-design.md`, `tenant-isolation-audit.md`, `infra-credential-audit.md`, `monitors-implementation-risks.md`.

V1 foundation is shipped. Monitors data layer is the last gate. One open product question (§end).

## Shipped

- **Tenant isolation** (#2) — gateway overrides `ward.tenant_id` server-side; dashboard reads scoped via `requireTenantId()`.
- **Onboarding** (#8, #22, #23, #28, #29, #33) — snippet uses `Authorization: Bearer`, points to gateway, no truncated-key footgun, no plaintext keys in scripts.
- **Secret hygiene** (#30) — gitleaks pre-commit + CI.
- **UI foundation** (#5, #12, #13, #43) — sidebar pruned, loading/error/404 scaffolds, shadcn primitives, legacy components migrated.
- **Overview** (#6, #10) — real tenant-scoped span count, cost, latency, error rate.
- **Tracing** (#7, #11) — spans + sessions toggle + trace detail.
- **Monitors partial** (#4, #19, #21) — design locked, create/edit modal, firing-banner with conditional polling.

## Ship gate (pending)

| # | Task | Owner | Status |
|---|---|---|---|
| #24 | Prisma migrate-on-startup | backend | in_progress |
| #14 | Monitor Prisma models | backend | up next |
| #15 | Monitor server actions | backend | blocked by #14 |
| #16 | Cron evaluation worker | backend | blocked by #14 |
| #17 | Monitor preview query | backend | blocked by #14 |
| #18 | Monitors list page | frontend | in_progress |
| #20 | Monitor detail page | frontend | in_progress |
| #9 | Tenant isolation regression test | backend | in_progress |
| #27 | Mirror seeded keys to Postgres | backend | pending |
| #31 | Drop `clickhouse.ts` env fallbacks | backend | pending |

Backend reads `monitors-implementation-risks.md` before #15.

## Demo readiness checklist

`git clone` → first trace in `/overview`:

1. `cp .env.example .env`; fill `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. `docker compose up -d` — Redis, ClickHouse, collector, gateway, Postgres, dashboard, Grafana.
3. **[rough — pending #24]** Run `npx prisma migrate dev` from `dashboard/` manually. Without it `getOrCreateOrg()` swallows `P2021` and the dashboard renders `<TenantContextFallback />`.
4. Open `localhost:3001`; sign in via Supabase. Org auto-provisions on first sign-in.
5. `/settings/keys` → "Create API key" → copy plain key (shown once).
6. Target app: `pip install ward-sdk`; `ward.init(otlp_endpoint="http://localhost:8080", otlp_headers={"Authorization": f"Bearer {key}"})`.
7. Run app. SDK → gateway (auth + tenant inject) → collector → ClickHouse.
8. **[rough — pending #27]** Operator path via `setup_test_environment.sh` seeds Redis only; those keys won't appear in `/settings/keys` until #27.
9. Refresh `/overview` and `/traces` — spans visible within ~5s.

#24 and #27 close the rough edges.

## V1.1 backlog

| # | Task | Tier |
|---|---|---|
| **#34** | Redis auth in prod | **prereq if customer-facing** |
| #35 | ClickHouse password → Secrets Manager | hardening |
| #25 | Collector shared-secret auth | hardening |
| #26 | Atomic Postgres↔Redis key writes | hardening |
| #38 | Radix swap for a11y | UX |
| #39, #40, #41 | Overview time-range / env / cost-bucket | UX |
| #42 | gitleaks regression fixtures | hygiene |
| #31 (V1.1) | Compose `${VAR:-default}` | hygiene |

## Open product question

**Is V1 demo-only or customer-facing?** Drives whether #34 gates ship. Treated as V1.1 today; revise if customer-facing.
