package config

import (
	"os"
	"strconv"
	"time"
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
		RedisPassword:      envOr("REDIS_PASSWORD", ""),
		RedisDB:            envIntOr("REDIS_DB", 0),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		DefaultRateLimit:   envIntOr("DEFAULT_RATE_LIMIT", 10000),
		ReadTimeout:        30 * time.Second,
		WriteTimeout:       30 * time.Second,
	}
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
