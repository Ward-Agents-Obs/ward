export const DASHBOARD_DOCS_URL = "https://docs.ward.dev";

/**
 * Public OTLP endpoint that SDK clients should send traces to.
 *
 * Resolves at build time from `NEXT_PUBLIC_WARD_OTLP_ENDPOINT`. Defaults to
 * the gateway's local docker-compose port (`http://localhost:8080`) — the
 * gateway forwards to the collector after auth and tenant injection, so SDK
 * users must NOT target the collector (`:4318`) directly.
 */
export const OTLP_ENDPOINT =
  process.env.NEXT_PUBLIC_WARD_OTLP_ENDPOINT ?? "http://localhost:8080";
