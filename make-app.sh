#!/usr/bin/env bash
#
# make-app.sh — build both Taskscape apps for macOS and package them into a
# single distributable DMG containing ONE app the user installs.
#
# The always-on menu-bar agent (taskscape-tray) is embedded inside the main app
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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/dmg-staging"
DMG="$DIST/Taskscape.dmg"

build_app() {
  local dir="$1"
  echo "==> Building $dir"
  cd "$ROOT/$dir"
  if [ ! -d node_modules ]; then
    echo "    installing npm dependencies…"
    npm install
  fi
  # Only the .app bundle; we assemble the DMG ourselves below.
  npm run tauri -- build --bundles app
}

find_app() {
  # Newest .app bundle produced by `tauri build` for the given app dir. Sorting
  # by mtime avoids grabbing a stale bundle left over from an earlier build under
  # a different productName.
  ls -dt "$ROOT/$1/src-tauri/target/release/bundle/macos/"*.app 2>/dev/null | head -1
}

build_app taskscape-main
build_app taskscape-tray

MAIN_APP="$(find_app taskscape-main)"
TRAY_APP="$(find_app taskscape-tray)"

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
