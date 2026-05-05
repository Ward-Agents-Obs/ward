"use server";

import { clickhouse } from "@/lib/clickhouse";
import { requireTenantId } from "@/lib/org";

export interface SessionRow {
  sessionId: string;
  firstMessage: string;
  lastMessage: string;
  duration: number; // in milliseconds
  startTime: string;
  traces: number;
  totalTokens: number;
  cost: number;
  status: string;
}

export interface SessionFilters {
  timeRange?: string;
  environment?: string;
  search?: string;
  model?: string;
}

export async function getSessions(
  tenantId: string,
  opts: SessionFilters & { limit?: number; offset?: number } = {}
): Promise<SessionRow[]> {
  const resolvedTenantId = requireTenantId(tenantId);
  const { timeRange, environment, search, model, limit = 50, offset = 0 } = opts;

  let timeFilter = "";
  if (timeRange) {
    switch (timeRange) {
      case "1h":
        timeFilter = "AND Timestamp >= subtractHours(now(), 1)";
        break;
      case "24h":
        timeFilter = "AND Timestamp >= subtractHours(now(), 24)";
        break;
      case "7d":
        timeFilter = "AND Timestamp >= subtractDays(now(), 7)";
        break;
      case "30d":
        timeFilter = "AND Timestamp >= subtractDays(now(), 30)";
        break;
    }
  }

  const environmentFilter = environment ?
    "AND ResourceAttributes['deployment.environment'] = {environment:String}" : "";

  const modelFilter = model ?
    "AND SpanAttributes['gen_ai.request.model'] = {model:String}" : "";

  let searchFilter = "";
  if (search) {
    // Search in message content
    searchFilter = `AND (
      positionCaseInsensitive(SpanAttributes['gen_ai.prompt'], {search:String}) > 0 OR
      positionCaseInsensitive(SpanAttributes['gen_ai.completion'], {search:String}) > 0
    )`;
  }

  const result = await clickhouse.query({
    query: `
      WITH session_traces AS (
        SELECT
          SpanAttributes['gen_ai.session.id'] as sessionId,
          min(Timestamp) as startTime,
          max(Timestamp) as endTime,
          count(*) as traces,
          sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens'])) +
          sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens'])) as totalTokens,
          sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost'])) as cost,
          any(SpanAttributes['gen_ai.prompt']) as firstMessage,
          anyLast(SpanAttributes['gen_ai.completion']) as lastMessage,
          any(StatusCode) as status
        FROM otel_traces
        WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
          AND SpanAttributes['gen_ai.session.id'] != ''
          ${timeFilter}
          ${environmentFilter}
          ${modelFilter}
          ${searchFilter}
        GROUP BY sessionId
      )
      SELECT
        sessionId,
        substring(firstMessage, 1, 100) as firstMessage,
        substring(lastMessage, 1, 100) as lastMessage,
        dateDiff('millisecond', startTime, endTime) as duration,
        startTime,
        traces,
        totalTokens,
        cost,
        status
      FROM session_traces
      ORDER BY startTime DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `,
    query_params: {
      tenantId: resolvedTenantId,
      environment: environment || "",
      model: model || "",
      search: search || "",
      limit,
      offset
    },
    format: "JSONEachRow",
  });

  return result.json<SessionRow>();
}

export async function getSessionDetail(tenantId: string, sessionId: string) {
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
        AND SpanAttributes['gen_ai.session.id'] = {sessionId:String}
      ORDER BY Timestamp ASC
    `,
    query_params: { tenantId: resolvedTenantId, sessionId },
    format: "JSONEachRow",
  });
  return result.json();
}

export async function getDistinctEnvironments(tenantId: string): Promise<string[]> {
  const resolvedTenantId = requireTenantId(tenantId);
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT ResourceAttributes['deployment.environment'] as environment
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        AND environment != ''
      ORDER BY environment
    `,
    query_params: { tenantId: resolvedTenantId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ environment: string }>();
  return rows.map((r) => r.environment);
}

export async function getSessionStats(tenantId: string, timeRange?: string) {
  const resolvedTenantId = requireTenantId(tenantId);

  let timeFilter = "";
  if (timeRange) {
    switch (timeRange) {
      case "1h":
        timeFilter = "AND Timestamp >= subtractHours(now(), 1)";
        break;
      case "24h":
        timeFilter = "AND Timestamp >= subtractHours(now(), 24)";
        break;
      case "7d":
        timeFilter = "AND Timestamp >= subtractDays(now(), 7)";
        break;
      case "30d":
        timeFilter = "AND Timestamp >= subtractDays(now(), 30)";
        break;
    }
  }

  const result = await clickhouse.query({
    query: `
      SELECT
        countDistinct(SpanAttributes['gen_ai.session.id']) as totalSessions,
        count(*) as totalTraces,
        sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.input_tokens'])) +
        sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.output_tokens'])) as totalTokens,
        sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost'])) as totalCost
      FROM otel_traces
      WHERE ResourceAttributes['ward.tenant_id'] = {tenantId:String}
        AND SpanAttributes['gen_ai.session.id'] != ''
        ${timeFilter}
    `,
    query_params: { tenantId: resolvedTenantId },
    format: "JSONEachRow",
  });

  const stats = await result.json<{
    totalSessions: number;
    totalTraces: number;
    totalTokens: number;
    totalCost: number;
  }>();

  return stats[0] || { totalSessions: 0, totalTraces: 0, totalTokens: 0, totalCost: 0 };
}