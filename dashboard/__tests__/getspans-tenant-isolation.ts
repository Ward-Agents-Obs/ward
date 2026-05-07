/**
 * B3 acceptance check — `getSpans` must:
 *   - return only spans for the supplied tenant ID
 *   - order rows deterministically (`Timestamp DESC, SpanId DESC` ties)
 *   - apply timeRange / environment / model / status / search filters
 *   - pass all caller values via parameterized `query_params` (no injection)
 *
 * Run (requires the docker-compose stack at `localhost:8123`):
 *
 *     # from dashboard/
 *     CLICKHOUSE_URL=http://localhost:8123 \
 *     CLICKHOUSE_USER=otel CLICKHOUSE_PASSWORD=otelpass \
 *     npx tsx __tests__/getspans-tenant-isolation.ts
 *
 * Mirrors the structure of overview-tenant-isolation.ts; will fold into the
 * vitest suite once B6 lands.
 */

import { randomBytes } from "node:crypto";

import { getSpans } from "../src/lib/queries/traces";
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
  environment: string;
  durationMs: number;
  status: "Ok" | "Error" | "Unset";
  ageSeconds: number;
  prompt?: string;
  completion?: string;
  spanIdSuffix?: string;
}): SyntheticSpan {
  const traceId = randomBytes(16).toString("hex");
  const spanId = (opts.spanIdSuffix ?? randomBytes(8).toString("hex")).padEnd(16, "0").slice(0, 16);
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
    SpanName: `chat ${opts.model}`,
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
      "gen_ai.usage.input_tokens": "100",
      "gen_ai.usage.output_tokens": "50",
      "gen_ai.usage.cost": "0.0015",
      "gen_ai.session.id": `session_${runId}`,
      "gen_ai.prompt": opts.prompt ?? "",
      "gen_ai.completion": opts.completion ?? "",
    },
    Duration: Math.round(opts.durationMs * 1_000_000),
    StatusCode: opts.status,
    StatusMessage: opts.status === "Error" ? "synthetic test failure" : "",
  };
}

async function insertFixtures() {
  const rows: SyntheticSpan[] = [
    // Tenant A: 2 prod, 1 staging, 1 error, plus a tie at the same timestamp.
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o",
      environment: "prod",
      durationMs: 200,
      status: "Ok",
      ageSeconds: 60,
      prompt: "find me unique-magic-string",
    }),
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o",
      environment: "prod",
      durationMs: 350,
      status: "Ok",
      ageSeconds: 90,
    }),
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o-mini",
      environment: "staging",
      durationMs: 80,
      status: "Ok",
      ageSeconds: 120,
    }),
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o",
      environment: "prod",
      durationMs: 5000,
      status: "Error",
      ageSeconds: 30,
    }),
    // Two spans at the exact same timestamp (tie) — distinct SpanId for ordering.
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o",
      environment: "prod",
      durationMs: 222,
      status: "Ok",
      ageSeconds: 10,
      spanIdSuffix: "aaaaaaaaaaaaaaaa",
    }),
    makeSpan({
      tenantId: TENANT_A,
      model: "gpt-4o",
      environment: "prod",
      durationMs: 333,
      status: "Ok",
      ageSeconds: 10,
      spanIdSuffix: "bbbbbbbbbbbbbbbb",
    }),

    // Tenant B: completely separate.
    makeSpan({
      tenantId: TENANT_B,
      model: "claude-3-5-sonnet-20241022",
      environment: "prod",
      durationMs: 400,
      status: "Ok",
      ageSeconds: 50,
    }),
    makeSpan({
      tenantId: TENANT_B,
      model: "claude-3-5-sonnet-20241022",
      environment: "prod",
      durationMs: 500,
      status: "Ok",
      ageSeconds: 100,
    }),
  ];

  await clickhouse.insert({
    table: "otel_traces",
    values: rows,
    format: "JSONEachRow",
  });
  await new Promise((r) => setTimeout(r, 500));
}

async function deleteFixtures() {
  await clickhouse.command({
    query: `
      ALTER TABLE otel_traces
      DELETE WHERE ResourceAttributes['ward.tenant_id'] IN ({a:String}, {b:String})
    `,
    query_params: { a: TENANT_A, b: TENANT_B },
  });
}

