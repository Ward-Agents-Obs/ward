package hydrate

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// newTestRedis spins up an in-process miniredis and returns a real
// `*redis.Client` pointing at it. Tests get full Redis semantics (HGet
// returning redis.Nil on missing keys, HSet upserts, etc.) without an
// external dep.
func newTestRedis(t *testing.T) (*redis.Client, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb, mr
}

// rowSpec is the shape sqlmock expects for a hydrate-query row.
type rowSpec struct {
	id        string
	keyHash   string
	tenantID  string
	tier      string
	rateLimit int
	active    bool
}

func mockHydrateRows(rows []rowSpec) *sqlmock.Rows {
	r := sqlmock.NewRows([]string{"id", "key_hash", "tenant_id", "tier", "rate_limit", "active"})
	for _, row := range rows {
		r.AddRow(row.id, row.keyHash, row.tenantID, row.tier, row.rateLimit, row.active)
	}
	return r
}

// TestHydrate_RebuildsFromEmptyRedis covers the post-flush case: Postgres
// has rows, Redis has nothing. Every active row should land in Redis with
// full fields; revoked rows should land as `active=false` markers.
func TestHydrate_RebuildsFromEmptyRedis(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rdb, mr := newTestRedis(t)

	mock.ExpectQuery("SELECT.*FROM api_keys").WillReturnRows(mockHydrateRows([]rowSpec{
		{id: "00000000-0000-0000-0000-000000000001", keyHash: "h-active-1", tenantID: "t1", tier: "free", rateLimit: 10000, active: true},
		{id: "00000000-0000-0000-0000-000000000002", keyHash: "h-active-2", tenantID: "t2", tier: "pro", rateLimit: 50000, active: true},
		{id: "00000000-0000-0000-0000-000000000003", keyHash: "h-revoked", tenantID: "t1", tier: "free", rateLimit: 10000, active: false},
	}))

	stats, err := Hydrate(context.Background(), db, rdb)
	if err != nil {
		t.Fatalf("hydrate: %v", err)
	}

	if got, want := stats.PostgresRowsScanned, 3; got != want {
		t.Errorf("rows scanned: got %d want %d", got, want)
	}
	if got, want := stats.RedisWritesActive, 2; got != want {
		t.Errorf("redis writes active: got %d want %d", got, want)
	}
	if got, want := stats.RedisWritesRevoked, 1; got != want {
		t.Errorf("redis writes revoked: got %d want %d", got, want)
	}
	if got, want := stats.PostgresConverged, 0; got != want {
		t.Errorf("postgres converged: got %d want %d (none expected — Redis was empty)", got, want)
	}

	// Validate Redis content. Active rows must carry the full payload.
	if got := mr.HGet("apikey:h-active-1", "tenant_id"); got != "t1" {
		t.Errorf("apikey:h-active-1 tenant_id: got %q want %q", got, "t1")
	}
	if got := mr.HGet("apikey:h-active-1", "rate_limit"); got != "10000" {
		t.Errorf("apikey:h-active-1 rate_limit: got %q want %q", got, "10000")
	}
	if got := mr.HGet("apikey:h-active-1", "active"); got != "true" {
		t.Errorf("apikey:h-active-1 active: got %q want %q", got, "true")
	}
	if got := mr.HGet("apikey:h-active-2", "tier"); got != "pro" {
		t.Errorf("apikey:h-active-2 tier: got %q want %q", got, "pro")
	}
	// Revoked row only carries the active=false marker.
	if got := mr.HGet("apikey:h-revoked", "active"); got != "false" {
		t.Errorf("apikey:h-revoked active: got %q want %q", got, "false")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

// TestHydrate_RedisRevokeWinsOverPostgresActive covers the partial-failure
// recovery case: Redis was successfully flipped to active=false (because
// `revokeApiKey` writes Redis first), but the corresponding Postgres update
// failed. On gateway restart, hydrate should NOT re-activate the key in
// Redis; instead it must converge Postgres back to active=false.
func TestHydrate_RedisRevokeWinsOverPostgresActive(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rdb, mr := newTestRedis(t)

	// Pre-populate Redis with an active=false marker — exactly what a
	// successful Redis-revoke leaves behind when Postgres update fails.
	mr.HSet("apikey:h-stale", "active", "false")

	mock.ExpectQuery("SELECT.*FROM api_keys").WillReturnRows(mockHydrateRows([]rowSpec{
		{id: "00000000-0000-0000-0000-000000000010", keyHash: "h-stale", tenantID: "t1", tier: "free", rateLimit: 10000, active: true},
	}))
	// Hydrate should now patch Postgres to active=false. The query uses
	// `id::text = $1` (rather than a `$1::uuid` cast) because pgx
	// parameterises Go strings as text and the bare-uuid comparison errors
	// with `text = uuid` at runtime; matching the expectation here keeps
	// the unit test in sync with the integration test fixture.
	mock.ExpectExec(`UPDATE api_keys SET active = false WHERE id::text = `).
		WithArgs("00000000-0000-0000-0000-000000000010").
		WillReturnResult(sqlmock.NewResult(0, 1))

	stats, err := Hydrate(context.Background(), db, rdb)
	if err != nil {
		t.Fatalf("hydrate: %v", err)
	}

	if got, want := stats.PostgresConverged, 1; got != want {
		t.Errorf("postgres converged: got %d want %d", got, want)
	}
	if got, want := stats.RedisWritesActive, 0; got != want {
		t.Errorf("redis writes active: got %d want %d (must NOT re-activate)", got, want)
	}
	// Redis should still report active=false — we never wrote a re-activate.
	if got := mr.HGet("apikey:h-stale", "active"); got != "false" {
		t.Errorf("apikey:h-stale active: got %q want %q (must remain revoked)", got, "false")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

// TestHydrate_PostgresRevokedOverridesRedisActive — the symmetric direction:
// Postgres was successfully flipped to active=false, but somehow Redis still
// says active=true (e.g. stale-snapshot restore that resurrected a revoked
// key). Hydrate must propagate the revoke into Redis.
func TestHydrate_PostgresRevokedOverridesRedisActive(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rdb, mr := newTestRedis(t)
	mr.HSet("apikey:h-resurrected", "tenant_id", "t1", "tier", "free", "rate_limit", "10000", "active", "true")

	mock.ExpectQuery("SELECT.*FROM api_keys").WillReturnRows(mockHydrateRows([]rowSpec{
		{id: "00000000-0000-0000-0000-000000000020", keyHash: "h-resurrected", tenantID: "t1", tier: "free", rateLimit: 10000, active: false},
	}))

	stats, err := Hydrate(context.Background(), db, rdb)
	if err != nil {
		t.Fatalf("hydrate: %v", err)
	}

	if got, want := stats.RedisWritesRevoked, 1; got != want {
		t.Errorf("redis writes revoked: got %d want %d", got, want)
	}
	if got := mr.HGet("apikey:h-resurrected", "active"); got != "false" {
		t.Errorf("active: got %q want %q (Redis must now reject the resurrected key)", got, "false")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("sqlmock expectations: %v", err)
	}
}

// TestHydrate_LeavesSeedOnlyRedisKeysAlone covers the gateway/cmd/seed
// keys that exist in Redis but not in Postgres. Hydrate iterates Postgres
// only — we never enumerate Redis — so seed keys are not touched. (When
// #27 mirrors them into Postgres, they become regular keys and hydrate
// starts including them.)
func TestHydrate_LeavesSeedOnlyRedisKeysAlone(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rdb, mr := newTestRedis(t)
	mr.HSet("apikey:seed-only", "tenant_id", "seed-tenant", "tier", "free", "rate_limit", "10000", "active", "true")

	mock.ExpectQuery("SELECT.*FROM api_keys").WillReturnRows(mockHydrateRows(nil))

	stats, err := Hydrate(context.Background(), db, rdb)
	if err != nil {
		t.Fatalf("hydrate: %v", err)
	}
	if stats.PostgresRowsScanned != 0 {
		t.Errorf("expected 0 postgres rows; got %d", stats.PostgresRowsScanned)
	}
	if got := mr.HGet("apikey:seed-only", "active"); got != "true" {
		t.Errorf("seed key got mutated: active=%q (expected unchanged 'true')", got)
	}
	if got := mr.HGet("apikey:seed-only", "tenant_id"); got != "seed-tenant" {
		t.Errorf("seed key got mutated: tenant_id=%q", got)
	}
}

// TestHydrate_RowScanFailureIsCountedNotFatal — one bad row shouldn't abort
// the whole hydrate. Logged and counted in Stats.Errors.
func TestHydrate_RowScanFailureIsCountedNotFatal(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rdb, _ := newTestRedis(t)

	// First row is fine; second has a type mismatch (rate_limit is a
	// string instead of int) which forces a scan error.
	rows := sqlmock.NewRows([]string{"id", "key_hash", "tenant_id", "tier", "rate_limit", "active"}).
		AddRow("id-ok", "h-ok", "t", "free", 10000, true).
		AddRow("id-bad", "h-bad", "t", "free", "not-an-int", true)
	mock.ExpectQuery("SELECT.*FROM api_keys").WillReturnRows(rows)

	stats, err := Hydrate(context.Background(), db, rdb)
	if err != nil {
		t.Fatalf("hydrate should not return error on a bad row: %v", err)
	}
	if stats.PostgresRowsScanned != 2 {
		t.Errorf("scanned: got %d want 2", stats.PostgresRowsScanned)
	}
	if stats.RedisWritesActive != 1 {
		t.Errorf("active writes: got %d want 1", stats.RedisWritesActive)
	}
	if stats.Errors != 1 {
		t.Errorf("errors: got %d want 1", stats.Errors)
	}
}

// TestHydrate_QueryErrorAborts — if the initial Postgres query fails, hydrate
// returns an error so the caller (gateway main()) can decide whether to
// proceed. (Today's caller logs warn and continues.)
func TestHydrate_QueryErrorAborts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rdb, _ := newTestRedis(t)
	mock.ExpectQuery("SELECT.*FROM api_keys").WillReturnError(errors.New("connection refused"))

	_, err = Hydrate(context.Background(), db, rdb)
	if err == nil {
		t.Fatal("expected error when query fails")
	}
}
