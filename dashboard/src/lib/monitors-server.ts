"use server";

/**
 * Server-only Prisma read helpers for monitors. Split out from
 * `lib/monitors.ts` (which hosts the types, constants, and pure validator)
 * because client components import `MONITOR_METRICS`/`MonitorMetric`/etc.
 * from there — pulling the Prisma client into the same module would leak
 * `@prisma/client` into client bundles.
 *
 * Convention (per `dashboard-conventions-drift.md` §1.2): mixed-export
 * `lib/<feature>.ts` stays unmarked; server-only async helpers move to a
 * sibling `lib/<feature>-server.ts` marked `"use server"` so non-async
 * exports stay legal in the upstream module.
 *
 * Tenant isolation is enforced at every entry point:
 *   - reads use a compound `(id, orgId)` filter (never `findUnique({id})`)
 *     so a wrong-tenant lookup returns `null`/`[]` rather than someone
 *     else's data.
 *   - the trigger query nests `monitor: { orgId }` under `where` so cross-
 *     tenant trigger reads are filtered at the SQL level, not after-the-fact.
 *
 * IDOR coverage is exercised by `__tests__/monitor-actions-tenant-isolation.ts`.
 */

import type { Monitor as PrismaMonitor, MonitorTrigger as PrismaMonitorTrigger } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { compareValue, evaluateMonitorMetric } from "@/lib/monitors-eval";
import type {
  MonitorComparator,
  MonitorListRow,
  MonitorMetric,
  MonitorPreviewInput,
  MonitorPreviewResult,
  MonitorTrigger,
  MonitorWindow,
} from "@/lib/monitors";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Prisma row shape with the trigger join we use to compute `lastTriggeredAt`. */
type MonitorWithLatestTrigger = PrismaMonitor & {
  triggers: { firedAt: Date }[];
};

export async function getFiringMonitorCount(orgId: string): Promise<number> {
  return prisma.monitor.count({
    where: { orgId, state: "firing", enabled: true },
  });
}

export async function getMonitors(orgId: string): Promise<MonitorListRow[]> {
  const monitors = await prisma.monitor.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    // Latest trigger per monitor — Prisma doesn't have a native "joined
    // first row" helper, so we include + take(1). Cheap at V1's ≤10
    // monitors-per-tenant cap.
    include: {
      triggers: {
        orderBy: { firedAt: "desc" },
        take: 1,
        select: { firedAt: true },
      },
    },
  });
  return monitors.map(toListRow);
}

export async function getMonitor(
  orgId: string,
  id: string,
): Promise<MonitorListRow | null> {
  // IDOR guard: compound `(id, orgId)` lookup. A wrong-tenant id returns
  // null without leaking that the row exists for someone else.
  const monitor = await prisma.monitor.findFirst({
    where: { id, orgId },
    include: {
      triggers: {
        orderBy: { firedAt: "desc" },
        take: 1,
        select: { firedAt: true },
      },
    },
  });
  return monitor ? toListRow(monitor) : null;
}

export async function getMonitorTriggers(
  orgId: string,
  monitorId: string,
  limit: number = 50,
): Promise<MonitorTrigger[]> {
  // Clamp to a sane upper bound so a pathological caller can't ask for
  // 1M triggers in one round-trip.
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 50));
  // Nested `monitor: { orgId }` filter is the IDOR guard at the DB level —
  // triggers whose monitor doesn't belong to this org are never selected.
  const triggers = await prisma.monitorTrigger.findMany({
    where: { monitorId, monitor: { orgId } },
    orderBy: { firedAt: "desc" },
    take: safeLimit,
  });
  return triggers.map(toTrigger);
}

/**
 * Preview a monitor's metric value over its window — powers the Create /
 * Edit modal's live preview pane (#19).
 *
 * Delegates the SQL + tenant scoping to `lib/monitors-eval.ts` so the
 * preview value is byte-identical with what the cron worker (#16)
 * evaluates against the same monitor. That shared module owns:
 *   - the `METRIC_EXPRESSIONS` allowlist
 *   - the parameterised SQL builder
 *   - the ClickHouse round-trip + NaN/null normalisation
 *   - the comparator semantics (`compareValue`)
 *
 * This wrapper exists only to fold the `threshold` / `breached` / `asOf`
 * envelope around the raw value so the modal can render "value vs threshold"
 * + a breach pill in one read. Adding new metrics happens in
 * `lib/monitors-eval.ts`; this function picks them up automatically.
 */
export async function previewMonitorMetric(
  tenantId: string,
  input: MonitorPreviewInput,
): Promise<MonitorPreviewResult> {
  const value = await evaluateMonitorMetric({
    tenantId,
    metric: input.metric,
    windowMinutes: input.windowMinutes,
    environment: input.environment,
    model: input.model,
  });
  return {
    value,
    threshold: input.threshold,
    breached: compareValue(value, input.comparator, input.threshold),
    asOf: new Date().toISOString(),
    ready: true,
  };
}

// ---------------------------------------------------------------------------
// Row mappers — keep Prisma's `Date` ↔ ISO-string + numeric conversions in
// one place so call sites get the canonical `Monitor` / `MonitorListRow`
// shape regardless of how Prisma evolves.
// ---------------------------------------------------------------------------

function toListRow(m: MonitorWithLatestTrigger): MonitorListRow {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    metric: m.metric as MonitorMetric,
    comparator: m.comparator as MonitorComparator,
    threshold: m.threshold,
    windowMinutes: m.windowMinutes as MonitorWindow,
    environment: m.environment,
    model: m.model,
    enabled: m.enabled,
    state: (m.state === "firing" ? "firing" : "ok") as "ok" | "firing",
    lastEvaluatedAt: m.lastEvaluatedAt ? m.lastEvaluatedAt.toISOString() : null,
    lastValue: m.lastValue,
    lastTriggeredAt: m.triggers[0] ? m.triggers[0].firedAt.toISOString() : null,
  };
}

function toTrigger(t: PrismaMonitorTrigger): MonitorTrigger {
  return {
    id: t.id,
    monitorId: t.monitorId,
    firedAt: t.firedAt.toISOString(),
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
    triggerValue: t.triggerValue,
    threshold: t.threshold,
    comparator: t.comparator as MonitorComparator,
  };
}
