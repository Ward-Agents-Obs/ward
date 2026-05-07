# Monitor Cron Deployment Options (#16)

**For:** backend, before #16. **From:** architect, 2026-05-07.

## Recommendation: Vercel Cron (prod) + `pnpm worker:monitors` (dev)

This is already what #16 specifies; this note explains the trade-off so backend doesn't second-guess it.

| Option | Verdict | Why |
|---|---|---|
| **Vercel Cron** | ✓ prod | Built-in given the assumed Vercel dashboard posture. Zero new infrastructure. Auth via `x-cron-token: $CRON_SECRET` matches the existing route handler. Limit: 60s per invocation — fine at V1 cap (≤10 monitors/tenant × small N tenants × ~100ms ClickHouse query each is well under 60s). |
| **Standalone Node worker** | ✓ dev only | The `pnpm worker:monitors` script in #16 already provides this for local iteration. Useful when developing the worker; not worth a second deployment surface in prod alongside Vercel Cron. |
| **Postgres `pg_cron`** | ✗ | Worker queries **ClickHouse** to compute the metric, not Postgres. pg_cron can't reach across data stores. Hard no. Also Supabase-tier-dependent. |

## V1.1 escape hatch

If Vercel Cron's 60s ceiling becomes painful (many monitors, slow ClickHouse queries, parallel evaluation), promote the local script to a long-running ECS Fargate task in `infra/services/`. The route handler stays identical; only the trigger changes. Cheap migration when scale demands it — V1 doesn't need to plan for it.
