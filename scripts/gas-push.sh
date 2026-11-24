#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GAS_DIR="$ROOT/gas"
source "$ROOT/scripts/gas-common.sh"

if [[ ! -f "$GAS_DIR/.clasp.json" ]]; then
  echo "エラー: gas/.clasp.json がありません。先に GAS プロジェクトを作成または設定してください。" >&2
  exit 1
fi

node "$ROOT/scripts/build-ui.js"
run_clasp push "$@"
