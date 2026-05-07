"use server";

import { clickhouse } from "@/lib/clickhouse";
import { requireTenantId } from "@/lib/org";

/**
 * Time-range tokens accepted by overview queries that bucket their output
 * across time. Maps to (window-size, bucket-size) pairs picked to keep each
 * series at roughly 50–60 buckets so the frontend can render lines without
 * over- or under-sampling.
 */
export type OverviewTimeRange = "1h" | "24h" | "7d" | "30d";

interface RangeConfig {
  hours: number;
  bucketSeconds: number;
}

const RANGE_CONFIG: Record<OverviewTimeRange, RangeConfig> = {
  "1h": { hours: 1, bucketSeconds: 60 }, // 60 × 1-min buckets
  "24h": { hours: 24, bucketSeconds: 60 * 30 }, // 48 × 30-min buckets
  "7d": { hours: 24 * 7, bucketSeconds: 60 * 60 * 3 }, // 56 × 3-hour buckets
  "30d": { hours: 24 * 30, bucketSeconds: 60 * 60 * 12 }, // 60 × 12-hour buckets
};

function resolveRange(range: OverviewTimeRange | undefined): RangeConfig {
  return RANGE_CONFIG[range ?? "24h"];
}

/**
 * Build the optional environment WHERE-clause fragment. Returns an empty
 * string when `environment` is null/undefined/empty, so callers can
 * unconditionally interpolate it into their SQL template. The literal
 * placeholder (`{environment:String}`) is parameterised — no string
 * interpolation, no injection vector.
 */
function environmentFilter(environment: string | undefined | null): string {
  return environment
    ? "AND ResourceAttributes['deployment.environment'] = {environment:String}"
    : "";
}

export async function getOverviewMetrics(
  tenantId: string,
  environment?: string,
) {
  const resolvedTenantId = requireTenantId(tenantId);
  const envFilter = environmentFilter(environment);
  const result = await clickhouse.query({
    query: `
      SELECT
        count() as total_spans,
        sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost'])) as total_cost,
        avg(Duration) / 1000000 as avg_latency_ms,
        uniq(SpanAttributes['gen_ai.request.model']) as active_models
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        ${envFilter}
        AND Timestamp >= now() - INTERVAL 24 HOUR
    `,
    query_params: { tenantId: resolvedTenantId, environment: environment ?? "" },
    format: "JSONEachRow",
  });
  const rows = await result.json<{
    total_spans: string;
    total_cost: string;
    avg_latency_ms: string;
    active_models: string;
  }>();
  const row = rows[0] || { total_spans: "0", total_cost: "0", avg_latency_ms: "0", active_models: "0" };
  return {
    totalSpans: parseInt(row.total_spans),
    totalCost: parseFloat(row.total_cost),
    avgLatencyMs: parseFloat(row.avg_latency_ms),
    activeModels: parseInt(row.active_models),
  };
}

export async function getSpansOverTime(tenantId: string, days: number = 7) {
  const resolvedTenantId = requireTenantId(tenantId);
  const result = await clickhouse.query({
    query: `
      SELECT
        toDate(Timestamp) as date,
        count() as spans
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        AND Timestamp >= now() - INTERVAL {days:UInt32} DAY
      GROUP BY date
      ORDER BY date
    `,
    query_params: { tenantId: resolvedTenantId, days },
    format: "JSONEachRow",
  });
  return result.json<{ date: string; spans: string }>();
}

export async function getCostByModel(
  tenantId: string,
  days: number = 7,
  environment?: string,
) {
  const resolvedTenantId = requireTenantId(tenantId);
  const envFilter = environmentFilter(environment);
  const result = await clickhouse.query({
    query: `
      SELECT
        SpanAttributes['gen_ai.request.model'] as model,
        sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost'])) as cost
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        ${envFilter}
        AND Timestamp >= now() - INTERVAL {days:UInt32} DAY
        AND SpanAttributes['gen_ai.request.model'] != ''
      GROUP BY model
      ORDER BY cost DESC
    `,
    query_params: { tenantId: resolvedTenantId, days, environment: environment ?? "" },
    format: "JSONEachRow",
  });
  return result.json<{ model: string; cost: string }>();
}

