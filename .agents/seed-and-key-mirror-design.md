# Seed + Key-Mirror Design

**For:** backend, before #27. **From:** architect, 2026-05-07.

## 1. Current behavior of `gateway/cmd/seed/main.go`

Takes `--tenant` (required), `--tier` (default `free`), `--rate-limit` (default 10000). Generates `"ward_" + 48 hex chars` via `auth.GenerateAPIKey()` (24 random bytes), SHA-256-hashes the plaintext, writes one Redis hash `apikey:<hash> → {tenant_id, tier, rate_limit, active=true}`. Prints the plain key plus a ready-to-paste SDK snippet. **Not idempotent** — every invocation produces a fresh random key.

## 2. Changes for #27

Per locked decision: seed dual-writes to Redis **and** Postgres `api_keys`.
1. Resolve-or-create the Postgres `organizations` row keyed on `tenant_id` (`ON CONFLICT (tenant_id) DO NOTHING`).
2. Insert into `api_keys` with `org_id`, `key_hash`, `key_prefix = plain[:11]`, `name = "seeded"`, `active = true`. `ON CONFLICT (key_hash) DO NOTHING`.
3. Add `--no-postgres` flag for stacks without Prisma migrations (early CI).
4. **Standardize key format with the dashboard.** Today seed emits `ward_<48 hex>`, dashboard emits `ak_live_<32 hex>`. Pick one — recommend `ak_live_<32 hex>` since it matches `/settings/keys` and downstream gitleaks/CI regex (`ak_live_[0-9a-f]{32}`).

## 3. Idempotency for #9 regression tests

Add a `--key <plain>` flag. When set, skip generation and write hash of the supplied plaintext. Tests pass deterministic strings (`ak_live_aaaa…aaaa` for tenantA, `ak_live_bbbb…bbbb` for tenantB) and avoid stdout-parsing brittleness. debug-expert's "delete `wardtest_*` hashes" workaround becomes unnecessary.

When `--key` is unset, behavior is today's: random generation. Production seeds stay random.

## 3a. Test file convention

Dashboard has no jest/vitest runner (debug-expert confirmed). Existing convention is tsx scripts under `dashboard/__tests__/` run via `npx tsx <file>` (see `overview-tenant-isolation.ts`, `getspans-tenant-isolation.ts`). Format-drift guard goes at `dashboard/__tests__/api-key-format-guard.ts` and is added to `dashboard/scripts/run-tenant-isolation-tests.sh` so it runs in CI alongside the isolation tests.

## 4. Trust boundary

**Operator-only, never user-facing.** Reads `DATABASE_URL` and Redis credentials from env; both grant write access to the entire tenant key store. Ship as a `make seed` target (binary already gitignored per #29). Never deploy to customer-facing infrastructure — local demo + ops only.
