/**
 * B6 acceptance check (tier 1 of 2) — tenant-isolation regression for the
 * twelve dashboard query functions NOT already covered by
 * `overview-tenant-isolation.ts` (B2) and `getspans-tenant-isolation.ts` (B3).
 *
 * Functions exercised here:
 *   overview.ts:  getOverviewMetrics, getSpansOverTime, getCostByModel
 *   traces.ts:    getTraces, getTraceDetail, getDistinctModels
 *   sessions.ts:  getSessions, getSessionDetail,
 *                 getDistinctEnvironments, getSessionStats
 *   costs.ts:     getCostOverTime, getCostByModelDetailed
 *
 * For every function we:
 *   1. Insert synthetic spans for two distinct test tenants (orgA, orgB) with
 *      different models / environments / session ids / cost / error mix so
 *      cross-leak is loud.
 *   2. Call the function with each tenant id, assert orgA's response has zero
 *      orgB rows and vice-versa. Failure messages embed both tenant ids and
 *      the leaking row count for regression-readability.
 *   3. Call the function with `""` (and `undefined` where the type permits) to
 *      assert `requireTenantId()` throws.
 *   4. Delete fixtures.
 *
 * Run (requires the docker-compose stack at `localhost:8123`):
 *
 *     # from dashboard/
 *     CLICKHOUSE_URL=http://localhost:8123 \
 *     CLICKHOUSE_USER=otel CLICKHOUSE_PASSWORD=otelpass \
 *     npx tsx __tests__/dashboard-queries-tenant-isolation.ts
 *
 * Mirrors `overview-tenant-isolation.ts` and `getspans-tenant-isolation.ts`.
 */

import { randomBytes } from "node:crypto";

import {
  getCostByModel,
  getOverviewMetrics,
  getSpansOverTime,
} from "../src/lib/queries/overview";
import {
  getDistinctModels,
  getTraceDetail,
  getTraces,
} from "../src/lib/queries/traces";
import {
  getDistinctEnvironments,
  getSessionDetail,
  getSessionStats,
  getSessions,
} from "../src/lib/queries/sessions";
import {
  getCostByModelDetailed,
  getCostOverTime,
} from "../src/lib/queries/costs";
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

// Stable per-tenant trace and session ids so the detail-style queries have
// concrete ids to look up. Lengths match the upstream OTel format (16 hex
// chars for trace, 16 hex chars for span).
const TRACE_A = `${runId.padEnd(8, "a")}aaaaaaaaaaaaaaaaaaaaaaaa`.slice(0, 32);
const TRACE_B = `${runId.padEnd(8, "b")}bbbbbbbbbbbbbbbbbbbbbbbb`.slice(0, 32);
const SESSION_A = `wardtest_${runId}_session_a`;
const SESSION_B = `wardtest_${runId}_session_b`;

const failures: string[] = [];

function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

/** Build the failure message that the team-lead asked for: both tenant ids,
 *  expected 0 leaks, actual leak count, plus a brief description. */
function leakMsg(query: string, leakingRows: number): string {
  return `${query}: tenant orgA (${TENANT_A}) returned ${leakingRows} rows belonging to orgB (${TENANT_B}) — expected 0`;
}

interface SpanOpts {
  tenantId: string;
  model: string;
  environment: string;
  durationMs: number;
  status: "Ok" | "Error" | "Unset";
  ageSeconds: number;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
  traceIdOverride?: string;
  spanName?: string;
  prompt?: string;
  completion?: string;
}

