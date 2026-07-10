# AGENTS.md

Orientation for coding agents. This mirrors [`CLAUDE.md`](CLAUDE.md); the two are kept identical in spirit, with the deep detail in [`.llm/`](.llm/README.md).

## What this is

**Taskscape** — a macOS task manager built as **two independent Tauri v2 apps** sharing **one Rust crate** and **one SQLite database**:

- **`main/`** (package `taskscape-main`) — the full task-manager window.
- **`tray/`** (package `taskscape-tray`) — an always-on menu-bar agent; its only UI is a frameless "mini" capture bar summoned with **⌘Return**. (Its Tauri window label is `"main"` — that's the mini bar, _not_ the main app.)
- **`common/`** — shared Rust library (`taskscape_common`): SQLite storage, screenshots, attachments, and the localhost HTTP IPC (main :7420, tray :7421).
- **`common-ui/`** (package `@taskscape/common-ui`) — shared React/TS frontend library, imported by both apps as `@taskscape/common-ui/*`. The repo is a flat npm workspace (`main` + `tray` + `common-ui`); dev/packaging scripts live in `scripts/`.

Two separate processes; they coordinate via the shared SQLite DB in`~/.taskscape/` and localhost HTTP.

## Where to read more

| Doc                                              | For                                                     |
| ------------------------------------------------ | ------------------------------------------------------- |
| [`.llm/architecture.md`](.llm/architecture.md)   | Big picture, why two processes, data flow.              |
| [`.llm/tray-app.md`](.llm/tray-app.md)           | The menu-bar agent / mini bar (macOS window mechanics). |
| [`.llm/main-app.md`](.llm/main-app.md)           | The full window app.                                    |
| [`.llm/common-crate.md`](.llm/common-crate.md)   | Data model, storage schema, IPC endpoints.              |
| [`.llm/build-and-run.md`](.llm/build-and-run.md) | Dev, build, packaging, ports.                           |
| [`.llm/conventions.md`](.llm/conventions.md)     | Code style, error handling, the `api.ts` pattern.       |

## Commands

Both run from the repo root:

```bash
npm run dev      # run BOTH apps in dev (Ctrl-C stops both) → scripts/run-dev.sh
npm run build    # build + package → dist/Taskscape.dmg     → scripts/make-app.sh
```

## Ground rules

- Rust Tauri commands return `Result<T, String>` ending in `.map_err(err)`; `common` uses `anyhow`.
- All frontend IPC goes through `src/api.ts` — one typed `invoke` wrapper per command; components never call `invoke` directly.
- Tailwind v4 utilities; icons via the shared `Icon` (Material Symbols).
- **Minimal comments** — explain non-obvious _why_, never restate the code.
- Cross-process updates: write SQLite, then POST `/refresh` or `/focus` to the other app's port rather than polling.
