# `taskscape-tray` — menu-bar agent + mini capture bar

The always-on agent. No dock icon; its only window is a small, frameless, **opaque** "mini" bar for capturing a task from anywhere.

> Heads-up: the mini window's Tauri **label is `"main"`** (see `tauri.conf.json`). "main" here means the tray's primary window, _not_ the `taskscape-main` app. `app.get_webview_window("main")` in the tray code always refers to the mini bar.

## Files

| File                                  | What it holds                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/lib.rs`                | **All the interesting logic.** Hotkey, window mechanics, Tauri commands, tray menu, HTTP server wiring.                   |
| `src-tauri/src/main.rs`               | One-line entry point → `taskscape_tray_lib::run()`.                                                                       |
| `src-tauri/tauri.conf.json`           | Window config (480×180 — sized for the notes panel expanded, frameless, `transparent: true`, always-on-top, hidden at start). `macOSPrivateApi: true` is required for the transparent backing, which now only lets the opaque card's rounded corners render — there is no vibrancy. |
| `src-tauri/capabilities/default.json` | Permissions for the `main` window.                                                                                        |
| `src/App.tsx`                         | The mini bar UI (React). Title + notes fields, and a footer with the target (project / list, opens main) on the left and, on the right, a **Clear** button (⌘⇧⌫, shown only when the draft has content) + the screenshot **ghost button** (spinner while capturing, shot count, ⌘⇧⏎ hint). Holds the draft state, which persists across dismissal. |
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

While hidden, the window is **moved off-screen to `PARK` (-10000,-10000)** rather than only `hide()`n so the next reveal can move it to the cursor _before_ showing, and no stale on-screen frame flashes at the old position. (Parking is **not** used during capture — the bar is excluded from the shot instead; see [The capture flow](#the-capture-flow).) Hiding **keeps the draft** (title / notes / screenshots) — it survives dismissal and returns on the next reveal; only submitting or an explicit clear empties it.

### Anchoring on screen

`cursor_anchor` places the bar just down-and-right of the cursor. If that would push the frame past the **right or bottom edge** of the monitor the cursor is on, it **flips to the opposite side** of the cursor; a final clamp to that monitor's **work area** (menu bar / dock excluded) keeps the whole frame on screen even near a corner or on a small display. The monitor is resolved from the cursor position (`monitor_from_point`), so multi-display setups anchor to the right screen.

### Dismiss on click-away, but not on a Space switch

A real **click-away** dismisses the bar (`Focused(false)` → `dismiss`). Two blurs must _not_ dismiss it:

- the **transient blur** while it settles onto a Space right after opening — guarded by `just_revealed()` / `REVEAL_GRACE` (500 ms of the reveal);
- a **desktop (Space) switch**, which blurs the panel too but should carry the bar to the new Space (it joins all Spaces via `CanJoinAllSpaces`). Just hiding on that blur brought back the one-frame flash — no `Focused(false)` / Space-change event fires until _after_ the compositor has drawn the sticky window on the new Space — so instead the bar **stays**.

Telling a switch apart from a click-away needs a signal AppKit only gives natively: `observe_space_changes()` registers a leaked `NSObject` observer (`TaskscapeSpaceObserver`, mirroring `panel_class`) on `NSWorkspaceActiveSpaceDidChangeNotification`. Its `spaceChanged:` stamps `last_space_change` and **re-pins + refocuses** a visible bar onto the new Space (so it stays key/typable there). The blur handler then **defers ~160 ms** (the Space-change notification can land a hair after the blur) and skips the dismiss if `during_space_switch()` is true _or_ the bar has regained focus. The reachable `app_handle()` `OnceLock` lets the C callback find the window.

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

**User-customizable** via the centralized hotkey system (`common/src/hotkeys.rs`
owns the catalog + settings-backed bindings; edited in main's Settings ▸
Shortcuts pane). At startup — and on every `POST /reload-hotkeys` from main —
`refresh_global_shortcuts` resolves the two `Global`-scope commands from
settings asynchronously and (re)registers them on the main thread via
`tauri-plugin-global-shortcut`, updating the tray tooltip to match. The single
handler dispatches by comparing the fired shortcut against that registered
state (only on `Pressed`):

- **`toggle_capture_bar`** (default **⌘Return**) toggles the mini bar (`toggle_mini`).
- **`screenshot_capture`** (default **⌘⇧Return**) captures a
  screenshot and attaches it (`capture_and_show`): summons the bar **instantly**
  (showing a spinner) if it was hidden, or reuses it if it's already open, then
  captures in the background and attaches the shot when it lands. See
  [The capture flow](#the-capture-flow).

A combo the OS refuses (taken by another app) is logged and the previous
registration is kept.

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
- `Focused(false)` → dismiss (deferred ~160 ms), unless `just_revealed()`, `during_space_switch()`, or the bar has regained focus (see [Dismiss on click-away, but not on a Space switch](#dismiss-on-click-away-but-not-on-a-space-switch)).

## Events (Rust → webview)

The frontend `listen`s for these (emitted from `lib.rs`):

- `mini-shown` — bar was revealed; refocus the title field, refresh the target.
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
- The bar has a title field (autofocused), a **collapsed** notes editor below it,
  and a footer with the **target** (project / list — click to open main) on the
  left and, on the right, the **Clear** ghost button (shown only when the draft
  has content) followed by the **screenshot ghost button**.
- **Pointer hidden on open and while typing.** The bar appears right under the
  mouse, so the pointer sits on the title field and hides what you type. The
  `mini-shown` reveal and every `keydown` add `cursor-hidden` to `<html>` (→
  `cursor: none` on everything); a `mousemove` removes it. So the pointer is
  hidden **when the bar opens and mid-keystroke**, and returns the instant the
  mouse actually moves — never hidden while you're reaching for a control. A
  ~250 ms grace after each reveal ignores the settling mouse events macOS emits
  as the panel appears under a stationary pointer, so "hidden until the mouse
  moves" holds. The class is toggled imperatively (no React re-render), and
  `mousemove` only ever *shows*, which keeps it snappy (an earlier static
  `cursor: none` on the field lagged because WebKit only re-evaluates a hovered
  cursor on mouse-move). Done in CSS, not `NSCursor` — the tray is a
  non-activating accessory, where native cursor hiding has no effect.
- **Notes are hidden until Tab.** The card sizes to its content and the window
  stays a fixed 480×180, so the collapsed card simply leaves the lower part of the
  (transparent) window empty. Tab from the title sets `notesOpen`, which animates
  the panel's `grid-template-rows` from `0fr` to `1fr` (expands to the editor's
  natural height without measuring it) and then focuses the editor. While
  collapsed the panel is `inert`, so nothing inside it is tabbable. It re-collapses
  when the draft is emptied (submit or clear) **and** whenever focus leaves the
  editor while it's empty (its `onBlur` → `isEmpty()` check — docked-toolbar
  clicks `preventDefault` their blur, so they don't trip it); non-empty notes
  stay open and survive dismissing the bar. The footer buttons are `tabIndex={-1}`,
  so Tab only ever goes title → notes.
- Screenshots live in a React array; the footer button is state-driven off the
  `screenshot-*` events: **spinner** ("Capturing …") while a shot is in flight,
  the shot **count** once attached, or a brief **"Capture failed"** on error. It
  adds one capture per trigger.
- **The draft persists across dismissal.** Escape / click-away only hide the bar
  (Rust no longer emits a reset event). The form is emptied by `clearDraft()` in
  two cases: after a successful **submit**, and on an **explicit clear** — the
  **Clear** footer button or **⌘⇧⌫** (Cmd-Shift-Delete). The clear hotkey is a
  capture-phase `keydown` listener on `window`, so it fires ahead of both the
  title field and the notes editor (which stops React key propagation) and works
  with either focused.
- The IPC surface is centralized in `src/api.ts`; add new commands there.
