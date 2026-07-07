#!/usr/bin/env bash
#
# run-dev.sh — run both Taskscape apps in development mode.
#
#   taskscape-main  → main window   (vite :1420, HTTP :7420)
#   taskscape-tray  → tray + mini    (vite :1421, HTTP :7421)
#
# Both are independent Tauri apps; this just launches them together and tears
# them both down on Ctrl-C.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_app() {
  local dir="$1"
  cd "$ROOT/$dir"
  if [ ! -d node_modules ]; then
    echo "[$dir] installing npm dependencies…"
    npm install
  fi
  echo "[$dir] starting tauri dev…"
  exec npm run tauri dev
}

# Kill the whole process group (both apps + their vite/cargo children) on exit.
trap 'trap - INT TERM EXIT; kill 0 2>/dev/null || true' INT TERM EXIT

run_app taskscape-main &
run_app taskscape-tray &

wait
