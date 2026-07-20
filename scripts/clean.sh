#!/bin/bash
set -euo pipefail

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

# Rust crates (each app has its own target/; they share the common crate). The
# tray is now a standalone Slint binary at tray/ (was tray/src-tauri under Tauri).
RUST_CRATES=(common main/src-tauri tray)

# Vite build output + dev caches live per workspace (common-ui is source-only; the
# tray no longer has a JS frontend).
VITE_DIRS=(main/dist main/node_modules/.vite)

step "Cleaning Rust workspaces"
for crate in "${RUST_CRATES[@]}"; do
  if [ -f "$ROOT_DIR/$crate/Cargo.toml" ]; then
    run cargo clean --manifest-path "$ROOT_DIR/$crate/Cargo.toml"
  else
    warn "[$crate] no Cargo.toml — skipping"
  fi
done

step "Cleaning Vite workspaces"
for dir in "${VITE_DIRS[@]}"; do
  if [ -e "$ROOT_DIR/$dir" ]; then
    run rm -rf "$ROOT_DIR/$dir"
  else
    log "${GRAY}[$dir] already clean${RESET}"
  fi
done

step "Done"
success "Rust and Vite build artifacts removed."
