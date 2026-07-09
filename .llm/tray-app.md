# `taskscape-tray` — menu-bar agent + mini capture bar

The always-on agent. No dock icon; its only window is a small, frameless, **opaque** "mini" bar for capturing a task from anywhere.

> Heads-up: the mini window's Tauri **label is `"main"`** (see `tauri.conf.json`). "main" here means the tray's primary window, _not_ the `taskscape-main` app. `app.get_webview_window("main")` in the tray code always refers to the mini bar.

## Files

| File                                  | What it holds                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/lib.rs`                | **All the interesting logic.** Hotkey, window mechanics, Tauri commands, tray menu, HTTP server wiring.                   |
| `src-tauri/src/main.rs`               | One-line entry point → `taskscape_tray_lib::run()`.                                                                       |
| `src-tauri/tauri.conf.json`           | Window config (480×130, frameless, `transparent: true`, always-on-top, hidden at start). `macOSPrivateApi: true` is required for the transparent backing, which now only lets the opaque card's rounded corners render — there is no vibrancy. |
| `src-tauri/capabilities/default.json` | Permissions for the `main` window.                                                                                        |
| `src/App.tsx`                         | The mini bar UI (React). Title + notes fields, and a footer with the target (project / list, opens main) on the left and the screenshot **ghost button** (spinner while capturing, shot count, ⌘⇧⏎ hint) on the right. |
| `src/api.ts`                          | Thin typed wrappers over `invoke(...)` for each Tauri command.                                                            |
| `src/components/Icon.tsx`             | Material Symbols glyph component (self-hosted, offline).                                                                  |
| `src/components/Spinner.tsx`          | Small indeterminate spinner (mini-bar palette) shown in the screenshot button while a capture is in flight.               |
| `src/index.css`                       | Tailwind import + the (opaque, main-app-derived) design tokens; `html/body/#root` stay transparent so the opaque card's rounded corners render.                                                |

## The window lifecycle (macOS)

The mini bar has to do something unusual: appear **instantly at the cursor** and **float in front of other apps' native full-screen Spaces** without yanking macOS out of that Space. Regular `alwaysOnTop` can't do this. The tricks, all in `lib.rs`:

