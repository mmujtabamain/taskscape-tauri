# `taskscape-tray` — menu-bar agent + mini capture bar

The always-on agent. No dock icon; its only window is a small, frameless, translucent "mini" bar for capturing a task from anywhere.

> Heads-up: the mini window's Tauri **label is `"main"`** (see `tauri.conf.json`). "main" here means the tray's primary window, _not_ the `taskscape-main` app. `app.get_webview_window("main")` in the tray code always refers to the mini bar.

## Files

| File                                  | What it holds                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/lib.rs`                | **All the interesting logic.** Hotkey, window mechanics, Tauri commands, tray menu, HTTP server wiring.                   |
| `src-tauri/src/main.rs`               | One-line entry point → `taskscape_tray_lib::run()`.                                                                       |
| `src-tauri/tauri.conf.json`           | Window config (480×140, frameless, transparent, always-on-top, hidden at start). `macOSPrivateApi: true` enables vibrancy. |
| `src-tauri/capabilities/default.json` | Permissions for the `main` window.                                                                                        |
| `src/App.tsx`                         | The mini bar UI (React). Title + notes fields, screenshot button (count badge), list footer.                                                     |
| `src/api.ts`                          | Thin typed wrappers over `invoke(...)` for each Tauri command.                                                            |
| `src/components/Icon.tsx`             | Material Symbols glyph component (self-hosted, offline).                                                                  |
| `src/index.css`                       | Tailwind import + transparent `html/body/#root` so vibrancy shows through.                                                |

## The window lifecycle (macOS)

The mini bar has to do something unusual: appear **instantly at the cursor** and **float in front of other apps' native full-screen Spaces** without yanking macOS out of that Space. Regular `alwaysOnTop` can't do this. The tricks, all in `lib.rs`:

- **Accessory activation policy** (`set_activation_policy(Accessory)`) — runs as a menu-bar agent, no dock icon.
- **`convert_to_panel`** — swaps the window's backing `NSWindow` for a non-activating `NSPanel` (via `object_setClass`) so it can become key (typable) _without activating the app_ and thus without leaving the full-screen Space. A custom `NSPanel` subclass overrides `canBecomeKeyWindow → YES`.
- **`allow_over_fullscreen`** — sets collection behavior `CanJoinAllSpaces | FullScreenAuxiliary` and raises the window to `NSPopUpMenuWindowLevel` (101) so it draws above full-screen apps. Re-asserted right before every show.
- **`order_front_regardless`** — brings it forward on the _currently active_ Space instead of activating the app (which would drag focus to the desktop).
- **Vibrancy** — `window-vibrancy` applies the appearance-adaptive `Popover` material for the translucent blurred background.

### Parking, not hiding

While hidden, the window is **moved off-screen to `PARK` (-10000,-10000)** rather than only `hide()`n. Two reasons:

1. The next reveal moves it to the cursor _before_ showing, so no stale on-screen frame flashes at the old position.
2. During screenshot capture (see below) it's parked while staying focused, so the blur-driven auto-hide doesn't fire.

### The reveal-grace window

Showing the bar over a full-screen Space causes a transient `Focused(false)` blur. `just_revealed()` / `REVEAL_GRACE` (500ms) ignore blurs that arrive right after a reveal, so the bar isn't auto-dismissed one frame after appearing. A real click-away (later than the grace) still dismisses it.

## Hotkeys

Registered via `tauri-plugin-global-shortcut`; the single handler dispatches on
which shortcut fired (only on `Pressed`):

- **⌘Return** (`hotkey()` = `SUPER + Enter`) toggles the mini bar (`toggle_mini`).
- **⌘⇧Return** (`screenshot_hotkey()` = `SUPER | SHIFT + Enter`) captures a
  screenshot and attaches it (`capture_and_show`): summons the bar with the shot
  already attached if it was hidden, or adds another shot if it's already open.

## Tauri commands (Rust ⇄ frontend)

Registered in `invoke_handler![...]`, called from `src/api.ts`:

| Command              | Purpose                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `hide_mini`          | Park + hide the bar (Escape, or after submit).                                                             |
| `active_list_name`   | Name of the list captures will land in (shown in the footer).                                              |
| `open_main`          | Dismiss the bar and focus/launch `taskscape-main`.                                                         |
| `capture_and_attach` | Screenshot the full screen without the bar in it (parks it off-screen if visible), return the PNG path. Each click adds another screenshot — it is **not** a toggle. |
| `submit_capture`     | Create the task in the target list, attach **all** captured screenshots (`screenshot_paths: Vec<String>`) plus notes, POST `/refresh` to main, dismiss. |

`target_list()` resolves where captures go: last active list (setting `last_active_list`, written by the main app) → first list → a freshly created `Inbox`.

## Tray icon menu

Built with `TrayIconBuilder`: **Open Taskscape** (`focus_or_launch_main`) and
**Quit Taskscape** (`quit_all`). Left-click does not open the menu
(`show_menu_on_left_click(false)`). `quit_all` POSTs `/quit` to the main app
(:7420) so quitting the agent also closes the main window, then `app.exit(0)`s
this process.

## Window events

- `CloseRequested` → `prevent_close()` + dismiss (never destroy — the agent must stay alive).
- `Focused(false)` → dismiss, unless `just_revealed()`.

## Events (Rust → webview)

The frontend `listen`s for these (emitted from `lib.rs`):

- `mini-shown` — bar was revealed; refocus the title field, refresh the list name.
- `mini-reset` — bar was dismissed/submitted (fired from `dismiss` + the hide
  branch of `toggle_mini`); clear the draft (title, notes, screenshots).
- `screenshot-captured` (payload: PNG path) — a ⌘⇧Return capture to attach.

## Frontend notes

- Pure Tailwind utility classes (no component lib), **theme-adaptive** via `dark:`
  variants (driven by `prefers-color-scheme` + `color-scheme: light dark`). The
  native backdrop uses the `Popover` vibrancy material, which also adapts.
- The bar has a title field (autofocused), a notes field below it ("Press Tab to
  add notes" — the icon buttons are `tabIndex={-1}` so Tab goes title → notes),
  and a footer showing the target list.
- Screenshots live in a React array; the screenshot button shows a **count badge**
  and adds one capture per click. Dismissing (Escape/click-away) clears them via
  `mini-reset`.
- The IPC surface is centralized in `src/api.ts`; add new commands there.
