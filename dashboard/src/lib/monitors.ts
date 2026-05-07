// Server-only module (consumed by server components + the actions module
// in `app/(dashboard)/monitors/actions.ts`). Deliberately NOT marked
// `"use server"` because it exports non-async types and constants alongside
// the async helpers — the directive would forbid those exports.

/**
 * V1 monitor types, validation, and stubbed read helpers.
 *
 * Source-of-truth schema lives in `.agents/monitors-design.md` §2 + §5.
 * Backend's task #15 (B8) will own the zod schema and the real Prisma calls;
 * this module ships the types + a hand-rolled validator so the F8 modal
 * (#19) and F10 banner (#21) can be scaffolded against a real-shape API
 * before the backend lands. Each "STUB" comment marks a body that swaps
 * for a Prisma / ClickHouse call once #14 / #15 / #17 are merged.
 */

// ---------------------------------------------------------------------------
// Types — match `monitors-design.md` §2 Prisma model + §5 zod schema.
// ---------------------------------------------------------------------------

export const MONITOR_METRICS = ["cost", "latency_p95", "error_rate"] as const;
export type MonitorMetric = (typeof MONITOR_METRICS)[number];

export const MONITOR_COMPARATORS = ["gt", "gte", "lt", "lte"] as const;
export type MonitorComparator = (typeof MONITOR_COMPARATORS)[number];

export const MONITOR_WINDOWS = [5, 15, 60, 360, 1440] as const;
export type MonitorWindow = (typeof MONITOR_WINDOWS)[number];

export interface MonitorInput {
  name: string;
  description?: string | null;
  metric: MonitorMetric;
  comparator: MonitorComparator;
  threshold: number;
  windowMinutes: MonitorWindow;
  environment?: string | null;
  model?: string | null;
}

export interface Monitor extends MonitorInput {
  id: string;
  enabled: boolean;
  state: "ok" | "firing";
  lastEvaluatedAt: string | null;
  lastValue: number | null;
}

// ---------------------------------------------------------------------------
// Validation — hand-rolled to avoid pulling zod into the V1 dep budget
// before backend's B8 (where zod ships with the server actions). Each
// failure populates a `field`-keyed `errors` map matching the form layout
// so the modal can light up the right input.
// ---------------------------------------------------------------------------

export type ValidationErrors = Partial<Record<keyof MonitorInput, string>>;

export interface ValidationResult {
  ok: boolean;
  errors: ValidationErrors;
  /** Coerced value when ok; partial input otherwise. */
  value?: MonitorInput;
}

/**
 * Validate a candidate monitor input. Mirrors the zod schema in
 * `monitors-design.md` §5; will be replaced by `MonitorInputSchema.parse()`
 * once backend's B8 lands. Until then this is the contract the form binds to.
 */
export async function validateMonitorInput(
  raw: unknown,
): Promise<ValidationResult> {
  const errors: ValidationErrors = {};
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (name.length === 0) errors.name = "Name is required.";
  else if (name.length > 80) errors.name = "Name is at most 80 characters.";

  const description =
    typeof obj.description === "string" ? obj.description.trim() : "";
  if (description.length > 280) {
    errors.description = "Description is at most 280 characters.";
  }

  const metric = obj.metric;
  if (typeof metric !== "string" || !(MONITOR_METRICS as readonly string[]).includes(metric)) {
    errors.metric = "Pick a metric.";
  }

  const comparator = obj.comparator;
  if (
    typeof comparator !== "string" ||
    !(MONITOR_COMPARATORS as readonly string[]).includes(comparator)
  ) {
    errors.comparator = "Pick a comparator.";
  }

  const thresholdRaw = obj.threshold;
  const threshold =
    typeof thresholdRaw === "number"
      ? thresholdRaw
      : typeof thresholdRaw === "string" && thresholdRaw.length > 0
        ? Number(thresholdRaw)
        : Number.NaN;
  if (!Number.isFinite(threshold)) {
    errors.threshold = "Threshold must be a number.";
  }

  const windowRaw = obj.windowMinutes;
  const windowParsed =
    typeof windowRaw === "number"
      ? windowRaw
      : typeof windowRaw === "string" && windowRaw.length > 0
        ? Number(windowRaw)
        : Number.NaN;
  if (
    !Number.isFinite(windowParsed) ||
    !(MONITOR_WINDOWS as readonly number[]).includes(windowParsed)
  ) {
    errors.windowMinutes = "Pick a window.";
  }

  const environment =
    typeof obj.environment === "string" && obj.environment.trim().length > 0
      ? obj.environment.trim()
      : null;
  if (environment && environment.length > 40) {
    errors.environment = "Environment is at most 40 characters.";
  }

  const model =
    typeof obj.model === "string" && obj.model.trim().length > 0
      ? obj.model.trim()
      : null;
  if (model && model.length > 80) {
    errors.model = "Model is at most 80 characters.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors,
    value: {
      name,
      description: description || null,
      metric: metric as MonitorMetric,
      comparator: comparator as MonitorComparator,
      threshold,
      windowMinutes: windowParsed as MonitorWindow,
      environment,
      model,
    },
  };
}

// ---------------------------------------------------------------------------
// Read helpers — stubs until backend's #14 lands the Prisma model.
// ---------------------------------------------------------------------------

/**
 * Firing-monitor count for the dashboard banner (F10 / task #21).
 *
 * V1 STUB. Once the Monitor Prisma model exists, replace the body with:
 *
 *     import { prisma } from "@/lib/prisma";
 *     return prisma.monitor.count({
 *       where: { orgId, state: "firing", enabled: true },
 *     });
 *
 * The consumer (`<FiringBanner />`) is wired against the signature below so
 * the swap is body-only — no caller updates, no banner re-render path
 * changes. Reasoning lives in `.agents/monitors-design.md` §4.
 */
export async function getFiringMonitorCount(orgId: string): Promise<number> {
  // The arg is intentionally unused in the stub but kept on the signature
  // so the real Prisma call is a one-line drop-in.
  void orgId;
  return 0;
}

// ---------------------------------------------------------------------------
// Preview metric — stub for the modal's live value pane (F8 / task #19).
// Will swap to a real ClickHouse aggregation in backend's #17 (B10).
// ---------------------------------------------------------------------------

export interface MonitorPreviewInput {
  metric: MonitorMetric;
  windowMinutes: MonitorWindow;
  environment?: string | null;
  model?: string | null;
}

export interface MonitorPreviewResult {
  /** Numeric value of the metric across the requested window. */
  value: number;
  /**
   * Surface the data freshness so the form can label "as of N seconds ago".
   * Stub returns `null` to indicate no real data; real impl returns now().
   */
  asOf: string | null;
  /**
   * Whether the call resolved against real data. Stub sets `false` so the
   * preview pane can render a "preview unavailable" caption until #17 ships.
   */
  ready: boolean;
}

/**
 * V1 STUB — backend's task #17 (B10) replaces with a tenant-scoped
 * ClickHouse query against `otel_traces`. Until then, the modal renders an
 * "unavailable" preview caption.
 */
export async function previewMonitorMetric(
  tenantId: string,
  input: MonitorPreviewInput,
): Promise<MonitorPreviewResult> {
  void tenantId;
  void input;
  return { value: 0, asOf: null, ready: false };
}
