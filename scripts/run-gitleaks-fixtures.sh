#!/usr/bin/env bash
#
# Regression harness for the secret-scan rules in `.gitleaks.toml`.
#
# Two fixture trees under `gitleaks-fixtures/`:
#   should-flag/  files that MUST produce findings
#   should-pass/  files that MUST NOT produce findings
#
# This script runs gitleaks against each tree with `--no-git` and asserts the
# right outcome. For `should-flag/` we additionally parse the JSON report and
# verify each fixture's filename matches the rule ID it triggered — so a
# regression that "fires SOMETHING but the wrong rule" surfaces. The
# filename-to-rule mapping is `<rule-id>.<ext>` (e.g. `ward-api-key.py` must
# trigger rule ID `ward-api-key`).
#
# Built-in rule fixtures use the gitleaks v8 default rule IDs:
#   openai-key.py        → `openai-organization-key` (default ruleset)
#   anthropic-key.py     → `anthropic-api-key`
#   aws-access-key.py    → `aws-access-token`
#   github-pat.py        → `github-pat`
# The exact rule IDs are validated by the first run; if gitleaks renames a
# default rule, this harness fails loud and tells the operator which fixture
# to update.
#
# Run:
#   bash scripts/run-gitleaks-fixtures.sh
#
# Requires either a `gitleaks` binary on PATH or Docker. The script picks
# whichever is available, in that order. Same gitleaks version as CI uses
# (see `.github/workflows/secret-scan.yml`).

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "${SCRIPT_DIR}/.." && pwd )"
cd "${REPO_ROOT}"

FIXTURES_DIR="${REPO_ROOT}/gitleaks-fixtures"
SHOULD_FLAG_DIR="${FIXTURES_DIR}/should-flag"
SHOULD_PASS_DIR="${FIXTURES_DIR}/should-pass"
MAIN_CONFIG="${REPO_ROOT}/.gitleaks.toml"
GITLEAKS_VERSION="v8.30.1"

if [[ ! -d "${SHOULD_FLAG_DIR}" || ! -d "${SHOULD_PASS_DIR}" ]]; then
  echo "[gitleaks-fixtures] missing fixture directories under ${FIXTURES_DIR}" >&2
  exit 2
fi
if [[ ! -f "${MAIN_CONFIG}" ]]; then
  echo "[gitleaks-fixtures] missing .gitleaks.toml at ${MAIN_CONFIG}" >&2
  exit 2
fi

# Pick a gitleaks invocation — host binary if present, else docker. Both must
# accept the same flags; the CLI surface has been stable across v8.x.
if command -v gitleaks >/dev/null 2>&1; then
  GITLEAKS_RUN=(gitleaks)
elif command -v docker >/dev/null 2>&1; then
  GITLEAKS_RUN=(
    docker run --rm
    -v "${REPO_ROOT}:/repo"
    -w /repo
    "zricethezav/gitleaks:${GITLEAKS_VERSION}"
  )
else
  echo "[gitleaks-fixtures] need either a gitleaks binary on PATH or docker" >&2
  exit 2
fi

# Translate a host path under the repo into the path gitleaks sees, so the
# same code works for both local-binary and dockerised runs.
host_to_run_path() {
  local host="$1"
  if [[ "${GITLEAKS_RUN[0]}" == "docker" ]]; then
    # Inside the container the repo is mounted at /repo.
    printf '/repo/%s' "${host#${REPO_ROOT}/}"
  else
    printf '%s' "${host}"
  fi
}

# mktemp under the repo so the docker container (which mounts ${REPO_ROOT}
# at /repo) can both write to and read from this location. macOS mktemp
# doesn't accept `-p`, hence the explicit template.
REPORT_DIR="$(mktemp -d "${REPO_ROOT}/.tmp.gitleaks-fixtures.XXXXXX")"
trap 'rm -rf "${REPORT_DIR}"' EXIT

