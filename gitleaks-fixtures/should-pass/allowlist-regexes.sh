#!/usr/bin/env bash
# Fixture: every per-regex allowlist entry in `.gitleaks.toml [allowlist] regexes`
# must NOT trigger. These look like ward-api-key matches but represent test
# placeholders or shell-template strings that resolve to a real key only at
# script-execution time — there is no static secret to leak here.

# 1. `ak_live_invalid_key_<digits/underscores>` — TestGatewayAuth fixtures.
INVALID_KEY_001="ak_live_invalid_key_000000000000"
INVALID_KEY_002="ak_live_invalid_key_42_xy"

# 2. `ak_live_test_${VAR}` / `ak_live_test_$(openssl ...)` — generated at
#    runtime by setup_test_environment.sh.
TEST_KEY_VAR="ak_live_test_${WARD_TEST_TENANT_HEX}"
TEST_KEY_EXEC="ak_live_test_$(openssl rand -hex 12)"
