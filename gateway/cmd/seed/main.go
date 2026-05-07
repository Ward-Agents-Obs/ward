// gateway/cmd/seed: operator-only CLI that mints an API key + records it in
// Redis (so the gateway authenticates it) and Postgres (so the dashboard
// shows it under /settings/keys). Defined-by-#27 / `.agents/seed-and-key-
// mirror-design.md`.
//
// Trust boundary: this binary writes to the entire tenant key store. It is
// never deployed to customer-facing infrastructure — it ships as a `make
// seed` target for local demos and ops one-off provisioning. See #27 §4.
//
// Flags:
//
//	--tenant <id>          required. Tenant ID to associate the key with.
//	--tier <free|pro|team> default: free. Used when creating a new org row;
//	                       ignored on conflict so an operator's tier change
//	                       isn't clobbered by re-running the seeder.
//	--rate-limit <n>       default: 10000 (spans/min). Same conflict
//	                       semantics as --tier.
//	--key <plaintext>      optional. When set, skip random generation and
//	                       write the hash of the supplied plaintext instead.
//	                       Plaintext must match `^ak_live_[0-9a-f]{32}$` —
//	                       anything else exits non-zero. Existed for the #9
//	                       regression-test idempotency requirement.
//	--no-postgres          optional. Skip the Postgres dual-write and behave
//	                       as the legacy seeder did (Redis-only). Logs a
//	                       warning to stderr that the dashboard will not see
//	                       the key.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // pgx as the database/sql driver
	"github.com/redis/go-redis/v9"

	"github.com/ward-dev/gateway/internal/auth"
	"github.com/ward-dev/gateway/internal/config"
)

// keyFormatRe mirrors `gateway/internal/auth/keys_test.go::keyFormatRe` and
// `dashboard/__tests__/api-key-format-guard.ts`. The trio is checked from
// CI; drifting any one of them fails the format-drift guard.
var keyFormatRe = regexp.MustCompile(`^ak_live_[0-9a-f]{32}$`)

func main() {
	tenantID := flag.String("tenant", "", "tenant ID to associate with the key")
	tier := flag.String("tier", "free", "plan tier (free, pro, team)")
	rateLimit := flag.Int("rate-limit", 10000, "rate limit in spans per minute")
	suppliedKey := flag.String("key", "", "optional plaintext key (must match ak_live_<32 hex>); when unset, generates a fresh random key")
	noPostgres := flag.Bool("no-postgres", false, "skip the Postgres dual-write (Redis-only mode; dashboard will not see the key)")
	flag.Parse()

	if *tenantID == "" {
		fmt.Fprintln(os.Stderr, "error: --tenant is required")
		flag.Usage()
		os.Exit(1)
	}

	cfg := config.Load()

	plain, hash, err := resolveKey(*suppliedKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	keyPrefix := plain[:11] // matches `dashboard/src/lib/api-keys.ts:9` slice convention

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// --- Redis: gateway authentication source --------------------------------
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		fmt.Fprintf(os.Stderr, "error: cannot connect to Redis at %s: %v\n", cfg.RedisAddr, err)
		os.Exit(1)
	}

	if err := auth.SeedKey(ctx, rdb, hash, *tenantID, *tier, *rateLimit); err != nil {
		fmt.Fprintf(os.Stderr, "error: seeding Redis: %v\n", err)
		os.Exit(1)
	}

	// --- Postgres: dashboard source-of-truth mirror --------------------------
	var pgSummary string
	switch {
	case *noPostgres:
		fmt.Fprintln(os.Stderr,
			"WARNING: --no-postgres set — the dashboard's /settings/keys page will NOT show this key. "+
				"Use only for stacks without Prisma migrations applied.")
		pgSummary = "skipped (--no-postgres)"
	case cfg.DatabaseURL == "":
		fmt.Fprintln(os.Stderr,
			"error: DATABASE_URL is empty — set it or pass --no-postgres if this stack has no Postgres on purpose.")
		os.Exit(1)
	default:
		orgID, keyID, err := mirrorToPostgres(ctx, cfg.DatabaseURL, *tenantID, *tier, *rateLimit, hash, keyPrefix)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: Postgres mirror failed: %v\n", err)
			os.Exit(1)
		}
		pgSummary = fmt.Sprintf("org=%s key=%s", orgID, keyID)
	}

	// --- Operator-facing output ----------------------------------------------
	fmt.Println("API key created successfully.")
	fmt.Printf("  Key:       %s\n", plain)
	fmt.Printf("  Tenant:    %s\n", *tenantID)
	fmt.Printf("  Tier:      %s\n", *tier)
	fmt.Printf("  RateLimit: %d spans/min\n", *rateLimit)
	fmt.Printf("  Postgres:  %s\n", pgSummary)
	fmt.Println()
	fmt.Println("Use this key in your SDK:")
	fmt.Println()
	fmt.Println("  import ward")
	fmt.Printf("  ward.init(\n")
	fmt.Printf("      otlp_endpoint=\"http://localhost:8080\",\n")
	fmt.Printf("      otlp_headers={\"Authorization\": \"Bearer %s\"},\n", plain)
	fmt.Printf("  )\n")
}

