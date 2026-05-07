// Mixed-export module: types + constants + the pure validator. Deliberately
// NOT marked `"use server"` because non-async exports (`MONITOR_METRICS`,
// `MonitorMetric`, `validateMonitorInput`) are imported by client
// components — the directive would forbid those.
//
// Server-only async helpers that touch Prisma live in `lib/monitors-server.ts`.
// The split matches the convention documented in
// `.agents/dashboard-conventions-drift.md` §1.2.

/**
 * V1 monitor types + validation. Source-of-truth schema lives in
 * `.agents/monitors-design.md` §2 + §5. The validator is hand-rolled rather
 * than zod-based to keep the client-bundle footprint small; backend's #15
 * design proposed swapping to `zod.safeParse()` but the return shape is
 * identical so the swap is body-only when zod is approved.
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
// Read-helper types. The async helpers themselves live in
// `lib/monitors-server.ts` — split out so this module (imported by client
// components for `MONITOR_METRICS` / `validateMonitorInput`) doesn't pull
// `@prisma/client` into the client bundle. Convention is in
// `.agents/dashboard-conventions-drift.md` §1.2.
// ---------------------------------------------------------------------------

/**
 * Trigger history row. Mirrors the `MonitorTrigger` Prisma model from
 * `monitors-design.md` §2.
 */
export interface MonitorTrigger {
  id: string;
  monitorId: string;
  firedAt: string;
  resolvedAt: string | null;
  triggerValue: number;
  threshold: number;
  comparator: MonitorComparator;
}

/**
 * Row shape returned by the `/monitors` list and detail pages. Extends the
 * base `Monitor` with `lastTriggeredAt`, derived from the latest
 * `MonitorTrigger.firedAt` for that monitor.
 */
export interface MonitorListRow extends Monitor {
  lastTriggeredAt: string | null;
}

/**
 * Input shape for the live preview pane in the create/edit modal. Includes
 * comparator + threshold so the server can compute `breached` and the modal
 * doesn't duplicate the comparison logic.
 */
export interface MonitorPreviewInput {
  metric: MonitorMetric;
  comparator: MonitorComparator;
  threshold: number;
  windowMinutes: MonitorWindow;
  environment?: string | null;
  model?: string | null;
}

/** Output shape for the live preview pane. */
export interface MonitorPreviewResult {
  /** Numeric value of the metric across the requested window. */
  value: number;
  /** Echoed back so the modal can render "value vs threshold" in one read. */
  threshold: number;
  /**
   * Whether `value` violates `comparator threshold` right now. Server-side
   * comparison so the rule stays consistent with the cron worker's
   * evaluator.
   */
  breached: boolean;
  /** ISO timestamp of when the query ran, for "as of N seconds ago" copy. */
  asOf: string | null;
  /**
   * Whether the value reflects a real ClickHouse query. False on
   * unreachable backend; the modal renders an "unavailable" caption.
   */
  ready: boolean;
}

