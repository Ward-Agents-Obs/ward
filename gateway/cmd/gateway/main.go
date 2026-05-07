package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ward-dev/gateway/internal/config"
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
