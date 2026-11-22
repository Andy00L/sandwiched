#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../../app" || exit 1

CHECK_FILE=src/lib/game/table-store.check.test.ts

run_check() {
  bun test "$CHECK_FILE" -t "$1" 2>&1 | grep -v "went backwards, starting over"
}

property_output=$(run_check "agrees with the chain")
property_status=$?
if [ "$property_status" -ne 0 ]; then
  printf '%s\n' "$property_output"
  echo "[tableStore] property: FAIL (a scratch break, a real regression, or drift in the check: read the [checkSession] lines above)"
  exit 1
fi
echo "[tableStore] property: pass ($(printf '%s\n' "$property_output" | grep -E '^ *[0-9]+ pass$' | sed 's/^ *//'))"

if ! grep -q 'describe("findings open at the sync commit"' "$CHECK_FILE"; then
  echo "[tableStore] findings: none open"
  exit 0
fi
findings_output=$(run_check "findings open at the sync commit")
findings_status=$?
if [ "$findings_status" -eq 0 ]; then
  echo "[tableStore] findings: none open. Move the passing finding tests into the property describe and update the skill."
  exit 0
fi
printf '%s\n' "$findings_output" | grep -E '^\(fail\)'
echo "[tableStore] findings: $(printf '%s\n' "$findings_output" | grep -cE '^\(fail\)') open finding tests (expected at the sync commit, see the table-store skill)"
exit 2
