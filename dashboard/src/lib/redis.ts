import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis: Redis };

export const redis =
  globalForRedis.redis ||
  new Redis(process.env.REDIS_URL || "redis://localhost:6379");

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
