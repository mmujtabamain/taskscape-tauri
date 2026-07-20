# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

**Taskscape** — a macOS task manager built as **two independent apps** sharing **one Rust crate** and **one SQLite database**:

- **`main/`** (package `taskscape-main`) — the full task-manager window. A **Tauri v2** (webview) app.
- **`tray/`** (crate `taskscape-tray`) — an always-on menu-bar agent whose only UI is a frameless "mini" capture bar summoned with **⌘Return**. A **standalone Slint (Rust) app** — no Tauri, no webview; it owns its own tray icon (`tray-icon`), global shortcuts (`global-hotkey`), NSPanel window, HTTP endpoint, and screenshot capture in one winit/Slint event loop.
- **`common/`** — shared Rust library (`taskscape_common`): SQLite storage, screenshot capture, attachments, and the localhost HTTP endpoints the two apps use to talk (main :7420, tray :7421).
- **`common-ui/`** (package `@taskscape/common-ui`) — shared React/TypeScript frontend library (`Icon`, `RichTextEditor`, `sanitizeHtml`, `fileKind`), imported by the **main** app as `@taskscape/common-ui/*`. (The Slint tray does not use it.)

The two apps are separate processes; they coordinate via the shared SQLite DB at
`~/.taskscape/` and localhost HTTP.

The repo has a flat **npm workspace** (`main` + `common-ui`) — one hoisted `node_modules` at the root — for the webview side. The shared Rust `common` crate sits at the repo root: `main/src-tauri/Cargo.toml` references it as `../../common`; the standalone `tray/Cargo.toml` as `../common`. Dev/packaging scripts live in `scripts/`.

## Detailed docs — read the one that matches your task

Navigation docs live in [`.llm/`](.llm/README.md):

- [`.llm/architecture.md`](.llm/architecture.md) — the big picture, why two processes, data flow.
- [`.llm/tray-app.md`](.llm/tray-app.md) — the menu-bar agent + mini bar (macOS window mechanics, hotkey, commands).
- [`.llm/main-app.md`](.llm/main-app.md) — the full window app.
- [`.llm/common-crate.md`](.llm/common-crate.md) — data model, storage schema, IPC endpoints.
- [`.llm/build-and-run.md`](.llm/build-and-run.md) — dev, build, packaging, ports.
- [`.llm/conventions.md`](.llm/conventions.md) — code style, error handling, the `api.ts` pattern.

## Commands

Both run from the repo root:

```bash
npm run dev      # run BOTH apps in dev (Ctrl-C stops both) → scripts/run-dev.sh
npm run build    # build + package → dist/Taskscape.dmg     → scripts/make-app.sh
```

Run just the main app: `cd main && npm run tauri dev`. Run just the tray: `cd tray && cargo run`.

## Conventions (short version — see .llm/conventions.md)

- Rust Tauri commands (**main app**) that touch the store are `async fn` and end with `.await.map_err(err)`; they return `Result<T, String>`. `common` uses `anyhow`; `Store` is async (SeaORM).
- **Main app** frontend IPC goes through `src/api.ts` (one typed `invoke` wrapper per command). Components never call `invoke` directly.
- The **tray** is Slint: its UI is `tray/ui/app.slint` and there is no `invoke`/IPC layer — the UI's callbacks call Rust in-process, and the Rust side drives the UI via `slint::Weak` / `invoke_from_event_loop` (see `tray/src/ctx.rs`). Design tokens are the `Palette`/`Glyphs` globals in `app.slint` (oklch→sRGB from `common-ui/styles/tokens.css`).
- Tailwind v4 utility classes (main app); icons via the shared `Icon` (Material Symbols).
- **Minimal comments** — explain non-obvious _why_, never restate the code.

## Gotchas

- Two apps, two processes. Data changes propagate by writing SQLite + POSTing `/refresh` (or `/focus`) to the other app's HTTP port.
- **Persistence is SeaORM (async) + Atlas migrations.** The schema's source of truth is `common/schema.hcl` — never hand-write a migration or hand-edit the DB schema. To change it: edit `schema.hcl` → `atlas migrate diff` → `./common/gen-entities.sh` → map the field in `storage.rs`. See `.llm/build-and-run.md#schema-changes-the-dev-loop`. Migrations from `0002` on must preserve data. `common/src/entities/` is **generated** — don't edit by hand.
- Ports are fixed: `MAIN_PORT`/`TRAY_PORT` in `common/src/lib.rs` (runtime), Vite `server.port` in `main/vite.config.ts` (dev).
- The mini window is a converted **NSPanel** parked off-screen while hidden. For the Slint tray this class-swap is done on the raw `NSWindow` behind the Slint window (`tray/src/macos.rs`); winit must never *tear it down* afterwards, so the tray quits via a hard `std::process::exit` (see `menubar::quit_all`). Read `tray/src/macos.rs` + `window.rs` before touching show/hide/capture/Space logic.
- **`.llm/` docs still describe the old Tauri tray** — they predate the Slint migration and need revising; trust `tray/README.md` + the `tray/src/*` module docs for the current tray.
