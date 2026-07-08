# `common` — shared Rust library (`taskscape_common`)

Everything both apps share: persistence, screenshots, attachments, and the HTTP IPC layer. Linked by both `src-tauri` crates via `taskscape-common = { path = "../../common" }`.

## Modules (`common/src/`)

| Module           | Responsibility                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`         | Re-exports (`Store`, `Task`, `List`, `Attachment`, `LinkType`) and the port constants `MAIN_PORT = 7420`, `TRAY_PORT = 7421`. |
| `models.rs`      | Serde structs: `List`, `Task`, `Attachment`, and the `LinkType` enum (`Reference` \| `Copy`).                                 |
| `storage.rs`     | `Store` — the SQLite handle. All DB reads/writes and the schema/migrations.                                                   |
| `paths.rs`       | Locations under `~/.taskscape/` and `ensure_dirs()`.                                                                          |
| `screenshot.rs`  | `capture_fullscreen()` — shells out to macOS `screencapture -x`.                                                              |
| `attachments.rs` | `attach_reference` (record a pointer) and `attach_copy` (copy a file into the data dir).                                      |
| `server.rs`      | axum `data_router`, `serve(port, router)`, and the `client` helpers (`is_up`, `post_json`).                                   |
| `util.rs`        | `now_millis()`, `new_id()` (UUID v4).                                                                                         |

## Data locations (`paths.rs`)

```
~/.taskscape/
├── taskscape.db      # SQLite (WAL)
├── attachments/      # files copied in via "copy" attachments
└── screenshots/      # PNGs from capture_fullscreen()
```

## The database (`storage.rs`)

One connection per process (`Mutex<Connection>`), WAL journaling + 5s busy timeout so both apps share the file. Schema is created idempotently in `migrate()`; `ensure_column()` adds new columns to older DBs (e.g. `due_at`).

Tables: `lists`, `tasks` (FK → lists, `ON DELETE CASCADE`), `attachments` (FK → tasks, cascade), and a `settings` key/value table (e.g. `last_active_list`). Indexes on `tasks(list_id)` and `attachments(task_id)`.

`Store` methods group by entity: lists (`create/list/rename/delete_list`), tasks (`create/list/all/update/get/delete_task`, `set_task_due`), attachments (`add/list/delete_attachment`), settings (`get/set_setting`). `attach_all()` populates each `Task.attachments` after a query.

## Models (`models.rs`)

`Task` carries `notes: Option<String>`, `done`, `created_at`/`updated_at` (unix millis), optional `due_at`, and a `#[serde(default)] attachments: Vec<Attachment>`. `Attachment` has a `LinkType` (`reference` copies nothing and stores a URL/path; `copy` copies the file into `attachments/` and stores a relative `location`). Timestamps are unix millis via `util::now_millis()`; IDs are UUIDv4 via `util::new_id()`.

## HTTP IPC (`server.rs`)

`data_router(store)` exposes the shared data API; each app serves it on its port and may `.merge()` extra routes (main adds `/refresh`, `/focus`).

| Method + path                       | Action                                      |
| ----------------------------------- | ------------------------------------------- |
| `GET /health`                       | Liveness (`"ok"`). Used by `client::is_up`. |
| `GET/POST /lists`                   | List / create lists.                        |
| `GET /lists/{id}/tasks`             | Tasks in a list.                            |
| `GET/POST /tasks`                   | All tasks / create a task.                  |
| `PATCH/DELETE /tasks/{id}`          | Update / delete a task.                     |
| `GET/POST /tasks/{id}/attachments`  | List / add-by-reference.                    |
| `POST /tasks/{id}/attachments/copy` | Add-by-copy.                                |

`client::post_json(port, path, body)` and `client::is_up(port)` are how one app calls the other. Errors are wrapped by `AppError` → HTTP 500 with the message.

## Screenshots (`screenshot.rs`)

macOS only: `capture_fullscreen()` runs `screencapture -x` (silent) into `~/.taskscape/screenshots/screenshot-<millis>.png` and returns the path. First use triggers the macOS Screen Recording permission prompt for that app. Non-macOS targets `bail!`.
