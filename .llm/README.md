# `.llm/` — project navigation docs

Concise, task-oriented documentation for anyone (human or agent) working in this repo. Start here, then jump to the file that matches what you're touching.

| Doc                                  | Read it when you're…                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- |
| [architecture.md](architecture.md)   | Getting oriented — what the pieces are and why there are two apps.         |
| [tray-app.md](tray-app.md)           | Working on the menu-bar agent / mini capture window (`taskscape-tray`).    |
| [main-app.md](main-app.md)           | Working on the full task-manager window (`taskscape-main`).                |
| [common-crate.md](common-crate.md)   | Touching storage, models, screenshots, attachments, or the HTTP IPC layer. |
| [build-and-run.md](build-and-run.md) | Running in dev, building, or packaging the `.dmg`.                         |
| [conventions.md](conventions.md)     | Writing code — style, error handling, the frontend `api.ts` pattern.       |

## 30-second orientation

Taskscape is a macOS task manager made of **two independent Tauri apps** that share **one Rust crate** and **one SQLite database**:

- **`taskscape-main`** — the full window where you browse lists and tasks.
- **`taskscape-tray`** — an always-running menu-bar agent whose only UI is a frameless "mini" capture bar summoned with **⌘Return** to jot a task from anywhere (even over another app's full-screen Space).
- **`common`** — shared Rust library: SQLite storage, screenshot capture, attachments, and the localhost HTTP endpoints the two apps use to talk.

The two apps are separate OS processes. They coordinate over **localhost HTTP** (main on :7420, tray on :7421) and by both reading/writing `~/.taskscape/`.

See [architecture.md](architecture.md) for the full picture.
