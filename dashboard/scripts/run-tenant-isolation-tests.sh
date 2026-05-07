#!/usr/bin/env bash
#
# Runs every tenant-isolation tsx script in `dashboard/__tests__/`. Exits
# non-zero on the first failure so CI fails loudly. Each script handles its
# own fixture setup + teardown via random run-ids, so they're safe to run in
# any order against a shared ClickHouse.
#
# Prerequisites (mirrors the docstring at the top of each script):
#   • docker-compose ClickHouse reachable at $CLICKHOUSE_URL
#   • CLICKHOUSE_USER / CLICKHOUSE_PASSWORD set
#   • run from the dashboard/ directory (so `npx tsx` resolves the @/ alias
#     via tsconfig.json)
#
# Usage:
#   cd dashboard
#   CLICKHOUSE_URL=http://localhost:8123 \
#   CLICKHOUSE_USER=otel CLICKHOUSE_PASSWORD=otelpass \
#   bash scripts/run-tenant-isolation-tests.sh

set -euo pipefail

# Allow being invoked from anywhere — anchor at the dashboard/ root.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DASHBOARD_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
cd "${DASHBOARD_DIR}"

# Discover every *-tenant-isolation.ts file under __tests__/. Sort for stable
# CI output. New scripts following the naming convention are picked up
# automatically. Avoid `mapfile` (bash 4+) so this works on macOS's bundled
# bash 3.2 too.
TESTS_LIST="$(find __tests__ -maxdepth 1 -name '*-tenant-isolation.ts' -type f | sort)"

if [[ -z "${TESTS_LIST}" ]]; then
  echo "[run-tenant-isolation-tests] no *-tenant-isolation.ts files found under __tests__/" >&2
  exit 1
fi

count="$(printf '%s\n' "${TESTS_LIST}" | wc -l | tr -d ' ')"
echo "[run-tenant-isolation-tests] found ${count} test script(s):"
printf '  - %s\n' ${TESTS_LIST}

# `--env-file=.env` lets scripts that import the Prisma client (which reads
# DATABASE_URL on instantiation) work the same as the Prisma CLI. Variables
# already set in the shell win over the file, so the existing ClickHouse-only
# scripts are unaffected — they read CLICKHOUSE_URL/USER/PASSWORD from the
# caller's env as before. Requires Node >= 20.6.
ENV_FLAG=()
if [[ -f .env ]]; then
  ENV_FLAG=(--env-file=.env)
fi

failed=0
while IFS= read -r f; do
  [[ -z "${f}" ]] && continue
  echo
  echo "================================================================"
  echo "  ${f}"
  echo "================================================================"
  if ! npx tsx "${ENV_FLAG[@]}" "${f}"; then
    failed=1
    echo "[run-tenant-isolation-tests] FAIL: ${f}" >&2
  fi
done <<< "${TESTS_LIST}"

if [[ ${failed} -ne 0 ]]; then
  echo
  echo "[run-tenant-isolation-tests] one or more scripts failed" >&2
  exit 1
fi

echo
echo "[run-tenant-isolation-tests] all ${count} script(s) passed"