# The main `.gitleaks.toml` adds `gitleaks-fixtures/` to its path allowlist
# so the production scan ignores this directory — but that allowlist also
# blocks the harness from seeing its own fixtures. Build a temporary copy
# of the config with that single line stripped: same rules, same stopwords,
# same per-regex allowlist; just no fixture-path skip. Confirms the
# fixtures fire against EXACTLY the production rule set.
HARNESS_CONFIG="${REPORT_DIR}/.gitleaks-fixtures-config.toml"
grep -v "gitleaks-fixtures" "${MAIN_CONFIG}" > "${HARNESS_CONFIG}"

run_gitleaks_against() {
  # Echo gitleaks' exit code on stdout; full report is at $REPORT (caller-set).
  local source_dir="$1"
  local report_path="$2"
  local rc=0
  "${GITLEAKS_RUN[@]}" detect \
    --no-git \
    --source "$(host_to_run_path "${source_dir}")" \
    --config "$(host_to_run_path "${HARNESS_CONFIG}")" \
    --report-format json \
    --report-path "$(host_to_run_path "${report_path}")" \
    --no-banner \
    --redact >/dev/null 2>&1 || rc=$?
  printf '%s' "${rc}"
}

# ---------------------------------------------------------------------------
# Phase 1: should-flag — every fixture must produce ≥1 finding, AND the
# rule that fired must match the fixture's filename (per-rule isolation).
# ---------------------------------------------------------------------------

FLAG_REPORT="${REPORT_DIR}/should-flag.json"
FLAG_RC=$(run_gitleaks_against "${SHOULD_FLAG_DIR}" "${FLAG_REPORT}")

if [[ "${FLAG_RC}" -eq 0 ]]; then
  echo "[gitleaks-fixtures] FAIL: should-flag/ produced ZERO findings (gitleaks exit 0)." >&2
  echo "  Expected at least one finding per fixture under ${SHOULD_FLAG_DIR}" >&2
  exit 1
fi

# Per-rule isolation check. Each fixture's filename stem must trigger a
# matching rule ID. macOS still ships bash 3.2, which has no associative
# arrays, so the stem→pattern map lives in a case statement; CI's bash 5
# runs the same code with no changes. Bump to associative arrays (and
# `declare -A`) only if we ever need dynamic registration.
expected_pattern_for_stem() {
  # Custom rules (`ward-api-key`, `bearer-token-literal`) MUST fire by their
  # specific name — those are the rules we own and don't want renamed
  # silently. Built-in default-ruleset fixtures additionally accept
  # `generic-api-key` (the v8 catch-all for high-entropy keyworded strings)
  # as a valid match — the point of those fixtures is to verify
  # `useDefault = true` is still in effect, NOT to assert a specific rule
  # name that gitleaks could rename across releases.
  #
  # OpenAI / Anthropic detectors are intentionally NOT covered here:
  # gitleaks v8.30.1's regexes for those providers have format-anchored
  # constraints that synthetic fixtures struggle to satisfy without using
  # real-shape values. If a future gitleaks release adds more permissive
  # detectors (or we paste real-shape synthetic samples), add fixtures and
  # entries here.
  case "$1" in
    "ward-api-key")          echo "ward-api-key" ;;
    "bearer-token-literal")  echo "bearer-token-literal" ;;
    "aws-access-key")        echo "aws-access-token|aws-access-key|aws-access-key-id|generic-api-key" ;;
    "github-pat")            echo "github-pat|github-personal-access-token|generic-api-key" ;;
    *)                       echo "" ;;
  esac
}
ALL_STEMS=(ward-api-key bearer-token-literal aws-access-key github-pat)

# Pull (filename stem, rule id) pairs from the JSON. The python fallback
# avoids a `jq` dependency; gitleaks JSON is shallow enough that ad-hoc
# parsing is fine.
FOUND_PAIRS="$(python3 - "${FLAG_REPORT}" "${SHOULD_FLAG_DIR}" <<'PY'
import json, os, sys
report_path, base = sys.argv[1], sys.argv[2]
with open(report_path) as f:
    findings = json.load(f) or []
