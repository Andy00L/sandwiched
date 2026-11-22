#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root/app"
DEPOSIT_SHUTTLE_CHECK=1 bun test src/lib/chain/deposits.check.test.ts "$@"
