## Dashboard Setup

Copy the local env template and fill in your service credentials:

```bash
cp .env.example .env
```

Required auth variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Enable Google and GitHub OAuth providers in Supabase Auth and add these callback URLs:

- Local: `http://localhost:3000/auth/callback`
- Deployed: `https://<your-domain>/auth/callback`

Start the dashboard:

```bash
npm install
npm run dev
```

The app redirects unauthenticated requests to `/sign-in`, then exchanges the Supabase OAuth code at `/auth/callback` before loading the protected dashboard routes.

## Database migrations

Prisma migrations live in `prisma/migrations/`. They are applied automatically every time the dashboard container starts: `docker-entrypoint.sh` runs `prisma migrate deploy` against `DATABASE_URL` before exec'ing `node server.js`. The step is idempotent — a fast no-op on a healthy database.

If migrations fail, the container exits non-zero and (under `restart: unless-stopped`) the orchestrator will restart it. Investigate before letting it loop.

### Local dev recovery

If you need to start over with a clean schema during development:

```bash
docker compose down dashboard postgres
docker volume rm ward_postgres_data    # destroys all dashboard data
docker compose up -d postgres dashboard # entrypoint re-applies all migrations
```

To bypass the entrypoint migration once (e.g. you applied a hotfix manually):

```bash
SKIP_PRISMA_MIGRATE=1 docker compose up -d dashboard
```

### Production rollback

`prisma migrate deploy` only rolls forward. To undo a bad migration in prod:

1. Restore the pre-deploy Postgres snapshot **and** revert the dashboard image to the prior commit so `prisma/migrations/` no longer contains the offending entry.
2. If the snapshot is gone, manually undo the schema and tell Prisma to forget the migration with `npx prisma migrate resolve --rolled-back <migration_name>` — this clears the row from `_prisma_migrations` so a corrected forward migration can deploy cleanly.
3. Prefer writing a forward-only fix migration over rolling back when the schema change is recoverable in place.

## Monitor evaluation cron

Monitors (alerting rules over cost / latency_p95 / error_rate) are evaluated by a periodic POST to `/api/cron/evaluate-monitors`. The route checks an `x-cron-token` header against `process.env.CRON_SECRET`:

- Unset env var → `503 CRON_SECRET not set — see dashboard/.env.example`
- Token mismatch → `401 unauthorized`
- Match → evaluate every enabled monitor, write state transitions, return a JSON summary `{ evaluated, transitions, errors }`

V1 cadence is **every 5 minutes**. The route handler is the contract — pick whichever scheduler your environment supports.

### Local / demo (any environment)

A small Node loop ships under `scripts/worker-monitors.ts` and is wired up as `pnpm worker:monitors`:

```bash
# from dashboard/
pnpm worker:monitors
# overrides:
TARGET=http://localhost:3001 INTERVAL_SEC=60 pnpm worker:monitors
```

`CRON_SECRET` is loaded from `.env` via `tsx --env-file=.env`. Don't run this alongside Vercel Cron in prod — they'll double-evaluate.

### Production (Vercel)

Add a `vercel.json` to your Vercel project (NOT committed — environment-specific) with:

```json
{
  "crons": [
    {
      "path": "/api/cron/evaluate-monitors",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Set `CRON_SECRET` in the Vercel project env. Vercel Cron sends the header automatically (it forwards the project's `CRON_SECRET` env as the `x-cron-token` header value when configured per [their docs](https://vercel.com/docs/cron-jobs)). Cap is 60s per invocation — fine at V1's ≤10 monitors/tenant × small N tenants × ~100ms ClickHouse query each. If that ceiling ever bites, promote the local loop script to a long-running ECS Fargate task; the route handler stays identical, only the trigger changes.
