#!/usr/bin/env bash
set -euo pipefail

# 固定のデプロイ（/exec の URL）を、新しい版に更新する。
# 初回だけ新しいデプロイを作り、その ID を gas/deployment-id.txt に覚えておく。2回目以降は同じ URL のまま中身だけ変わる。
# 使い方: npm run gas:deploy [-- "版の説明"]

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/gas-common.sh"
DEPLOYMENT_FILE="$GAS_PROJECT_DIR/deployment-id.txt"

if [[ ! -f "$GAS_PROJECT_DIR/.clasp.json" ]]; then
  echo "エラー: gas/.clasp.json がありません。先に GAS プロジェクトを作成または設定してください。" >&2
  exit 1
fi

description="${1:-まとめて工数管理さん $(date '+%Y-%m-%d %H:%M')}"
GIT_REMOTE="${GAS_GIT_REMOTE:-github}"

# 本番に出す内容と GitHub に残す内容を同じにするため、コミットしていない変更があれば止める。
require_clean_tree() {
  if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
    echo "エラー: コミットしていない変更があります（$1）。コミットしてからデプロイしてください。" >&2
    git -C "$ROOT" status --short >&2
    exit 1
  fi
}
require_clean_tree "デプロイ前"

# 最新のコードを送ってから版を作る（送っていないコードが版に入らないように）。
bash "$ROOT/scripts/gas-push.sh"
# 画面の組み立てでファイルが変わった（組み立て直したものをコミットしていない）ときも止める。
require_clean_tree "画面を組み立てたあと"

version_output="$(run_clasp create-version "$description")"
echo "$version_output"
version="$(grep -oE '[0-9]+' <<<"$version_output" | tail -1 || true)"
if [[ -z "$version" ]]; then
  echo "エラー: 版の番号を読み取れませんでした。" >&2
  exit 1
fi

if [[ -s "$DEPLOYMENT_FILE" ]]; then
  deployment_id="$(tr -d '[:space:]' < "$DEPLOYMENT_FILE")"
  run_clasp create-deployment -i "$deployment_id" -V "$version" -d "$description"
else
  deploy_output="$(run_clasp create-deployment -V "$version" -d "$description")"
  echo "$deploy_output"
  deployment_id="$(grep -oE 'AKfy[A-Za-z0-9_-]+' <<<"$deploy_output" | head -1 || true)"
  if [[ -z "$deployment_id" ]]; then
    echo "エラー: デプロイの ID を読み取れませんでした。gas/deployment-id.txt に手で書いてください。" >&2
    exit 1
  fi
  echo "$deployment_id" > "$DEPLOYMENT_FILE"
fi

echo "版 $version を公開しました: https://script.google.com/macros/s/$deployment_id/exec"

# 公開したコミットに版の番号のタグを付け、GitHub へ送る。失敗しても公開は済んでいるので、手で送り直せるよう案内する。
tag="deploy-v$version"
branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
if git -C "$ROOT" tag -a "$tag" -m "本番 版$version（$description）"; then
  if git -C "$ROOT" push "$GIT_REMOTE" "$branch" && git -C "$ROOT" push "$GIT_REMOTE" "$tag"; then
    echo "GitHub に送りました: $branch とタグ $tag（$GIT_REMOTE）"
  else
    echo "注意: GitHub に送れませんでした。あとで次を実行してください: git push $GIT_REMOTE $branch && git push $GIT_REMOTE $tag" >&2
  fi
else
  echo "注意: タグ $tag を付けられませんでした（同じ名前のタグがあるかもしれません）。" >&2
fi
echo "問題があれば前の版に戻せます: npm run gas:restore -- deploy-v<版の番号>"
