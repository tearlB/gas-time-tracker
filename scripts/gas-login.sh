#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/gas-common.sh"

# Keep accepting the old `--force` spelling, but make a normal `gas:login`
# invocation reauthenticate as well. This avoids a confusing silent skip when
# Google requires a new Workspace session.
if [[ "${1:-}" == "--force" ]]; then
  shift
fi

if [[ "$#" -eq 1 && "${1:-}" == "--status" ]]; then
  run_clasp show-authorized-user
  exit 0
fi

# 標準では Apps Script の権限だけでログインする（Google Cloud セッション制御による定期的な再ログインを避ける）。
# clasp logs など Google Cloud の権限が要るコマンドを使う場合は `--clasp` を付けて clasp 標準のログインをする。
if [[ "${1:-}" == "--clasp" ]]; then
  shift
  run_clasp_with_local_auth login "$@"
  exit 0
fi

node "$ROOT/scripts/gas-login.js" "$GAS_AUTH_FILE"
