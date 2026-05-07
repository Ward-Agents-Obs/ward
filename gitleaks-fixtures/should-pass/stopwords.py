# Fixture: every stopword listed in `.gitleaks.toml [allowlist] stopwords`
# must NOT trigger any rule. If a regression strips a stopword or weakens the
# stopword-matching logic, this fixture lights up loudly.
#
# Mirror order with `.gitleaks.toml` so ad-hoc audits can diff them by eye.
PLACEHOLDERS = [
    "Bearer your-api-key-here",
    "Bearer your-ward-api-key",
    "Bearer your-openai-key",
    "Bearer your-openai-api-key",
    "Bearer your_openai_api_key_here",
    "Bearer your_anthropic_api_key_here",
    "Bearer your-supabase-anon-key",
    "Bearer ak_live_invalid_key_000000000000",
    "Bearer <your-api-key>",
    "Bearer <your-ward-api-key>",
    # negative-auth fixtures used by tests (TestCollectorAuth, etc.)
    "Bearer not-the-real-token-xxxxxxxxxxxx",
    "Bearer replace_me_with_openssl_rand_hex_32",
    # CI deterministic seeds (#27 `--key` flag); wiped at job teardown.
    "Bearer ak_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "Bearer ak_live_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "Bearer ak_live_a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    "Bearer ak_live_b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
]
