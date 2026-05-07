/**
 * B2 acceptance check — `getLatencyPercentiles`, `getErrorRateOverTime`,
 * `getRecentFailures`, and `getSpansOverTimeByModel` must return rows that
 * belong to the supplied tenant ID and *only* that tenant's data.
 *
 * No vitest in this repo yet. This script runs on its own and asserts the
 * tenant-scoping property by:
 *   1. inserting synthetic spans for two distinct test tenants;
 *   2. calling each query with each tenant ID;
 *   3. asserting that tenant A never sees tenant B's data and vice-versa;
 *   4. deleting the synthetic rows.
 *
 * Run (requires the docker-compose stack up at `localhost:8123`):
 *
 *     # from dashboard/
 *     CLICKHOUSE_URL=http://localhost:8123 \
 *     CLICKHOUSE_USER=otel CLICKHOUSE_PASSWORD=otelpass \
 *     npx tsx __tests__/overview-tenant-isolation.ts
 *
 * (`npx tsx` is used rather than `node --experimental-strip-types` because
 * the imported query module relies on the Next.js `@/` path alias, which
 * Node's native TS stripper does not resolve.)
 *
 * When B6 lands and installs vitest, port the assertions to a real `it()`
 * block — the setup/teardown logic transfers verbatim.
 */

import { randomBytes } from "node:crypto";

import {
  getErrorRateOverTime,
  getLatencyPercentiles,
  getRecentFailures,
  getSpansOverTimeByModel,
} from "../src/lib/queries/overview";
import { clickhouse } from "../src/lib/clickhouse";

interface SyntheticSpan {
  Timestamp: string;
  TraceId: string;
  SpanId: string;
  ParentSpanId: string;
  TraceState: string;
  SpanName: string;
  SpanKind: string;
  ServiceName: string;
  ResourceAttributes: Record<string, string>;
  ScopeName: string;
  ScopeVersion: string;
  SpanAttributes: Record<string, string>;
  Duration: number;
  StatusCode: string;
  StatusMessage: string;
}

const runId = randomBytes(4).toString("hex");
const TENANT_A = `wardtest_${runId}_a`;
const TENANT_B = `wardtest_${runId}_b`;

const failures: string[] = [];

function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function makeSpan(opts: {
  tenantId: string;
  model: string;
  durationMs: number;
  status: "Ok" | "Error";
  ageSeconds?: number;
}): SyntheticSpan {
  const traceId = randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  const ts = new Date(Date.now() - (opts.ageSeconds ?? 0) * 1000).toISOString().replace("T", " ").replace("Z", "");

  return {
    Timestamp: ts,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: "",
    TraceState: "",
    SpanName: `chat ${opts.model}`,
    SpanKind: "Client",
    ServiceName: "wardtest-service",
    ResourceAttributes: {
      "ward.tenant_id": opts.tenantId,
      "service.name": "wardtest-service",
      "deployment.environment": "test",
    },
    ScopeName: "ward",
    ScopeVersion: "0.1.0",
    SpanAttributes: {
      "gen_ai.system": "openai",
      "gen_ai.request.model": opts.model,
      "gen_ai.usage.input_tokens": "100",
      "gen_ai.usage.output_tokens": "50",
      "gen_ai.usage.cost": "0.0015",
      "gen_ai.client.operation.duration": String(opts.durationMs / 1000),
    },
    Duration: Math.round(opts.durationMs * 1_000_000), // ms → ns
    StatusCode: opts.status,
    StatusMessage: opts.status === "Error" ? "synthetic test failure" : "",
  };
}

async function insertFixtures() {
  // Tenant A: 5 OK + 2 Error spans across two models.
  // Tenant B: 4 OK spans on a different model. No errors at all.
  // Different cardinality and status mix per tenant proves cross-leak loudly.
  const rows: SyntheticSpan[] = [
    makeSpan({ tenantId: TENANT_A, model: "gpt-4o", durationMs: 200, status: "Ok", ageSeconds: 60 }),
    makeSpan({ tenantId: TENANT_A, model: "gpt-4o", durationMs: 350, status: "Ok", ageSeconds: 90 }),
    makeSpan({ tenantId: TENANT_A, model: "gpt-4o", durationMs: 1200, status: "Ok", ageSeconds: 120 }),
    makeSpan({ tenantId: TENANT_A, model: "gpt-4o-mini", durationMs: 80, status: "Ok", ageSeconds: 150 }),
    makeSpan({ tenantId: TENANT_A, model: "gpt-4o-mini", durationMs: 95, status: "Ok", ageSeconds: 180 }),
    makeSpan({ tenantId: TENANT_A, model: "gpt-4o", durationMs: 5000, status: "Error", ageSeconds: 30 }),
    makeSpan({ tenantId: TENANT_A, model: "gpt-4o-mini", durationMs: 600, status: "Error", ageSeconds: 45 }),

    makeSpan({ tenantId: TENANT_B, model: "claude-3-5-sonnet-20241022", durationMs: 400, status: "Ok", ageSeconds: 50 }),
    makeSpan({ tenantId: TENANT_B, model: "claude-3-5-sonnet-20241022", durationMs: 500, status: "Ok", ageSeconds: 100 }),
    makeSpan({ tenantId: TENANT_B, model: "claude-3-5-sonnet-20241022", durationMs: 700, status: "Ok", ageSeconds: 150 }),
    makeSpan({ tenantId: TENANT_B, model: "claude-3-5-sonnet-20241022", durationMs: 900, status: "Ok", ageSeconds: 200 }),
  ];

  await clickhouse.insert({
    table: "otel_traces",
    values: rows,
    format: "JSONEachRow",
  });

  // Insert is async-flushed — give ClickHouse a beat to settle.
  await new Promise((r) => setTimeout(r, 500));
}

