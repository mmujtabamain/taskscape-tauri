#!/bin/bash
set -euo pipefail

clear
clear
clear

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
BLUE=$'\033[0;34m'
GRAY=$'\033[0;90m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

log()     { printf '%s\n' "${BLUE}> $* ${RESET}"; }
step()    { printf '\n%s\n' "${BOLD}${BLUE}==> $*${RESET}"; }
success() { printf '%s\n' "${GREEN}$* ${RESET}"; }
warn()    { printf '%s\n' "${YELLOW}$* ${RESET}"; }
fail()    { printf '%s\n' "${RED}$* ${RESET}" >&2; }

run() {
    log "${GRAY}\$ $*${RESET}"
    "$@"
}

# Determine repository root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# add dependencies if not present
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  warn "[workspace] installing npm dependencies…"
  (
    cd "$ROOT_DIR"
    run npm install
  )
fi

# Build the standalone Slint modal/overlay helper once so the main app can spawn
# it in dev, and point the main process at the built binary (packaged builds find
# it under Contents/Helpers instead — see scripts/make-app.sh).
log "[modals] building Slint helper…"
run cargo build --manifest-path "$ROOT_DIR/modals/Cargo.toml"
export TASKSCAPE_MODALS_BIN="$ROOT_DIR/modals/target/debug/taskscape-modals"

run_app() {
  local dir="$1"
  log "[$dir] starting tauri dev…"
  (
    cd "$ROOT_DIR/$dir"
    exec npm run tauri dev
  )
}

# Kill both apps (and their child processes) on Ctrl-C.
trap 'trap - INT TERM EXIT; kill 0 2>/dev/null || true' INT TERM EXIT

run_app main &
run_app tray &

wait