- **Accessory activation policy** (`set_activation_policy(Accessory)`) — runs as a menu-bar agent, no dock icon.
- **`convert_to_panel`** — swaps the window's backing `NSWindow` for a non-activating `NSPanel` (via `object_setClass`) so it can become key (typable) _without activating the app_ and thus without leaving the full-screen Space. A custom `NSPanel` subclass overrides `canBecomeKeyWindow → YES`.
- **`allow_over_fullscreen`** — sets collection behavior `CanJoinAllSpaces | FullScreenAuxiliary` and raises the window to `NSPopUpMenuWindowLevel` (101) so it draws above full-screen apps. Re-asserted right before every show.
- **`order_front_regardless`** — brings it forward on the _currently active_ Space instead of activating the app (which would drag focus to the desktop).
- **Opaque surface** — the bar paints a solid surface in the webview (the main app's neutral palette); there is **no** `window-vibrancy`. The `NSWindow` keeps `transparent: true` only so the card's rounded corners render against nothing.

### Parking, not hiding

While hidden, the window is **moved off-screen to `PARK` (-10000,-10000)** rather than only `hide()`n so the next reveal can move it to the cursor _before_ showing, and no stale on-screen frame flashes at the old position. (Parking is **not** used during capture — the bar is excluded from the shot instead; see [The capture flow](#the-capture-flow).)

### The reveal-grace window

Showing the bar over a full-screen Space causes a transient `Focused(false)` blur. `just_revealed()` / `REVEAL_GRACE` (500ms) ignore blurs that arrive right after a reveal, so the bar isn't auto-dismissed one frame after appearing. A real click-away (later than the grace) still dismisses it.

### The capture flow

A screenshot must not include the bar, yet the ⌘⇧Return path should feel
instant **and** the bar should stay on screen (showing its spinner) while the
grab runs — and the bar must still be capturable by **OS screenshot tools and
the main app** at every other moment. `spawn_capture` (in `lib.rs`) gets all
four:

1. The panel's `NSWindowSharingType` is flipped to `None` **only for the grab**
   (`set_sharing_type`, on the capture's background thread, blocking until the
   change lands), then restored to the default `ReadOnly` right after by the
   `SharingRestore` RAII guard — even on error or panic. Because the exclusion is
   scoped to the tray's own capture, the bar appears normally in ⌘⇧4 shots and in
   screenshots the main app takes; it's hidden only from the shot the tray itself
   triggers.
2. The trigger (button `capture_and_attach`, or `capture_and_show` for the
   hotkey — which **shows the bar first** if it was hidden) emits
   `screenshot-pending` and hands off to a **background thread** (the blocking
   `screencapture` shell-out never runs on the UI/hotkey thread). The bar stays
   put throughout.
3. On success it emits `screenshot-captured` (PNG path); on failure,
   `screenshot-error`.

A `capturing` `AtomicBool` (released by the `CaptureFlag` RAII guard, even on
panic) makes overlapping captures a no-op, so two triggers can't collide.

> The bar is deliberately **not** excluded from capture at setup: a permanent
> `NSWindowSharingNone` would also hide it from OS screenshot tools and the main
> app. The exclusion is applied only around the tray's own grab and lifted
> immediately after, so the bar stays capturable everywhere else.

## Hotkeys

Registered via `tauri-plugin-global-shortcut`; the single handler dispatches on
which shortcut fired (only on `Pressed`):

- **⌘Return** (`hotkey()` = `SUPER + Enter`) toggles the mini bar (`toggle_mini`).
- **⌘⇧Return** (`screenshot_hotkey()` = `SUPER | SHIFT + Enter`) captures a
  screenshot and attaches it (`capture_and_show`): summons the bar **instantly**
  (showing a spinner) if it was hidden, or reuses it if it's already open, then
  captures in the background and attaches the shot when it lands. See
  [The capture flow](#the-capture-flow).

## Tauri commands (Rust ⇄ frontend)

Registered in `invoke_handler![...]`, called from `src/api.ts`:

| Command              | Purpose                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `hide_mini`          | Park + hide the bar (Escape, or after submit).                                                             |
| `capture_target`     | The project **and** list names captures will land in (`{ project, list }`), shown in the footer.          |
| `open_main`          | Focus/launch `taskscape-main` **first**, then dismiss the bar — so there's no gap where neither window is on screen (async). |
| `capture_and_attach` | Kick off a background screenshot (`spawn_capture`) and return immediately; progress is reported via the `screenshot-*` events. Each trigger adds another shot — it is **not** a toggle. |
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

- `mini-shown` — bar was revealed; refocus the title field, refresh the target.
- `mini-reset` — bar was dismissed/submitted (fired from `dismiss` + the hide
  branch of `toggle_mini`); clear the draft (title, notes, screenshots, spinner).
- `screenshot-pending` — a capture just started (button or ⌘⇧Return); the button
  shows a spinner.
- `screenshot-captured` (payload: PNG path) — the capture landed; attach it and
  drop the spinner.
- `screenshot-error` (payload: message) — the capture failed (e.g. Screen
  Recording permission); the button surfaces it briefly.

## Frontend notes

- Pure Tailwind utility classes (no component lib), **theme-adaptive** via `dark:`
  variants (driven by `prefers-color-scheme` + `color-scheme: light dark`). The
  bar is a single opaque card (`bg-surface-2`) with hairline dividers between the
  title row, notes row, and footer — reminiscent of the main window. Draggable
  via `data-tauri-drag-region` on the card and its chrome rows.
- The bar has a title field (autofocused), a notes field below it (the footer
  buttons are `tabIndex={-1}` so Tab goes title → notes), and a footer with the
  **target** (project / list — click to open main) on the left and the
  **screenshot ghost button** on the right.
- Screenshots live in a React array; the footer button is state-driven off the
  `screenshot-*` events: **spinner** ("Capturing …") while a shot is in flight,
  the shot **count** once attached, or a brief **"Capture failed"** on error. It
  adds one capture per trigger. Dismissing (Escape/click-away) clears everything
  via `mini-reset`.
- The IPC surface is centralized in `src/api.ts`; add new commands there.
