/**
 * #16 acceptance check — Monitor evaluation cron worker.
 *
 * Validates the three risks called out in
 * `.agents/monitors-implementation-risks.md`:
 *
 *   1. Tenant scoping — orgA's monitor evaluating its own metric must NOT
 *      see orgB's spans, even when both orgs share a window/metric/scope.
 *   2. State-transition idempotency — re-running `reconcileState` on a
 *      monitor that's already firing produces zero new MonitorTrigger rows.
 *      The `SELECT ... FOR UPDATE` lock + state-machine in the route should
 *      make ok→firing a single edge, even under repeated invocations.
 *   3. Allowlist drift — the worker rejects an unknown metric stored on a
 *      Monitor row (defence in depth — the action layer should reject this
 *      first, but corrupt rows happen).
 *
 * The test exercises the worker by importing `evaluateMonitorMetric` and
 * `compareValue` directly + driving the state-machine via the live POST
 * route. No mocks, no shimmed Prisma. Spans go to the docker-compose
 * ClickHouse, monitor state goes to the docker-compose Postgres.
 *
 * Run from `dashboard/`:
 *
 *     CLICKHOUSE_URL=http://localhost:8123 \
 *     CLICKHOUSE_USER=otel CLICKHOUSE_PASSWORD=otelpass \
 *     CRON_SECRET=test-secret \
 *     CRON_ROUTE_URL=http://localhost:3001/api/cron/evaluate-monitors \
 *       npx tsx --env-file=.env __tests__/monitor-cron-tenant-isolation.ts
 *
 * The runner script `scripts/run-tenant-isolation-tests.sh` already passes
 * `--env-file=.env` and discovers any `*-tenant-isolation.ts` file. If the
 * route URL or CRON_SECRET aren't reachable / configured, the route-driven
 * sub-checks are skipped with a clear warning so this test stays useful in
 * partial-environment CI runs.
 */

import { randomBytes } from "node:crypto";

import { clickhouse } from "../src/lib/clickhouse";
import {
  buildMetricQuery,
  compareValue,
  evaluateMonitorMetric,
} from "../src/lib/monitors-eval";
import { prisma } from "../src/lib/prisma";

const runId = randomBytes(4).toString("hex");
const TENANT_A = `wardtest_${runId}_a`;
const TENANT_B = `wardtest_${runId}_b`;

const CRON_ROUTE_URL =
  process.env.CRON_ROUTE_URL ??
  "http://localhost:3001/api/cron/evaluate-monitors";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

const failures: string[] = [];

function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

interface Seeded {
  orgA: { id: string };
  orgB: { id: string };
  /** orgA's cost monitor: threshold 1, window 60min, no env/model filter. */
  monA: { id: string };
  /** orgB's cost monitor: same shape as monA. */
  monB: { id: string };
}

async function insertSpansForA() {
  // Two GenAI spans for orgA in the last 5 min, $0.50 each → total $1.00.
  // Threshold is 1 ($1) so monA's `cost > 1` would be FALSE on these alone;
  // we add one more span below to push it over.
  const baseTs = (s: number) =>
    new Date(Date.now() - s * 1000)
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");
  await clickhouse.insert({
    table: "otel_traces",
    values: [
      makeSpan({
        tenantId: TENANT_A,
        ageSeconds: 90,
        costUsd: 0.5,
        timestamp: baseTs(90),
      }),
      makeSpan({
        tenantId: TENANT_A,
        ageSeconds: 60,
        costUsd: 0.5,
        timestamp: baseTs(60),
      }),
      makeSpan({
        tenantId: TENANT_A,
        ageSeconds: 30,
        costUsd: 0.75,
        timestamp: baseTs(30),
      }),
      // Single orgB span — its cost ($5) blows past orgA's threshold. If the
      // tenant filter is broken, monA's evaluation will read this as $5+ and
      // mistakenly fire on orgB's data.
      makeSpan({
        tenantId: TENANT_B,
        ageSeconds: 30,
        costUsd: 5,
        timestamp: baseTs(30),
      }),
    ],
    format: "JSONEachRow",
  });
  await new Promise((r) => setTimeout(r, 500));
}

interface SpanOpts {
  tenantId: string;
  ageSeconds: number;
  costUsd: number;
  timestamp: string;
}

