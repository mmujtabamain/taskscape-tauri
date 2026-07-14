# `common` — shared Rust library (`taskscape_common`)

Everything both apps share: persistence, screenshots, attachments, and the HTTP IPC layer. Linked by both `src-tauri` crates via `taskscape-common = { path = "../../common" }`.

## Modules (`common/src/`)

| Module           | Responsibility                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`         | Re-exports (`Store`, `Project`, `List`, `Task`, `Note`, `Attachment`, `LinkType`) and the port constants `MAIN_PORT`/`TRAY_PORT`.      |
| `models.rs`      | Serde **domain** structs: `Project`, `List`, `Task`, `Note`, `Attachment`, and `LinkType` (`Reference` \| `Copy`). The JSON contract.  |
| `hotkeys.rs`     | The hotkey system's source of truth: command catalog, canonical accel format, `resolve`/`set_binding` (conflict-checked) over the settings store (`~/.taskscape/settings.json`, key `hotkeys`). The frontend twin is `common-ui/src/hotkeys.ts`. |
| `storage.rs`     | `Store` — the async SeaORM handle. All DB reads/writes; maps entities → domain models.                                                 |
| `settings.rs`    | File-backed app **settings** — a string→string map persisted as JSON at `~/.taskscape/settings.json`, kept out of the DB. Backs `Store::get/set_setting` (atomic writes, read-through).                                                             |
| `entities/`      | **Generated** SeaORM entities (`sea-orm-cli`, via `gen-entities.sh`). Never serialized to the frontend — mapped in `storage.rs`.       |
| `migrations.rs`  | Runtime applier: embeds `common/migrations/*.sql` and applies unrecorded versions at startup. Atlas authors the SQL; it's not shipped. |
| `paths.rs`       | Locations under `~/.taskscape/` and `ensure_dirs()`.                                                                                   |
| `screenshot.rs`  | `capture()` — shells out to macOS `screencapture`; full-screen (`-x`) or interactive region (`-i`) per the `screenshot_mode` setting.   |
| `attachments.rs` | `attach_reference` / `attach_copy` / `rename_attachment` (async — they call `Store`).                                                  |
| `server.rs`      | axum `data_router`, `serve(port, router)`, and the `client` helpers (`is_up`, `post_json`).                                            |
| `util.rs`        | `now_millis()`, `new_id()` (UUID v4).                                                                                                  |

## Data locations (`paths.rs`)

```
~/.taskscape/
├── taskscape.db      # SQLite (WAL)
├── attachments/      # files copied in via "copy" attachments
└── screenshots/      # PNGs from capture()
```

## The database (`storage.rs`)

`Store` wraps an **async SeaORM `DatabaseConnection`** over an SQLx SQLite pool
(`max_connections = 4`). The pool's `SqliteConnectOptions` set `journal_mode=WAL`,
`busy_timeout=5s`, and `foreign_keys=ON` on **every** connection — the last is
required for the schema's `ON DELETE CASCADE` rules to fire. `Store::open()` is
`async`; call it from a sync context with `tauri::async_runtime::block_on(...)`.

**Schema & migrations.** The schema is defined declaratively in
[`common/schema.hcl`](../common/schema.hcl) (Atlas HCL — "the models"). Atlas
autogenerates versioned SQL into `common/migrations/`; at startup `migrations.rs`
records applied versions in a `schema_migrations` table and replays any new ones
in a transaction. See [build-and-run.md](build-and-run.md#schema-changes-the-dev-loop)
for the schema-change dev loop, and [`.plans/orm-migration.md`](../.plans/orm-migration.md)
for the full design.

**Tables** (all with full referential integrity):
`projects` → `lists` (FK, cascade) → `tasks` (FK, cascade; plus a self-referential
`parent_id` FK, cascade, so deleting a task drops its whole subtree in the DB) →
`attachments` and `task_notes` (both FK, cascade). `sort_order` is `REAL NOT NULL`
everywhere. Indexes on every FK column. App **settings** are deliberately *not* in
the DB — they live in a separate file-backed key/value store (`settings.rs`,
`~/.taskscape/settings.json`) so copying `taskscape.db` carries data without
preferences.

**Entities vs. domain models.** SeaORM entity `Model`s live in `entities/` and are
**mapped** to the `models.rs` structs at the `Store` boundary (`to_task`,
`to_list`, …) — entities are never serialized to the frontend. Regenerate entities
with `common/gen-entities.sh` after a schema change (it normalizes SQLite's loose
numeric typing to the domain's `i64` millis / `f64` ordering keys).

**Method groups:** settings (`get/set_setting` — file-backed, see `settings.rs`), projects (`create/list/rename/delete_project`,
`default_project`), lists (`create/list/reorder/rename/delete_list`), tasks
(`create/list/all/update/get/delete/move/reorder_task`), attachments
(`add/list/get/update/delete_attachment`), notes (`list/create/update/delete_note`).
`hydrate()` batch-loads each task's attachments + notes with SeaORM `load_many`
(two queries total, not N+1). Multi-statement writes (`create_task` + first note,
`move_task` + subtree relist, note write + preview recompute) run in a transaction.

## Models (`models.rs`)

`Task` carries `notes: Option<String>` (a derived plaintext preview of its rich
`note_items`, kept for the list-row preview and search), `done`, `sort_order`,
`created_at`/`updated_at` (unix millis), an optional `parent_id` (subtasks nest
arbitrarily deep), and `#[serde(default)]` `attachments` and `note_items`. `Note`
is a rich-text block (`content` is sanitized HTML). `Attachment` has a `LinkType`
(`reference` copies nothing and stores a URL/path; `copy` copies the file into
`attachments/` and stores a relative `location`). Timestamps via `util::now_millis()`;
IDs via `util::new_id()` (UUIDv4).

## HTTP IPC (`server.rs`)

`data_router(store)` exposes the shared data API; each app serves it on its port
and may `.merge()` extra routes (main adds `/refresh`, `/focus`, `/quit`). Handlers
are `async` and `.await` the store.

| Method + path                       | Action                                      |
| ----------------------------------- | ------------------------------------------- |
| `GET /health`                       | Liveness (`"ok"`). Used by `client::is_up`. |
| `GET/POST /lists`                   | List / create lists.                        |
| `GET /lists/{id}/tasks`             | Tasks in a list.                            |
| `GET/POST /tasks`                   | All tasks / create a task.                  |
| `PATCH/DELETE /tasks/{id}`          | Update / delete a task.                     |
| `GET/POST /tasks/{id}/attachments`  | List / add-by-reference.                    |
| `POST /tasks/{id}/attachments/copy` | Add-by-copy.                                |

`client::post_json(port, path, body)` and `client::is_up(port)` are how one app
calls the other. Errors are wrapped by `AppError` → HTTP 500 with the message.

## Screenshots (`screenshot.rs`)

macOS only: `capture()` runs `screencapture` into
`~/.taskscape/screenshots/screenshot-<millis>.png` and returns the path. The grab
is full-screen (`-x`, silent) or an interactive region/window selection (`-i`)
depending on the `screenshot_mode` setting (`CaptureMode::current()`, default
full-screen). A cancelled region selection returns `Ok(None)` — callers treat
that as a silent no-op. First use triggers the macOS Screen Recording permission
prompt for that app. Non-macOS targets `bail!`.
