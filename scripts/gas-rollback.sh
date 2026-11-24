#!/usr/bin/env bash
set -euo pipefail

# 固定のデプロイ（/exec の URL）を、前の版に戻す。
# 使い方: npm run gas:rollback -- <版の番号>（番号なしで実行すると、版の一覧を出す）

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/gas-common.sh"
DEPLOYMENT_FILE="$GAS_PROJECT_DIR/deployment-id.txt"

if [[ ! -s "$DEPLOYMENT_FILE" ]]; then
  echo "エラー: 固定のデプロイがまだありません。先に npm run gas:deploy を実行してください。" >&2
  exit 1
fi
deployment_id="$(tr -d '[:space:]' < "$DEPLOYMENT_FILE")"

if [[ $# -lt 1 ]]; then
  echo "戻す版の番号を指定してください（例: npm run gas:rollback -- 3）。版の一覧:"
  run_clasp list-versions
  exit 1
fi
version="$1"
if [[ ! "$version" =~ ^[0-9]+$ ]]; then
  echo "エラー: 版の番号は数字で指定してください。" >&2
  exit 1
fi

run_clasp create-deployment -i "$deployment_id" -V "$version" -d "版 $version に戻す（$(date '+%Y-%m-%d %H:%M')）"
echo "版 $version に戻しました: https://script.google.com/macros/s/$deployment_id/exec"