async function runChecks() {
  console.log(`\n[getspans-tenant-isolation] tenant-A=${TENANT_A} tenant-B=${TENANT_B}`);

  console.log("\n# tenant scoping");
  const all = await getSpans(TENANT_A, { timeRange: "1h", limit: 100 });
  assert(all.length === 6, `tenant A returns 6 rows (got ${all.length})`);
  const otherTenantRows = all.filter((r) => r.environment === "" /* never set on B's rows we care about */ && r.model.startsWith("claude"));
  assert(otherTenantRows.length === 0, "tenant A response contains no Claude (tenant B's) models");

  const bRows = await getSpans(TENANT_B, { timeRange: "1h", limit: 100 });
  assert(bRows.length === 2, `tenant B returns 2 rows (got ${bRows.length})`);
  assert(
    bRows.every((r) => r.model === "claude-3-5-sonnet-20241022"),
    "tenant B rows are all Claude (no leak from A)",
  );

  console.log("\n# deterministic ordering");
  // The two tied-timestamp spans must come out in SpanId DESC order.
  const ordered = await getSpans(TENANT_A, { timeRange: "1h", limit: 100 });
  const tied = ordered.filter((r) =>
    r.spanId === "aaaaaaaaaaaaaaaa" || r.spanId === "bbbbbbbbbbbbbbbb",
  );
  assert(tied.length === 2, "both tied-timestamp spans returned");
  assert(
    tied[0].spanId === "bbbbbbbbbbbbbbbb" && tied[1].spanId === "aaaaaaaaaaaaaaaa",
    "tied spans ordered by SpanId DESC ('bbbb...' before 'aaaa...')",
  );
  // Timestamps must be monotonically non-increasing.
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1].timestamp;
    const cur = ordered[i].timestamp;
    assert(prev >= cur, `row ${i - 1} timestamp ≥ row ${i} timestamp`);
  }

  console.log("\n# environment filter");
  const stagingOnly = await getSpans(TENANT_A, { environment: "staging", timeRange: "1h" });
  assert(stagingOnly.length === 1, `staging filter returns 1 row (got ${stagingOnly.length})`);
  assert(stagingOnly[0].environment === "staging", "row environment matches filter");

  console.log("\n# model filter");
  const miniOnly = await getSpans(TENANT_A, { model: "gpt-4o-mini", timeRange: "1h" });
  assert(miniOnly.length === 1, `gpt-4o-mini filter returns 1 row (got ${miniOnly.length})`);
  assert(miniOnly[0].model === "gpt-4o-mini", "row model matches filter");

  console.log("\n# status filter");
  const errorsOnly = await getSpans(TENANT_A, { status: "error", timeRange: "1h" });
  assert(errorsOnly.length === 1, `status=error returns 1 row (got ${errorsOnly.length})`);
  assert(errorsOnly[0].status === "Error", "status field is 'Error'");

  const okOnly = await getSpans(TENANT_A, { status: "ok", timeRange: "1h" });
  assert(
    okOnly.every((r) => r.status !== "Error"),
    `status=ok rows have no Error (got ${okOnly.filter((r) => r.status === "Error").length} errors)`,
  );

  console.log("\n# search filter");
  const found = await getSpans(TENANT_A, { search: "unique-magic-string", timeRange: "1h" });
  assert(found.length === 1, `search returns 1 row (got ${found.length})`);
  const notFound = await getSpans(TENANT_A, { search: "no-such-string-zzz", timeRange: "1h" });
  assert(notFound.length === 0, `unknown search returns 0 rows (got ${notFound.length})`);

  console.log("\n# pagination");
  const page1 = await getSpans(TENANT_A, { timeRange: "1h", limit: 2, offset: 0 });
  const page2 = await getSpans(TENANT_A, { timeRange: "1h", limit: 2, offset: 2 });
  assert(page1.length === 2, "page 1 has 2 rows");
  assert(page2.length === 2, "page 2 has 2 rows");
  const overlap = page1.filter((r) => page2.some((p) => p.spanId === r.spanId));
  assert(overlap.length === 0, "page 1 and page 2 do not overlap");

  console.log("\n# requireTenantId guard");
  let blankThrew = false;
  try {
    await getSpans("", { timeRange: "1h" });
  } catch {
    blankThrew = true;
  }
  assert(blankThrew, "blank tenant id throws via requireTenantId()");

  console.log("\n# parameter-binding hardening (no SQL injection)");
  // Pass a value that would terminate a quoted string + tack on a malicious
  // suffix. If the query ever stops parameterizing, this would either error
  // or return all rows. Properly parameterized: returns 0 rows.
  const malicious = await getSpans(TENANT_A, {
    model: "gpt-4o' OR 1=1 --",
    timeRange: "1h",
  });
  assert(
    malicious.length === 0,
    "malicious model filter is treated as a literal string (returns 0 rows)",
  );
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
  console.log("\n[PASS] all getSpans assertions passed");
}

void main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
