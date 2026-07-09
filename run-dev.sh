#!/usr/bin/env bash
#
# run-dev.sh — run both Taskscape apps in development mode.
#
#   apps/main  → main window   (vite :1420, HTTP :7420)
#   apps/tray  → tray + mini    (vite :1421, HTTP :7421)
#
# Both are independent Tauri apps; this just launches them together and tears
# them both down on Ctrl-C. Dependencies are one hoisted npm-workspace install
# at the repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Install the whole workspace once (hoisted node_modules at the repo root).
if [ ! -d "$ROOT/node_modules" ]; then
  echo "[workspace] installing npm dependencies…"
  (cd "$ROOT" && npm install)
fi

run_app() {
  local dir="$1"
  cd "$ROOT/$dir"
  echo "[$dir] starting tauri dev…"
  exec npm run tauri dev
}

# Kill the whole process group (both apps + their vite/cargo children) on exit.
trap 'trap - INT TERM EXIT; kill 0 2>/dev/null || true' INT TERM EXIT

run_app apps/main &
run_app apps/tray &

wait