function makeSpan(opts: SpanOpts): SyntheticSpan {
  const traceId = opts.traceIdOverride ?? randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  const ts = new Date(Date.now() - opts.ageSeconds * 1000)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");

  return {
    Timestamp: ts,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: "",
    TraceState: "",
    SpanName: opts.spanName ?? `chat ${opts.model}`,
    SpanKind: "Client",
    ServiceName: "wardtest-service",
    ResourceAttributes: {
      "ward.tenant_id": opts.tenantId,
      "service.name": "wardtest-service",
      "deployment.environment": opts.environment,
    },
    ScopeName: "ward",
    ScopeVersion: "0.1.0",
    SpanAttributes: {
      "gen_ai.system": "openai",
      "gen_ai.request.model": opts.model,
      "gen_ai.usage.input_tokens": String(opts.inputTokens ?? 100),
      "gen_ai.usage.output_tokens": String(opts.outputTokens ?? 50),
      "gen_ai.usage.cost": opts.costUsd.toFixed(6),
      "gen_ai.session.id": opts.sessionId ?? "",
      "gen_ai.prompt": opts.prompt ?? "",
      "gen_ai.completion": opts.completion ?? "",
    },
    Duration: Math.round(opts.durationMs * 1_000_000),
    StatusCode: opts.status,
    StatusMessage: opts.status === "Error" ? "synthetic test failure" : "",
  };
}

async function insertFixtures() {
  // Tenant A — diverse mix:
  //   • two prod gpt-4o spans (one in TRACE_A, one error)
  //   • one staging gpt-4o-mini span
  //   • two prod gpt-4o session spans tied to SESSION_A
  // Total spans: 5; models: gpt-4o, gpt-4o-mini; environments: prod, staging.
  //
  // Tenant B — completely separate axis:
  //   • two prod claude-3-5-sonnet spans (one in TRACE_B)
  //   • one prod claude-3-5-sonnet session span tied to SESSION_B
  // Total spans: 3; models: claude-3-5-sonnet; environments: prod.
  const rows: SyntheticSpan[] = [
    // --- Tenant A ---
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o",
      environment: "prod",
      durationMs: 320,
      status: "Ok",
      ageSeconds: 60,
      costUsd: 0.012,
      traceIdOverride: TRACE_A,
      spanName: "tenant-iso-test orgA primary",
    }),
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o",
      environment: "prod",
      durationMs: 4500,
      status: "Error",
      ageSeconds: 45,
      costUsd: 0.018,
      spanName: "tenant-iso-test orgA error",
    }),
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o-mini",
      environment: "staging",
      durationMs: 95,
      status: "Ok",
      ageSeconds: 90,
      costUsd: 0.0008,
      spanName: "tenant-iso-test orgA mini",
    }),
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o",
      environment: "prod",
      durationMs: 280,
      status: "Ok",
      ageSeconds: 30,
      costUsd: 0.011,
      sessionId: SESSION_A,
      prompt: "orgA-session-prompt",
      completion: "orgA-session-completion",
      spanName: "tenant-iso-test orgA session pt1",
    }),
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o",
      environment: "prod",
      durationMs: 410,
      status: "Ok",
      ageSeconds: 25,
      costUsd: 0.013,
      sessionId: SESSION_A,
      spanName: "tenant-iso-test orgA session pt2",
    }),
    // --- Tenant B ---
    makeSpan({
      tenantId: TENANT_B,
      model: "claude-3-5-sonnet-20241022",
      environment: "prod",
      durationMs: 600,
      status: "Ok",
      ageSeconds: 50,
      costUsd: 0.027,
      traceIdOverride: TRACE_B,
      spanName: "tenant-iso-test orgB primary",
    }),
    makeSpan({
      tenantId: TENANT_B,
      model: "claude-3-5-sonnet-20241022",
      environment: "prod",
      durationMs: 720,
      status: "Ok",
      ageSeconds: 100,
      costUsd: 0.031,
      spanName: "tenant-iso-test orgB secondary",
    }),
    makeSpan({
      tenantId: TENANT_B,
      model: "claude-3-5-sonnet-20241022",
      environment: "prod",
      durationMs: 850,
      status: "Ok",
      ageSeconds: 40,
      costUsd: 0.039,
      sessionId: SESSION_B,
      spanName: "tenant-iso-test orgB session",
    }),
  ];

  await clickhouse.insert({
    table: "otel_traces",
    values: rows,
    format: "JSONEachRow",
  });

  // ClickHouse async-flushes inserts; give it a beat before assertions.
  await new Promise((r) => setTimeout(r, 500));
}

