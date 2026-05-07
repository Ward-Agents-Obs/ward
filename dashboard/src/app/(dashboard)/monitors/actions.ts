"use server";

// `next/cache`'s `revalidatePath` will be imported once the real Prisma
// writes land (backend tasks #14/#15) — a stub action shouldn't call it.
import { getOrCreateOrg, requireTenantId } from "@/lib/org";
import {
  type Monitor,
  type MonitorPreviewInput,
  type MonitorPreviewResult,
  previewMonitorMetric,
  validateMonitorInput,
} from "@/lib/monitors";

/**
 * Server actions for the Create/Edit Monitor modal (F8 / task #19).
 *
 * These are SCAFFOLD STUBS until backend lands #14 (Prisma models),
 * #15 (the canonical create/update/delete/toggle actions with zod), and
 * #17 (ClickHouse preview query). The shapes here mirror what the design
 * doc (`.agents/monitors-design.md` §5) specifies so the F8 form binds
 * against the real contract from day one — once the real implementation
 * lands, the bodies swap inside this file with no caller changes.
 *
 * Tenant safety pattern is already in place: every mutation calls
 * `getOrCreateOrg()` + `requireTenantId()` before doing anything else.
 * That guard stays even when this file is rewired.
 */

export interface MonitorActionResult {
  ok: boolean;
  /** Field-keyed validation errors mirroring `validateMonitorInput`. */
  errors?: Record<string, string>;
  /** Single user-facing message for non-field errors (cap reached, missing tenant, etc.). */
  message?: string;
  monitor?: Monitor;
}

/**
 * V1 STUB. Real impl (B8) will:
 *  1. Run `getOrCreateOrg()` + `requireTenantId()`.
 *  2. Parse with the canonical zod schema.
 *  3. Enforce the ≤10-monitors-per-tenant cap.
 *  4. `prisma.monitor.create({ data: { orgId, createdBy, ...input }})`.
 *  5. Return the new monitor; revalidate `/monitors`.
 */
export async function createMonitor(raw: unknown): Promise<MonitorActionResult> {
  const org = await getOrCreateOrg();
  if (!org) {
    return { ok: false, message: "Tenant context unavailable. Sign out and back in." };
  }
  // Touch tenantId for the same-shape parity check the real action will do
  // before any Prisma write — keeps the `requireTenantId()` invariant on the
  // mutation path even though the body is a no-op stub today.
  void requireTenantId(org.tenantId);

  const validation = await validateMonitorInput(raw);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  return {
    ok: false,
    message:
      "Monitor creation isn't wired up yet — backend tasks #14 (Prisma model) and #15 (server actions) are pending. Form validation and preview wiring are live so you can shake out UX.",
  };
}

/**
 * V1 STUB. Real impl (B8): scope-check `monitor.orgId === currentOrg.id`,
 * parse, update, revalidate.
 */
export async function updateMonitor(
  id: string,
  raw: unknown,
): Promise<MonitorActionResult> {
  const org = await getOrCreateOrg();
  if (!org) {
    return { ok: false, message: "Tenant context unavailable." };
  }
  void requireTenantId(org.tenantId);
  void id;

  const validation = await validateMonitorInput(raw);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  return {
    ok: false,
    message:
      "Monitor updates aren't wired up yet — backend tasks #14 + #15 are pending.",
  };
}

/**
 * V1 STUB. Real impl (B8): scope-check, cascade delete via Prisma, revalidate.
 */
export async function deleteMonitor(id: string): Promise<MonitorActionResult> {
  const org = await getOrCreateOrg();
  if (!org) return { ok: false, message: "Tenant context unavailable." };
  void requireTenantId(org.tenantId);
  void id;
  return {
    ok: false,
    message: "Monitor deletion isn't wired up yet — backend tasks #14 + #15 are pending.",
  };
}

/**
 * V1 STUB. Real impl (B8): scope-check, set `enabled = !current`, revalidate.
 */
export async function toggleMonitor(
  id: string,
  enabled: boolean,
): Promise<MonitorActionResult> {
  const org = await getOrCreateOrg();
  if (!org) return { ok: false, message: "Tenant context unavailable." };
  void requireTenantId(org.tenantId);
  void id;
  void enabled;
  return {
    ok: false,
    message: "Monitor toggle isn't wired up yet — backend tasks #14 + #15 are pending.",
  };
}

/**
 * Preview the current value of a metric over the requested window for the
 * modal's live preview pane. Tenant-scoped via `requireTenantId()`.
 *
 * Today this returns the helper's stubbed `{ value: 0, ready: false }`.
 * Real impl is backend's task #17 (B10) — body of `previewMonitorMetric()`
 * in `lib/monitors.ts` swaps for a ClickHouse aggregation and this action
 * inherits the change.
 */
export async function previewMonitorMetricAction(
  raw: MonitorPreviewInput,
): Promise<{ ok: true; result: MonitorPreviewResult } | { ok: false; message: string }> {
  const org = await getOrCreateOrg();
  if (!org) return { ok: false, message: "Tenant context unavailable." };
  const tenantId = requireTenantId(org.tenantId);
  const result = await previewMonitorMetric(tenantId, raw);
  return { ok: true, result };
}

