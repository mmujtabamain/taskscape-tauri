# Migration & ORM Plan: Atlas (autogen migrations) + SeaORM (async queries)

Status: **proposed** · Owner: TBD · Target crate: `common` (`taskscape_common`)

## 1. Decisions (locked)

- **Migrations:** **Atlas** (ariga/atlas) — declarative schema + `atlas migrate diff`
  autogenerates versioned SQL migrations. The `manage.py makemigrations` analog.
- **Schema source of truth:** a hand-edited **Atlas HCL** schema file (`common/schema.hcl`)
  — the "models." Chosen over raw SQL for expressiveness and for portability if a
  sync-server/Postgres backend ever appears. (Atlas still generates **SQL** migration files
  from it.)
- **Query layer:** **SeaORM**, async, used to its fullest (§5).
- **Autogeneration is the default.** Migrations are **generated**, not hand-written.
  Hand-authoring is reserved for changes Atlas genuinely cannot express (real data
  backfills, §10) and used **only when necessary** — no shortcuts, no ad-hoc DDL.
- **Removed:** hand-rolled rusqlite `migrate()`, the `rusqlite` dependency, and all
  legacy-data compatibility code (`ensure_column`, `backfill_*`, `sort_order` seeding).

Atlas is a **dev-time tool** (authors migration SQL, never shipped in the `.dmg`);
SeaORM is the **runtime** (typed async queries over an SQLx pool). They meet only at
"the SQLite schema."

## 2. Data & migration policy (read first)

- **The app is unreleased. Current data is dev-only and may be discarded.** During this
  setup we will **delete the existing `~/.taskscape/taskscape.db`** and regenerate from a
  clean, canonical schema. No effort is spent preserving today's rows.
- **This is a one-time allowance.** Once the Atlas + SeaORM setup lands, **every subsequent
  migration MUST preserve data.** From `0002` onward, migrations run against real user DBs
  and are forward-only and non-destructive by default.
- Because we start clean, the schema is built **without legacy constraints** — we enforce
  the "perfect" shape now (§6) rather than accommodating old dev rows.

## 3. How Atlas + SeaORM fit together — the dev loop (`makemigrations`-style)

Single source of truth: **`common/schema.hcl`** (desired schema, hand-edited — the "models").

```
edit common/schema.hcl                # 1. declare the change (add column, table, index…)
atlas migrate diff <name> --env local # 2. AUTOGENERATE the versioned SQL migration → common/migrations/
atlas migrate apply --url sqlite://dev.db --dir file://common/migrations  # 3. build a dev DB at head
sea-orm-cli generate entity -u sqlite://dev.db -o common/src/entities      # 4. regen SeaORM entities from DB
# 5. adjust the models.rs mapping if the change is user-visible
```

Two HCL files, kept distinct: **`common/schema.hcl`** is the *desired schema* (the models);
**`atlas.hcl`** is the *project config* (env definitions). Same shape as Django (declare
schema → autogen migration), with entity codegen going DB→Rust. `atlas.hcl` (checked in):

```hcl
env "local" {
  src = "file://common/schema.hcl"
  dev = "sqlite://dev?mode=memory"
  migration { dir = "file://common/migrations" }
}
```

## 4. The async decision

SeaORM is async; today's `Store` is sync (`Mutex<Connection>`, `pub fn`). Go async
end-to-end — the only correct choice for the axum path:

- axum handlers in [`server.rs`](../common/src/server.rs) are already `async` → just `.await` the store.
- ~30 Tauri commands across [`taskscape-main/src-tauri/src/lib.rs`](../taskscape-main/src-tauri/src/lib.rs)
  and [`taskscape-tray/src-tauri/src/lib.rs`](../taskscape-tray/src-tauri/src/lib.rs) become `async fn` + `.await`.
- `Store::open()` → `async`; call via `tauri::async_runtime::block_on(...)` at startup.
- `.manage(Arc<Store>)` / `State<'_, Arc<Store>>` stay — `DatabaseConnection` is `Send + Sync + Clone`.

## 5. Utilizing SeaORM async to its fullest

Honest ceiling: local, single-user **SQLite** (single-writer, microsecond local reads), so
async buys no raw throughput. It buys correctness and lets us use SeaORM properly:

1. **Non-blocking runtime** — DB I/O on the SQLx pool instead of blocking Tauri/axum threads
   behind a held `Mutex`. The real reason to be async.
2. **Eager relational loading → kill the N+1.** `attach_all` loops per-task calling
   `list_attachments` + `list_notes`. Replace with SeaORM `load_many` / `find_with_related`:
   one query for tasks, one for attachments, one for notes, then zip. Biggest "used properly" win.
