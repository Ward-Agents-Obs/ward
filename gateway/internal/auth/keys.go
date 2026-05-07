package auth

import (
	"crypto/rand"
	"encoding/hex"
)

// APIKeyPrefix is the canonical prefix for plaintext API keys minted by Ward.
// Both this package's `GenerateAPIKey` and the dashboard's
// `dashboard/src/lib/api-keys.ts:generateApiKey()` emit keys of the form
// `ak_live_<32 hex chars>` so that the gateway's secret-scan rule
// (`.gitleaks.toml::ward-api-key`, regex `ak_live_[0-9a-f]{32}`) catches
// leaks regardless of which side issued the key.
//
// Don't change without also updating:
//   - `dashboard/src/lib/api-keys.ts` (TS generator)
//   - `.gitleaks.toml` rule + stopwords
//   - The format-drift tests in `keys_test.go` and
//     `dashboard/__tests__/api-key-format-guard.ts`
const APIKeyPrefix = "ak_live_"

// GenerateAPIKey produces a fresh plaintext key + its SHA-256 hash. The
// plaintext format is `ak_live_<32 hex chars>` — 16 random bytes encoded.
// The hash is the SHA-256 of the plaintext (no salt) and is what Redis +
// Postgres store; the plaintext is shown to the operator exactly once at
// creation time and never persisted on the server side.
func GenerateAPIKey() (plain string, hash string, err error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}

	plain = APIKeyPrefix + hex.EncodeToString(raw)
	return plain, HashAPIKey(plain), nil
}
