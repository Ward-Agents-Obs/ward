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

// ---------------------------------------------------------------------------
// List + detail read helpers — stubs for F7 (#18) and F9 (#20). All three
// helpers return mock data shaped exactly like the real Prisma read so the
// page swap-in is body-only when backend's #14 / B11-style queries land.
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
 * Row shape used by the `/monitors` list page. Extends the base `Monitor`
 * with `lastTriggeredAt`, which the real impl will derive from the latest
 * `MonitorTrigger.firedAt` for that monitor (likely via a Prisma include +
 * post-process or a windowed subquery).
 */
export interface MonitorListRow extends Monitor {
  lastTriggeredAt: string | null;
}

/**
 * V1 STUB. Real impl swaps to:
 *
 *   const monitors = await prisma.monitor.findMany({
 *     where: { orgId },
 *     orderBy: { updatedAt: "desc" },
 *     include: { triggers: { orderBy: { firedAt: "desc" }, take: 1 } },
 *   });
 *   return monitors.map((m) => ({ ...m, lastTriggeredAt: m.triggers[0]?.firedAt ?? null }));
 *
 * The mock entries cover every state the list page needs to render — a
 * firing monitor, a healthy ok monitor, and a disabled monitor — so the
 * scaffolded UI exercises every code path before backend lands #14.
 */
export async function getMonitors(orgId: string): Promise<MonitorListRow[]> {
  // TODO(#18): replace with prisma.monitor.findMany({ where: { orgId }, ... }).
  void orgId;
  const now = new Date();
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  return [
    {
      id: "mon_mock_firing",
      name: "Cost spike — production",
      description: "Alerts when prod model spend crosses the daily budget.",
      metric: "cost",
      comparator: "gt",
      threshold: 5,
      windowMinutes: 60,
      environment: "production",
      model: null,
      enabled: true,
      state: "firing",
      lastEvaluatedAt: minutesAgo(2),
      lastValue: 7.42,
      lastTriggeredAt: minutesAgo(8),
    },
    {
      id: "mon_mock_ok",
      name: "p95 latency — gpt-4o",
      description: null,
      metric: "latency_p95",
      comparator: "gt",
      threshold: 1500,
      windowMinutes: 15,
      environment: "production",
      model: "gpt-4o",
      enabled: true,
      state: "ok",
      lastEvaluatedAt: minutesAgo(1),
      lastValue: 980,
      lastTriggeredAt: null,
    },
    {
      id: "mon_mock_disabled",
      name: "Error rate — staging",
      description: "Paused while we tune the new prompt template.",
      metric: "error_rate",
      comparator: "gt",
      threshold: 0.05,
      windowMinutes: 60,
      environment: "staging",
      model: null,
      enabled: false,
      state: "ok",
      lastEvaluatedAt: minutesAgo(180),
      lastValue: 0.012,
      lastTriggeredAt: minutesAgo(60 * 24 * 3),
    },
  ];
}

/**
 * V1 STUB. Real impl swaps to:
 *
 *   const monitor = await prisma.monitor.findFirst({ where: { id, orgId } });
 *   return monitor ?? null;
 *
 * `orgId` is required so the swap-in trivially enforces the IDOR guard
 * called out in `monitors-design.md` §7 (`monitor.orgId === currentOrg.id`)
 * — looking up by the compound `(id, orgId)` makes "wrong tenant" return
 * `null`, not throw.
 */
export async function getMonitor(
  orgId: string,
  id: string,
): Promise<MonitorListRow | null> {
  // TODO(#20): replace with prisma.monitor.findFirst({ where: { id, orgId }, ... }).
  const all = await getMonitors(orgId);
  return all.find((m) => m.id === id) ?? null;
}

/**
 * V1 STUB. Real impl swaps to:
 *
 *   return prisma.monitorTrigger.findMany({
 *     where: { monitorId, monitor: { orgId } },
 *     orderBy: { firedAt: "desc" },
 *     take: limit,
 *   });
 *
 * The nested `monitor: { orgId }` filter is the IDOR guard — a trigger
 * whose monitor doesn't belong to this org is filtered out at the DB level
 * rather than relying on a follow-up check.
 */
export async function getMonitorTriggers(
  orgId: string,
  monitorId: string,
  limit: number = 50,
): Promise<MonitorTrigger[]> {
  // TODO(#20): replace with prisma.monitorTrigger.findMany({ where: { monitorId, monitor: { orgId } }, ... }).
  void orgId;
  void limit;
  if (monitorId !== "mon_mock_firing" && monitorId !== "mon_mock_disabled") {
    return [];
  }
  const now = new Date();
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  if (monitorId === "mon_mock_firing") {
    return [
      {
        id: "trg_mock_firing_1",
        monitorId,
        firedAt: minutesAgo(8),
        resolvedAt: null,
        triggerValue: 7.42,
        threshold: 5,
        comparator: "gt",
      },
      {
        id: "trg_mock_firing_2",
        monitorId,
        firedAt: minutesAgo(60 * 6),
        resolvedAt: minutesAgo(60 * 5),
        triggerValue: 6.1,
        threshold: 5,
        comparator: "gt",
      },
    ];
  }
  return [
    {
      id: "trg_mock_disabled_1",
      monitorId,
      firedAt: minutesAgo(60 * 24 * 3),
      resolvedAt: minutesAgo(60 * 24 * 3 - 30),
      triggerValue: 0.087,
      threshold: 0.05,
      comparator: "gt",
    },
  ];
}
