# taskscape-tray

Taskscape's always-on **menu-bar capture agent**, as a standalone **Slint** (Rust)
app — no Tauri, no webview. Its only UI is the frameless "mini" capture bar
summoned with **⌘Return**.

It owns, in one winit/Slint event loop:

- the mini bar window (`ui/app.slint`), a converted non-activating **NSPanel** that
  floats over other apps' full-screen Spaces and rests parked off-screen while hidden;
- the menu-bar tray icon + menu (`tray-icon`);
- the OS global shortcuts (`global-hotkey`);
- the localhost HTTP endpoint the main app talks to (`axum`, port `TRAY_PORT`);
- screenshot capture and task creation, via the shared `taskscape_common` crate.

## Run

```bash
cargo run                 # from this directory (or `npm run dev` at the repo root
                          # to run the main app + this tray together)
```

## Layout

- `ui/app.slint` — the capture bar UI + the `Palette` / `Glyphs` design tokens.
- `assets/` — embedded fonts (Outfit, Montserrat) + the Material Symbols TTF subset
  (regenerate with `scripts/gen-slint-icons.py`).
- `src/` — the Rust modules: `macos` (NSPanel/Space/cursor/key-monitor interop),
  `window`, `capture`, `hotkeys`, `menubar`, `http`, `task`, `theme`, `ctx`.
- `Info.plist` — embedded into the binary (`LSUIElement`) so it runs as an agent
  even unbundled; packaging wraps it into a `.app` (see `scripts/make-app.sh`).
