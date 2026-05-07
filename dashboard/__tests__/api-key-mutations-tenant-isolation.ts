/**
 * B-harden #26 acceptance check — Postgres↔Redis atomicity for the API key
 * mutation helpers in `dashboard/src/lib/api-key-mutations.ts`.
 *
 * Property-style coverage (each property runs in isolation against a fresh
 * Org row in Postgres + a fresh Redis hash):
 *
 *   create-happy:        Postgres row exists + Redis hash matches Org.
 *   create-rollback:     inject a Redis-throwing client → Postgres row
 *                        is rolled back, Redis hash absent.
 *   revoke-happy:        Redis active=false AND Postgres active=false.
 *   revoke-redis-fail:   inject a Redis-throwing client → Postgres row
 *                        STAYS active=true (we never wrote Redis, so Redis
 *                        also still says active=true). Caller sees `ok=false`.
 *   revoke-pg-fail:      inject a Postgres-update-throwing client →
 *                        Redis active=false (security-relevant write
 *                        committed) BUT Postgres row stays active=true.
 *                        Caller sees `ok=false` with stale-dashboard message.
 *                        This is the inverted-order property; the gateway
 *                        starts rejecting the key even though the dashboard
 *                        view is briefly stale.
 *
 * Run:
 *
 *     # from dashboard/, with docker-compose up:
 *     bash scripts/run-tenant-isolation-tests.sh
 *     # or directly:
 *     npx tsx --env-file=.env __tests__/api-key-actions-atomicity.ts
 */

import { randomBytes } from "node:crypto";

import {
  createApiKeyForOrg,
  revokeApiKeyForOrg,
  type OrgForKeyMutation,
} from "../src/lib/api-key-mutations";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";

const runId = randomBytes(4).toString("hex");
const TENANT_ID = `wardtest_${runId}_atomicity`;
const ORG_SLUG = `wardtest-${runId}-atomicity`;

const failures: string[] = [];

function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

interface OrgRow extends OrgForKeyMutation {
  id: string;
  tenantId: string;
}

async function withFreshOrg(
  fn: (org: OrgRow) => Promise<void>,
): Promise<void> {
  const created = await prisma.organization.create({
    data: {
      name: `wardtest atomicity ${runId}`,
      slug: `${ORG_SLUG}-${randomBytes(3).toString("hex")}`,
      tenantId: `${TENANT_ID}-${randomBytes(3).toString("hex")}`,
      tier: "free",
      rateLimit: 10000,
    },
  });
  try {
    await fn({
      id: created.id,
      tenantId: created.tenantId,
      tier: created.tier,
      rateLimit: created.rateLimit,
    });
  } finally {
    // Cascade deletes the api_keys rows; redis cleanup is best-effort.
    await prisma.organization.delete({ where: { id: created.id } }).catch(() => {});
  }
}

async function redisHashState(keyHash: string): Promise<Record<string, string> | null> {
  const exists = await redis.exists(`apikey:${keyHash}`);
  if (!exists) return null;
  const all = await redis.hgetall(`apikey:${keyHash}`);
  return all;
}

