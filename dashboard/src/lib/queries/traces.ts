"use server";

import { clickhouse } from "@/lib/clickhouse";
import { requireTenantId } from "@/lib/org";

export interface TraceRow {
  traceId: string;
  spanId: string;
  spanName: string;
  timestamp: string;
  duration: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  status: string;
}

/**
 * Time-range tokens used by the unified `/traces` list view. Each token maps
 * to a window length in hours; mirrors the buckets used by overview queries.
 */
export type SpansTimeRange = "1h" | "24h" | "7d" | "30d";

const SPANS_RANGE_HOURS: Record<SpansTimeRange, number> = {
  "1h": 1,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

export interface SpanRow {
  traceId: string;
  spanId: string;
  timestamp: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  status: string;
  environment: string;
  sessionId: string;
}

export interface SpansFilters {
  timeRange?: SpansTimeRange;
  environment?: string;
  model?: string;
  /** "ok" matches StatusCode != 'Error' (Ok or Unset); "error" matches 'Error'. */
  status?: "ok" | "error";
  /** Substring search against prompt/completion content. Case-insensitive. */
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Unified per-call span list for the V1 `/traces` page. Returns one row per
 * top-level GenAI span (filtered to spans with `gen_ai.request.model` set).
 *
 * Ordering is deterministic — `Timestamp DESC, SpanId DESC` — so pagination
 * is stable across pages even when many spans share the same millisecond.
 *
 * TODO(perf): switch from LIMIT/OFFSET to keyset pagination on
 * `(Timestamp, SpanId)` once the spans table grows past tens of millions of
 * rows. OFFSET is acceptable for V1 demo workloads.
 */
export async function getSpans(
  tenantId: string,
  opts: SpansFilters = {},
): Promise<SpanRow[]> {
  const resolvedTenantId = requireTenantId(tenantId);

  const limit = clampInt(opts.limit, 50, 1, 500);
  const offset = clampInt(opts.offset, 0, 0, 1_000_000);

  // Build optional filter fragments. Each fragment uses parameterized
  // placeholders so values can never inject SQL — see `query_params` below.
  const filters: string[] = [
    "ResourceAttributes['ward.tenant_id'] = {tenantId:String}",
    "SpanAttributes['gen_ai.request.model'] != ''",
  ];

  if (opts.timeRange) {
    filters.push("Timestamp >= now() - INTERVAL {hours:UInt32} HOUR");
  }
  if (opts.environment) {
    filters.push(
      "ResourceAttributes['deployment.environment'] = {environment:String}",
    );
  }
  if (opts.model) {
    filters.push("SpanAttributes['gen_ai.request.model'] = {model:String}");
  }
  if (opts.status === "error") {
    filters.push("StatusCode = 'Error'");
  } else if (opts.status === "ok") {
    filters.push("StatusCode != 'Error'");
  }
  if (opts.search) {
    filters.push(`(
      positionCaseInsensitive(SpanAttributes['gen_ai.prompt'], {search:String}) > 0
      OR positionCaseInsensitive(SpanAttributes['gen_ai.completion'], {search:String}) > 0
    )`);
  }

  const result = await clickhouse.query({
    query: `
      SELECT
        TraceId as traceId,
        SpanId as spanId,
        toString(Timestamp) as timestamp,
        SpanAttributes['gen_ai.request.model'] as model,
        Duration / 1000000 as latencyMs,
        toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens']) as inputTokens,
        toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens']) as outputTokens,
        toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']) as cost,
        StatusCode as status,
        ResourceAttributes['deployment.environment'] as environment,
        SpanAttributes['gen_ai.session.id'] as sessionId
      FROM otel_traces
      WHERE ${filters.join("\n        AND ")}
      ORDER BY Timestamp DESC, SpanId DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `,
    query_params: {
      tenantId: resolvedTenantId,
      hours: opts.timeRange ? SPANS_RANGE_HOURS[opts.timeRange] : 0,
      environment: opts.environment ?? "",
      model: opts.model ?? "",
      search: opts.search ?? "",
      limit,
      offset,
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    traceId: string;
    spanId: string;
    timestamp: string;
    model: string;
    latencyMs: number;
    inputTokens: string;
    outputTokens: string;
    cost: number;
    status: string;
    environment: string;
    sessionId: string;
  }>();

  return rows.map((row) => ({
    traceId: row.traceId,
    spanId: row.spanId,
    timestamp: row.timestamp,
    model: row.model,
    latencyMs: Number(row.latencyMs) || 0,
    inputTokens: parseInt(row.inputTokens, 10) || 0,
    outputTokens: parseInt(row.outputTokens, 10) || 0,
    cost: Number(row.cost) || 0,
    status: row.status,
    environment: row.environment,
    sessionId: row.sessionId,
  }));
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  const i = Math.floor(value);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

export async function getTraces(
  tenantId: string,
  opts: { model?: string; limit?: number; offset?: number } = {}
): Promise<TraceRow[]> {
  const resolvedTenantId = requireTenantId(tenantId);
  const { model, limit = 50, offset = 0 } = opts;
  const modelFilter = model ? "AND SpanAttributes['gen_ai.request.model'] = {model:String}" : "";

  const result = await clickhouse.query({
    query: `
      SELECT
        TraceId as traceId,
        SpanId as spanId,
        SpanName as spanName,
        Timestamp as timestamp,
        Duration / 1000000 as duration,
        SpanAttributes['gen_ai.request.model'] as model,
        toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens']) as inputTokens,
        toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens']) as outputTokens,
        toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']) as cost,
        StatusCode as status
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        ${modelFilter}
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `,
    query_params: { tenantId: resolvedTenantId, model: model || "", limit, offset },
    format: "JSONEachRow",
  });
  return result.json<TraceRow>();
}

export async function getTraceDetail(tenantId: string, traceId: string) {
  const resolvedTenantId = requireTenantId(tenantId);
  const result = await clickhouse.query({
    query: `
      SELECT
        TraceId as traceId,
        SpanId as spanId,
        ParentSpanId as parentSpanId,
        SpanName as spanName,
        Timestamp as timestamp,
        Duration / 1000000 as duration,
        SpanAttributes as attributes,
        StatusCode as status,
        StatusMessage as statusMessage
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        AND TraceId = {traceId:String}
      ORDER BY Timestamp ASC
    `,
    query_params: { tenantId: resolvedTenantId, traceId },
    format: "JSONEachRow",
  });
  return result.json();
}

export async function getDistinctModels(tenantId: string): Promise<string[]> {
  const resolvedTenantId = requireTenantId(tenantId);
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT SpanAttributes['gen_ai.request.model'] as model
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        AND model != ''
      ORDER BY model
    `,
    query_params: { tenantId: resolvedTenantId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ model: string }>();
  return rows.map((r) => r.model);
}
