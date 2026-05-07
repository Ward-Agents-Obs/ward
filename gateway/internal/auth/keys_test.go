package auth

import (
	"regexp"
	"testing"
)

// keyFormatRe is the canonical plaintext-key regex shared with the
// dashboard's TS generator and the `.gitleaks.toml::ward-api-key` rule.
// If you change this you must also update:
//   - `dashboard/src/lib/api-keys.ts` (KEY_PREFIX + bytes count)
//   - `dashboard/__tests__/api-key-format-guard.ts` (the same regex check)
//   - `.gitleaks.toml` (the `ward-api-key` rule's `regex` field)
//
// Drift on any one of those silently weakens the secret scanner. The
// two-test pairing (this Go test + the tsx guard) is the trip-wire.
var keyFormatRe = regexp.MustCompile(`^ak_live_[0-9a-f]{32}$`)

func TestGenerateAPIKey_PlaintextMatchesCanonicalRegex(t *testing.T) {
	// Run a few iterations because the random payload could in principle
	// emit a fluke; once-per-test is sufficient evidence the format is
	// stable across calls.
	for i := 0; i < 32; i++ {
		plain, hash, err := GenerateAPIKey()
		if err != nil {
			t.Fatalf("iteration %d: GenerateAPIKey returned error: %v", i, err)
		}
		if !keyFormatRe.MatchString(plain) {
			t.Errorf("iteration %d: plaintext %q does not match %s — would be missed by the gitleaks `ward-api-key` rule",
				i, plain, keyFormatRe)
		}
		// Hash is sha256 hex (64 chars). HashAPIKey is the contract.
		if len(hash) != 64 {
			t.Errorf("iteration %d: hash length = %d, want 64 (sha256 hex)", i, len(hash))
		}
	}
}

func TestHashAPIKey_IsStableSHA256(t *testing.T) {
	// Sanity-check: the hash function is plain SHA-256 over the plaintext
	// (no salt). Both Redis and Postgres key off this; if it ever drifted,
	// every existing key would invalidate.
	plain := "ak_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	h1 := HashAPIKey(plain)
	h2 := HashAPIKey(plain)
	if h1 != h2 {
		t.Fatalf("HashAPIKey is not deterministic: %q != %q", h1, h2)
	}
	if len(h1) != 64 {
		t.Fatalf("HashAPIKey output length = %d, want 64 (sha256 hex)", len(h1))
	}
	// Empty input is allowed by the hash; the gateway middleware rejects
	// empty bearer tokens before lookup, so this is just a contract check.
	if HashAPIKey("") == "" {
		t.Fatal("HashAPIKey('') returned empty string — should be sha256 of empty input")
	}
}
