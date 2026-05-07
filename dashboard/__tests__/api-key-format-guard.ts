/**
 * Format-drift guard for the dashboard's API-key generator.
 *
 * Pairs with `gateway/internal/auth/keys_test.go` (Go side) and
 * `.gitleaks.toml::ward-api-key` (CI secret scan) to keep three definitions
 * of the API-key plaintext format in lockstep:
 *
 *   - Dashboard TS: `dashboard/src/lib/api-keys.ts::generateApiKey`
 *   - Gateway Go:    `gateway/internal/auth/keys.go::GenerateAPIKey`
 *   - Secret scan:   `.gitleaks.toml` rule `ward-api-key` regex
 *
 * If any of those drifts off `^ak_live_[0-9a-f]{32}$`, the secret scanner
 * silently weakens (or, worse, the gateway issues keys whose leak the
 * scanner can't detect). Two regression tests — one per language — make
 * the drift loud.
 *
 * Convention: tsx scripts under `__tests__/` per dashboard's no-runner
 * convention (see `dashboard-conventions-drift.md` §1.3 and the existing
 * `*-tenant-isolation.ts` siblings). Run via:
 *
 *     # from dashboard/
 *     npx tsx __tests__/api-key-format-guard.ts
 *
 *     # or via the wrapper that picks this up alongside the isolation suite
 *     bash scripts/run-tenant-isolation-tests.sh
 *
 * #27 / `.agents/seed-and-key-mirror-design.md` §3a.
 */

import { generateApiKey, hashKey } from "../src/lib/api-keys";

// Single canonical regex. Mirrors:
//   - gateway/internal/auth/keys_test.go::keyFormatRe
//   - .gitleaks.toml::ward-api-key (regex field)
const KEY_FORMAT_RE = /^ak_live_[0-9a-f]{32}$/;

const failures: string[] = [];

function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function checkPlaintextRegex() {
  console.log("\n# generateApiKey() plaintext format");
  // Multiple iterations because the random payload could in principle
  // emit a fluke; per-iteration assertion keeps the failure message
  // pointing at the exact bad sample.
  for (let i = 0; i < 32; i++) {
    const { plain } = generateApiKey();
    assert(
      KEY_FORMAT_RE.test(plain),
      `iteration ${i}: plaintext ${plain!} matches ${KEY_FORMAT_RE} ` +
        `(if this fails, secret-scan rule \`ward-api-key\` would miss leaks of this key shape)`,
    );
  }
}

function checkHashShape() {
  console.log("\n# generateApiKey() hash shape");
  const { plain, hash } = generateApiKey();
  assert(
    /^[0-9a-f]{64}$/.test(hash),
    `hash is 64 lowercase hex chars (sha256). got len=${hash.length}, value=${hash.slice(0, 16)}…`,
  );
  assert(
    hash === hashKey(plain),
    "hash field of the generated record matches `hashKey(plain)` — the two helpers can't drift",
  );
}

function checkPrefixContract() {
  console.log("\n# keyPrefix slice convention (`plain.slice(0, 12) + '...'`)");
  // The dashboard's prefix shape is documented in `api-keys.ts:9` and the
  // gateway seeder matches it byte-for-byte (`plain[:12] + "..."` in
  // `gateway/cmd/seed/main.go`) so `/settings/keys` renders both sources
  // with identical column shapes. We assert the dashboard's contract
  // here; the Go side's matching slice is covered by code review against
  // this same comment block.
  const { plain, prefix } = generateApiKey();
  assert(
    prefix === plain.slice(0, 12) + "...",
    `prefix \`${prefix}\` matches plain.slice(0, 12) + '...' for plain=${plain.slice(0, 8)}…`,
  );
  assert(
    prefix.length === 15,
    `prefix length is 15 (12 chars + 3-char ellipsis); got ${prefix.length}`,
  );
}

function checkHashStability() {
  console.log("\n# hashKey() is deterministic SHA-256 of plaintext (no salt)");
  // Both Redis and Postgres key off this hash. If `hashKey` ever became
  // salted / iterated, every existing `apikey:<hash>` and `api_keys`
  // row would invalidate.
  const sample = "ak_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const a = hashKey(sample);
  const b = hashKey(sample);
  assert(a === b, `hashKey is deterministic for the same input (a=${a.slice(0, 8)}…, b=${b.slice(0, 8)}…)`);
  assert(
    a.length === 64,
    `hashKey output is 64 hex chars (sha256). got ${a.length}`,
  );
  // Pinning to a known SHA-256 catches any "we accidentally salted it"
  // regression in one move. Verified via:
  //   $ printf '%s' "ak_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" | shasum -a 256
  //   6ae1318f5e04b967109e53232e9efb3abfb8e6846e8f834509fd5b1ded3054b2
  const expected = "6ae1318f5e04b967109e53232e9efb3abfb8e6846e8f834509fd5b1ded3054b2";
  assert(
    a === expected,
    `hashKey("ak_live_aaaa…aaaa") matches the pinned sha256 ${expected.slice(0, 12)}…`,
  );
}

function main() {
  console.log("[api-key-format-guard]");
  checkPlaintextRegex();
  checkHashShape();
  checkPrefixContract();
  checkHashStability();

  if (failures.length > 0) {
    console.error(`\n[FAIL] ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "\nIf this test fails, the plaintext / hash / prefix contract has drifted. " +
      "Update in lockstep:\n" +
      "  - dashboard/src/lib/api-keys.ts (TS generator)\n" +
      "  - gateway/internal/auth/keys.go + keys_test.go (Go generator + matching regex)\n" +
      "  - .gitleaks.toml `ward-api-key` rule (secret scan)\n" +
      "  - .agents/seed-and-key-mirror-design.md (design doc, if the contract itself is changing)",
    );
    process.exit(1);
  }
  console.log("\n[PASS] all api-key-format-guard assertions passed");
}

main();
