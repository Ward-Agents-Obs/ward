import { formatCost, formatLatency } from "@/lib/utils";
import type {
  MonitorComparator,
  MonitorMetric,
  MonitorWindow,
} from "@/lib/monitors";

/**
 * Pure formatters used by the monitor list and detail pages. Kept as
 * functions (not React components) so they're testable and reusable across
 * server + client contexts.
 */

const METRIC_LABELS: Record<MonitorMetric, string> = {
  cost: "Cost",
  latency_p95: "p95 latency",
  error_rate: "Error rate",
};

const COMPARATOR_LABELS: Record<MonitorComparator, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

const WINDOW_LABELS: Record<MonitorWindow, string> = {
  5: "5m",
  15: "15m",
  60: "1h",
  360: "6h",
  1440: "24h",
};

export function formatMetricLabel(metric: MonitorMetric): string {
  return METRIC_LABELS[metric];
}

export function formatComparator(comparator: MonitorComparator): string {
  return COMPARATOR_LABELS[comparator];
}

export function formatWindow(windowMinutes: MonitorWindow): string {
  return WINDOW_LABELS[windowMinutes];
}

/**
 * Format a metric value using the unit appropriate to its metric. Cost
 * uses USD, latency uses ms, error rate is a 0..1 float rendered as %.
 */
export function formatMetricValue(metric: MonitorMetric, value: number): string {
  switch (metric) {
    case "cost":
      return formatCost(value);
    case "latency_p95":
      return formatLatency(value);
    case "error_rate":
      return `${(value * 100).toFixed(2)}%`;
  }
}

/**
 * Render the full condition as a single-line string for the table column
 * and the detail page hero. Example: "p95 latency > 1500ms over 15m".
 */
export function formatCondition(input: {
  metric: MonitorMetric;
  comparator: MonitorComparator;
  threshold: number;
  windowMinutes: MonitorWindow;
}): string {
  const metric = formatMetricLabel(input.metric);
  const comparator = formatComparator(input.comparator);
  const threshold = formatMetricValue(input.metric, input.threshold);
  const window = formatWindow(input.windowMinutes);
  return `${metric} ${comparator} ${threshold} over ${window}`;
}

/**
 * Format the optional environment + model scope into a single human label.
 * Used in the list-page "Scope" column and the detail-page header.
 */
export function formatScope(input: {
  environment?: string | null;
  model?: string | null;
}): string {
  const env = input.environment?.trim() || null;
  const model = input.model?.trim() || null;
  if (!env && !model) return "All envs · all models";
  const parts: string[] = [];
  parts.push(env ?? "all envs");
  parts.push(model ?? "all models");
  return parts.join(" · ");
}

/**
 * Cheap relative-time formatter. Avoids pulling `date-fns` / `dayjs` for a
 * single use case. Inputs are ISO strings.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "in the future";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return seconds <= 1 ? "just now" : `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/**
 * Computed status of a monitor row. The Prisma model splits "is the rule
 * paused" (`enabled: boolean`) from "is it currently breaching its
 * threshold" (`state: 'ok' | 'firing'`). Disabled wins for display
 * purposes — a paused rule shouldn't render as "ok".
 */
export type MonitorRenderStatus = "firing" | "ok" | "disabled";

export function resolveMonitorStatus(input: {
  enabled: boolean;
  state: "ok" | "firing";
}): MonitorRenderStatus {
  if (!input.enabled) return "disabled";
  return input.state === "firing" ? "firing" : "ok";
}
