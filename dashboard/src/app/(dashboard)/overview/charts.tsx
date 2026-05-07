"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ErrorRateBucket,
  LatencyPercentileBucket,
  SpansByModelBucket,
} from "@/lib/queries/overview";

/**
 * Overview chart components. Each takes its raw query rows and reshapes them
 * for Recharts inside the client boundary — keeps the server component lean
 * and lets the chart code own its own data plumbing.
 */

const SERIES_COLORS = [
  "#22d3ee",
  "#a78bfa",
  "#f472b6",
  "#34d399",
  "#fb923c",
  "#facc15",
  "#818cf8",
  "#f87171",
];

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--foreground)",
};
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

/**
 * Reformat a ClickHouse bucket string into a short human label.
 * Recharts forwards labels typed as `ReactNode | undefined` so the
 * formatter accepts unknown and narrows internally.
 */
function shortBucket(label: unknown): string {
  if (typeof label !== "string" || label.length === 0) return "";
  // ClickHouse returns ISO-like strings ("2026-05-06 03:00:00"); Date
  // accepts these in modern V8. Fall back to the raw value if parsing fails
  // so the chart never renders "Invalid Date".
  const parsed = new Date(label.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return label;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Spans-by-model stacked area chart
// ---------------------------------------------------------------------------

interface SpansByModelChartProps {
  data: SpansByModelBucket[];
}

export function SpansByModelChart({ data }: SpansByModelChartProps) {
  // Pivot (bucket, model, spans) rows into one row per bucket with a column
  // per model, matching Recharts' stacked-area shape.
  const models = Array.from(new Set(data.map((d) => d.model))).sort();
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const row of data) {
    if (!byBucket.has(row.bucket)) {
      byBucket.set(row.bucket, { bucket: row.bucket });
    }
    const entry = byBucket.get(row.bucket)!;
    entry[row.model] = row.spans;
  }
  const pivot = Array.from(byBucket.values());

  if (pivot.length === 0 || models.length === 0) {
    return <ChartEmpty label="No spans in this window yet." />;
  }

  return (
    <div className="h-64">
      <ResponsiveContainer>
        <AreaChart data={pivot} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="bucket"
            tickFormatter={shortBucket}
            tick={AXIS_TICK}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} allowDecimals={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={shortBucket}
          />
          {models.map((model, i) => (
            <Area
              key={model}
              type="monotone"
              dataKey={model}
              stackId="spans"
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              fillOpacity={0.25}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Latency p50/p95/p99 line chart
// ---------------------------------------------------------------------------

interface LatencyChartProps {
  data: LatencyPercentileBucket[];
}

export function LatencyChart({ data }: LatencyChartProps) {
  if (data.length === 0) {
    return <ChartEmpty label="No latency data in this window yet." />;
  }
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="bucket"
            tickFormatter={shortBucket}
            tick={AXIS_TICK}
            minTickGap={24}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={(v: number) => `${Math.round(v)}ms`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={shortBucket}
            formatter={(value, name) => {
              const ms = typeof value === "number" ? value : Number(value) || 0;
              const seriesName =
                typeof name === "string" ? name.toUpperCase() : String(name ?? "");
              return [`${Math.round(ms)}ms`, seriesName];
            }}
          />
          <Line
            type="monotone"
            dataKey="p50"
            stroke="#22d3ee"
            strokeWidth={1.75}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="p95"
            stroke="#a78bfa"
            strokeWidth={1.75}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="p99"
            stroke="#f87171"
            strokeWidth={1.75}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error rate line chart
// ---------------------------------------------------------------------------

interface ErrorRateChartProps {
  data: ErrorRateBucket[];
}

export function ErrorRateChart({ data }: ErrorRateChartProps) {
  if (data.length === 0) {
    return <ChartEmpty label="No traffic in this window yet." />;
  }
  // Convert 0..1 → percent for display, keeping raw count in the tooltip.
  const formatted = data.map((d) => ({
    bucket: d.bucket,
    errorRate: d.errorRate * 100,
    total: d.total,
    errors: d.errors,
  }));
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart
          data={formatted}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="bucket"
            tickFormatter={shortBucket}
            tick={AXIS_TICK}
            minTickGap={24}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            domain={[
              0,
              // Floor of 5% so a quiet window doesn't render a 0–0.0 axis.
              (dataMax: number) => Math.max(5, Math.ceil(dataMax)),
            ]}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={shortBucket}
            formatter={(value, name, item) => {
              if (name === "errorRate") {
                const num = typeof value === "number" ? value : Number(value) || 0;
                const point = (item?.payload ?? {}) as {
                  errors?: number;
                  total?: number;
                };
                return [
                  `${num.toFixed(2)}% (${point.errors ?? 0}/${point.total ?? 0})`,
                  "Error rate",
                ];
              }
              return [
                value as React.ReactNode,
                name as React.ReactNode,
              ];
            }}
          />
          <Line
            type="monotone"
            dataKey="errorRate"
            stroke="#f87171"
            strokeWidth={1.75}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost-over-time line chart
// ---------------------------------------------------------------------------

export interface CostOverTimeBucket {
  /** ClickHouse bucket string in `YYYY-MM-DD HH:MM:SS` form. */
  bucket: string;
  /** Total cost across the bucket window, in USD. */
  cost: number;
}

interface CostOverTimeChartProps {
  data: CostOverTimeBucket[];
}

/**
 * Per-bucket cost line chart for the §V1.B "Cost over time" panel.
 *
 * V1 SCAFFOLD — the page currently feeds an empty array because backend's
 * #40 (B13) hasn't landed `getCostOverTime(tenantId, range)`. With no data
 * the chart renders the shared `<ChartEmpty>` placeholder explaining the
 * pending swap. Once #40 ships, the page passes real rows and the line
 * appears with no further changes here.
 */
export function CostOverTimeChart({ data }: CostOverTimeChartProps) {
  if (data.length === 0) {
    return (
      <ChartEmpty label="Per-bucket cost arrives once backend task #40 (B13) lands." />
    );
  }
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="bucket"
            tickFormatter={shortBucket}
            tick={AXIS_TICK}
            minTickGap={24}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={(v: number) => formatYAxisCost(v)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={shortBucket}
            formatter={(value) => {
              const num = typeof value === "number" ? value : Number(value) || 0;
              return [formatYAxisCost(num), "Cost"];
            }}
          />
          <Line
            type="monotone"
            dataKey="cost"
            stroke="#34d399"
            strokeWidth={1.75}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cost-axis labelling. Sub-cent resolution for tiny windows, $ for the rest. */
function formatYAxisCost(v: number): string {
  if (!Number.isFinite(v)) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Shared empty-state placeholder for charts so callers don't render a blank box
// ---------------------------------------------------------------------------

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed tech-border bg-background/50 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
