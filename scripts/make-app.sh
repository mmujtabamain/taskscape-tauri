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
MAIN_APP="$(find_app main)"

# The tray is now a standalone Slint (Rust) binary — there's no Tauri bundler for
# it, so build it with cargo and hand-assemble a minimal LSUIElement .app bundle.
echo "==> Building tray (cargo release)"
(cd "$ROOT/tray" && cargo build --release)
TRAY_BIN="$ROOT/tray/target/release/taskscape-tray"
TRAY_APP="$DIST/Taskscape Tray.app"
rm -rf "$TRAY_APP"
mkdir -p "$TRAY_APP/Contents/MacOS" "$TRAY_APP/Contents/Resources"
cp "$TRAY_BIN" "$TRAY_APP/Contents/MacOS/taskscape-tray"
cp "$ROOT/tray/icons/icon.icns" "$TRAY_APP/Contents/Resources/AppIcon.icns" 2>/dev/null || true
cat > "$TRAY_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>taskscape-tray</string>
  <key>CFBundleIdentifier</key><string>com.taskscape.tray</string>
  <key>CFBundleName</key><string>Taskscape Tray</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
</dict>
</plist>
PLIST

if [ -z "$MAIN_APP" ] || [ ! -x "$TRAY_APP/Contents/MacOS/taskscape-tray" ]; then
  echo "error: could not locate built app bundles" >&2
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
