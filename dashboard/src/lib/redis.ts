import Redis from "ioredis";

/**
 * Hard-fail at module load if `REDIS_PASSWORD` is missing rather than
 * silently connecting to an anonymous Redis. Same risk model as
 * `lib/clickhouse.ts:requireEnv()` (#31) — a forgotten env var would have
 * the dashboard talk to a misconfigured Redis (e.g. `--requirepass ""`)
 * and never know it was unauthenticated.
 *
 * Dashboard's #34 fail-closed is symmetric with the gateway's
 * `cmd/gateway/main.go::cfg.RedisPassword == ""` check; both surface
 * operator misconfig at boot rather than as a silent anonymous connection.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required for the dashboard's Redis client. ` +
      "Set it in your environment (docker-compose injects it for the " +
      "`dashboard` service via `${REDIS_PASSWORD:-devredispass}`; for " +
      "local dev outside compose, source the value from `docker-compose.yaml` " +
      "or your team's secrets store)."
    );
  }
  return value;
}

const globalForRedis = globalThis as unknown as { redis: Redis };

// `password:` option overrides whatever's in `REDIS_URL` so the env var is
// the canonical source of truth — operators can use a plain URL like
// `redis://redis:6379` without embedding the password (less url-encoding
// to think about) and the secret stays in `REDIS_PASSWORD`.
export const redis =
  globalForRedis.redis ||
  new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    password: requireEnv("REDIS_PASSWORD"),
  });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

/** Subset of the ioredis client this module needs. Decoupled from the full
 *  `Redis` type so tests can pass a stub without spinning up a real server. */
type RedisHsetClient = Pick<Redis, "hset">;

export async function syncKeyToRedis(
  keyHash: string,
  tenantId: string,
  rateLimit: number,
  tier: string,
  active: boolean,
  client: RedisHsetClient = redis,
) {
  const redisKey = `apikey:${keyHash}`;
  if (active) {
    await client.hset(redisKey, {
      tenant_id: tenantId,
      rate_limit: rateLimit.toString(),
      tier,
      active: "true",
    });
  } else {
    await client.hset(redisKey, { active: "false" });
  }
}
