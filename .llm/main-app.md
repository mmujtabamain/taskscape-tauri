# `taskscape-main` — full task-manager window

The normal window where the user browses lists and tasks. A conventional Tauri app (no menu-bar/NSPanel tricks).

## Files

| File                                           | What it holds                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/lib.rs`                         | Tauri commands (thin wrappers over `Store`), the extra `/refresh` + `/focus` HTTP routes, and `launch_embedded_tray()`. |
| `src-tauri/src/main.rs`                        | Entry point → `run()`.                                                                                                  |
| `src-tauri/tauri.conf.json`                    | Normal 800×600 window.                                                                                                  |
| `src/App.tsx`                                  | Root UI.                                                                                                                |
| `src/components/Sidebar.tsx`                   | List navigation.                                                                                                        |
| `src/components/TaskList.tsx` / `TaskItem.tsx` | Task rendering.                                                                                                         |
| `src/components/Icon.tsx`                      | Material Symbols glyph (same as tray).                                                                                  |
| `src/api.ts`                                   | Typed `invoke(...)` wrappers.                                                                                           |

## Commands (Rust ⇄ frontend)

All are thin wrappers over the shared `Store` (see [common-crate.md](common-crate.md)). Registered in `invoke_handler![...]`:

- Lists: `list_lists`, `create_list`, `rename_list`, `delete_list`.
- Tasks: `list_tasks`, `all_tasks`, `create_task`, `update_task`, `delete_task`, `set_task_due`.
- Attachments: `list_attachments`, `add_reference`, `add_copy`, `delete_attachment`, `open_attachment`.
- Settings: `set_active_list` (writes `last_active_list`, which the tray reads to decide where captures go).

## HTTP: what main serves that the tray calls

Main mounts the shared `data_router` on **:7420** and `.merge()`s two extra app-specific routes:

- `POST /refresh` → emits a `refresh` event to the webview so the open window live-reloads after the tray writes data.
- `POST /focus` → unminimize + show + focus the window (used by the tray's "Open Taskscape").

## `launch_embedded_tray()`

On macOS startup the main app `open`s the tray bundle nested at `Contents/Library/LoginItems/taskscape-tray.app` (packaged builds only; a no-op in dev, where `run-dev.sh` starts the tray itself). Uses `open` without `-n`, so a running tray is reused rather than duplicated.

## Frontend

React 19 + Tailwind v4 + Material Symbols, same stack and `api.ts` pattern as the tray. Listens for the `refresh` event to reload after tray-side changes.
