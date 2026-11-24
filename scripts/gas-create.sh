#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/gas-common.sh"

if [[ -f "$GAS_PROJECT_DIR/.clasp.json" ]]; then
  echo "エラー: gas/.clasp.json が既にあります。既存プロジェクトを上書きしないため作成を中止します。" >&2
  exit 1
fi

run_clasp create \
  --type webapp \
  --title "まとめて工数管理さん" \
  --rootDir . \
  "$@"