function makeSpan(opts: SpanOpts) {
  return {
    Timestamp: opts.timestamp,
    TraceId: randomBytes(16).toString("hex"),
    SpanId: randomBytes(8).toString("hex"),
    ParentSpanId: "",
    TraceState: "",
    SpanName: "monitor-cron-test",
    SpanKind: "Client",
    ServiceName: "wardtest-monitor-cron",
    ResourceAttributes: {
      "ward.tenant_id": opts.tenantId,
      "service.name": "wardtest-monitor-cron",
      "deployment.environment": "production",
    },
    ScopeName: "ward",
    ScopeVersion: "0.1.0",
    SpanAttributes: {
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": "100",
      "gen_ai.usage.output_tokens": "50",
      "gen_ai.usage.cost": opts.costUsd.toFixed(6),
    },
    Duration: 250 * 1_000_000,
    StatusCode: "Ok",
    StatusMessage: "",
  };
}

async function insertFixtures(): Promise<Seeded> {
  const orgA = await prisma.organization.create({
    data: {
      name: `wardtest cron orgA ${runId}`,
      slug: `wardtest-cron-${runId}-a`,
      tenantId: TENANT_A,
    },
  });
  const orgB = await prisma.organization.create({
    data: {
      name: `wardtest cron orgB ${runId}`,
      slug: `wardtest-cron-${runId}-b`,
      tenantId: TENANT_B,
    },
  });

  // Both monitors: cost > 1 over last 60 min. Same shape so any cross-leak in
  // evaluation surfaces as identical fire/ok behavior.
  const monA = await prisma.monitor.create({
    data: {
      orgId: orgA.id,
      name: "orgA cost monitor",
      metric: "cost",
      comparator: "gt",
      threshold: 1,
      windowMinutes: 60,
    },
  });
  const monB = await prisma.monitor.create({
    data: {
      orgId: orgB.id,
      name: "orgB cost monitor",
      metric: "cost",
      comparator: "gt",
      threshold: 1,
      windowMinutes: 60,
    },
  });

  await insertSpansForA();
  return { orgA, orgB, monA, monB };
}

