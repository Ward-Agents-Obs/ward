package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	_ "github.com/jackc/pgx/v5/stdlib" // pgx as the Postgres driver for `database/sql`
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ward-dev/gateway/internal/config"
	"github.com/ward-dev/gateway/internal/hydrate"
	"github.com/ward-dev/gateway/internal/middleware"
	"github.com/ward-dev/gateway/internal/proxy"
	"github.com/ward-dev/gateway/internal/ratelimit"
)

func main() {
	cfg := config.Load()

	zerolog.TimeFieldFormat = time.RFC3339Nano
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	// Fail closed: refuse to start without the shared collector-auth token.
	// A silent regression to no auth is the worst possible failure mode for
	// this defense-in-depth control. See `.agents/tenant-isolation-audit.md`
	// finding F2 / F3 and task #25.
	if cfg.CollectorAuthToken == "" {
		log.Fatal().Msg(
			"COLLECTOR_AUTH_TOKEN is required; refusing to start. " +
				"Generate via `openssl rand -hex 32` and set in the gateway's environment " +
				"AND the otel-collector's environment (must match).",
		)
	}

	// Fail closed on Redis auth too (#34). Transitive fail-closed via
	// `rdb.Ping → NOAUTH` only fires if Redis itself is correctly
	// configured to require auth — if an operator misconfigures the redis
	// task to run with `--requirepass ""`, the gateway would silently
	// connect anonymously and never know. The explicit check here
	// surfaces a forgotten gateway-side `REDIS_PASSWORD` at boot,
	// matching the `lib/clickhouse.ts:requireEnv()` pattern (#31) and
	// `lib/redis.ts:requireEnv()` on the dashboard side.
	if cfg.RedisPassword == "" {
		log.Fatal().Msg(
			"REDIS_PASSWORD is required; refusing to start. " +
				"Generate via `openssl rand -hex 32` and set in the gateway AND the redis " +
				"service's environment (must match). Empty values would let a misconfigured " +
				"redis task accept anonymous connections without the gateway noticing.",
		)
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	defer rdb.Close()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatal().Err(err).Str("redis_addr", cfg.RedisAddr).Msg("cannot connect to redis")
	}

	// Best-effort API-key hydrate: rebuild Redis from Postgres on startup so
	// that Redis flushes / stale-snapshot restores / dashboard partial-failure
	// residue all converge before we serve traffic. Failure is non-fatal —
	// availability beats strict-consistency-at-boot, and Redis already has
	// the cache. See internal/hydrate package doc and #26 for details.
	if cfg.DatabaseURL != "" {
		hydrateCtx, hydrateCancel := context.WithTimeout(ctx, 30*time.Second)
		if err := runHydrate(hydrateCtx, cfg.DatabaseURL, rdb); err != nil {
			log.Warn().Err(err).Msg("hydrate failed at startup; serving with whatever Redis has")
		}
		hydrateCancel()
	} else {
		log.Info().Msg("DATABASE_URL not set; skipping API-key hydrate (Redis-only mode)")
	}

	limiter := ratelimit.NewLimiter(rdb)
	traceProxy := proxy.New(cfg.CollectorAddr, cfg.CollectorAuthToken)

	router := chi.NewRouter()
	router.Use(middleware.RequestLogger())
	router.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	router.With(
		middleware.Authenticate(rdb, cfg.DefaultRateLimit),
		middleware.RateLimit(limiter),
	).Post("/v1/traces", traceProxy.HandleTraces)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
	}

	go func() {
		<-ctx.Done()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()

		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Error().Err(err).Msg("server shutdown failed")
		}
	}()

	log.Info().
		Str("port", cfg.Port).
		Str("collector_addr", cfg.CollectorAddr).
		Str("redis_addr", cfg.RedisAddr).
		Msg("gateway listening")

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal().Err(err).Msg("gateway exited")
	}
}

// runHydrate opens a short-lived Postgres connection, executes the
// hydrate pass, and closes the connection. Kept as a separate function so
// the connection lifecycle is bounded — the gateway doesn't hold an open
// Postgres connection across its serving lifetime, only at boot.
func runHydrate(ctx context.Context, dsn string, rdb *redis.Client) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return err
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		return err
	}

	_, err = hydrate.Hydrate(ctx, db, rdb)
	return err
}
