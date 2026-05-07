// Package hydrate rebuilds the Redis API-key cache from Postgres on gateway
// startup. Postgres is the source of truth; Redis is the gateway's hot
// cache. They drift in two scenarios:
//
//  1. Redis loses data (flush, eviction, restore-from-stale-snapshot). Without
//     hydrate, every dashboard-issued key would 401 until manually re-synced.
//  2. A dashboard mutation half-fails: Redis gets a write that Postgres misses
//     (or vice-versa) because the application-side rollback couldn't close
//     the loop. See `dashboard/src/lib/api-key-mutations.ts` for the
//     application-side compensating actions; this package handles the
//     residue.
//
// Convergence rule (option-b per #26 design discussion): "revoked anywhere
// wins". On hydrate:
//
//   - Postgres row says active=true AND Redis says active=false → write
//     Postgres back to active=false (Redis-revoked wins). The most common
//     way this state arises is a successful Redis-revoke followed by a
//     failed Postgres-update (the dashboard's revoke ordering is Redis-
//     first specifically so this stale-Postgres state is the recoverable
//     one).
//
//   - Postgres row says active=false → write Redis active=false regardless
//     of what's currently there. Postgres-revoked also wins.
//
//   - Both say active=true → write Redis with the full Postgres state
//     (tenant_id, tier, rate_limit). This is the pure rebuild path that
//     handles Redis flush.
//
//   - Postgres has no row, Redis has the key → leave Redis alone. These are
//     keys minted by `gateway/cmd/seed` (Redis-only, pre-#27). #27 is the
//     task that mirrors them into Postgres; until then we don't delete them.
//
// Failure mode: the gateway calls Hydrate as a best-effort step at startup.
// If Postgres is unreachable, the gateway logs a warning and continues
// serving with whatever's in Redis. Operational availability beats strict
// consistency at boot — Redis already had the data.
package hydrate

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// RedisClient is the subset of `*redis.Client` Hydrate exercises. Pinning
// to an interface lets tests pass `*miniredis` or a hand-rolled mock without
// dragging in the full client surface.
type RedisClient interface {
	HGet(ctx context.Context, key, field string) *redis.StringCmd
	HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
}

// Stats summarises the work done in a single Hydrate run. Useful both for
// logging and for tests to assert on the outcome.
type Stats struct {
	PostgresRowsScanned int
	RedisWritesActive   int // wrote active=true rows to Redis
	RedisWritesRevoked  int // wrote active=false (either from PG-revoked or Redis-revoke-wins)
	PostgresConverged   int // patched PG active=false because Redis said revoked
	Errors              int // per-row errors that were logged but didn't abort the run
}

