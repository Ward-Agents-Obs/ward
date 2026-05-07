/**
 * API key mutation helpers — the actual create/revoke logic, separated from
 * the request-handling server actions so it can be unit-tested without a
 * Next.js context. Server actions in `app/(dashboard)/settings/keys/actions.ts`
 * delegate here after resolving auth + tenant.
 *
 * Why a separate module rather than exporting helpers from `actions.ts`?
 *   - `"use server"` modules auto-expose every export as an RPC. Helpers we
 *     want to keep server-internal (or test directly) shouldn't ride that
 *     contract; lib/* modules with no `"use server"` directive are the right
 *     home (matches `dashboard-conventions-drift.md` §1.2).
 *
 * Atomicity strategy (B-harden #26 / `tenant-isolation-audit.md` F7):
 *
 *   CREATE — Postgres-first, Redis-second. If Redis fails, roll Postgres
 *            back: a half-created key is just broken from the user's PoV
 *            (the gateway can't authenticate it), so deleting the row is
 *            the right way to keep the user-visible state coherent.
 *
 *   REVOKE — Redis-first, Postgres-second. If Postgres fails, the key is
 *            already correctly rejected at the gateway (Redis says
 *            active=false). Do NOT roll Redis forward — that would
 *            re-enable a revoked key, which is strictly worse than a stale
 *            dashboard view. Hydrate-on-restart converges Postgres next
 *            time the gateway reboots (see `gateway/internal/hydrate`).
 */

import { Prisma } from "@prisma/client";
import type { ApiKey, Organization, PrismaClient } from "@prisma/client";
import type { Redis as RedisClient } from "ioredis";

import { prisma as defaultPrisma } from "@/lib/prisma";
import { redis as defaultRedis, syncKeyToRedis } from "@/lib/redis";
import { generateApiKey } from "@/lib/api-keys";

// Subset of `Organization` the helpers need. Action callers pass the row
// they already loaded in `getOrCreateOrg()`.
export type OrgForKeyMutation = Pick<
  Organization,
  "id" | "tenantId" | "tier" | "rateLimit"
>;

/** Optional dependency injection for tests. Production callers omit and the
 *  module-level Prisma + Redis clients are used. */
export interface MutationDeps {
  prisma?: PrismaClient | Prisma.TransactionClient;
  redis?: Pick<RedisClient, "hset">;
}

export type CreateResult =
  | { ok: true; plain: string; keyId: string; keyPrefix: string }
  | { ok: false; message: string };

export type RevokeResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Issue a new API key for `org`. Postgres is written first, then Redis. If
 * the Redis sync fails, the Postgres row is deleted before the error is
 * surfaced to the caller. The plaintext is returned ONCE on success and is
 * never persisted in the dashboard side outside the response.
 */
export async function createApiKeyForOrg(
  org: OrgForKeyMutation,
  name: string,
  deps: MutationDeps = {},
): Promise<CreateResult> {
  // Cast to PrismaClient for narrowing — both PrismaClient and TransactionClient
  // expose `apiKey.create / .delete` so calls below type-check either way.
  const prisma = (deps.prisma ?? defaultPrisma) as PrismaClient;
  const redis = deps.redis ?? defaultRedis;

  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, message: "Key name cannot be empty." };
  }

  const { plain, hash, prefix } = generateApiKey();

  let created: ApiKey;
  try {
    created = await prisma.apiKey.create({
      data: {
        orgId: org.id,
        name: trimmed,
        keyPrefix: prefix,
        keyHash: hash,
      },
    });
  } catch (err) {
    // Duplicate keyHash is astronomically unlikely (16 random bytes) but the
    // unique constraint exists; surface a sane message rather than a Prisma
    // error blob.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        ok: false,
        message: "Hash collision when generating the key. Try again.",
      };
    }
    return {
      ok: false,
      message: "Couldn't write the new key to the database. Try again.",
    };
  }

  try {
    await syncKeyToRedis(
      hash,
      org.tenantId,
      org.rateLimit,
      org.tier,
      true,
      redis,
    );
  } catch (err) {
    // Roll back Postgres so the dashboard never shows a key the gateway
    // can't authenticate. This deletion is best-effort — if it also fails,
    // the gateway's startup hydrate will eventually converge state. We
    // surface the original Redis error message rather than the rollback
    // outcome since that's what the user can act on (retry).
    try {
      await prisma.apiKey.delete({ where: { id: created.id } });
    } catch (rollbackErr) {
      // Phantom row — Postgres has it, Redis doesn't. The next gateway
      // hydrate will write it to Redis, *unless* the original Redis error
      // was transient and the second pass succeeds. Either way, log loudly.
      console.error(
        "[api-key-mutations] PANIC: Postgres rollback failed after Redis sync failure. " +
        `Phantom row ${created.id} in api_keys; gateway hydrate will reconcile.`,
        { redisErr: err, rollbackErr },
      );
    }
    return {
      ok: false,
      message:
        "Couldn't provision the key in the auth cache. Try again — the dashboard rolled back the partial create so retrying is safe.",
    };
  }

  return {
    ok: true,
    plain,
    keyId: created.id,
    keyPrefix: prefix,
  };
}

/**
 * Mark `keyId` revoked. Redis is updated first so the gateway stops
 * authenticating the key as soon as we've committed *anywhere*. Postgres is
 * updated second; if that fails, the dashboard view will still show the key
 * as active, but the security-relevant state (gateway acceptance) is
 * already correct. The next gateway startup hydrate (option-b: revoked
 * anywhere wins) converges Postgres back to inactive.
 */
export async function revokeApiKeyForOrg(
  org: OrgForKeyMutation,
  keyId: string,
  deps: MutationDeps = {},
): Promise<RevokeResult> {
  const prisma = (deps.prisma ?? defaultPrisma) as PrismaClient;
  const redis = deps.redis ?? defaultRedis;

  // Read the key first so we know which Redis hash to flip — and to confirm
  // the key actually belongs to the supplied org. Cross-org revoke would be
  // a bug; the action layer's `requireTenantId()` covers tenant scoping but
  // the keyId itself comes from the URL/UI and must be checked here too.
  const key = await prisma.apiKey.findFirst({
    where: { id: keyId, orgId: org.id },
  });
  if (!key) {
    return { ok: false, message: "API key not found." };
  }
  if (!key.active) {
    // Idempotent: already revoked.
    return { ok: true };
  }

  // Step 1 — kill auth at the gateway. This is the security-relevant write.
  try {
    await syncKeyToRedis(
      key.keyHash,
      org.tenantId,
      org.rateLimit,
      org.tier,
      false,
      redis,
    );
  } catch (err) {
    return {
      ok: false,
      message:
        "Couldn't reach the auth cache to revoke the key. The key is still active. Try again.",
    };
  }

  // Step 2 — converge Postgres so the dashboard view reflects the revoke.
  try {
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { active: false },
    });
  } catch (err) {
    // Don't roll Redis back — the security intent (key disabled at gateway)
    // is already committed, and re-activating it here to "match" Postgres
    // would defeat the revocation. Hydrate-on-restart converges Postgres.
    console.error(
      "[api-key-mutations] revoke: Redis flipped active=false but Postgres update failed. " +
      `Key ${keyId} will show as active in the dashboard until next gateway restart converges state.`,
      { err },
    );
    return {
      ok: false,
      message:
        "Key revoked at the gateway, but the dashboard record may be stale. Refresh in a moment.",
    };
  }

  return { ok: true };
}