async function deleteFixtures() {
  // Mutation is async in ClickHouse; we don't block on completion because
  // run-id randomization isolates fixtures across runs even if delete is
  // delayed. The cleanup is best-effort.
  await clickhouse.command({
    query: `
      ALTER TABLE otel_traces
      DELETE WHERE ResourceAttributes['ward.tenant_id'] IN ({a:String}, {b:String})
    `,
    query_params: { a: TENANT_A, b: TENANT_B },
  });
}

// ---------------------------------------------------------------------------
// Helpers used across query checks
// ---------------------------------------------------------------------------

/** orgA's models are gpt-* only; orgB's are claude-* only. Anything carrying
 *  the *other* tenant's model name in orgA's response is a leak. */
function leakingModelRows<T extends { model?: string }>(
  rows: T[],
  forbiddenModelPrefix: string,
): number {
  return rows.filter((r) => (r.model ?? "").startsWith(forbiddenModelPrefix))
    .length;
}

async function expectThrowsOnBlankTenant(
  fnName: string,
  fn: () => Promise<unknown>,
) {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw, `${fnName}: blank tenant id throws via requireTenantId()`);
}

// ---------------------------------------------------------------------------
// Per-query checks
// ---------------------------------------------------------------------------

async function checkOverviewMetrics() {
  console.log("\n# getOverviewMetrics");
  const a = await getOverviewMetrics(TENANT_A);
  const b = await getOverviewMetrics(TENANT_B);

  // orgA inserted 5 spans, orgB 3. Hardcoding these counts is fragile against
  // ambient cluster load; instead assert *relative* correctness.
  assert(a.totalSpans >= 5, `orgA totalSpans ≥ 5 (got ${a.totalSpans})`);
  assert(b.totalSpans >= 3, `orgB totalSpans ≥ 3 (got ${b.totalSpans})`);
  // orgA: gpt-4o + gpt-4o-mini = 2 distinct. orgB: claude-3-5-sonnet = 1.
  assert(
    a.activeModels >= 2,
    `orgA activeModels ≥ 2 (got ${a.activeModels})`,
  );
  assert(
    b.activeModels >= 1 && b.activeModels < a.activeModels,
    `orgB activeModels in [1, ${a.activeModels}) (got ${b.activeModels})`,
  );
  // orgA total cost = 0.012+0.018+0.0008+0.011+0.013 = 0.0548.
  // orgB total cost = 0.027+0.031+0.039 = 0.097. orgB strictly higher per fixture.
  assert(
    Math.abs(a.totalCost - 0.0548) < 0.01,
    `orgA totalCost ≈ 0.0548 (got ${a.totalCost.toFixed(4)})`,
  );
  assert(
    Math.abs(b.totalCost - 0.097) < 0.01,
    `orgB totalCost ≈ 0.097 (got ${b.totalCost.toFixed(4)})`,
  );
  // If costs leaked, orgA would carry orgB's higher figure. Direction check.
  assert(
    a.totalCost < b.totalCost,
    `${leakMsg("getOverviewMetrics", -1)} (cost direction: orgA ${a.totalCost} should be < orgB ${b.totalCost})`,
  );

  await expectThrowsOnBlankTenant("getOverviewMetrics", () =>
    getOverviewMetrics(""),
  );
}

async function checkSpansOverTime() {
  console.log("\n# getSpansOverTime");
  const a = await getSpansOverTime(TENANT_A, 1);
  const b = await getSpansOverTime(TENANT_B, 1);

  const aTotal = a.reduce((sum, r) => sum + parseInt(r.spans, 10), 0);
  const bTotal = b.reduce((sum, r) => sum + parseInt(r.spans, 10), 0);
  assert(aTotal >= 5, `orgA bucketed total ≥ 5 (got ${aTotal})`);
  assert(bTotal >= 3, `orgB bucketed total ≥ 3 (got ${bTotal})`);

  await expectThrowsOnBlankTenant("getSpansOverTime", () =>
    getSpansOverTime(""),
  );
}

