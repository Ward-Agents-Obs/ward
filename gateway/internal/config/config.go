package config

import (
	"os"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
)

type Config struct {
	Port               string
	CollectorAddr      string
	CollectorAuthToken string
	RedisAddr          string
	RedisPassword      string
	RedisDB            int
	// DatabaseURL is the Postgres connection string the gateway uses for
	// the API-key hydrate pass at startup (see `internal/hydrate`). Optional
	// — empty string skips hydrate. The dashboard's Prisma migrations create
	// the schema; the gateway is read-mostly against `api_keys` and only
	// writes when converging revoked-anywhere state back to Postgres.
	DatabaseURL      string
	DefaultRateLimit int
	ReadTimeout      time.Duration
	WriteTimeout     time.Duration
}

func Load() *Config {
	return &Config{
		Port:               envOr("GATEWAY_PORT", "8080"),
		CollectorAddr:      envOr("COLLECTOR_ADDR", "http://otel-collector:4318"),
		CollectorAuthToken: os.Getenv("COLLECTOR_AUTH_TOKEN"),
		RedisAddr:          envOr("REDIS_ADDR", "redis:6379"),
		// #34 — hard-fail at config load if REDIS_PASSWORD is empty.
		// Mirrors the `requireEnv()` shape from `dashboard/src/lib/redis.ts`
		// (and `lib/clickhouse.ts` from #31). Transitive `Ping → NOAUTH`
		// fail-closed isn't enough on its own: if an operator
		// misconfigures the redis task with `--requirepass ""`, an empty
		// `RedisPassword` here would let the gateway connect anonymously
		// and never know. Failing at config load surfaces the misconfig
		// at boot, not as a silent compromise.
		RedisPassword:    requireEnv("REDIS_PASSWORD"),
		RedisDB:          envIntOr("REDIS_DB", 0),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		DefaultRateLimit: envIntOr("DEFAULT_RATE_LIMIT", 10000),
		ReadTimeout:      30 * time.Second,
		WriteTimeout:     30 * time.Second,
	}
}

// requireEnv returns the value of `name` from the process environment, or
// `log.Fatal`s the gateway with a clear message if it's missing or empty.
//
// Used for env vars whose absence represents a security regression rather
// than a configuration choice. The dashboard's `lib/clickhouse.ts` and
// `lib/redis.ts` both have a TS-side analog (#31, #34). When you add a new
// callsite, document the security rationale at the call site (not here)
// so the next contributor understands which knobs are load-bearing vs
// merely optional.
func requireEnv(name string) string {
	v := os.Getenv(name)
	if v == "" {
		log.Fatal().Msgf(
			"%s is required; refusing to start. "+
				"Set it in the gateway's environment AND any peer service that "+
				"shares the secret (must match). Empty values would let a misconfigured "+
				"peer accept anonymous connections without the gateway noticing.",
			name,
		)
	}
	return v
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envIntOr(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}
