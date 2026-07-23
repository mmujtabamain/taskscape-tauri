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
  # The .app bundle produced by `tauri build` for the given app dir. Both apps
  # build into one shared target dir (see .cargo/config.toml), so bundles are
  # disambiguated by productName rather than by directory.
  local name
  name="$(node -p "require('$ROOT/$1/src-tauri/tauri.conf.json').productName")"
  local app="$ROOT/target/release/bundle/macos/$name.app"
  [ -d "$app" ] && printf '%s\n' "$app"
}

build_app main
build_app tray

MAIN_APP="$(find_app main)"
TRAY_APP="$(find_app tray)"

if [ -z "$MAIN_APP" ] || [ -z "$TRAY_APP" ]; then
  echo "error: could not locate built .app bundles" >&2
  exit 1
fi

echo "==> Embedding tray helper inside main app"
HELPERS="$MAIN_APP/Contents/Library/LoginItems"
rm -rf "$HELPERS"
mkdir -p "$HELPERS"
cp -R "$TRAY_APP" "$HELPERS/"

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
