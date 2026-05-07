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
	DefaultRateLimit   int
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
}

func Load() *Config {
	return &Config{
		Port:               envOr("GATEWAY_PORT", "8080"),
		CollectorAddr:      envOr("COLLECTOR_ADDR", "http://otel-collector:4318"),
		CollectorAuthToken: os.Getenv("COLLECTOR_AUTH_TOKEN"),
		RedisAddr:          envOr("REDIS_ADDR", "redis:6379"),
		RedisPassword:      envOr("REDIS_PASSWORD", ""),
		RedisDB:            envIntOr("REDIS_DB", 0),
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