async function deleteFixtures() {
  // Postgres: cascade wipes monitors + triggers via the FK.
  await prisma.organization.deleteMany({
    where: { tenantId: { in: [TENANT_A, TENANT_B] } },
  });
  // ClickHouse: ALTER DELETE is async but our run-id keeps the rows
  // namespaced so nothing else gets caught.
  try {
    await clickhouse.command({
      query: `
        ALTER TABLE otel_traces
        DELETE WHERE ResourceAttributes['ward.tenant_id'] IN ({a:String}, {b:String})
      `,
      query_params: { a: TENANT_A, b: TENANT_B },
    });
  } catch (err) {
    console.warn("[cleanup] ALTER DELETE failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

async function checkTenantScopedEvaluation() {
  console.log("\n# tenant-scoped metric evaluation");

  // orgA: should see $1.75 of cost (3 spans × {0.5, 0.5, 0.75}). Comfortably
  // over the threshold of $1 → breached.
  const aValue = await evaluateMonitorMetric({
    tenantId: TENANT_A,
    metric: "cost",
    windowMinutes: 60,
  });
  // orgB: should see $5 (1 span × $5). Also over threshold, but the test
  // point is that the NUMBERS differ — orgA must not see orgB's $5.
  const bValue = await evaluateMonitorMetric({
    tenantId: TENANT_B,
    metric: "cost",
    windowMinutes: 60,
  });

  assert(
    Math.abs(aValue - 1.75) < 0.01,
    `orgA cost ≈ 1.75 (got ${aValue.toFixed(4)})`,
  );
  assert(
    Math.abs(bValue - 5) < 0.01,
    `orgB cost ≈ 5 (got ${bValue.toFixed(4)})`,
  );
  // The decisive check: if the tenant filter were missing or buggy, orgA's
  // result would carry orgB's $5 — the loud direction check catches it.
  assert(
    aValue < bValue,
    `tenant scope holds: orgA cost ${aValue} < orgB cost ${bValue}`,
  );

  // Sanity: the comparator in compareValue agrees with the breached state.
  assert(compareValue(aValue, "gt", 1) === true, `orgA breached (1.75 > 1)`);
  assert(compareValue(bValue, "gt", 1) === true, `orgB breached (5 > 1)`);
}

async function checkBuiltMetricQueryAllowlist() {
  console.log("\n# allowlist drift guard (buildMetricQuery)");
  let threw = false;
  try {
    // Cast to bypass the compile-time union; we're verifying the run-time
    // guard that defends the SQL boundary against a corrupt DB row.
    buildMetricQuery({
      metric: "phantom_metric" as unknown as "cost",
      windowMinutes: 60,
    });
  } catch (err) {
    threw = err instanceof Error && /unknown monitor metric/i.test(err.message);
  }
  assert(threw, `buildMetricQuery rejects unknown metric (defence in depth)`);
}

async function checkRouteUnauthorized() {
  console.log("\n# route auth: missing/wrong x-cron-token → 401");
  if (!CRON_SECRET) {
    console.log(
      `  ↷ skipped — CRON_SECRET not set in env, can't drive the route`,
    );
    return;
  }
  let res: Response;
  try {
    res = await fetch(CRON_ROUTE_URL, {
      method: "POST",
      headers: { "x-cron-token": "definitely-wrong" },
    });
  } catch (err) {
    console.log(
      `  ↷ skipped — route at ${CRON_ROUTE_URL} unreachable (${(err as Error).message})`,
    );
    return;
  }
  assert(
    res.status === 401,
    `wrong x-cron-token returns 401 (got ${res.status})`,
  );

  const noHeader = await fetch(CRON_ROUTE_URL, { method: "POST" });
  assert(
    noHeader.status === 401,
    `missing x-cron-token returns 401 (got ${noHeader.status})`,
  );
}

async function checkRouteStateMachineIdempotency(seeded: Seeded) {
  console.log("\n# route end-to-end + idempotency (firing→firing no-op)");
  if (!CRON_SECRET) {
    console.log(
      `  ↷ skipped — CRON_SECRET not set in env, can't drive the route`,
    );
    return;
  }

  let first: Response;
  try {
    first = await fetch(CRON_ROUTE_URL, {
      method: "POST",
      headers: { "x-cron-token": CRON_SECRET },
    });
  } catch (err) {
    console.log(
      `  ↷ skipped — route at ${CRON_ROUTE_URL} unreachable (${(err as Error).message})`,
    );
    return;
  }
  assert(first.status === 200, `first POST → 200 (got ${first.status})`);

  // After the first tick, monA must be firing and have exactly one trigger.
  const monAAfter1 = await prisma.monitor.findUnique({
    where: { id: seeded.monA.id },
  });
  const triggersAfter1 = await prisma.monitorTrigger.count({
    where: { monitorId: seeded.monA.id },
  });
  assert(
    monAAfter1?.state === "firing",
    `monA state=firing after first tick (got ${monAAfter1?.state})`,
  );
  assert(
    triggersAfter1 === 1,
    `monA has exactly 1 trigger after first tick (got ${triggersAfter1})`,
  );
  // lastValue should be roughly orgA's cost ($1.75), NOT orgB's $5.
  const lastValue = monAAfter1?.lastValue ?? 0;
  assert(
    Math.abs(lastValue - 1.75) < 0.01,
    `monA.lastValue ≈ 1.75 — NOT orgB's $5 (got ${lastValue})`,
  );

  // Second tick: firing→firing must be a no-op on triggers (idempotency).
  const second = await fetch(CRON_ROUTE_URL, {
    method: "POST",
    headers: { "x-cron-token": CRON_SECRET },
  });
  assert(second.status === 200, `second POST → 200 (got ${second.status})`);

  const triggersAfter2 = await prisma.monitorTrigger.count({
    where: { monitorId: seeded.monA.id },
  });
  assert(
    triggersAfter2 === 1,
    `monA STILL has 1 trigger after second tick — idempotent firing→firing (got ${triggersAfter2})`,
  );

  // Symmetric: monB is firing on its own data, with its own trigger.
  const monBAfter = await prisma.monitor.findUnique({
    where: { id: seeded.monB.id },
  });
  assert(
    monBAfter?.state === "firing",
    `monB state=firing (got ${monBAfter?.state})`,
  );
  const monBTriggers = await prisma.monitorTrigger.count({
    where: { monitorId: seeded.monB.id },
  });
  assert(
    monBTriggers === 1,
    `monB has exactly 1 trigger (got ${monBTriggers})`,
  );
}

async function runChecks(seeded: Seeded) {
  console.log(
    `\n[monitor-cron-tenant-isolation] tenant-A=${TENANT_A} tenant-B=${TENANT_B}`,
  );
  await checkTenantScopedEvaluation();
  await checkBuiltMetricQueryAllowlist();
  await checkRouteUnauthorized();
  await checkRouteStateMachineIdempotency(seeded);
}

async function main() {
  let seeded: Seeded | null = null;
  try {
    seeded = await insertFixtures();
    await runChecks(seeded);
  } finally {
    try {
      await deleteFixtures();
    } catch (err) {
      console.warn("[cleanup] failed to delete fixtures:", err);
    }
    await prisma.$disconnect();
    await clickhouse.close();
  }

  if (failures.length) {
    console.error(`\n[FAIL] ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n[PASS] all monitor-cron tenant-isolation assertions passed");
}

void main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
