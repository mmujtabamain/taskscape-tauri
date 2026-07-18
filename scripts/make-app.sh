#!/usr/bin/env bash
#
# make-app.sh — build both Taskscape apps for macOS and package them into a
# single distributable DMG containing ONE app the user installs.
#
# The always-on menu-bar agent (tray/) is embedded inside the main app
# at Taskscape.app/Contents/Library/LoginItems/, so from the user's point of view
# there is a single "Taskscape" app. The main app launches the embedded tray on
# startup.
#
# Output: dist/Taskscape.dmg  (Taskscape.app + Applications)
#
# Note: these bundles are unsigned. On first launch macOS Gatekeeper will require
# right-click → Open (or `xattr -dr com.apple.quarantine <app>`, which also clears
# the nested tray helper since it recurses).

set -euo pipefail

# Repository root, regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/dmg-staging"
DMG="$DIST/Taskscape.dmg"

# Install the whole workspace once (hoisted node_modules at the repo root).
if [ ! -d "$ROOT/node_modules" ]; then
  echo "==> Installing npm dependencies (workspace)"
  (cd "$ROOT" && npm install)
fi

build_app() {
  local dir="$1"
  echo "==> Building $dir"
  cd "$ROOT/$dir"
  # Only the .app bundle; we assemble the DMG ourselves below.
  npm run tauri -- build --bundles app
}

find_app() {
  # Newest .app bundle produced by `tauri build` for the given app dir. Sorting
  # by mtime avoids grabbing a stale bundle left over from an earlier build under
  # a different productName.
  ls -dt "$ROOT/$1/src-tauri/target/release/bundle/macos/"*.app 2>/dev/null | head -1
}

build_app main
build_app tray

# The standalone Slint modal/overlay helper — a plain executable (not a Tauri
# app), so it builds with cargo, not `tauri build`.
echo "==> Building modals helper"
(cd "$ROOT/modals" && cargo build --release)
MODALS_BIN="$ROOT/modals/target/release/taskscape-modals"

MAIN_APP="$(find_app main)"
TRAY_APP="$(find_app tray)"

if [ -z "$MAIN_APP" ] || [ -z "$TRAY_APP" ]; then
  echo "error: could not locate built .app bundles" >&2
  exit 1
fi
if [ ! -x "$MODALS_BIN" ]; then
  echo "error: could not locate built modals helper at $MODALS_BIN" >&2
  exit 1
fi

echo "==> Embedding tray helper inside main app"
HELPERS="$MAIN_APP/Contents/Library/LoginItems"
rm -rf "$HELPERS"
mkdir -p "$HELPERS"
cp -R "$TRAY_APP" "$HELPERS/"

# The main app resolves this at Contents/Helpers/taskscape-modals via
# current_exe() (see modal_helper_path() in main/src-tauri/src/lib.rs).
echo "==> Embedding modals helper inside main app"
MODALS_DIR="$MAIN_APP/Contents/Helpers"
mkdir -p "$MODALS_DIR"
cp "$MODALS_BIN" "$MODALS_DIR/taskscape-modals"

echo "==> Assembling DMG"
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$MAIN_APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

hdiutil create \
  -volname "Taskscape" \
  -srcfolder "$STAGE" \
  -ov -format UDZO \
  "$DMG"

rm -rf "$STAGE"
echo "==> Done: $DMG"
