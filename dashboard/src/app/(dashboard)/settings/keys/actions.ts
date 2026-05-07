"use server";

import { revalidatePath } from "next/cache";

import { getOrCreateOrg, requireTenantId } from "@/lib/org";
import {
  createApiKeyForOrg,
  revokeApiKeyForOrg,
  type CreateResult,
  type RevokeResult,
} from "@/lib/api-key-mutations";

/**
 * Server actions for the API-keys page. These are thin wrappers around
 * `lib/api-key-mutations` — they handle auth + tenant resolution and then
 * delegate to the helper, which owns the Postgres↔Redis atomicity logic.
 *
 * Both return the `{ ok, ... }` envelope shape per
 * `dashboard-conventions-drift.md` §2.8 so the client can surface a toast on
 * partial-failure (#26 — F7) without throwing through Next's RPC channel.
 */

export async function createApiKey(name: string): Promise<CreateResult> {
  const org = await getOrCreateOrg();
  if (!org) {
    return { ok: false, message: "Tenant context unavailable. Sign out and back in." };
  }
  // Touch tenantId before delegating so the same `requireTenantId()` invariant
  // the rest of the codebase relies on holds at the action boundary.
  void requireTenantId(org.tenantId);

  const result = await createApiKeyForOrg(org, name);
  if (result.ok) {
    revalidatePath("/settings/keys");
  }
  return result;
}

export async function revokeApiKey(keyId: string): Promise<RevokeResult> {
  const org = await getOrCreateOrg();
  if (!org) {
    return { ok: false, message: "Tenant context unavailable. Sign out and back in." };
  }
  void requireTenantId(org.tenantId);

  const result = await revokeApiKeyForOrg(org, keyId);
  // Always revalidate — even on partial-failure the user's view should
  // refresh so they can see the (still-active-in-Postgres) row and decide
  // whether to retry.
  revalidatePath("/settings/keys");
  return result;
}
