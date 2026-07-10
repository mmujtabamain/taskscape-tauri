# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

**Taskscape** — a macOS task manager built as **two independent Tauri v2 apps** sharing **one Rust crate** and **one SQLite database**:

- **`main/`** (package `taskscape-main`) — the full task-manager window.
- **`tray/`** (package `taskscape-tray`) — an always-on menu-bar agent whose only UI is a frameless "mini" capture bar summoned with **⌘Return**.
- **`common/`** — shared Rust library (`taskscape_common`): SQLite storage, screenshot capture, attachments, and the localhost HTTP endpoints the two apps use to talk (main :7420, tray :7421).
- **`common-ui/`** (package `@taskscape/common-ui`) — shared React/TypeScript frontend library (`Icon`, `RichTextEditor`, `sanitizeHtml`, `fileKind`), imported by both apps as `@taskscape/common-ui/*`.

The two apps are separate processes; they coordinate via the shared SQLite DB at
`~/.taskscape/` and localhost HTTP.

The repo is a flat **npm workspace** (`main` + `tray` + `common-ui`) — one hoisted `node_modules` at the root. The shared Rust `common` crate sits at the repo root, referenced by each app's `src-tauri/Cargo.toml` as `../../common`. Dev/packaging scripts live in `scripts/`.

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

Run one app: `cd tray && npm run tauri dev` (or `npm run dev -w taskscape-tray`).

## Conventions (short version — see .llm/conventions.md)

- Rust Tauri commands that touch the store are `async fn` and end with `.await.map_err(err)`; they return `Result<T, String>`. `common` uses `anyhow`; `Store` is async (SeaORM).
- All frontend IPC goes through `src/api.ts` (one typed `invoke` wrapper per command). Components never call `invoke` directly.
- Tailwind v4 utility classes; icons via the shared `Icon` (Material Symbols).
- **Minimal comments** — explain non-obvious _why_, never restate the code.
- The tray's window **label is `"main"`** — it's the mini bar, not the main app.

## Gotchas

- Two apps, two processes. Data changes propagate by writing SQLite + POSTing `/refresh` (or `/focus`) to the other app's HTTP port.
- **Persistence is SeaORM (async) + Atlas migrations.** The schema's source of truth is `common/schema.hcl` — never hand-write a migration or hand-edit the DB schema. To change it: edit `schema.hcl` → `atlas migrate diff` → `./common/gen-entities.sh` → map the field in `storage.rs`. See `.llm/build-and-run.md#schema-changes-the-dev-loop`. Migrations from `0002` on must preserve data. `common/src/entities/` is **generated** — don't edit by hand.
- Ports are fixed: `MAIN_PORT`/`TRAY_PORT` in `common/src/lib.rs` (runtime), Vite `server.port` in each `vite.config.ts` (dev).
- The mini window is a converted **NSPanel** parked off-screen while hidden — see `.llm/tray-app.md` before touching its show/hide/capture logic.
