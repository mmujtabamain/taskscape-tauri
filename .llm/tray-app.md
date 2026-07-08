# `taskscape-tray` — menu-bar agent + mini capture bar

The always-on agent. No dock icon; its only window is a small, frameless, translucent "mini" bar for capturing a task from anywhere.

> Heads-up: the mini window's Tauri **label is `"main"`** (see `tauri.conf.json`). "main" here means the tray's primary window, _not_ the `taskscape-main` app. `app.get_webview_window("main")` in the tray code always refers to the mini bar.

## Files

| File                                  | What it holds                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/lib.rs`                | **All the interesting logic.** Hotkey, window mechanics, Tauri commands, tray menu, HTTP server wiring.                   |
| `src-tauri/src/main.rs`               | One-line entry point → `taskscape_tray_lib::run()`.                                                                       |
| `src-tauri/tauri.conf.json`           | Window config (480×84, frameless, transparent, always-on-top, hidden at start). `macOSPrivateApi: true` enables vibrancy. |
| `src-tauri/capabilities/default.json` | Permissions for the `main` window.                                                                                        |
| `src/App.tsx`                         | The mini bar UI (React). Title input, screenshot button, list footer.                                                     |
| `src/api.ts`                          | Thin typed wrappers over `invoke(...)` for each Tauri command.                                                            |
| `src/components/Icon.tsx`             | Material Symbols glyph component (self-hosted, offline).                                                                  |
| `src/index.css`                       | Tailwind import + transparent `html/body/#root` so vibrancy shows through.                                                |

## The window lifecycle (macOS)

The mini bar has to do something unusual: appear **instantly at the cursor** and **float in front of other apps' native full-screen Spaces** without yanking macOS out of that Space. Regular `alwaysOnTop` can't do this. The tricks, all in `lib.rs`:

- **Accessory activation policy** (`set_activation_policy(Accessory)`) — runs as a menu-bar agent, no dock icon.
- **`convert_to_panel`** — swaps the window's backing `NSWindow` for a non-activating `NSPanel` (via `object_setClass`) so it can become key (typable) _without activating the app_ and thus without leaving the full-screen Space. A custom `NSPanel` subclass overrides `canBecomeKeyWindow → YES`.
- **`allow_over_fullscreen`** — sets collection behavior `CanJoinAllSpaces | FullScreenAuxiliary` and raises the window to `NSPopUpMenuWindowLevel` (101) so it draws above full-screen apps. Re-asserted right before every show.
- **`order_front_regardless`** — brings it forward on the _currently active_ Space instead of activating the app (which would drag focus to the desktop).
- **Vibrancy** — `window-vibrancy` applies the `HudWindow` material for the translucent blurred background.

### Parking, not hiding

While hidden, the window is **moved off-screen to `PARK` (-10000,-10000)** rather than only `hide()`n. Two reasons:

1. The next reveal moves it to the cursor _before_ showing, so no stale on-screen frame flashes at the old position.
2. During screenshot capture (see below) it's parked while staying focused, so the blur-driven auto-hide doesn't fire.

### The reveal-grace window

Showing the bar over a full-screen Space causes a transient `Focused(false)` blur. `just_revealed()` / `REVEAL_GRACE` (500ms) ignore blurs that arrive right after a reveal, so the bar isn't auto-dismissed one frame after appearing. A real click-away (later than the grace) still dismisses it.

## Hotkey

Registered via `tauri-plugin-global-shortcut`:

- **⌘Return** (`hotkey()` = `SUPER + Enter`) toggles the mini bar (`toggle_mini`).

The handler checks `shortcut == &hotkey() && state == Pressed`.

## Tauri commands (Rust ⇄ frontend)

Registered in `invoke_handler![...]`, called from `src/api.ts`:

| Command              | Purpose                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `hide_mini`          | Park + hide the bar (Escape, or after submit).                                                             |
| `active_list_name`   | Name of the list captures will land in (shown in the footer).                                              |
| `open_main`          | Dismiss the bar and focus/launch `taskscape-main`.                                                         |
| `capture_and_attach` | Park the bar off-screen, screenshot the full screen (without the bar in it), restore, return the PNG path. |
| `submit_capture`     | Create the task in the target list, attach the screenshot if present, POST `/refresh` to main, dismiss.    |

`target_list()` resolves where captures go: last active list (setting `last_active_list`, written by the main app) → first list → a freshly created `Inbox`.

## Tray icon menu

Built with `TrayIconBuilder`: **Open Taskscape** (`focus_or_launch_main`) and **Quit** (`app.exit(0)`). Left-click does not open the menu (`show_menu_on_left_click(false)`).

## Window events

- `CloseRequested` → `prevent_close()` + dismiss (never destroy — the agent must stay alive).
- `Focused(false)` → dismiss, unless `just_revealed()`.

## Frontend notes

- Pure Tailwind utility classes (no component lib). The bar listens for the `mini-shown` event to refocus the input each time it's summoned.
- Screenshot state currently lives in React (`App.tsx`), set from `capture_and_attach`'s returned path and sent back through `submit_capture`.
- The IPC surface is centralized in `src/api.ts`; add new commands there.
