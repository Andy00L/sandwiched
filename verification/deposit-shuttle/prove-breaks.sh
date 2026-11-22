#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deposits_file="$repo_root/app/src/lib/chain/deposits.ts"
check_file="src/lib/chain/deposits.check.test.ts"
breaks_dir="$repo_root/verification/deposit-shuttle/breaks"
backup_dir="$(mktemp -d)"
backup_file="$backup_dir/deposits.ts.orig"

expected_catches=(
  "01-record-after-send|a crash at any point"
  "02-forget-on-any-confirm-failure|a crash at any point"
  "03-no-grace-for-missing-shuttle|a crash at any point"
  "04-missing-shuttle-counts-as-landed-unseen|a crash at any point"
  "05-settle-after-refused-merge|a crash at any point"
  "06-handed-back-shuttle-counts-as-landed|hands a funded shuttle back"
)

cp "$deposits_file" "$backup_file"
restore_deposits() {
  cp "$backup_file" "$deposits_file"
}
trap 'restore_deposits; rm -rf "$backup_dir"' EXIT

missed=0
for entry in "${expected_catches[@]}"; do
  IFS="|" read -r break_name scenario_filter <<<"$entry"
  patch_file="$breaks_dir/$break_name.patch"
  if ! patch --dry-run --forward --no-backup-if-mismatch --silent -p1 -d "$repo_root" <"$patch_file" >/dev/null; then
    echo "[proveBreaks] $break_name: the patch no longer applies to deposits.ts, rewrite it against the current code"
    missed=1
    continue
  fi
  patch --forward --no-backup-if-mismatch --silent -p1 -d "$repo_root" <"$patch_file"
  set +e
  output="$(cd "$repo_root/app" && DEPOSIT_SHUTTLE_CHECK=1 bun test "$check_file" -t "$scenario_filter" 2>&1)"
  status=$?
  set -e
  restore_deposits
  if [[ $status -ne 0 && "$output" == *"broken rule: "* ]]; then
    echo "[proveBreaks] $break_name: caught in \"$scenario_filter\""
    grep -E '^(broken rule:|  [0-9]+\. )' <<<"$output" | head -14
  else
    echo "[proveBreaks] $break_name: MISSED (exit $status)"
    missed=1
  fi
done

cmp -s "$backup_file" "$deposits_file" && echo "[proveBreaks] deposits.ts restored"
exit "$missed"