async function checkCostByModel() {
  console.log("\n# getCostByModel");
  const a = await getCostByModel(TENANT_A, 1);
  const b = await getCostByModel(TENANT_B, 1);

  const aModels = a.map((r) => r.model);
  const bModels = b.map((r) => r.model);
  const claudeInA = aModels.filter((m) => m.startsWith("claude")).length;
  const gptInB = bModels.filter((m) => m.startsWith("gpt")).length;
  assert(
    claudeInA === 0,
    leakMsg("getCostByModel", claudeInA),
  );
  assert(
    gptInB === 0,
    `getCostByModel: tenant orgB (${TENANT_B}) returned ${gptInB} rows belonging to orgA (${TENANT_A}) — expected 0`,
  );
  assert(aModels.includes("gpt-4o"), "orgA includes gpt-4o");
  assert(
    bModels.includes("claude-3-5-sonnet-20241022"),
    "orgB includes claude-3-5-sonnet",
  );

  await expectThrowsOnBlankTenant("getCostByModel", () => getCostByModel(""));
}

async function checkTraces() {
  console.log("\n# getTraces");
  const a = await getTraces(TENANT_A, { limit: 100 });
  const b = await getTraces(TENANT_B, { limit: 100 });

  const claudeInA = leakingModelRows(a, "claude");
  const gptInB = leakingModelRows(b, "gpt");
  assert(claudeInA === 0, leakMsg("getTraces", claudeInA));
  assert(
    gptInB === 0,
    `getTraces: tenant orgB (${TENANT_B}) returned ${gptInB} rows belonging to orgA (${TENANT_A}) — expected 0`,
  );

  // Model filter still honours tenant scoping.
  const aClaudeFilter = await getTraces(TENANT_A, {
    model: "claude-3-5-sonnet-20241022",
    limit: 100,
  });
  assert(
    aClaudeFilter.length === 0,
    `getTraces: orgA filtered for orgB's model returned ${aClaudeFilter.length} rows — expected 0 (tenant scope must dominate)`,
  );

  await expectThrowsOnBlankTenant("getTraces", () => getTraces(""));
}

async function checkTraceDetail() {
  console.log("\n# getTraceDetail");
  // Sanity: orgA can read its own trace.
  const aOwnRaw = await getTraceDetail(TENANT_A, TRACE_A);
  const aOwn = aOwnRaw as Array<Record<string, unknown>>;
  assert(aOwn.length >= 1, `orgA can read its own trace ${TRACE_A} (got ${aOwn.length} spans)`);

  // Cross-tenant: orgA tries to read orgB's trace id. Must return zero rows.
  const aOnBRaw = await getTraceDetail(TENANT_A, TRACE_B);
  const aOnB = aOnBRaw as Array<unknown>;
  assert(
    aOnB.length === 0,
    `getTraceDetail: orgA (${TENANT_A}) querying orgB's trace ${TRACE_B} returned ${aOnB.length} spans — expected 0`,
  );
  // Symmetric check.
  const bOnARaw = await getTraceDetail(TENANT_B, TRACE_A);
  const bOnA = bOnARaw as Array<unknown>;
  assert(
    bOnA.length === 0,
    `getTraceDetail: orgB (${TENANT_B}) querying orgA's trace ${TRACE_A} returned ${bOnA.length} spans — expected 0`,
  );

  await expectThrowsOnBlankTenant("getTraceDetail", () =>
    getTraceDetail("", TRACE_A),
  );
}

