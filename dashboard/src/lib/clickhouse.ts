import { createClient } from "@clickhouse/client";

/**
 * Hard-fail at module load if a credential env is missing rather than
 * silently falling back to the dev defaults. Compiled-in `|| "otel"` /
 * `|| "otelpass"` fallbacks ship to production and turn a forgotten env
 * var into a silent regression to dev creds — exactly the failure mode
 * `.agents/tenant-isolation-audit.md` S3 / #31 calls out.
 *
 * The URL fallback stays — it's a host/port, not a credential, and the
 * `localhost:8123` default is purely dev convenience (compose injects
 * `http://clickhouse:8123` in the dashboard container).
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required for the dashboard's ClickHouse client. ` +
      "Set it in your environment (docker-compose injects it for the " +
      "`dashboard` service; for local dev outside compose, source the " +
      "values from `docker-compose.yaml` or your team's secrets store)."
    );
  }
  return value;
}

export const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
  username: requireEnv("CLICKHOUSE_USER"),
  password: requireEnv("CLICKHOUSE_PASSWORD"),
  request_timeout: 30000,
});