3. **Real transactions** via `db.transaction(|txn| …)` for the multi-statement ops:
   `create_task` + first note, `move_task` + `relist_task_tree`, subtree delete, and
   note write + `recompute_task_notes`.
4. **Concurrent independent reads** with `try_join!` where useful (minor, free).
5. **Streaming** (`.stream()`) available but **not needed** at this data scale.

## 6. Clean schema — enforce the "perfect" shape now

Starting from empty removes every reason the current schema is loose. Enforce full
constraints in `schema.hcl` (Atlas generates the corresponding `0001` DDL), and delete the
fallback code they made necessary:

| Change | Was | Now (clean) | Code this deletes |
| ------ | --- | ----------- | ----------------- |
| `lists.project_id` | nullable, no explicit FK | `NOT NULL REFERENCES projects(id) ON DELETE CASCADE` | `backfill_default_project`; manual `DELETE FROM lists` in `delete_project` |
| `tasks.parent_id` | nullable, **no FK** (to allow legacy `ALTER`) | `REFERENCES tasks(id) ON DELETE CASCADE` (self-ref) | recursive `delete_task_tree` → DB cascade (keep `relist_task_tree` for moves) |
| `*.sort_order` | `REAL` nullable, defaulted in code | `REAL NOT NULL` (always set on insert) | `COALESCE(sort_order, created_at)` + `unwrap_or` fallbacks |
| legacy plaintext `tasks.notes` | backfilled into `task_notes` | keep column (derived preview), **drop the one-time backfill** | `backfill_task_notes`, `ensure_column` |

This is the "no shortcuts" direction: proper referential integrity in the DB rather than
hand-maintained cascades in Rust. `default_project()` (create-on-demand at runtime) stays —
it's app logic, not a migration.

> Decision to confirm: `tasks.parent_id` self-referential FK with `ON DELETE CASCADE` lets
> SQLite cascade subtree deletion (drops `delete_task_tree`). Requires `foreign_keys=ON`
> (already set). Recommended. See open question #2.

## 7. Constraints to preserve

1. **Domain models ≠ entities.** [`models.rs`](../common/src/models.rs) stays the wire/JSON
   contract `api.ts` depends on — `Task.attachments`, `Task.note_items`, `LinkType` as
   `"reference"`/`"copy"`. SeaORM entities live in `common/src/entities/` and are **mapped**
   to domain structs at the boundary; never serialize entity `Model`s to the frontend.
2. **Logic SeaORM won't do — port, don't drop:** `relist_task_tree` (list reassignment on
   move), `move_task` cycle detection, `recompute_task_notes` + `strip_html`/`plaintext_to_html`,
   and hydration (now via eager-loading, §5.2). (Recursive *delete* moves to the DB FK, §6.)
3. **Two processes, one SQLite file, WAL** (main `:7420`, tray `:7421`). Reproduce
   `journal_mode=WAL` + `busy_timeout=5s` + `foreign_keys=ON` on the pool (§11).

## 8. Runtime: applying Atlas migrations in the shipped app

Atlas produces plain SQL — the app applies it, so the Atlas binary is **never shipped**:

- **Embed** `common/migrations/*.sql` into the binary with `include_dir`.
- In the now-async `Store::open()`, replace `migrate()` with a small applier:
  1. `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER)`.
  2. List embedded migrations sorted by filename (skip `atlas.sum`).
  3. For each version not yet recorded, run its SQL via `db.execute_unprepared(sql)` in a
     transaction and record the version.
- Do **not** use `sea-orm-migration`'s Rust `Migrator` (Atlas replaces it). *Alternative to
  evaluate in Phase 0:* `sqlx::migrate!("./migrations")` (SQLx is already present via SeaORM) —
  convenient, but reconcile its checksum tracking with Atlas file naming first. Default to the
  hand-rolled applier for control.

## 9. Baseline (`0001`) — clean, autogenerated

Because current data is disposable (§2), the baseline is **not** hand-written and **not**
idempotent-for-legacy:

1. Delete the dev DB. Start with an **empty** `common/migrations/`.
2. Write the perfect `common/schema.hcl` (§6).
3. `atlas migrate diff baseline --env local` → Atlas **autogenerates** `0001_baseline.sql`
   as clean `CREATE TABLE` / FK / index DDL matching `schema.hcl`.
4. Generate entities from a DB at head; wire up the runtime applier (§8).

No `IF NOT EXISTS`, no guarded `ALTER`, no backfills in `0001`. From `0002` onward the policy
in §2 applies: every migration preserves data.