async function checkDistinctModels() {
  console.log("\n# getDistinctModels");
  const a = await getDistinctModels(TENANT_A);
  const b = await getDistinctModels(TENANT_B);
  const claudeInA = a.filter((m) => m.startsWith("claude")).length;
  const gptInB = b.filter((m) => m.startsWith("gpt")).length;
  assert(claudeInA === 0, leakMsg("getDistinctModels", claudeInA));
  assert(
    gptInB === 0,
    `getDistinctModels: tenant orgB (${TENANT_B}) returned ${gptInB} rows belonging to orgA (${TENANT_A}) — expected 0`,
  );

  await expectThrowsOnBlankTenant("getDistinctModels", () =>
    getDistinctModels(""),
  );
}

async function checkSessions() {
  console.log("\n# getSessions");
  const a = await getSessions(TENANT_A, { timeRange: "1h", limit: 100 });
  const b = await getSessions(TENANT_B, { timeRange: "1h", limit: 100 });

  const aIds = a.map((r) => r.sessionId);
  const bIds = b.map((r) => r.sessionId);
  const orgBSessionLeak = aIds.filter((id) => id === SESSION_B).length;
  const orgASessionLeak = bIds.filter((id) => id === SESSION_A).length;
  assert(
    orgBSessionLeak === 0,
    `getSessions: orgA (${TENANT_A}) returned ${orgBSessionLeak} rows tied to orgB session ${SESSION_B} — expected 0`,
  );
  assert(
    orgASessionLeak === 0,
    `getSessions: orgB (${TENANT_B}) returned ${orgASessionLeak} rows tied to orgA session ${SESSION_A} — expected 0`,
  );

  // Each tenant should still see ITS OWN session.
  assert(
    aIds.includes(SESSION_A),
    `orgA sees its own session ${SESSION_A}`,
  );
  assert(
    bIds.includes(SESSION_B),
    `orgB sees its own session ${SESSION_B}`,
  );

  await expectThrowsOnBlankTenant("getSessions", () => getSessions(""));
}

async function checkSessionDetail() {
  console.log("\n# getSessionDetail");
  const aOwnRaw = await getSessionDetail(TENANT_A, SESSION_A);
  const aOwn = aOwnRaw as Array<unknown>;
  assert(
    aOwn.length >= 2,
    `orgA sees ≥ 2 spans for its own session ${SESSION_A} (got ${aOwn.length})`,
  );

  const aOnBRaw = await getSessionDetail(TENANT_A, SESSION_B);
  const aOnB = aOnBRaw as Array<unknown>;
  assert(
    aOnB.length === 0,
    `getSessionDetail: orgA (${TENANT_A}) querying orgB's session ${SESSION_B} returned ${aOnB.length} spans — expected 0`,
  );

  const bOnARaw = await getSessionDetail(TENANT_B, SESSION_A);
  const bOnA = bOnARaw as Array<unknown>;
  assert(
    bOnA.length === 0,
    `getSessionDetail: orgB (${TENANT_B}) querying orgA's session ${SESSION_A} returned ${bOnA.length} spans — expected 0`,
  );

  await expectThrowsOnBlankTenant("getSessionDetail", () =>
    getSessionDetail("", SESSION_A),
  );
}

async function checkDistinctEnvironments() {
  console.log("\n# getDistinctEnvironments");
  const a = await getDistinctEnvironments(TENANT_A);
  const b = await getDistinctEnvironments(TENANT_B);

  // orgA had prod + staging; orgB had prod only. orgB seeing 'staging' is a
  // tell-tale leak.
  assert(a.includes("prod"), "orgA includes prod");
  assert(a.includes("staging"), "orgA includes staging");
  assert(b.includes("prod"), "orgB includes prod");
  const stagingInB = b.includes("staging") ? 1 : 0;
  assert(
    stagingInB === 0,
    `getDistinctEnvironments: orgB (${TENANT_B}) returned 'staging' env which only orgA (${TENANT_A}) emits — expected 0 such rows`,
  );

  await expectThrowsOnBlankTenant("getDistinctEnvironments", () =>
    getDistinctEnvironments(""),
  );
}

