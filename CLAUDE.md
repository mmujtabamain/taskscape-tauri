# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

**Taskscape** — a macOS task manager built as **two independent Tauri v2 apps** sharing **one Rust crate** and **one SQLite database**:

- **`taskscape-main/`** — the full task-manager window.
- **`taskscape-tray/`** — an always-on menu-bar agent whose only UI is a frameless "mini" capture bar summoned with **⌘Return**.
- **`common/`** — shared Rust library (`taskscape_common`): SQLite storage, screenshot capture, attachments, and the localhost HTTP endpoints the two apps use to talk (main :7420, tray :7421).

The two apps are separate processes; they coordinate via the shared SQLite DB at
`~/.taskscape/` and localhost HTTP.

## Detailed docs — read the one that matches your task

Navigation docs live in [`.llm/`](.llm/README.md):

- [`.llm/architecture.md`](.llm/architecture.md) — the big picture, why two processes, data flow.
- [`.llm/tray-app.md`](.llm/tray-app.md) — the menu-bar agent + mini bar (macOS window mechanics, hotkey, commands).
- [`.llm/main-app.md`](.llm/main-app.md) — the full window app.
- [`.llm/common-crate.md`](.llm/common-crate.md) — data model, storage schema, IPC endpoints.
- [`.llm/build-and-run.md`](.llm/build-and-run.md) — dev, build, packaging, ports.
- [`.llm/conventions.md`](.llm/conventions.md) — code style, error handling, the `api.ts` pattern.

## Commands

```bash
./run-dev.sh     # run BOTH apps in dev (Ctrl-C stops both)
./make-app.sh    # build + package → dist/Taskscape.dmg
```

Run one app: `cd taskscape-tray && npm run tauri dev`.

## Conventions (short version — see .llm/conventions.md)

- Rust Tauri commands return `Result<T, String>` and end with `.map_err(err)`; `common` uses `anyhow`.
- All frontend IPC goes through `src/api.ts` (one typed `invoke` wrapper per command). Components never call `invoke` directly.
- Tailwind v4 utility classes; icons via the shared `Icon` (Material Symbols).
- **Minimal comments** — explain non-obvious _why_, never restate the code.
- The tray's window **label is `"main"`** — it's the mini bar, not the main app.

## Gotchas

- Two apps, two processes. Data changes propagate by writing SQLite + POSTing `/refresh` (or `/focus`) to the other app's HTTP port.
- Ports are fixed: `MAIN_PORT`/`TRAY_PORT` in `common/src/lib.rs` (runtime), Vite `server.port` in each `vite.config.ts` (dev).
- The mini window is a converted **NSPanel** parked off-screen while hidden — see `.llm/tray-app.md` before touching its show/hide/capture logic.
