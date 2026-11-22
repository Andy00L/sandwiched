#!/usr/bin/env sh
# Model-check TableMoney.tla: the current program must pass; each config named after a removed exit or a broken payout must fail.
# Needs Java 11+ and TLA2TOOLS pointing at tla2tools.jar (v1.7.4).
set -eu
cd "$(dirname "$0")"
: "${TLA2TOOLS:?set TLA2TOOLS to the path of tla2tools.jar}"
META="$(mktemp -d)"
trap 'rm -rf "$META"' EXIT
check() {
  output="$(java -XX:+UseParallelGC -cp "$TLA2TOOLS" tlc2.TLC -workers 1 -config "$1.cfg" -metadir "$META/$1" TableMoney.tla 2>&1 || true)"
  if printf '%s' "$output" | grep -q "No error has been found"; then result="pass"; else result="fail"; fi
  states="$(printf '%s' "$output" | grep -o '[0-9]* distinct states found' | head -1)"
  echo "[tableMoney] $1: $result ($states)"
  if [ "$result" != "$2" ]; then printf '%s\n' "$output" | grep -A40 "violated\|Error:" | head -60; exit 1; fi
}
check current pass
check no-withdraw-ante fail
check no-abort fail
check evict-without-payout fail
echo "[tableMoney] ok"
