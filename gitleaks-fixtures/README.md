# gitleaks regression fixtures

CI-enforced regression coverage for the secret-scan rules in `.gitleaks.toml`.
Every rule we want to defend lives here as a paired fixture: a positive case
the rule MUST detect, plus (where applicable) negative cases that look like
the rule's target but must NOT trigger because of a stopword, allowlist, or
near-miss boundary.

Without this suite, the only way to know whether `.gitleaks.toml` still works
is to wait for a real leak. With it, any rule edit that breaks coverage
fails CI on the same PR that broke it.

## Layout

```
gitleaks-fixtures/
├── README.md
├── should-flag/      one fixture per rule we're defending; MUST produce ≥1 finding
└── should-pass/      placeholders, allowlisted patterns, near-misses; MUST produce 0
```

The runner at `scripts/run-gitleaks-fixtures.sh` invokes gitleaks against
each tree and asserts the right outcome. CI runs the same script as a step
in `.github/workflows/secret-scan.yml`.

## Conventions

### `should-flag/`

- One file per rule. Filename stem == rule ID
  (e.g. `ward-api-key.py` defends rule `ward-api-key`).
- For built-in default-ruleset rules, the filename stem is the conventional
  name (e.g. `openai-key.py`); the runner's `EXPECTED_RULE_FOR_STEM` table
  maps each stem to one or more allowed gitleaks rule IDs (default rulesets
  occasionally rename rules across versions; the alternation tolerates that
  while still catching "fired SOMETHING but not what we wanted" regressions).
- Each fixture uses synthetic high-entropy values that look real but are
  tied to no service — never paste a real or historical leak literal into
  these files. Audit-doc redaction stays.
- Comment at the top of each file naming the rule and explaining what
  invariant the fixture defends.

### `should-pass/`

- Group by category: stopwords, allowlist regexes, near-misses.
- Mirror the order of the source list in `.gitleaks.toml` (`stopwords.py`
  enumerates entries in their `.gitleaks.toml [allowlist] stopwords` order)
  so audits diff cleanly.
- Comment at the top of each file naming the source allowlist entry.

## Local run

```bash
bash scripts/run-gitleaks-fixtures.sh
```

The runner picks a `gitleaks` binary on PATH if present, otherwise falls
back to docker (`zricethezav/gitleaks:v8.30.1`, same version as CI). On
PASS prints which rules fired; on FAIL prints what's missing or what
false-positived plus per-finding `file:line — rule` detail for triage.

## Adding a new rule

1. Add the rule to `.gitleaks.toml`.
2. Add `gitleaks-fixtures/should-flag/<rule-id>.py` with a synthetic
   trigger and a docstring naming the rule.
3. Add the stem → rule-ID mapping to `expected_pattern_for_stem()` in
   `scripts/run-gitleaks-fixtures.sh` and append the stem to `ALL_STEMS`.
4. If the rule comes with stopwords or an allowlist regex, add a paired
   `should-pass/` fixture exercising each.
5. Run `bash scripts/run-gitleaks-fixtures.sh` locally before pushing.

## Coverage notes

V1.1 ships fixtures for 4 rules:

- **`ward-api-key`** (custom) — must fire by exact name.
- **`bearer-token-literal`** (custom) — must fire by exact name.
- **`aws-access-key`** (built-in) — accepts `aws-access-token` /
  `aws-access-key` / `aws-access-key-id` / `generic-api-key`.
- **`github-pat`** (built-in) — accepts `github-pat` /
  `github-personal-access-token` / `generic-api-key`.

OpenAI and Anthropic detectors in gitleaks v8.30.1 have format-anchored
regexes that synthetic fixtures struggle to satisfy without using
real-shape values. They're intentionally NOT covered — the moment a future
gitleaks release loosens those detectors (or someone wants to paste
real-shape synthetic samples), add fixtures and entries to
`expected_pattern_for_stem()`. Until then, the catch-all `generic-api-key`
rule provides incidental coverage on those providers via the
high-entropy-keyworded heuristic.

## Why these aren't `.env.example`-style placeholders

Placeholder files would be ignored by gitleaks anyway (every value matches a
stopword or is sub-threshold). The point of `should-flag/` is to push past
the placeholder layer and verify the regex actually fires on something that
would slip through if the rule were removed. The path-allowlist entry in
`.gitleaks.toml` (`(^|/)gitleaks-fixtures/`) keeps the regular full-history
scan from firing on every fixture; only the dedicated CI step exercises them.
