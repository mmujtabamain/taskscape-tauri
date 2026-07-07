#!/usr/bin/env bash
#
# make-app.sh — build both Taskscape apps for macOS and package them into a
# single distributable DMG containing both .app bundles.
#
# Output: dist/Taskscape.dmg  (Taskscape.app + Taskscape-tray.app + Applications)
#
# Note: these bundles are unsigned. On first launch macOS Gatekeeper will require
# right-click → Open (or `xattr -dr com.apple.quarantine <app>`).

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
  # First .app bundle produced by `tauri build` for the given app dir.
  find "$ROOT/$1/src-tauri/target/release/bundle/macos" \
    -maxdepth 1 -name '*.app' -print -quit
}

build_app taskscape-main
build_app taskscape-tray

MAIN_APP="$(find_app taskscape-main)"
TRAY_APP="$(find_app taskscape-tray)"

if [ -z "$MAIN_APP" ] || [ -z "$TRAY_APP" ]; then
  echo "error: could not locate built .app bundles" >&2
  exit 1
fi

echo "==> Assembling DMG"
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$MAIN_APP" "$STAGE/"
cp -R "$TRAY_APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

hdiutil create \
  -volname "Taskscape" \
  -srcfolder "$STAGE" \
  -ov -format UDZO \
  "$DMG"

rm -rf "$STAGE"
echo "==> Done: $DMG"
