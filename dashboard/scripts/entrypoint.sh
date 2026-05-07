#!/bin/sh
# Ward dashboard container entrypoint.
#
# Applies any pending Prisma migrations against `DATABASE_URL` before
# starting the Next.js server. The dashboard cannot serve a working
# `getOrCreateOrg()` (and therefore any authenticated route) without the
# `organizations`, `org_members`, and `api_keys` relations existing — so
# we fail fast here rather than silently degrading every page.
#
# `prisma migrate deploy` is idempotent. If the schema is already current,
# it's a fast no-op (~250ms). On a fresh DB it applies all migrations in
# `./prisma/migrations` in lexical order.
#
# Failure modes:
#   - DATABASE_URL unset    → exits non-zero immediately.
#   - Postgres unreachable  → 30s readiness loop; exits non-zero on timeout.
#   - Migration check fails → exits non-zero; operator must inspect.
#                             See `dashboard/README.md` § "Database migrations".

set -eu

log() { echo "[entrypoint] $*"; }

if [ -z "${DATABASE_URL:-}" ]; then
  log "FATAL: DATABASE_URL is not set" >&2
  exit 1
fi

# Belt-and-suspenders Postgres readiness loop. Compose already gates startup
# on `depends_on: condition: service_healthy`, but k8s/ECS deploys do not —
# this script must be portable across both. Parses host/port out of
# DATABASE_URL and TCP-pings until accept(), with a 30s ceiling.
wait_for_postgres() {
  log "waiting for Postgres to accept connections..."
  i=0
  while [ "$i" -lt 30 ]; do
    if node -e "
      const url = new URL(process.env.DATABASE_URL);
      const sock = require('net').connect({
        host: url.hostname,
        port: Number(url.port) || 5432,
      });
      sock.once('connect', function() { this.end(); process.exit(0); });
      sock.once('error', function() { process.exit(1); });
    " 2>/dev/null; then
      log "Postgres is up (attempt $((i + 1)))"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  log "FATAL: Postgres unreachable after 30s" >&2
  exit 1
}

if [ "${SKIP_PRISMA_MIGRATE:-0}" = "1" ]; then
  log "SKIP_PRISMA_MIGRATE=1 — skipping migrations"
elif [ -d "./prisma/migrations" ]; then
  wait_for_postgres
  log "applying Prisma migrations against DATABASE_URL..."
  # Invoke the bundled CLI directly rather than via node_modules/.bin/prisma.
  # Docker COPY dereferences npm's .bin symlink, leaving the JS bundle in .bin/
  # without its sibling .wasm files (which still live in prisma/build/). Calling
  # the package script directly keeps __dirname pointed at prisma/build so the
  # WASM loaders resolve. No network reach.
  node ./node_modules/prisma/build/index.js migrate deploy
  log "migrations up-to-date"
else
  # Defense in depth: if the migrations dir wasn't shipped in the image we
  # must NOT silently start, since we'd serve a broken dashboard.
  log "FATAL: ./prisma/migrations not present in image" >&2
  exit 1
fi

log "starting Next.js standalone server..."
exec node server.js