async function deleteRedisHash(keyHash: string) {
  await redis.del(`apikey:${keyHash}`);
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

async function createHappy() {
  console.log("\n# create — happy path");
  await withFreshOrg(async (org) => {
    const result = await createApiKeyForOrg(org, "happy");
    assert(result.ok === true, "create returns ok=true");
    if (!result.ok) return;

    const pg = await prisma.apiKey.findUnique({ where: { id: result.keyId } });
    assert(pg !== null, "Postgres row exists for the new key");
    assert(pg?.active === true, "Postgres row has active=true");

    // Re-derive the hash from the plaintext to look up Redis. The helper
    // doesn't return the hash directly — keyPrefix on the row is opaque.
    const keyHash = pg!.keyHash;
    const r = await redisHashState(keyHash);
    assert(r !== null, `Redis hash exists at apikey:${keyHash.slice(0, 8)}…`);
    assert(r?.tenant_id === org.tenantId, "Redis tenant_id matches org");
    assert(r?.tier === "free", "Redis tier matches org tier");
    assert(r?.rate_limit === "10000", "Redis rate_limit matches org");
    assert(r?.active === "true", "Redis active=true");

    await deleteRedisHash(keyHash);
  });
}

async function createRollback() {
  console.log("\n# create — Redis fails → Postgres rolled back");
  await withFreshOrg(async (org) => {
    // Stub Redis client whose hset throws. The helper wraps Postgres-create
    // in try/rollback, so we expect ok=false AND zero Postgres residue.
    const failingRedis = {
      hset: async () => {
        throw new Error("synthetic Redis outage");
      },
    };

    const before = await prisma.apiKey.count({ where: { orgId: org.id } });
    const result = await createApiKeyForOrg(org, "rollback", {
      redis: failingRedis,
    });
    const after = await prisma.apiKey.count({ where: { orgId: org.id } });

    assert(result.ok === false, "create returns ok=false on Redis failure");
    assert(before === after, `Postgres row count unchanged after rollback (before=${before}, after=${after})`);
    assert(
      !result.ok && /try again/i.test(result.message),
      "failure message points the user at retry",
    );
  });
}

async function revokeHappy() {
  console.log("\n# revoke — happy path");
  await withFreshOrg(async (org) => {
    const created = await createApiKeyForOrg(org, "to-revoke");
    if (!created.ok) {
      assert(false, "fixture: create should succeed");
      return;
    }

    const pg = await prisma.apiKey.findUnique({ where: { id: created.keyId } });
    if (!pg) {
      assert(false, "fixture: Postgres row should exist");
      return;
    }

    const result = await revokeApiKeyForOrg(org, created.keyId);
    assert(result.ok === true, "revoke returns ok=true");

    const pgAfter = await prisma.apiKey.findUnique({ where: { id: created.keyId } });
    assert(pgAfter?.active === false, "Postgres row marked active=false");

    const r = await redisHashState(pg.keyHash);
    assert(r?.active === "false", "Redis hash flipped to active=false");

    await deleteRedisHash(pg.keyHash);
  });
}

async function revokeRedisFail() {
  console.log("\n# revoke — Redis fails BEFORE Postgres update");
  await withFreshOrg(async (org) => {
    const created = await createApiKeyForOrg(org, "redis-fail");
    if (!created.ok) {
      assert(false, "fixture: create should succeed");
      return;
    }
    const pg = await prisma.apiKey.findUnique({ where: { id: created.keyId } });
    if (!pg) return;

    const failingRedis = {
      hset: async () => {
        throw new Error("synthetic Redis outage");
      },
    };

    const result = await revokeApiKeyForOrg(org, created.keyId, {
      redis: failingRedis,
    });
    assert(result.ok === false, "revoke returns ok=false when Redis is down");

    const pgAfter = await prisma.apiKey.findUnique({ where: { id: created.keyId } });
    assert(
      pgAfter?.active === true,
      "Postgres row STAYS active=true (no Postgres write attempted yet)",
    );

    // Redis was never touched — the key remains active in the cache too.
    // This is the *intended* behaviour of inverted-order revoke: if we can't
    // commit the security-relevant write, we don't pretend half the work
    // happened. The user retries.
    const r = await redisHashState(pg.keyHash);
    assert(r?.active === "true", "Redis row remains active=true (not partially flipped)");

    await deleteRedisHash(pg.keyHash);
  });
}

async function revokePostgresFail() {
  console.log("\n# revoke — Redis succeeds, Postgres update fails");
  await withFreshOrg(async (org) => {
    const created = await createApiKeyForOrg(org, "pg-fail");
    if (!created.ok) {
      assert(false, "fixture: create should succeed");
      return;
    }
    const pg = await prisma.apiKey.findUnique({ where: { id: created.keyId } });
    if (!pg) return;

    // Stub Prisma client: passes through findFirst, throws on update.
    // findFirst is needed for the "key belongs to this org" check.
    const failingPrisma = {
      apiKey: {
        findFirst: prisma.apiKey.findFirst.bind(prisma.apiKey),
        update: async () => {
          throw new Error("synthetic Postgres outage");
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await revokeApiKeyForOrg(org, created.keyId, { prisma: failingPrisma as any });
    assert(result.ok === false, "revoke returns ok=false on Postgres failure");
    assert(
      !result.ok && /stale/i.test(result.message),
      "failure message warns the user about the stale dashboard view",
    );

    // Critical: the SECURITY-relevant write (Redis active=false) WAS committed.
    // This is the whole point of the inverted-order strategy.
    const r = await redisHashState(pg.keyHash);
    assert(
      r?.active === "false",
      "Redis row IS flipped to active=false despite Postgres failure (gateway already stops accepting the key)",
    );

    // Postgres view is stale until next gateway restart hydrates it.
    const pgAfter = await prisma.apiKey.findUnique({ where: { id: created.keyId } });
    assert(
      pgAfter?.active === true,
      "Postgres row stays active=true (dashboard view briefly stale; hydrate-on-restart converges)",
    );

    await deleteRedisHash(pg.keyHash);
  });
}

async function main() {
  console.log(`\n[api-key-actions-atomicity] runId=${runId}`);
  try {
    await createHappy();
    await createRollback();
    await revokeHappy();
    await revokeRedisFail();
    await revokePostgresFail();
  } finally {
    // Best-effort: any leftover redis hashes from runaway tests get cleaned
    // up here. Postgres cascade-deletes the keys when the org is dropped in
    // `withFreshOrg`'s finally block.
    redis.disconnect();
    await prisma.$disconnect();
  }

  if (failures.length) {
    console.error(`\n[FAIL] ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n[PASS] all api-key-actions-atomicity assertions passed");
}

void main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