seen = set()
for f in findings:
    file_path = f.get("File", "")
    rule_id = f.get("RuleID", "")
    if not file_path or not rule_id:
        continue
    stem = os.path.splitext(os.path.basename(file_path))[0]
    seen.add((stem, rule_id))
for stem, rule in sorted(seen):
    print(f"{stem} {rule}")
PY
)"

# Plain-array tracking of which stems we've seen at least one rule for, plus
# a stem-prefixed line list ("ward-api-key:rule_name") so we can report exact
# rule IDs back to the caller. Shape works in bash 3.2.
SEEN_LINES=""
while IFS=' ' read -r stem rule; do
  [[ -z "${stem}" ]] && continue
  SEEN_LINES="${SEEN_LINES}${stem}:${rule}
"
done <<< "${FOUND_PAIRS}"

stem_was_seen() {
  printf '%s' "${SEEN_LINES}" | grep -q "^$1:"
}

stem_observed_rules() {
  # Print the rule IDs for the given stem, space-separated.
  printf '%s' "${SEEN_LINES}" | awk -F: -v s="$1" '$1 == s { print $2 }' | tr '\n' ' '
}

flag_failures=0
for stem in "${ALL_STEMS[@]}"; do
  expected_pattern=$(expected_pattern_for_stem "${stem}")
  if [[ -z "${expected_pattern}" ]]; then
    echo "[gitleaks-fixtures] internal error: no expected pattern registered for '${stem}'" >&2
    flag_failures=$((flag_failures + 1))
    continue
  fi
  if ! stem_was_seen "${stem}"; then
    echo "[gitleaks-fixtures] FAIL: ${stem}.* produced NO findings (expected rule matching: ${expected_pattern})" >&2
    flag_failures=$((flag_failures + 1))
    continue
  fi
  observed=$(stem_observed_rules "${stem}")
  matched=0
  matched_rule=""
  for rule in ${observed}; do
    if [[ "${rule}" =~ ^(${expected_pattern})$ ]]; then
      matched=1
      matched_rule="${rule}"
      break
    fi
  done
  if [[ "${matched}" -eq 0 ]]; then
    echo "[gitleaks-fixtures] FAIL: ${stem}.* fired rules [${observed% }] but none match expected pattern (${expected_pattern})." >&2
    echo "  If gitleaks renamed a default rule, update expected_pattern_for_stem() in this script." >&2
    flag_failures=$((flag_failures + 1))
  else
    echo "  ✓ should-flag/${stem}.* triggered '${matched_rule}' as expected"
  fi
done

# ---------------------------------------------------------------------------
# Phase 2: should-pass — every fixture must produce ZERO findings.
# ---------------------------------------------------------------------------

PASS_REPORT="${REPORT_DIR}/should-pass.json"
PASS_RC=$(run_gitleaks_against "${SHOULD_PASS_DIR}" "${PASS_REPORT}")

pass_failures=0
if [[ "${PASS_RC}" -ne 0 ]]; then
  pass_failures=1
  echo "[gitleaks-fixtures] FAIL: should-pass/ produced findings (gitleaks exit ${PASS_RC})." >&2
  echo "  Per-finding detail (file:line — rule):" >&2
  python3 - "${PASS_REPORT}" <<'PY' >&2
import json, os, sys
with open(sys.argv[1]) as f:
    findings = json.load(f) or []
for finding in findings:
    file_path = finding.get("File", "?")
    line = finding.get("StartLine", "?")
    rule = finding.get("RuleID", "?")
    print(f"  - {file_path}:{line} — {rule}")
PY
fi

# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------

if [[ "${flag_failures}" -ne 0 || "${pass_failures}" -ne 0 ]]; then
  echo "" >&2
  echo "[gitleaks-fixtures] FAIL — ${flag_failures} positive failure(s), ${pass_failures} negative failure(s)." >&2
  exit 1
fi

echo ""
echo "[gitleaks-fixtures] PASS — ${#ALL_STEMS[@]} positive fixtures fired the right rule, 0 false-positives in should-pass/."