// ---------------------------------------------------------------------------
// V1.B — bucketed health metrics
// ---------------------------------------------------------------------------

export interface LatencyPercentileBucket {
  bucket: string;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Latency p50/p95/p99 in milliseconds, bucketed across the requested window.
 *
 * Filters to GenAI spans (those with `gen_ai.request.model` set) so non-LLM
 * spans don't pollute the percentile distribution. Returns one row per bucket
 * that contains at least one matching span — empty buckets are omitted, and
 * the response is `[]` when no data exists for the tenant.
 */
export async function getLatencyPercentiles(
  tenantId: string,
  timeRange?: OverviewTimeRange,
  environment?: string,
): Promise<LatencyPercentileBucket[]> {
  const resolvedTenantId = requireTenantId(tenantId);
  const { hours, bucketSeconds } = resolveRange(timeRange);
  const envFilter = environmentFilter(environment);

  const result = await clickhouse.query({
    query: `
      SELECT
        toString(toStartOfInterval(Timestamp, INTERVAL {bucketSeconds:UInt32} SECOND)) as bucket,
        quantile(0.50)(Duration / 1000000) as p50,
        quantile(0.95)(Duration / 1000000) as p95,
        quantile(0.99)(Duration / 1000000) as p99
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        ${envFilter}
        AND SpanAttributes['gen_ai.request.model'] != ''
        AND Timestamp >= now() - INTERVAL {hours:UInt32} HOUR
      GROUP BY bucket
      ORDER BY bucket
    `,
    query_params: {
      tenantId: resolvedTenantId,
      hours,
      bucketSeconds,
      environment: environment ?? "",
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    bucket: string;
    p50: number;
    p95: number;
    p99: number;
  }>();

  return rows.map((row) => ({
    bucket: row.bucket,
    p50: Number(row.p50) || 0,
    p95: Number(row.p95) || 0,
    p99: Number(row.p99) || 0,
  }));
}

export interface ErrorRateBucket {
  bucket: string;
  total: number;
  errors: number;
  errorRate: number; // 0..1
}

/**
 * Per-bucket error rate (errors / total) across the requested window.
 *
 * Considers only GenAI spans. `errorRate` is a Float64 in [0, 1]; the caller
 * should multiply by 100 for display. Returns `[]` when no spans matched.
 */
export async function getErrorRateOverTime(
  tenantId: string,
  timeRange?: OverviewTimeRange,
  environment?: string,
): Promise<ErrorRateBucket[]> {
  const resolvedTenantId = requireTenantId(tenantId);
  const { hours, bucketSeconds } = resolveRange(timeRange);
  const envFilter = environmentFilter(environment);

  const result = await clickhouse.query({
    query: `
      SELECT
        toString(toStartOfInterval(Timestamp, INTERVAL {bucketSeconds:UInt32} SECOND)) as bucket,
        count() as total,
        countIf(StatusCode = 'Error') as errors,
        countIf(StatusCode = 'Error') / count() as errorRate
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        ${envFilter}
        AND SpanAttributes['gen_ai.request.model'] != ''
        AND Timestamp >= now() - INTERVAL {hours:UInt32} HOUR
      GROUP BY bucket
      ORDER BY bucket
    `,
    query_params: {
      tenantId: resolvedTenantId,
      hours,
      bucketSeconds,
      environment: environment ?? "",
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    bucket: string;
    total: string;
    errors: string;
    errorRate: number;
  }>();

  return rows.map((row) => ({
    bucket: row.bucket,
    total: parseInt(row.total, 10) || 0,
    errors: parseInt(row.errors, 10) || 0,
    errorRate: Number(row.errorRate) || 0,
  }));
}

export interface RecentFailure {
  traceId: string;
  spanId: string;
  timestamp: string;
  spanName: string;
  model: string;
  statusMessage: string;
  latencyMs: number;
}

/**
 * Most recent failed GenAI spans for the tenant. Used by the overview's
 * "recent failures" table. Limit is clamped to 100 to avoid runaway queries
 * if a caller passes something pathological.
 */
export async function getRecentFailures(
  tenantId: string,
  limit: number = 5,
  environment?: string,
): Promise<RecentFailure[]> {
  const resolvedTenantId = requireTenantId(tenantId);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 5));
  const envFilter = environmentFilter(environment);

  const result = await clickhouse.query({
    query: `
      SELECT
        TraceId as traceId,
        SpanId as spanId,
        toString(Timestamp) as timestamp,
        SpanName as spanName,
        SpanAttributes['gen_ai.request.model'] as model,
        StatusMessage as statusMessage,
        Duration / 1000000 as latencyMs
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        ${envFilter}
        AND StatusCode = 'Error'
      ORDER BY Timestamp DESC, SpanId DESC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      tenantId: resolvedTenantId,
      limit: safeLimit,
      environment: environment ?? "",
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    traceId: string;
    spanId: string;
    timestamp: string;
    spanName: string;
    model: string;
    statusMessage: string;
    latencyMs: number;
  }>();

  return rows.map((row) => ({
    traceId: row.traceId,
    spanId: row.spanId,
    timestamp: row.timestamp,
    spanName: row.spanName,
    model: row.model,
    statusMessage: row.statusMessage,
    latencyMs: Number(row.latencyMs) || 0,
  }));
}

export interface SpansByModelBucket {
  bucket: string;
  model: string;
  spans: number;
}

/**
 * Span counts bucketed by (time, model) for the stacked-area chart on the
 * overview page. Only GenAI spans are included. Frontend should pivot the
 * flat (bucket, model, spans) rows into one series per model.
 */
export async function getSpansOverTimeByModel(
  tenantId: string,
  timeRange?: OverviewTimeRange,
  environment?: string,
): Promise<SpansByModelBucket[]> {
  const resolvedTenantId = requireTenantId(tenantId);
  const { hours, bucketSeconds } = resolveRange(timeRange);
  const envFilter = environmentFilter(environment);

  const result = await clickhouse.query({
    query: `
      SELECT
        toString(toStartOfInterval(Timestamp, INTERVAL {bucketSeconds:UInt32} SECOND)) as bucket,
        SpanAttributes['gen_ai.request.model'] as model,
        count() as spans
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        ${envFilter}
        AND SpanAttributes['gen_ai.request.model'] != ''
        AND Timestamp >= now() - INTERVAL {hours:UInt32} HOUR
      GROUP BY bucket, model
      ORDER BY bucket, model
    `,
    query_params: {
      tenantId: resolvedTenantId,
      hours,
      bucketSeconds,
      environment: environment ?? "",
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    bucket: string;
    model: string;
    spans: string;
  }>();

  return rows.map((row) => ({
    bucket: row.bucket,
    model: row.model,
    spans: parseInt(row.spans, 10) || 0,
  }));
}

// ---------------------------------------------------------------------------
// V1.B — previous-window comparison + cost-over-time bucketing
// ---------------------------------------------------------------------------

/**
 * Convert an `OverviewTimeRange` to a minute count, used to express both the
 * current and the previous window as `INTERVAL N MINUTE` clauses in the
 * conditional aggregates below. Pulling the math out of the SQL keeps the
 * query string readable and makes the fixed-set windows easy to extend later.
 */
function rangeToMinutes(range: OverviewTimeRange): number {
  return RANGE_CONFIG[range].hours * 60;
}

export interface OverviewMetricsDelta {
  /**
   * Signed percentage change vs the previous window.
   *   delta = 100 * (current - previous) / previous
   *
   * `null` when the previous window has no data — the page renders a "no
   * comparison available" affordance rather than showing a misleading
   * "+Infinity%" arrow.
   */
  totalSpans: number | null;
  totalCost: number | null;
  avgLatency: number | null;
  errorRate: number | null;
}

/**
 * Tenant-scoped previous-window delta for the four overview KPI tiles.
 *
 * Computes both windows in a single ClickHouse round-trip by using `*If()`
 * conditional aggregates. The frontend MetricCards (wired in F1) accept a
 * signed percentage and render the up/down arrow + colour from `goodDirection`
 * — see comments in `dashboard/src/app/(dashboard)/overview/page.tsx` for the
 * full integration shape.
 *
 * Window semantics (locked):
 *   • current  = [ now() - currentRange, now() ]
 *   • previous = [ now() - currentRange - previousRange, now() - currentRange ]
 * In other words, `previousRange` is the SIZE of the lookback window placed
 * immediately before the current window. Passing `previousRange = currentRange`
 * gives the standard "this 24h vs last 24h" comparison; differing values
 * support custom comparisons (e.g. "last 1h vs the previous 24h baseline").
 *
 * Filters mirror `getOverviewMetrics` — GenAI spans only, optional environment
 * filter — so the delta refers to the same population the KPI tile shows.
 */
export async function getOverviewMetricsDelta(
  tenantId: string,
  currentRange: OverviewTimeRange,
  previousRange: OverviewTimeRange,
  environment?: string,
): Promise<OverviewMetricsDelta> {
  const resolvedTenantId = requireTenantId(tenantId);
  const currentMinutes = rangeToMinutes(currentRange);
  const previousMinutes = rangeToMinutes(previousRange);
  const combinedMinutes = currentMinutes + previousMinutes;
  const envFilter = environmentFilter(environment);

  // Single round-trip: one outer WHERE prunes by tenant + (optional) env +
  // the combined window, then conditional aggregates split each metric into
  // current / previous halves. The outer Timestamp clause keeps the partition
  // scan tight; the inner `*If()` predicates do the bucketing.
  const result = await clickhouse.query({
    query: `
      SELECT
        countIf(Timestamp >= now() - INTERVAL {currentMinutes:UInt32} MINUTE) AS currentSpans,
        countIf(
          Timestamp >= now() - INTERVAL {combinedMinutes:UInt32} MINUTE
          AND Timestamp <  now() - INTERVAL {currentMinutes:UInt32} MINUTE
        ) AS previousSpans,
        sumIf(
          toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']),
          Timestamp >= now() - INTERVAL {currentMinutes:UInt32} MINUTE
        ) AS currentCost,
        sumIf(
          toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']),
          Timestamp >= now() - INTERVAL {combinedMinutes:UInt32} MINUTE
          AND Timestamp <  now() - INTERVAL {currentMinutes:UInt32} MINUTE
        ) AS previousCost,
        avgIf(
          Duration / 1000000,
          Timestamp >= now() - INTERVAL {currentMinutes:UInt32} MINUTE
        ) AS currentLatency,
        avgIf(
          Duration / 1000000,
          Timestamp >= now() - INTERVAL {combinedMinutes:UInt32} MINUTE
          AND Timestamp <  now() - INTERVAL {currentMinutes:UInt32} MINUTE
        ) AS previousLatency,
        countIf(
          StatusCode = 'Error'
          AND Timestamp >= now() - INTERVAL {currentMinutes:UInt32} MINUTE
        ) AS currentErrors,
        countIf(
          StatusCode = 'Error'
          AND Timestamp >= now() - INTERVAL {combinedMinutes:UInt32} MINUTE
          AND Timestamp <  now() - INTERVAL {currentMinutes:UInt32} MINUTE
        ) AS previousErrors
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        ${envFilter}
        AND SpanAttributes['gen_ai.request.model'] != ''
        AND Timestamp >= now() - INTERVAL {combinedMinutes:UInt32} MINUTE
    `,
    query_params: {
      tenantId: resolvedTenantId,
      currentMinutes,
      combinedMinutes,
      environment: environment ?? "",
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    currentSpans: string;
    previousSpans: string;
    currentCost: string;
    previousCost: string;
    currentLatency: number | string | null;
    previousLatency: number | string | null;
    currentErrors: string;
    previousErrors: string;
  }>();
  const row = rows[0];
  if (!row) {
    return { totalSpans: null, totalCost: null, avgLatency: null, errorRate: null };
  }

  const currentSpans = parseInt(row.currentSpans, 10) || 0;
  const previousSpans = parseInt(row.previousSpans, 10) || 0;
  const currentCost = parseFloat(row.currentCost as string) || 0;
  const previousCost = parseFloat(row.previousCost as string) || 0;
  const currentLatency = toFiniteNumber(row.currentLatency);
  const previousLatency = toFiniteNumber(row.previousLatency);
  const currentErrors = parseInt(row.currentErrors, 10) || 0;
  const previousErrors = parseInt(row.previousErrors, 10) || 0;

  // Error RATE compares ratios, not raw counts — a doubled error count under
  // doubled traffic is unchanged. Compute each window's rate, then take the
  // pct change between rates. Falls through to `null` when either window has
  // zero spans (no traffic → undefined rate).
  const currentErrorRate = currentSpans > 0 ? currentErrors / currentSpans : null;
  const previousErrorRate = previousSpans > 0 ? previousErrors / previousSpans : null;

  return {
    totalSpans: pctChange(currentSpans, previousSpans),
    totalCost: pctChange(currentCost, previousCost),
    avgLatency: pctChange(currentLatency, previousLatency),
    errorRate: pctChange(currentErrorRate, previousErrorRate),
  };
}

/**
 * Signed percentage change. Returns `null` when `previous` is null/zero so
 * callers can render "no comparison" rather than `+Infinity%` or NaN.
 * `current` of null also returns null — we don't synthesize a "fell to zero"
 * delta from a missing aggregate.
 */
function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Coerce ClickHouse aggregate output to a finite number, or null on NaN/missing. */
function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export interface CostOverTimeBucket {
  /** ClickHouse bucket string in `YYYY-MM-DD HH:MM:SS` form, UTC. */
  bucket: string;
  /** Total cost (USD) of GenAI spans in this bucket. */
  cost: number;
}

/**
 * Tenant-scoped per-bucket cost over the requested window. Bucket size comes
 * from the same `RANGE_CONFIG` the latency / error-rate / spans-by-model
 * queries use, so all four panels on the overview render against an aligned
 * x-axis. GenAI spans only — non-LLM spans wouldn't carry `gen_ai.usage.cost`
 * anyway, but the explicit filter matches the read-paths used by the other
 * V1.B charts and keeps the empty-bucket semantics consistent.
 *
 * Empty buckets (no spans landed in that window) are omitted; consumers can
 * either render gaps or zero-fill on the client. The shape matches the
 * frontend's `<CostOverTimeChart>` which currently consumes an empty-array
 * stub — once this query is wired in `page.tsx`, the chart appears with no
 * further changes.
 */
export async function getCostOverTime(
  tenantId: string,
  range: OverviewTimeRange,
  environment?: string,
): Promise<CostOverTimeBucket[]> {
  const resolvedTenantId = requireTenantId(tenantId);
  const { hours, bucketSeconds } = resolveRange(range);
  const envFilter = environmentFilter(environment);

  const result = await clickhouse.query({
    query: `
      SELECT
        toString(toStartOfInterval(Timestamp, INTERVAL {bucketSeconds:UInt32} SECOND)) AS bucket,
        sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost'])) AS cost
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        ${envFilter}
        AND SpanAttributes['gen_ai.request.model'] != ''
        AND Timestamp >= now() - INTERVAL {hours:UInt32} HOUR
      GROUP BY bucket
      ORDER BY bucket
    `,
    query_params: {
      tenantId: resolvedTenantId,
      hours,
      bucketSeconds,
      environment: environment ?? "",
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ bucket: string; cost: number | string }>();
  return rows.map((row) => ({
    bucket: row.bucket,
    cost: typeof row.cost === "number" ? row.cost : parseFloat(row.cost) || 0,
  }));
}
