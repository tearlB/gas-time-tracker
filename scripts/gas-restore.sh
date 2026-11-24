#!/usr/bin/env bash
set -euo pipefail

# 本番を、前に公開した版（deploy-v<番号> のタグ）の内容に戻す。
# 履歴は消さず、「その版の内容に戻す」コミットを新しく作ってから、gas:deploy で新しい版として公開する。
# 戻すのはアプリの中身（gas/ ui/ tests/）だけ。デプロイ用のスクリプトなど（scripts/ や package.json）は今のまま使う。
# 使い方: npm run gas:restore -- deploy-v4   （タグの一覧: git tag -l 'deploy-v*'）

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:-}"
APP_PATHS=(gas ui tests)

if [[ -z "$tag" ]]; then
  echo "使い方: npm run gas:restore -- deploy-v<版の番号>" >&2
  echo "戻せる版:" >&2
  git -C "$ROOT" tag -l 'deploy-v*' --sort=-v:refname --format='  %(refname:short)  %(contents:subject)' >&2
  exit 1
fi
if ! git -C "$ROOT" rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "エラー: タグ $tag がありません。git tag -l 'deploy-v*' で確認してください。" >&2
  exit 1
fi
if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "エラー: コミットしていない変更があります。コミットしてから戻してください。" >&2
  git -C "$ROOT" status --short >&2
  exit 1
fi
if [[ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" == "HEAD" ]]; then
  echo "エラー: ブランチの上で実行してください（例: git switch main）。" >&2
  exit 1
fi

cd "$ROOT"
undo() { git restore --source=HEAD --staged --worktree -- "${APP_PATHS[@]}"; }

git restore --source="$tag" --staged --worktree -- "${APP_PATHS[@]}"
# 公開用デプロイの ID は今のものを使う（同じ URL のまま戻すため）。
git restore --source=HEAD --staged --worktree -- gas/deployment-id.txt 2>/dev/null || true

if git diff --cached --quiet; then
  echo "今の内容は、すでに $tag と同じです。何もしませんでした。"
  exit 0
fi

echo "$tag の内容に戻して、テストしています…"
if ! npm test >/dev/null 2>&1; then
  undo
  echo "エラー: $tag の内容でテストが通りませんでした。元に戻しました（何も公開していません）。" >&2
  exit 1
fi

git commit -q -m "$tag の内容に戻す" -m "npm run gas:restore -- $tag で作成。"
echo "コミットしました: $(git log --oneline -1)"

bash "$ROOT/scripts/gas-deploy.sh" "$tag の内容に戻す（$(date '+%Y-%m-%d %H:%M')）"