// Hydrate scans `api_keys ⨝ organizations` in Postgres and reconciles each
// row into Redis per the package's convergence rule. The function does NOT
// iterate Redis to look for orphaned keys — Redis-only entries (gateway-
// seeded) are intentionally untouched until #27 mirrors them into Postgres.
//
// Returns a Stats summary on success. On a fatal error (Postgres
// unreachable, query fails, etc.) returns the error and a partial Stats.
// Per-row failures are logged and counted in Stats.Errors but do not abort.
func Hydrate(ctx context.Context, db *sql.DB, rdb RedisClient) (Stats, error) {
	stats := Stats{}

	rows, err := db.QueryContext(ctx, hydrateQuery)
	if err != nil {
		return stats, fmt.Errorf("hydrate query: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		stats.PostgresRowsScanned++

		var (
			keyID, keyHash, tenantID, tier string
			rateLimit                      int
			active                         bool
		)
		if err := rows.Scan(&keyID, &keyHash, &tenantID, &tier, &rateLimit, &active); err != nil {
			log.Warn().Err(err).Msg("hydrate: skipping row with scan error")
			stats.Errors++
			continue
		}

		// Read what Redis currently says about this key. If Redis is
		// missing or active=false, we still want to write something
		// authoritative below — the read just lets us implement the
		// "revoked anywhere wins" rule.
		redisActive, err := readRedisActive(ctx, rdb, keyHash)
		if err != nil {
			log.Warn().Err(err).Str("key_id", keyID).Msg("hydrate: redis read failed; skipping")
			stats.Errors++
			continue
		}

		// Convergence: if Redis says revoked and Postgres still says
		// active, propagate Redis's truth back to Postgres.
		if redisActive == redisFalse && active {
			if _, err := db.ExecContext(ctx, convergeRevokeQuery, keyID); err != nil {
				log.Warn().Err(err).Str("key_id", keyID).
					Msg("hydrate: failed to converge Postgres active=false; will retry next startup")
				stats.Errors++
				// Keep going — even if Postgres update failed, we still
				// don't need to write Redis (it's already revoked).
				continue
			}
			stats.PostgresConverged++
			stats.RedisWritesRevoked++ // tracked separately because we didn't write Redis here
			continue
		}

		// Otherwise write Redis to match Postgres. Active rows write the
		// full record; revoked rows write a marker the gateway's
		// `LookupAPIKey` will reject.
		if active {
			if err := writeActive(ctx, rdb, keyHash, tenantID, tier, rateLimit); err != nil {
				log.Warn().Err(err).Str("key_id", keyID).Msg("hydrate: failed to write active=true row")
				stats.Errors++
				continue
			}
			stats.RedisWritesActive++
		} else {
			if err := writeRevoked(ctx, rdb, keyHash); err != nil {
				log.Warn().Err(err).Str("key_id", keyID).Msg("hydrate: failed to write active=false row")
				stats.Errors++
				continue
			}
			stats.RedisWritesRevoked++
		}
	}
	if err := rows.Err(); err != nil {
		return stats, fmt.Errorf("hydrate row iteration: %w", err)
	}

	log.Info().
		Int("rows_scanned", stats.PostgresRowsScanned).
		Int("redis_active", stats.RedisWritesActive).
		Int("redis_revoked", stats.RedisWritesRevoked).
		Int("postgres_converged", stats.PostgresConverged).
		Int("errors", stats.Errors).
		Msg("hydrate complete")

	return stats, nil
}

const (
	redisTrue  = "true"
	redisFalse = "false"

	// hydrateQuery returns one row per API key with the org-level fields the
	// gateway needs to populate Redis. Active flag is on the api_keys row.
	hydrateQuery = `
		SELECT k.id::text, k.key_hash, o.tenant_id, o.tier, o.rate_limit, k.active
		FROM api_keys k
		JOIN organizations o ON k.org_id = o.id
	`

	// convergeRevokeQuery is the lone Postgres write hydrate makes — flipping
	// `active` to false to match Redis when Redis is the authority. The
	// `id::text` cast lets us pass the parameter as a string (matching the
	// SELECT's `k.id::text`) — pgx parameterises strings as text by default
	// and a bare `WHERE id = $1` would error with `text = uuid`.
	convergeRevokeQuery = `UPDATE api_keys SET active = false WHERE id::text = $1`
)

// readRedisActive returns "true" / "false" / "" (missing). A redis.Nil error
// is treated as missing rather than a fatal error.
func readRedisActive(ctx context.Context, rdb RedisClient, keyHash string) (string, error) {
	v, err := rdb.HGet(ctx, redisKey(keyHash), "active").Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return "", nil
		}
		return "", err
	}
	return v, nil
}

func writeActive(ctx context.Context, rdb RedisClient, keyHash, tenantID, tier string, rateLimit int) error {
	return rdb.HSet(ctx, redisKey(keyHash), map[string]interface{}{
		"tenant_id":  tenantID,
		"tier":       tier,
		"rate_limit": fmt.Sprintf("%d", rateLimit),
		"active":     redisTrue,
	}).Err()
}

func writeRevoked(ctx context.Context, rdb RedisClient, keyHash string) error {
	return rdb.HSet(ctx, redisKey(keyHash), "active", redisFalse).Err()
}

func redisKey(hash string) string { return "apikey:" + hash }