## 10. Data migrations (post-baseline, only if necessary)

Atlas autogenerates **schema** (DDL) only. A future change that needs to **move/transform
data** (the `RunPython` analog) is the *only* case where we hand-author a migration file:
create the `.sql`, then `atlas migrate hash` to fold it into `atlas.sum`. This is rare and
deliberate — schema changes stay autogenerated. (During this initial setup there are **no**
data migrations, since we discard existing data.)

## 11. Connection pool (replaces `Store::open` PRAGMAs)

SeaORM `ConnectOptions` / SQLx `SqliteConnectOptions`: `journal_mode=WAL`, `busy_timeout=5s`,
`foreign_keys=ON`; small pool (`max_connections ≈ 4`) with `busy_timeout` covering
cross-process writer contention. Verify no `database is locked` regressions with both apps
running. Confirm the `.dmg` still statically bundles SQLite via `sqlx-sqlite`.

## 12. Dependencies

`common/Cargo.toml`:
- `sea-orm = { version = "1", features = ["sqlx-sqlite", "runtime-tokio-rustls", "macros"] }`.
- `include_dir = "0.7"` (embed migration SQL).
- Remove `rusqlite` after Phase 3.
- Dev tooling (not runtime deps): **Atlas** (`brew install ariga/tap/atlas`), `sea-orm-cli`
  (`cargo install sea-orm-cli`).

## 13. Phased execution

Keep `cargo build` green between phases.

**Phase 0 — Tooling + clean baseline**
- Install Atlas + `sea-orm-cli`; add `atlas.hcl`.
- Write the perfect `common/schema.hcl` (§6); autogenerate `0001_baseline` (§9).
- Add the embedded-SQL applier (§8); decide applier vs `sqlx::migrate!`.
- Delete the dev DB. Document the dev loop in [`.llm/build-and-run.md`](../.llm/build-and-run.md).

**Phase 1 — SeaORM entities + async `Store`**
- Generate `common/src/entities/` from a dev DB at head.
- `Store` holds `DatabaseConnection`; `Store::open()` → `async`, runs the applier instead of `migrate()`.
- Port methods per entity group (settings → projects → lists → tasks → attachments → notes),
  `async`, mapping `Model` → `models::*`; use eager-loading + transactions (§5); drop the
  legacy code listed in §6.

**Phase 2 — Flip callers to async**
- `server.rs`: `.await` each store call.
- Both `src-tauri/src/lib.rs`: commands → `async fn` + `.await`; startup via `block_on`;
  tray's `target_list(store: &Store)` → async/inline. Update [`attachments.rs`](../common/src/attachments.rs).

**Phase 3 — Remove rusqlite** and all §6 legacy code; confirm nothing else imports it.

**Phase 4 — Docs**: update [`.llm/common-crate.md`](../.llm/common-crate.md),
[`.llm/build-and-run.md`](../.llm/build-and-run.md), [`CLAUDE.md`](../CLAUDE.md).

## 14. Verification (Claude owns build/type only; user owns behavioral/visual)

- `cargo build` / `clippy` clean across all three crates.
- **Fresh DB builds the perfect schema:** delete DB, launch, confirm `0001` produces the
  full constrained schema and default-project create-on-demand works.
- **Forward-preservation (the real guarantee):** with a populated dev DB at head, add a
  nullable column to `schema.hcl`, `atlas migrate diff`, apply, and confirm **existing rows
  survive** and load. This proves the §2 post-baseline promise before real users exist.
- **FK cascades:** deleting a project removes its lists/tasks/attachments; deleting a task
  removes its subtree — via DB FKs, not code.
- **Concurrency:** `./run-dev.sh` (both apps), write from tray while main is open, confirm
  `/refresh` reflects it with no `database is locked`.
- **Frontend contract:** `api.ts` JSON shapes byte-compatible with today.

## 15. Rollback

During setup, rollback is trivial (dev data disposable): delete the DB, revert the branch.
**This ease is one-time** — after release the §2 preserve-data policy governs and rollbacks
must be non-destructive.

## 16. Open questions

1. **`tasks.parent_id` self-ref FK** with `ON DELETE CASCADE` (drops `delete_task_tree`) —
   confirm (recommended, §6).
2. **Entities:** regenerate via `sea-orm-cli generate entity` each change, or hand-curate?
3. **`LinkType`:** SeaORM `DeriveActiveEnum` vs keep `String` + existing `from_db`/`as_str`.
4. **Runtime applier:** hand-rolled embedded-SQL runner vs `sqlx::migrate!` — settle in Phase 0.
