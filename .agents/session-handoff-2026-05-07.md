# Session handoff — 2026-05-07

Quick resumption notes. Read top-down; the "When you return" section is the action list.

## Where we stand

Two V1-blocking tasks closed this session (#24, #25). Three agents running concurrently when you left:
- **architect** on #14 (Monitor Prisma models) — work appearing in working tree, not yet signalled ready
- **debug-expert** on #26 (atomic key writes + gateway hydrate) — coding after my push-back
- **frontend** idle, blocked on #14

Backend agent has been silent ~1h+. I reassigned #14 to architect after three pings + your "nah continue" earlier.

## Commits this session

| SHA | What |
|---|---|
| `e1129dd` | feat(dashboard): apply Prisma migrations on container startup (#24) |
| `3f6a150` | docs: dashboard-conventions-drift audit (frontend's audit) |
| `2e4e0b6` | feat(gateway): require Bearer auth on OTel Collector OTLP socket (#25 part 1) |
| `70ed242` | feat(infra): plumb COLLECTOR_AUTH_TOKEN through ECS task definitions (#25 part 2) |
| `4b12319` | chore(gateway): anchor binary ignores so cmd/ source dirs aren't shadowed |
| `3fa7b15` | feat(dashboard): add Recent matching spans deep-link to monitor detail |

## In-flight when you left

**Working tree (uncommitted):**
- `dashboard/prisma/schema.prisma` (M) — architect's #14
- `dashboard/prisma/migrations/migration_lock.toml` (M) — architect's #14
- `dashboard/prisma/migrations/20260507045844_add_monitors/` (??) — architect's #14

**Architect on #14**: brief sent included schema → migration → tsx tenant-isolation test → one commit. They confirmed reroute and started. Files appearing in tree means they're mid-work.

**Debug-expert on #26**: my push-back in their inbox. Key directives:
- Invert revoke ordering: Redis-first (kill auth), Postgres-second
- Hydrate ANDs `active` across both stores (revoked-anywhere wins)
- Surface partial-failure to user via `{ ok: false, message }` envelope
- Two commits: dashboard atomicity + tests, then gateway hydrate + Go/Python tests + compose/infra
- Use pgx/v5/stdlib for Postgres driver

**Frontend**: idle by design until #14 lands. Will then swap mock data → Prisma queries on #18/#20, and you can fan #39/#40 backend halves out (likely to architect).

## Key decisions made (so they don't drift)

- Backend silence: architect implements #14 (load-shedding rule overridden because backend unreachable)
- After #14 ships: stop architect there, re-evaluate #15/#16/#17 — likely fan to architect + frontend
- AGENTS.md refresh deferred to one consolidated PR after monitors are real
- Dockerfile bloat: V1 ships full builder node_modules in runner; V1.1 task to split migration tool stage
- Asymmetric rollback on key writes: create rolls back Postgres on Redis fail; revoke flips order entirely
- Periodic reconcile on key drift: V1.1 only, not V1

## When you return — first three actions

1. **Check architect's #14**. If they signalled ready in inbox, review the diff (`git diff dashboard/prisma/schema.prisma` + the migration SQL) and commit as `feat(dashboard): add Monitor + MonitorTrigger Prisma models`. Mark #14 completed. This unblocks 7 tasks.
2. **Check debug-expert's #26**. They had two commits planned. Review their inbox response to my push-back — if they accepted (b) hydrate and the order inversion, expect commits ready. If they pushed back, reason through it.
3. **Fan #15/#16/#17 + #39/#40 backend halves**. After #14 lands, six tasks become available. Frontend gets #15 (server actions — they have the spec), architect gets #16 (cron worker — they designed it) and the #39/#40 backend queries. #17 (preview metric query) is small — either of them.

## Outstanding pings to teammates

None unanswered. All three teammates have current direction.

## Open product question (still)

V1 demo-only or customer-facing? Drives whether #34 (Redis prod auth) gates ship. Treated as V1.1 today.

## Local env reminder

`COLLECTOR_AUTH_TOKEN` is set in your local `.env` (gitignored, set during this session). `docker compose up` will work for you. Anyone else cloning fresh after `2e4e0b6` will hit the fail-closed message and need to `openssl rand -hex 32` and add it.

Dashboard is healthy on `:3001` with both pre-#14 migrations applied.
