/**
 * Monitor evaluation cron worker (#16 / B9).
 *
 * Trigger: Vercel Cron in prod, the `pnpm worker:monitors` script in dev (see
 * `dashboard/scripts/worker-monitors.ts`). Either way, an external scheduler
 * POSTs here every 5 minutes with `x-cron-token: $CRON_SECRET`.
 *
 * Per-monitor flow:
 *   1. Fetch all enabled monitors with their parent org (one Prisma round-trip).
 *   2. For each, compute the metric value via the shared
 *      `evaluateMonitorMetric()` helper — the SAME helper #17 uses, so the
 *      preview the user saw at create-time agrees byte-for-byte with what
 *      the worker sees at fire-time.
 *   3. Reconcile state inside `prisma.$transaction` with `SELECT ... FOR
 *      UPDATE` on the Monitor row. Two overlapping cron invocations cannot
 *      both observe `state='ok' AND breached=true` and both insert a
 *      MonitorTrigger; the second waits, sees the new state, and no-ops.
 *
 * State transitions:
 *   - ok → firing       : insert MonitorTrigger { resolvedAt: null }, set state=firing
 *   - firing → firing   : no-op on history; only update lastEvaluatedAt/lastValue
 *   - firing → ok       : update most recent open trigger's resolvedAt = now, set state=ok
 *   - ok → ok           : no-op on history; only update lastEvaluatedAt/lastValue
 *
 * Notifications: BANNER ONLY. No email, no Slack, no webhooks. Per the locked
 * V1 decision in `.agents/monitors-design.md` §4. The banner re-renders on
 * every layout render and self-polls every 30s when a fire is active, so
 * Postgres state alone is enough — no `revalidateTag`, no `revalidatePath`.
 *
 * Error handling: per-monitor failures are logged + counted in the response
 * summary, but they don't abort the loop. One bad monitor does not stop the
 * other 9.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  MONITOR_COMPARATORS,
  MONITOR_METRICS,
  MONITOR_WINDOWS,
  type MonitorComparator,
  type MonitorMetric,
  type MonitorWindow,
} from "@/lib/monitors";
import { compareValue, evaluateMonitorMetric } from "@/lib/monitors-eval";

interface EvaluationSummary {
  evaluated: number;
  transitions: number;
  errors: number;
}

export async function POST(req: Request): Promise<NextResponse> {
  // Auth: distinguish "config missing" (503) from "wrong token" (401) so a
  // missing CRON_SECRET in dev is loud and self-diagnosing rather than
  // looking like a token mismatch. Matches the locked decision in
  // `.agents/monitors-design.md` §3.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new NextResponse(
      "CRON_SECRET not set — see dashboard/.env.example",
      { status: 503 },
    );
  }
  const provided = req.headers.get("x-cron-token");
  if (provided !== secret) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  // Pull every enabled monitor in one shot. At V1 cap (≤10/tenant × small N
  // tenants) this is comfortably under 1k rows; revisit if a tenant ever
  // ships hundreds of monitors.
  const monitors = await prisma.monitor.findMany({
    where: { enabled: true },
    include: { org: true },
  });

  const summary: EvaluationSummary = {
    evaluated: 0,
    transitions: 0,
    errors: 0,
  };

  for (const monitor of monitors) {
    try {
      const transitioned = await evaluateOne(monitor);
      summary.evaluated += 1;
      if (transitioned) summary.transitions += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(
        `[evaluate-monitors] monitor=${monitor.id} org=${monitor.orgId} failed:`,
        err,
      );
    }
  }

  return NextResponse.json(summary);
}

type MonitorWithOrg = Awaited<
  ReturnType<typeof prisma.monitor.findMany<{ include: { org: true } }>>
>[number];

/**
 * Single-monitor pipeline: validate enum-typed columns against the allowlist
 * (defence in depth — the action layer should already enforce this), compute
 * the metric, then reconcile state in a transaction.
 */
async function evaluateOne(monitor: MonitorWithOrg): Promise<boolean> {
  const metric = assertMetric(monitor.metric);
  const comparator = assertComparator(monitor.comparator);
  const windowMinutes = assertWindow(monitor.windowMinutes);

  const value = await evaluateMonitorMetric({
    tenantId: monitor.org.tenantId,
    metric,
    windowMinutes,
    environment: monitor.environment,
    model: monitor.model,
  });

  const breached = compareValue(value, comparator, monitor.threshold);
  return reconcileState(monitor.id, monitor.threshold, comparator, value, breached);
}

/**
 * Reads current state under a row-level lock and writes the appropriate
 * transition. Returns `true` if state actually changed (caller increments the
 * `transitions` counter), `false` if it was a no-op or telemetry-only update.
 *
 * The `SELECT ... FOR UPDATE` is the whole game here: two concurrent
 * invocations serialize on this row. The second one observes the post-write
 * state and falls through to the firing→firing or ok→ok branches, which are
 * idempotent.
 */
async function reconcileState(
  monitorId: string,
  threshold: number,
  comparator: MonitorComparator,
  value: number,
  breached: boolean,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; state: string }>>`
      SELECT id, state FROM monitors WHERE id = ${monitorId} FOR UPDATE
    `;
    const current = locked[0];
    if (!current) return false;

    const now = new Date();
    const baseUpdate = { lastEvaluatedAt: now, lastValue: value };

    if (current.state === "ok" && breached) {
      // ok → firing: open a trigger row and flip state.
      await tx.monitorTrigger.create({
        data: {
          monitorId,
          firedAt: now,
          triggerValue: value,
          threshold,
          comparator,
        },
      });
      await tx.monitor.update({
        where: { id: monitorId },
        data: { ...baseUpdate, state: "firing" },
      });
      return true;
    }

    if (current.state === "firing" && !breached) {
      // firing → ok: close the most recent open trigger and flip state. If no
      // open trigger exists (data drift, manual DB edit), just flip state —
      // we'd rather recover than refuse to clear a stale firing flag.
      const open = await tx.monitorTrigger.findFirst({
        where: { monitorId, resolvedAt: null },
        orderBy: { firedAt: "desc" },
      });
      if (open) {
        await tx.monitorTrigger.update({
          where: { id: open.id },
          data: { resolvedAt: now },
        });
      }
      await tx.monitor.update({
        where: { id: monitorId },
        data: { ...baseUpdate, state: "ok" },
      });
      return true;
    }

    // No state change — only refresh telemetry. Includes the firing→firing
    // and ok→ok branches; both are no-ops on history per the design doc.
    await tx.monitor.update({
      where: { id: monitorId },
      data: baseUpdate,
    });
    return false;
  });
}

// ---------------------------------------------------------------------------
// Allowlist guards — defence in depth against drift between the action layer
// and what the worker is willing to evaluate.
// ---------------------------------------------------------------------------

function assertMetric(value: string): MonitorMetric {
  if ((MONITOR_METRICS as readonly string[]).includes(value)) {
    return value as MonitorMetric;
  }
  throw new Error(`monitor.metric '${value}' is not in the allowlist`);
}

function assertComparator(value: string): MonitorComparator {
  if ((MONITOR_COMPARATORS as readonly string[]).includes(value)) {
    return value as MonitorComparator;
  }
  throw new Error(`monitor.comparator '${value}' is not in the allowlist`);
}

function assertWindow(value: number): MonitorWindow {
  if ((MONITOR_WINDOWS as readonly number[]).includes(value)) {
    return value as MonitorWindow;
  }
  throw new Error(`monitor.windowMinutes ${value} is not in the allowlist`);
}
