#!/usr/bin/env bash
set -euo pipefail

GAS_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GAS_PROJECT_DIR="$GAS_REPO_ROOT/gas"

# Keep the credential file on the Windows filesystem when this repository is
# running under WSL. The environment variable remains available for machines
# where the Windows username differs from the WSL username.
GAS_DEFAULT_AUTH_FILE="$GAS_REPO_ROOT/.clasprc.json"
if [[ -d /mnt/c/Users && -n "${USER:-}" && -d "/mnt/c/Users/$USER" ]]; then
  GAS_DEFAULT_AUTH_FILE="/mnt/c/Users/$USER/.clasprc.json"
fi
GAS_AUTH_FILE="${GAS_CLASP_AUTH_FILE:-$GAS_DEFAULT_AUTH_FILE}"

run_clasp() {
  local auth_args=()

  # Use a workspace-local auth file when available. Otherwise clasp falls back
  # to its normal global auth file (~/.clasprc.json).
  if [[ -f "$GAS_AUTH_FILE" ]]; then
    auth_args=(--auth "$GAS_AUTH_FILE")
  fi

  (
    cd "$GAS_PROJECT_DIR"
    npm exec -- clasp "${auth_args[@]}" "$@"
  )
}

run_clasp_with_local_auth() {
  (
    cd "$GAS_PROJECT_DIR"
    npm exec -- clasp --auth "$GAS_AUTH_FILE" "$@"
  )
}
