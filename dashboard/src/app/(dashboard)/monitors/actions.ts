"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrCreateOrg } from "@/lib/org";
import {
  validateMonitorInput,
  type MonitorPreviewInput,
  type MonitorPreviewResult,
  type ValidationErrors,
} from "@/lib/monitors";
import { previewMonitorMetric } from "@/lib/monitors-server";

/**
 * Server actions backing the Create/Edit Monitor modal (F8) and any future
 * row-level actions (toggle/delete) on the list page (F7).
 *
 * Contract per `.agents/monitor-server-actions-design.md`:
 *  - Result envelopes are **discriminated unions**, never throw for
 *    expected failures (validation, not-found, cap, missing tenant).
 *    Throw only for infra exceptions; the route-group `error.tsx`
 *    boundary handles those.
 *  - Tenant safety: `getOrCreateOrg()` derives `orgId` from the session.
 *    Never accept `orgId` / `tenantId` from input.
 *  - IDOR-safe writes: every mutation filters by `(id, orgId)` so a wrong-
 *    tenant id surfaces as `not_found`, not a leaked update.
 *  - ≤10-monitor cap is enforced by `prisma.monitor.count` inside
 *    `createMonitor`. No DB unique constraint — V1.1 widens the cap and
 *    a column constraint would be painful to migrate.
 *
 * Coverage: `__tests__/monitor-actions-tenant-isolation.ts` exercises the
 * IDOR property (cross-tenant lookups return null/empty) and the cap
 * counting against a live Postgres.
 */

// ---------------------------------------------------------------------------
// Result envelope types — exported so consumer components can import the
// exact shape rather than re-deriving it.
// ---------------------------------------------------------------------------

// User-facing copy for these typed tags lives in the consumers (e.g.
// `<MonitorFormDialog>`'s `ERROR_COPY` const) — `"use server"` modules
// can't export non-async values, only types.
export type MonitorActionErrorTag = "no_tenant" | "not_found" | "limit_reached";

export type CreateMonitorResult =
  | { ok: true; id: string }
  | { ok: false; errors: ValidationErrors }
  | { ok: false; error: "limit_reached" | "no_tenant" };

export type UpdateMonitorResult =
  | { ok: true }
  | { ok: false; errors: ValidationErrors }
  | { ok: false; error: "not_found" | "no_tenant" };

export type DeleteMonitorResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "no_tenant" };

export type ToggleMonitorResult = DeleteMonitorResult;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createMonitor(raw: unknown): Promise<CreateMonitorResult> {
  const org = await getOrCreateOrg();
  if (!org) return { ok: false, error: "no_tenant" };

  const validation = await validateMonitorInput(raw);
  if (!validation.ok || !validation.value) {
    return { ok: false, errors: validation.errors };
  }

  // Cap check. Read-then-write is racy in theory (two concurrent creates
  // could both see count=9 and both insert), but the cap is generous
  // enough that briefly exceeding it by one is fine. Adding a partial
  // unique index would be V1.1 hardening.
  const count = await prisma.monitor.count({ where: { orgId: org.id } });
  if (count >= 10) return { ok: false, error: "limit_reached" };

  const monitor = await prisma.monitor.create({
    data: {
      orgId: org.id,
      name: validation.value.name,
      description: validation.value.description ?? null,
      metric: validation.value.metric,
      comparator: validation.value.comparator,
      threshold: validation.value.threshold,
      windowMinutes: validation.value.windowMinutes,
      environment: validation.value.environment ?? null,
      model: validation.value.model ?? null,
      // `createdBy` (Supabase auth_user_id) deferred until we surface it
      // through the org helper. Schema allows null; design doc §2 notes
      // this is V1-acceptable.
    },
  });

  revalidatePath("/monitors");
  return { ok: true, id: monitor.id };
}

export async function updateMonitor(
  id: string,
  raw: unknown,
): Promise<UpdateMonitorResult> {
  const org = await getOrCreateOrg();
  if (!org) return { ok: false, error: "no_tenant" };

  const validation = await validateMonitorInput(raw);
  if (!validation.ok || !validation.value) {
    return { ok: false, errors: validation.errors };
  }

  // IDOR-safe `updateMany` with compound `(id, orgId)` filter. A wrong-
  // tenant id matches zero rows; we map that to `not_found` rather than
  // letting the caller think the update succeeded silently.
  const result = await prisma.monitor.updateMany({
    where: { id, orgId: org.id },
    data: {
      name: validation.value.name,
      description: validation.value.description ?? null,
      metric: validation.value.metric,
      comparator: validation.value.comparator,
      threshold: validation.value.threshold,
      windowMinutes: validation.value.windowMinutes,
      environment: validation.value.environment ?? null,
      model: validation.value.model ?? null,
    },
  });
  if (result.count === 0) return { ok: false, error: "not_found" };

  revalidatePath("/monitors");
  revalidatePath(`/monitors/${id}`);
  return { ok: true };
}

export async function deleteMonitor(id: string): Promise<DeleteMonitorResult> {
  const org = await getOrCreateOrg();
  if (!org) return { ok: false, error: "no_tenant" };

  // `deleteMany` with the compound filter is atomically IDOR-safe — there's
  // no find-then-delete window where another transaction could swap the
  // row's orgId. Cascades to `MonitorTrigger` via the schema's
  // `onDelete: Cascade`.
  const result = await prisma.monitor.deleteMany({
    where: { id, orgId: org.id },
  });
  if (result.count === 0) return { ok: false, error: "not_found" };

  revalidatePath("/monitors");
  return { ok: true };
}

export async function toggleMonitor(
  id: string,
  enabled: boolean,
): Promise<ToggleMonitorResult> {
  const org = await getOrCreateOrg();
  if (!org) return { ok: false, error: "no_tenant" };

  const result = await prisma.monitor.updateMany({
    where: { id, orgId: org.id },
    data: { enabled },
  });
  if (result.count === 0) return { ok: false, error: "not_found" };

  revalidatePath("/monitors");
  revalidatePath(`/monitors/${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Preview metric — server-action wrapper around the ClickHouse query.
// Forwards to `previewMonitorMetric` in `lib/monitors-server.ts`, which
// returns `{ ready: false }` until backend's #17 (B10) lands the real
// aggregation. Modal renders an "unavailable" caption when not ready.
// ---------------------------------------------------------------------------

export async function previewMonitorMetricAction(
  raw: MonitorPreviewInput,
): Promise<
  | { ok: true; result: MonitorPreviewResult }
  | { ok: false; error: "no_tenant" }
> {
  const org = await getOrCreateOrg();
  if (!org?.tenantId) return { ok: false, error: "no_tenant" };
  const result = await previewMonitorMetric(org.tenantId, raw);
  return { ok: true, result };
}