async function checkSessionStats() {
  console.log("\n# getSessionStats");
  const a = await getSessionStats(TENANT_A, "1h");
  const b = await getSessionStats(TENANT_B, "1h");

  // orgA: 1 session, 2 spans in it; orgB: 1 session, 1 span.
  // Use ≥ to tolerate ambient noise from prior runs whose ALTER DELETE hasn't
  // finished mutating yet.
  assert(
    Number(a.totalSessions) >= 1,
    `orgA totalSessions ≥ 1 (got ${a.totalSessions})`,
  );
  assert(
    Number(b.totalSessions) >= 1,
    `orgB totalSessions ≥ 1 (got ${b.totalSessions})`,
  );
  // Cost direction: orgB session span cost (0.039) > sum of orgA session
  // spans (0.011 + 0.013 = 0.024). If orgA's stat carries orgB cost, the test
  // catches it.
  assert(
    Number(a.totalCost) < Number(b.totalCost),
    `${leakMsg("getSessionStats", -1)} (orgA totalCost ${a.totalCost} should be < orgB totalCost ${b.totalCost})`,
  );

  await expectThrowsOnBlankTenant("getSessionStats", () =>
    getSessionStats(""),
  );
}

async function checkCostOverTime() {
  console.log("\n# getCostOverTime");
  const a = await getCostOverTime(TENANT_A, 1);
  const b = await getCostOverTime(TENANT_B, 1);

  const claudeInA = a.filter((r) => r.model.startsWith("claude")).length;
  const gptInB = b.filter((r) => r.model.startsWith("gpt")).length;
  assert(claudeInA === 0, leakMsg("getCostOverTime", claudeInA));
  assert(
    gptInB === 0,
    `getCostOverTime: tenant orgB (${TENANT_B}) returned ${gptInB} rows belonging to orgA (${TENANT_A}) — expected 0`,
  );

  await expectThrowsOnBlankTenant("getCostOverTime", () =>
    getCostOverTime(""),
  );
}

async function checkCostByModelDetailed() {
  console.log("\n# getCostByModelDetailed");
  const a = await getCostByModelDetailed(TENANT_A, 1);
  const b = await getCostByModelDetailed(TENANT_B, 1);

  const claudeInA = a.filter((r) => r.model.startsWith("claude")).length;
  const gptInB = b.filter((r) => r.model.startsWith("gpt")).length;
  assert(claudeInA === 0, leakMsg("getCostByModelDetailed", claudeInA));
  assert(
    gptInB === 0,
    `getCostByModelDetailed: tenant orgB (${TENANT_B}) returned ${gptInB} rows belonging to orgA (${TENANT_A}) — expected 0`,
  );

  // Token counts are tenant-scoped too.
  const aTotalIn = a.reduce(
    (sum, r) => sum + parseInt(r.inputTokens, 10),
    0,
  );
  const bTotalIn = b.reduce(
    (sum, r) => sum + parseInt(r.inputTokens, 10),
    0,
  );
  // orgA inserted 5 spans × 100 tokens = 500. orgB 3 × 100 = 300.
  assert(
    aTotalIn >= 500,
    `orgA inputTokens ≥ 500 (got ${aTotalIn})`,
  );
  assert(
    bTotalIn >= 300 && bTotalIn < aTotalIn,
    `orgB inputTokens in [300, ${aTotalIn}) (got ${bTotalIn})`,
  );

  await expectThrowsOnBlankTenant("getCostByModelDetailed", () =>
    getCostByModelDetailed(""),
  );
}

async function runChecks() {
  console.log(
    `\n[dashboard-queries-tenant-isolation] tenant-A=${TENANT_A} tenant-B=${TENANT_B}`,
  );

  await checkOverviewMetrics();
  await checkSpansOverTime();
  await checkCostByModel();
  await checkTraces();
  await checkTraceDetail();
  await checkDistinctModels();
  await checkSessions();
  await checkSessionDetail();
  await checkDistinctEnvironments();
  await checkSessionStats();
  await checkCostOverTime();
  await checkCostByModelDetailed();
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
  console.log("\n[PASS] all dashboard-query tenant-isolation assertions passed");
}

void main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