async function deleteFixtures() {
  // ALTER TABLE ... DELETE is asynchronous in ClickHouse; we don't block on
  // mutation completion because the run-id randomization keeps fixtures from
  // colliding even if deletion is delayed.
  await clickhouse.command({
    query: `
      ALTER TABLE otel_traces
      DELETE WHERE ResourceAttributes['ward.tenant_id'] IN ({a:String}, {b:String})
    `,
    query_params: { a: TENANT_A, b: TENANT_B },
  });
}

async function runChecks() {
  console.log(`\n[overview-tenant-isolation] tenant-A=${TENANT_A} tenant-B=${TENANT_B}`);

  console.log("\n# getLatencyPercentiles");
  const latA = await getLatencyPercentiles(TENANT_A, "1h");
  const latB = await getLatencyPercentiles(TENANT_B, "1h");
  assert(latA.length > 0, "tenant A returns at least one latency bucket");
  assert(latB.length > 0, "tenant B returns at least one latency bucket");
  // Tenant A has a 5000ms outlier; B's max sample is 900ms. p99 must reflect that.
  const aP99 = Math.max(...latA.map((r) => r.p99));
  const bP99 = Math.max(...latB.map((r) => r.p99));
  assert(aP99 >= 1000, `tenant A p99 ≥ 1000ms (got ${aP99.toFixed(1)})`);
  assert(bP99 < 1000, `tenant B p99 < 1000ms (got ${bP99.toFixed(1)})`);
  assert(aP99 !== bP99, "A and B see distinct p99 distributions (no leak)");

  console.log("\n# getErrorRateOverTime");
  const errA = await getErrorRateOverTime(TENANT_A, "1h");
  const errB = await getErrorRateOverTime(TENANT_B, "1h");
  const errorsA = errA.reduce((sum, r) => sum + r.errors, 0);
  const errorsB = errB.reduce((sum, r) => sum + r.errors, 0);
  assert(errorsA === 2, `tenant A sees exactly 2 errors (got ${errorsA})`);
  assert(errorsB === 0, `tenant B sees zero errors (got ${errorsB})`);

  console.log("\n# getRecentFailures");
  const failsA = await getRecentFailures(TENANT_A, 10);
  const failsB = await getRecentFailures(TENANT_B, 10);
  assert(failsA.length === 2, `tenant A: 2 recent failures (got ${failsA.length})`);
  assert(failsB.length === 0, `tenant B: 0 recent failures (got ${failsB.length})`);
  assert(
    failsA.every((f) => f.statusMessage === "synthetic test failure"),
    "tenant A failures carry the synthetic StatusMessage (no foreign rows)",
  );

  console.log("\n# getSpansOverTimeByModel");
  const modelsA = await getSpansOverTimeByModel(TENANT_A, "1h");
  const modelsB = await getSpansOverTimeByModel(TENANT_B, "1h");
  const modelsSeenByA = new Set(modelsA.map((r) => r.model));
  const modelsSeenByB = new Set(modelsB.map((r) => r.model));
  assert(modelsSeenByA.has("gpt-4o"), "A sees gpt-4o");
  assert(modelsSeenByA.has("gpt-4o-mini"), "A sees gpt-4o-mini");
  assert(!modelsSeenByA.has("claude-3-5-sonnet-20241022"), "A does NOT see Claude (B's model)");
  assert(modelsSeenByB.has("claude-3-5-sonnet-20241022"), "B sees claude-3-5-sonnet");
  assert(!modelsSeenByB.has("gpt-4o"), "B does NOT see gpt-4o (A's model)");

  console.log("\n# requireTenantId guard");
  let threw = false;
  try {
    // @ts-expect-error — intentionally violating the type to prove the guard.
    await getLatencyPercentiles(undefined, "1h");
  } catch {
    threw = true;
  }
  assert(threw, "missing tenant id throws via requireTenantId()");

  let blankThrew = false;
  try {
    await getRecentFailures("", 5);
  } catch {
    blankThrew = true;
  }
  assert(blankThrew, "blank tenant id throws via requireTenantId()");
}

async function main() {
  try {
    await insertFixtures();
    await runChecks();
  } finally {
    try {
      await deleteFixtures();
    } catch (err) {
      console.warn("[cleanup] failed to delete fixtures:", err);
    }
    await clickhouse.close();
  }

  if (failures.length) {
    console.error(`\n[FAIL] ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n[PASS] all tenant-isolation assertions passed");
}

void main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
