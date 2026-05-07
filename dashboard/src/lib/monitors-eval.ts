/**
 * Shared monitor metric evaluation helpers.
 *
 * Single source of truth for the ClickHouse expressions, comparator semantics,
 * and window-boundary computation used by:
 *   • `app/api/cron/evaluate-monitors/route.ts` (#16) — periodic evaluation
 *   • `lib/monitors.ts::previewMonitorMetric` (#17) — modal preview pane
 *
 * Concretely guards against the three risks called out in
 * `.agents/monitors-implementation-risks.md`:
 *
 *   1. State-transition race — the worker route uses `prisma.$transaction`
 *      with `SELECT ... FOR UPDATE` on the Monitor row. Nothing in *this*
 *      module locks; this is just the metric-computation half.
 *
 *   2. Window-boundary drift — both worker and preview call
 *      `evaluateMonitorMetric()` (or `buildMetricQuery()` directly) so the
 *      `Timestamp >= now() - INTERVAL N MINUTE` clause is byte-identical
 *      across both code paths. Drifting one without the other would make a
 *      user see one preview value at create-time and a different value when
 *      the monitor fires.
 *
 *   3. Allowlist drift — `metric` and `comparator` are typed as the same
 *      literal unions (`MonitorMetric`, `MonitorComparator`) re-exported from
 *      `@/lib/monitors`. The `METRIC_EXPRESSIONS` table is keyed on those
 *      types so adding a new metric there forces a corresponding update to
 *      the union (and the form's segmented control). zod at the action layer
 *      remains the source of truth for run-time validation; this module
 *      defends the SQL boundary.
 *
 * Tenant scoping: every call takes a `tenantId: string` and asserts it is
 * non-empty before running the query. The same `requireTenantId` helper used
 * by the read-path queries in `lib/queries/`.
 */

import { clickhouse } from "@/lib/clickhouse";
import { requireTenantId } from "@/lib/org";
import type {
  MonitorComparator,
  MonitorMetric,
  MonitorWindow,
} from "@/lib/monitors";

/**
 * ClickHouse expressions that compute the per-metric numeric value over a
 * filtered set of GenAI spans. Each must:
 *   - Return a single Float64 column aliased `value`.
 *   - Be safe over an empty input (NULL → 0 coercion happens caller-side, but
 *     wrapping with `if(count() = 0, 0, ...)` keeps the SQL self-defensive).
 *   - Reference no user-supplied identifiers — the expression is fixed at
 *     compile time. Only the numeric/string filter parameters cross the
 *     trust boundary, and they're parameterised via `query_params`.
 */
const METRIC_EXPRESSIONS: Record<MonitorMetric, string> = {
  cost: `sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']))`,
  latency_p95: `if(count() = 0, 0, quantile(0.95)(Duration / 1000000))`,
  error_rate: `if(count() = 0, 0, countIf(StatusCode = 'Error') / count())`,
};

export interface MetricQueryInput {
  metric: MonitorMetric;
  windowMinutes: MonitorWindow;
  environment?: string | null;
  model?: string | null;
}

export interface BuiltMetricQuery {
  sql: string;
  /**
   * Caller MUST merge in `tenantId: string` before invoking ClickHouse. We
   * keep `tenantId` out of the helper's responsibility so this module stays
   * pure-SQL-string and `evaluateMonitorMetric()` is the only thing that
   * actually issues the query.
   */
  query_params: Record<string, string | number>;
}

/**
 * Build the parameterised ClickHouse query for the given metric + scope.
 * Throws if `metric` is not in the allowlist — defence in depth, the action
 * layer should reject this input long before we get here.
 *
 * Exported because `previewMonitorMetric` (#17) wants the same SQL shape; the
 * preview path can either call `evaluateMonitorMetric()` directly or call
 * `buildMetricQuery()` and run its own ClickHouse client (e.g. to surface
 * `asOf` timestamp from the response). #16 always goes through
 * `evaluateMonitorMetric()`.
 */
export function buildMetricQuery(input: MetricQueryInput): BuiltMetricQuery {
  const expr = METRIC_EXPRESSIONS[input.metric];
  if (!expr) {
    throw new Error(`unknown monitor metric: ${input.metric}`);
  }

  // Optional scope filters. Each adds a parameterised clause; if the value is
  // null/undefined/empty we omit the clause entirely so a missing model
  // doesn't accidentally match `model = ''` in the data.
  const envFilter = input.environment
    ? "AND ResourceAttributes['deployment.environment'] = {environment:String}"
    : "";
  const modelFilter = input.model
    ? "AND SpanAttributes['gen_ai.request.model'] = {model:String}"
    : "";

  const sql = `
    SELECT ${expr} AS value
    FROM otel_traces
    WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
      AND SpanAttributes['gen_ai.request.model'] != ''
      AND Timestamp >= now() - INTERVAL {windowMinutes:UInt32} MINUTE
      ${envFilter}
      ${modelFilter}
  `;

  return {
    sql,
    query_params: {
      windowMinutes: input.windowMinutes,
      environment: input.environment ?? "",
      model: input.model ?? "",
    },
  };
}

/**
 * Tenant-scoped numeric evaluation of a metric over the given window. Always
 * resolves to a finite number — empty datasets coerce to 0, NaN/Infinity from
 * malformed spans coerce to 0, so callers never have to nullguard the result.
 */
export async function evaluateMonitorMetric(input: {
  tenantId: string;
  metric: MonitorMetric;
  windowMinutes: MonitorWindow;
  environment?: string | null;
  model?: string | null;
}): Promise<number> {
  const tenantId = requireTenantId(input.tenantId);
  const built = buildMetricQuery(input);

  const result = await clickhouse.query({
    query: built.sql,
    query_params: { ...built.query_params, tenantId },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ value: number | string | null }>();
  const raw = rows[0]?.value;
  if (raw === null || raw === undefined) return 0;
  const num = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Pure comparator function. Chosen over a lookup table so TypeScript narrows
 * the union exhaustively — adding a new comparator surfaces as a compile
 * error here, not a silent fall-through to `false`.
 */
export function compareValue(
  value: number,
  comparator: MonitorComparator,
  threshold: number,
): boolean {
  switch (comparator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
  }
}
