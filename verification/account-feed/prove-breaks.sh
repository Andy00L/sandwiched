#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
feed_file="$repo_root/app/src/lib/chain/account-feed.ts"
check_file="src/lib/chain/account-feed.check.test.ts"
breaks_dir="$repo_root/verification/account-feed/breaks"
backup_dir="$repo_root/.scratch/account-feed-breaks"
backup_file="$backup_dir/account-feed.ts.orig"

expected_catches=(
  "01-no-silence-drop|fresh data:|live only while the socket works"
  "02-no-poll-while-connecting|fresh data:|fresh data, or a status"
  "03-refusal-not-retried|fresh data:|fresh data, or a status"
  "04-stale-ack-kept|safety|no leaked subscription"
  "05-watch-after-close|safety|nothing fires after close() or stop()"
  "06-overlapping-reads|safety|one read at a time"
  "07-no-reread-on-ack|fresh data:|fresh data, or a status"
  "08-dedupe-on-owner-only|fresh data:|fresh data, or a status"
  "09-close-keeps-reconnect-timer|safety|nothing fires after close() or stop()"
  "10-failed-read-dropped|a read that fails|fresh data, or a status"
  "11-no-subscribe-deadline|accountSubscribe that never gets an answer|fresh data, or a status"
  "12-no-degrade-on-failed-reads|leaves live while every|fresh data, or a status"
)

mkdir -p "$backup_dir"
cp "$feed_file" "$backup_file"
restore_feed() {
  cp "$backup_file" "$feed_file"
}
trap 'restore_feed; rm -rf "$backup_dir"' EXIT

missed=0
for entry in "${expected_catches[@]}"; do
  IFS="|" read -r break_name test_filter expected_rule <<<"$entry"
  patch_file="$breaks_dir/$break_name.patch"
  if ! patch --dry-run --forward --no-backup-if-mismatch --silent -p1 -d "$repo_root" <"$patch_file" >/dev/null; then
    echo "[proveBreaks] $break_name: the patch no longer applies to account-feed.ts, rewrite it against the current code"
    missed=1
    continue
  fi
  patch --forward --no-backup-if-mismatch --silent -p1 -d "$repo_root" <"$patch_file"
  set +e
  output="$(cd "$repo_root/app" && bun test "$check_file" -t "$test_filter" 2>&1)"
  status=$?
  set -e
  restore_feed
  if [[ $status -ne 0 && "$output" == *"broken rule: $expected_rule"* ]]; then
    echo "[proveBreaks] $break_name: caught as \"$expected_rule\""
    grep -E '^  ([0-9]+\.|then,|result:)' <<<"$output" | head -12
  else
    echo "[proveBreaks] $break_name: MISSED (exit $status, expected \"$expected_rule\")"
    missed=1
  fi
done

cmp -s "$backup_file" "$feed_file" && echo "[proveBreaks] account-feed.ts restored"
exit "$missed"