// resolveKey returns the plaintext + hash for the seed run. When `supplied`
// is empty we mint a fresh random key via `auth.GenerateAPIKey`. When set,
// we validate the plaintext against the canonical regex and reuse it —
// this is the path #9's regression tests use to avoid stdout-parsing.
func resolveKey(supplied string) (plain, hash string, err error) {
	if strings.TrimSpace(supplied) == "" {
		return auth.GenerateAPIKey()
	}
	if !keyFormatRe.MatchString(supplied) {
		return "", "", fmt.Errorf(
			"--key %q does not match the canonical format %s; "+
				"either drop --key (random will be generated) or supply a properly-formatted plaintext",
			supplied, keyFormatRe,
		)
	}
	return supplied, auth.HashAPIKey(supplied), nil
}

// mirrorToPostgres ensures an `organizations` row exists for `tenantID` and
// inserts an `api_keys` row pointing at it. Both inserts are idempotent
// (`ON CONFLICT DO NOTHING`) so re-running the seeder against the same
// tenant + key plaintext is a no-op rather than a duplicate-row error.
//
// Returns the org id and api_key id resolved from Postgres so the operator
// can correlate this run against the dashboard's UI.
func mirrorToPostgres(
	ctx context.Context,
	dsn, tenantID, tier string, rateLimit int,
	keyHash, keyPrefix string,
) (orgID, keyID string, err error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return "", "", fmt.Errorf("open postgres: %w", err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		return "", "", fmt.Errorf("ping postgres: %w", err)
	}

	// Step 1: ensure the `organizations` row. INSERT … ON CONFLICT lets
	// re-runs (and concurrent seeds for the same tenant) settle on the
	// existing row without clobbering an operator's tier/rate_limit edits.
	// `tenant_id` has a UNIQUE constraint per the Prisma schema.
	orgName := fmt.Sprintf("Seeded: %s", tenantID)
	orgSlug := slugify("seed-" + tenantID)
	if _, err := db.ExecContext(ctx, `
		INSERT INTO organizations (id, name, slug, tenant_id, tier, rate_limit, created_at)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
		ON CONFLICT (tenant_id) DO NOTHING
	`, orgName, orgSlug, tenantID, tier, rateLimit); err != nil {
		return "", "", fmt.Errorf("insert organization: %w", err)
	}
	if err := db.QueryRowContext(ctx, `
		SELECT id::text FROM organizations WHERE tenant_id = $1
	`, tenantID).Scan(&orgID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", errors.New("expected organization row after upsert; got none")
		}
		return "", "", fmt.Errorf("select organization: %w", err)
	}

	// Step 2: the api_keys row. ON CONFLICT (key_hash) means re-running
	// the seeder with --key <same plaintext> is a no-op and we still
	// resolve the original key id. `name = 'seeded'` matches the design.
	if _, err := db.ExecContext(ctx, `
		INSERT INTO api_keys (id, org_id, name, key_prefix, key_hash, active, created_at)
		VALUES (gen_random_uuid(), $1::uuid, 'seeded', $2, $3, true, now())
		ON CONFLICT (key_hash) DO NOTHING
	`, orgID, keyPrefix, keyHash); err != nil {
		return "", "", fmt.Errorf("insert api_key: %w", err)
	}
	if err := db.QueryRowContext(ctx, `
		SELECT id::text FROM api_keys WHERE key_hash = $1
	`, keyHash).Scan(&keyID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", errors.New("expected api_keys row after upsert; got none")
		}
		return "", "", fmt.Errorf("select api_key: %w", err)
	}

	return orgID, keyID, nil
}

// slugify is the simplest possible slug normaliser. The Prisma schema's
// `organizations.slug` is UNIQUE, so collisions on identical input would
// be caught by the same ON CONFLICT path that protects the tenant_id
// upsert above. We don't need anything fancier than ascii-lowercasing +
// non-alnum-to-dash for seeded orgs.
func slugify(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteRune('-')
		default:
			b.WriteRune('-')
		}
	}
	out := b.String()
	// Collapse consecutive dashes; trim leading/trailing.
	for strings.Contains(out, "--") {
		out = strings.ReplaceAll(out, "--", "-")
	}
	return strings.Trim(out, "-")
}
