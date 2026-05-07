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
