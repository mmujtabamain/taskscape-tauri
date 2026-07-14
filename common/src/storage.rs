use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use anyhow::Result;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, LoaderTrait,
    QueryFilter, QueryOrder, Set, SqlxSqliteConnector, TransactionTrait,
};

use crate::entities::{attachments, lists, projects, task_notes, tasks};
use crate::models::{Attachment, LinkType, List, Note, Project, Task};
use crate::util::{new_id, now_millis};

/// A handle to the Taskscape SQLite database.
///
/// Wraps an async SeaORM connection over an SQLx pool. Each process keeps its own
/// pool to the shared `~/.taskscape/taskscape.db`; WAL journaling plus a busy
/// timeout let the main app and the tray app read and write it concurrently.
pub struct Store {
    db: DatabaseConnection,
}

impl Store {
    /// Open (creating if needed) the shared database and apply migrations.
    pub async fn open() -> Result<Self> {
        crate::paths::ensure_dirs()?;
        Self::open_at(&crate::paths::db_path()).await
    }

    /// Open a store at an explicit database path (the data-dir setup in
    /// [`open`](Self::open) is skipped). Lets tests point at a temp file.
    async fn open_at(path: &Path) -> Result<Self> {
        let db = connect(path).await?;
        crate::migrations::apply(&db).await?;
        Ok(Self { db })
    }

    // ---- settings (shared key/value, e.g. the last active list) -----------
    //
    // Persisted as JSON at `~/.taskscape/settings.json`, deliberately outside the
    // database — see [`crate::settings`]. The signatures stay `async` so every
    // caller is unchanged despite the file-backed store being synchronous.

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        Ok(crate::settings::get(key))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        crate::settings::set(key, value)
    }

    // ---- projects --------------------------------------------------------

    pub async fn create_project(&self, name: &str) -> Result<Project> {
        let now = now_millis();
        let model = projects::ActiveModel {
            id: Set(new_id()),
            name: Set(name.to_string()),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&self.db)
        .await?;
        Ok(to_project(model))
    }

    pub async fn list_projects(&self) -> Result<Vec<Project>> {
        Ok(projects::Entity::find()
            .order_by_asc(projects::Column::CreatedAt)
            .all(&self.db)
            .await?
            .into_iter()
            .map(to_project)
            .collect())
    }

    pub async fn rename_project(&self, id: &str, name: &str) -> Result<()> {
        projects::Entity::update_many()
            .col_expr(projects::Column::Name, Expr::value(name))
            .col_expr(projects::Column::UpdatedAt, Expr::value(now_millis()))
            .filter(projects::Column::Id.eq(id))
            .exec(&self.db)
            .await?;
        Ok(())
    }

    /// Delete a project and everything under it. Its lists — and their tasks,
    /// attachments and notes — are removed by the database's `ON DELETE CASCADE`
    /// foreign keys.
    pub async fn delete_project(&self, id: &str) -> Result<()> {
        projects::Entity::delete_by_id(id.to_string())
            .exec(&self.db)
            .await?;
        Ok(())
    }

    /// The project new lists/captures fall into when none is specified: the
    /// oldest existing project, created on demand if the database has none.
    pub async fn default_project(&self) -> Result<Project> {
        if let Some(model) = projects::Entity::find()
            .order_by_asc(projects::Column::CreatedAt)
            .one(&self.db)
            .await?
        {
            return Ok(to_project(model));
        }
        self.create_project(&crate::names::suggest_project_name())
            .await
    }

    // ---- lists -----------------------------------------------------------

    pub async fn create_list(&self, project_id: &str, name: &str) -> Result<List> {
        let now = now_millis();
        // New lists land after existing tabs (seeded with `now`), so a fresh
        // list appears last.
        let model = lists::ActiveModel {
            id: Set(new_id()),
            project_id: Set(project_id.to_string()),
            name: Set(name.to_string()),
            sort_order: Set(now as f64),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&self.db)
        .await?;
        Ok(to_list(model))
    }

    pub async fn list_lists(&self) -> Result<Vec<List>> {
        Ok(lists::Entity::find()
            .order_by_asc(lists::Column::SortOrder)
            .order_by_asc(lists::Column::CreatedAt)
            .all(&self.db)
            .await?
            .into_iter()
            .map(to_list)
            .collect())
    }

    /// Move a list to a new manual position among its sibling tabs.
    pub async fn reorder_list(&self, id: &str, sort_order: f64) -> Result<()> {
        let res = lists::Entity::update_many()
            .col_expr(lists::Column::SortOrder, Expr::value(sort_order))
            .col_expr(lists::Column::UpdatedAt, Expr::value(now_millis()))
            .filter(lists::Column::Id.eq(id))
            .exec(&self.db)
            .await?;
        if res.rows_affected == 0 {
            anyhow::bail!("list not found: {id}");
        }
        Ok(())
    }

    pub async fn rename_list(&self, id: &str, name: &str) -> Result<()> {
        lists::Entity::update_many()
            .col_expr(lists::Column::Name, Expr::value(name))
            .col_expr(lists::Column::UpdatedAt, Expr::value(now_millis()))
            .filter(lists::Column::Id.eq(id))
            .exec(&self.db)
            .await?;
        Ok(())
    }

    pub async fn delete_list(&self, id: &str) -> Result<()> {
        lists::Entity::delete_by_id(id.to_string())
            .exec(&self.db)
            .await?;
        Ok(())
    }

    // ---- tasks -----------------------------------------------------------

    pub async fn create_task(
        &self,
        list_id: &str,
        title: &str,
        notes: Option<&str>,
        parent_id: Option<&str>,
    ) -> Result<Task> {
        let now = now_millis();
        let id = new_id();
        let txn = self.db.begin().await?;
        let task = tasks::ActiveModel {
            id: Set(id.clone()),
            list_id: Set(list_id.to_string()),
            parent_id: Set(parent_id.map(str::to_string)),
            title: Set(title.to_string()),
            notes: Set(notes.map(str::to_string)),
            done: Set(0),
            sort_order: Set(now as f64),
            created_at: Set(now),
            updated_at: Set(now),
            deleted_at: Set(None),
        }
        .insert(&txn)
        .await?;
        // A capture that arrives with note text (e.g. from the tray) becomes the
        // task's first rich note.
        if let Some(text) = notes.filter(|s| !s.trim().is_empty()) {
            task_notes::ActiveModel {
                id: Set(new_id()),
                task_id: Set(id.clone()),
                content: Set(plaintext_to_html(text)),
                sort_order: Set(now as f64),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(&txn)
            .await?;
        }
        txn.commit().await?;
        Ok(to_task(task))
    }

    pub async fn list_tasks(&self, list_id: &str) -> Result<Vec<Task>> {
        let models = tasks::Entity::find()
            .filter(tasks::Column::ListId.eq(list_id))
            .filter(tasks::Column::DeletedAt.is_null())
            .order_by_asc(tasks::Column::SortOrder)
            .order_by_asc(tasks::Column::CreatedAt)
            .all(&self.db)
            .await?;
        self.hydrate(models).await
    }

    /// Every live task across all lists (soft-deleted rows are excluded — only
    /// [`Store::list_trashed`] surfaces those).
    pub async fn all_tasks(&self) -> Result<Vec<Task>> {
        let models = tasks::Entity::find()
            .filter(tasks::Column::DeletedAt.is_null())
            .order_by_asc(tasks::Column::SortOrder)
            .order_by_asc(tasks::Column::CreatedAt)
            .all(&self.db)
            .await?;
        self.hydrate(models).await
    }

    pub async fn update_task(
        &self,
        id: &str,
        title: Option<&str>,
        notes: Option<&str>,
        done: Option<bool>,
    ) -> Result<Task> {
        if let Some(model) = tasks::Entity::find_by_id(id.to_string()).one(&self.db).await? {
            let mut active: tasks::ActiveModel = model.into();
            let mut dirty = false;
            if let Some(title) = title {
                active.title = Set(title.to_string());
                dirty = true;
            }
            if let Some(notes) = notes {
                active.notes = Set(Some(notes.to_string()));
                dirty = true;
            }
            if let Some(done) = done {
                active.done = Set(done as i32);
                dirty = true;
            }
            if dirty {
                active.updated_at = Set(now_millis());
                active.update(&self.db).await?;
            }
        }
        self.get_task(id).await
    }

    pub async fn get_task(&self, id: &str) -> Result<Task> {
        let model = tasks::Entity::find_by_id(id.to_string())
            .one(&self.db)
            .await?
            .ok_or_else(|| anyhow::anyhow!("task not found: {id}"))?;
        Ok(self.hydrate(vec![model]).await?.pop().unwrap())
    }

    /// Permanently delete a task and, recursively, every subtask beneath it. The
    /// subtree is removed by the `tasks.parent_id` self-referential
    /// `ON DELETE CASCADE` foreign key. This is the hard path (HTTP API, purge);
    /// the UI deletes softly via [`Store::soft_delete_tasks`].
    pub async fn delete_task(&self, id: &str) -> Result<()> {
        tasks::Entity::delete_by_id(id.to_string())
            .exec(&self.db)
            .await?;
        Ok(())
    }

    /// Soft-delete tasks: stamp `deleted_at` on each given task *and its whole
    /// subtree* (the cascade FK only fires on a hard delete, so descendants are
    /// walked here). Returns every id newly stamped — the exact set an undo /
    /// restore must clear, so already-trashed rows aren't double-counted.
    pub async fn soft_delete_tasks(&self, ids: &[String]) -> Result<Vec<String>> {
        let txn = self.db.begin().await?;
        let now = now_millis();
        let mut queue: Vec<String> = ids.to_vec();
        let mut seen: HashSet<String> = HashSet::new();
        let mut affected: Vec<String> = Vec::new();
        while let Some(id) = queue.pop() {
            if !seen.insert(id.clone()) {
                continue;
            }
            let Some(model) = tasks::Entity::find_by_id(id.clone()).one(&txn).await? else {
                continue;
            };
            for child in tasks::Entity::find()
                .filter(tasks::Column::ParentId.eq(id.clone()))
                .all(&txn)
                .await?
            {
                queue.push(child.id);
            }
            if model.deleted_at.is_none() {
                let mut active: tasks::ActiveModel = model.into();
                active.deleted_at = Set(Some(now));
                active.updated_at = Set(now);
                active.update(&txn).await?;
                affected.push(id);
            }
        }
        txn.commit().await?;
        Ok(affected)
    }

    /// Restore soft-deleted tasks (clear `deleted_at`) — the inverse of
    /// [`Store::soft_delete_tasks`]; pass the exact ids it returned.
    pub async fn restore_tasks(&self, ids: &[String]) -> Result<()> {
        let now = now_millis();
        let txn = self.db.begin().await?;
        for id in ids {
            if let Some(model) = tasks::Entity::find_by_id(id.clone()).one(&txn).await? {
                let mut active: tasks::ActiveModel = model.into();
                active.deleted_at = Set(None);
                active.updated_at = Set(now);
                active.update(&txn).await?;
            }
        }
        txn.commit().await?;
        Ok(())
    }

    /// Permanently remove the given tasks (and their subtrees, via cascade).
    pub async fn purge_tasks(&self, ids: &[String]) -> Result<()> {
        for id in ids {
            tasks::Entity::delete_by_id(id.clone())
                .exec(&self.db)
                .await?;
        }
        Ok(())
    }

    /// Every soft-deleted task, most-recently-trashed first (the Trash view).
    pub async fn list_trashed(&self) -> Result<Vec<Task>> {
        let models = tasks::Entity::find()
            .filter(tasks::Column::DeletedAt.is_not_null())
            .order_by_desc(tasks::Column::DeletedAt)
            .all(&self.db)
            .await?;
        self.hydrate(models).await
    }

    /// Permanently remove everything currently in the Trash.
    pub async fn empty_trash(&self) -> Result<()> {
        tasks::Entity::delete_many()
            .filter(tasks::Column::DeletedAt.is_not_null())
            .exec(&self.db)
            .await?;
        Ok(())
    }

    /// Re-home a task: place it under `parent_id` (`None` = top level) in
    /// `list_id` (`None` = keep current / derive from parent). Descendants
    /// follow across lists.
    pub async fn move_task(
        &self,
        id: &str,
        parent_id: Option<&str>,
        list_id: Option<&str>,
        sort_order: Option<f64>,
    ) -> Result<Task> {
        let txn = self.db.begin().await?;
        let current = tasks::Entity::find_by_id(id.to_string())
            .one(&txn)
            .await?
            .ok_or_else(|| anyhow::anyhow!("task not found: {id}"))?;
        let current_list = current.list_id.clone();

        let target_list = match parent_id {
            Some(parent) => {
                if parent == id {
                    anyhow::bail!("cannot move a task under itself");
                }
                let parent_model = tasks::Entity::find_by_id(parent.to_string())
                    .one(&txn)
                    .await?
                    .ok_or_else(|| anyhow::anyhow!("parent task not found: {parent}"))?;
                let parent_list = parent_model.list_id.clone();
                // Walk the parent chain up from the target parent; reaching `id`
                // means the parent lives inside this task's subtree.
                let mut ancestor = parent_model.parent_id.clone();
                while let Some(above) = ancestor {
                    if above == id {
                        anyhow::bail!("cannot move a task under its own subtask");
                    }
                    ancestor = tasks::Entity::find_by_id(above)
                        .one(&txn)
                        .await?
                        .and_then(|m| m.parent_id);
                }
                parent_list
            }
            None => list_id.map(str::to_string).unwrap_or_else(|| current_list.clone()),
        };

        let now = now_millis();
        let mut active: tasks::ActiveModel = current.into();
        active.parent_id = Set(parent_id.map(str::to_string));
        active.list_id = Set(target_list.clone());
        active.sort_order = Set(sort_order.unwrap_or(now as f64));
        active.updated_at = Set(now);
        active.update(&txn).await?;

        if target_list != current_list {
            relist_task_tree(&txn, id, &target_list, now).await?;
        }
        txn.commit().await?;
        self.get_task(id).await
    }

    pub async fn reorder_task(&self, id: &str, sort_order: f64) -> Result<Task> {
        let res = tasks::Entity::update_many()
            .col_expr(tasks::Column::SortOrder, Expr::value(sort_order))
            .col_expr(tasks::Column::UpdatedAt, Expr::value(now_millis()))
            .filter(tasks::Column::Id.eq(id))
            .exec(&self.db)
            .await?;
        if res.rows_affected == 0 {
            anyhow::bail!("task not found: {id}");
        }
        self.get_task(id).await
    }

    // ---- attachments -----------------------------------------------------

    pub async fn add_attachment(
        &self,
        task_id: &str,
        name: &str,
        link_type: LinkType,
        location: &str,
    ) -> Result<Attachment> {
        let model = attachments::ActiveModel {
            id: Set(new_id()),
            task_id: Set(task_id.to_string()),
            name: Set(name.to_string()),
            link_type: Set(link_type.as_str().to_string()),
            location: Set(location.to_string()),
            created_at: Set(now_millis()),
        }
        .insert(&self.db)
        .await?;
        Ok(to_attachment(model))
    }

    pub async fn list_attachments(&self, task_id: &str) -> Result<Vec<Attachment>> {
        Ok(attachments::Entity::find()
            .filter(attachments::Column::TaskId.eq(task_id))
            .order_by_asc(attachments::Column::CreatedAt)
            .all(&self.db)
            .await?
            .into_iter()
            .map(to_attachment)
            .collect())
    }

    pub async fn get_attachment(&self, id: &str) -> Result<Attachment> {
        let model = attachments::Entity::find_by_id(id.to_string())
            .one(&self.db)
            .await?
            .ok_or_else(|| anyhow::anyhow!("attachment not found: {id}"))?;
        Ok(to_attachment(model))
    }

    /// Update an attachment's display name and stored location (the latter
    /// changes only when a copy's on-disk file is renamed).
    pub async fn update_attachment(
        &self,
        id: &str,
        name: &str,
        location: &str,
    ) -> Result<Attachment> {
        let res = attachments::Entity::update_many()
            .col_expr(attachments::Column::Name, Expr::value(name))
            .col_expr(attachments::Column::Location, Expr::value(location))
            .filter(attachments::Column::Id.eq(id))
            .exec(&self.db)
            .await?;
        if res.rows_affected == 0 {
            anyhow::bail!("attachment not found: {id}");
        }
        self.get_attachment(id).await
    }

    pub async fn delete_attachment(&self, id: &str) -> Result<()> {
        attachments::Entity::delete_by_id(id.to_string())
            .exec(&self.db)
            .await?;
        Ok(())
    }

    // ---- notes -----------------------------------------------------------

    pub async fn list_notes(&self, task_id: &str) -> Result<Vec<Note>> {
        Ok(notes_of(&self.db, task_id)
            .await?
            .into_iter()
            .map(to_note)
            .collect())
    }

    /// Append a rich-text note to a task (`content` is sanitized HTML from the
    /// caller). Refreshes the task's derived plaintext.
    pub async fn create_note(&self, task_id: &str, content: &str) -> Result<Note> {
        let now = now_millis();
        let txn = self.db.begin().await?;
        let model = task_notes::ActiveModel {
            id: Set(new_id()),
            task_id: Set(task_id.to_string()),
            content: Set(content.to_string()),
            sort_order: Set(now as f64),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&txn)
        .await?;
        recompute_task_notes(&txn, task_id).await?;
        txn.commit().await?;
        Ok(to_note(model))
    }

    pub async fn update_note(&self, id: &str, content: &str) -> Result<Note> {
        let txn = self.db.begin().await?;
        let model = task_notes::Entity::find_by_id(id.to_string())
            .one(&txn)
            .await?
            .ok_or_else(|| anyhow::anyhow!("note not found: {id}"))?;
        let task_id = model.task_id.clone();
        let mut active: task_notes::ActiveModel = model.into();
        active.content = Set(content.to_string());
        active.updated_at = Set(now_millis());
        let model = active.update(&txn).await?;
        recompute_task_notes(&txn, &task_id).await?;
        txn.commit().await?;
        Ok(to_note(model))
    }

    pub async fn delete_note(&self, id: &str) -> Result<()> {
        let txn = self.db.begin().await?;
        let task_id = task_notes::Entity::find_by_id(id.to_string())
            .one(&txn)
            .await?
            .map(|m| m.task_id);
        task_notes::Entity::delete_by_id(id.to_string())
            .exec(&txn)
            .await?;
        if let Some(task_id) = task_id {
            recompute_task_notes(&txn, &task_id).await?;
        }
        txn.commit().await?;
        Ok(())
    }

    /// Populate the `attachments` and `note_items` fields of each task with two
    /// batched queries (one for all attachments, one for all notes) rather than
    /// a query per task.
    async fn hydrate(&self, models: Vec<tasks::Model>) -> Result<Vec<Task>> {
        let attachments = models
            .load_many(
                attachments::Entity::find().order_by_asc(attachments::Column::CreatedAt),
                &self.db,
            )
            .await?;
        let notes = models
            .load_many(
                task_notes::Entity::find()
                    .order_by_asc(task_notes::Column::SortOrder)
                    .order_by_asc(task_notes::Column::CreatedAt),
                &self.db,
            )
            .await?;
        let mut out = Vec::with_capacity(models.len());
        for ((task, atts), nts) in models.into_iter().zip(attachments).zip(notes) {
            let mut task = to_task(task);
            task.attachments = atts.into_iter().map(to_attachment).collect();
            task.note_items = nts.into_iter().map(to_note).collect();
            out.push(task);
        }
        Ok(out)
    }
}

/// Build a SeaORM connection over an SQLx SQLite pool whose every connection
/// has WAL journaling, a 5s busy timeout, and foreign keys enabled — the last
/// is required for the schema's `ON DELETE CASCADE` rules to fire.
async fn connect(path: &Path) -> Result<DatabaseConnection> {
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;
    Ok(SqlxSqliteConnector::from_sqlx_sqlite_pool(pool))
}

// ---- entity → domain mapping ---------------------------------------------
//
// Domain models are the JSON/wire contract the frontend depends on; SeaORM
// entities never cross that boundary (see `.plans/orm-migration.md` §7).

fn to_project(m: projects::Model) -> Project {
    Project {
        id: m.id,
        name: m.name,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

fn to_list(m: lists::Model) -> List {
    List {
        id: m.id,
        project_id: m.project_id,
        name: m.name,
        sort_order: m.sort_order,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

fn to_task(m: tasks::Model) -> Task {
    Task {
        id: m.id,
        list_id: m.list_id,
        parent_id: m.parent_id,
        title: m.title,
        notes: m.notes,
        done: m.done != 0,
        sort_order: m.sort_order,
        created_at: m.created_at,
        updated_at: m.updated_at,
        deleted_at: m.deleted_at,
        attachments: Vec::new(),
        note_items: Vec::new(),
    }
}

fn to_note(m: task_notes::Model) -> Note {
    Note {
        id: m.id,
        task_id: m.task_id,
        content: m.content,
        sort_order: m.sort_order,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

fn to_attachment(m: attachments::Model) -> Attachment {
    Attachment {
        id: m.id,
        task_id: m.task_id,
        name: m.name,
        link_type: LinkType::from_db(&m.link_type),
        location: m.location,
        created_at: m.created_at,
    }
}

// ---- shared query helpers (work over a connection or a transaction) -------

async fn notes_of<C: ConnectionTrait>(db: &C, task_id: &str) -> Result<Vec<task_notes::Model>> {
    Ok(task_notes::Entity::find()
        .filter(task_notes::Column::TaskId.eq(task_id))
        .order_by_asc(task_notes::Column::SortOrder)
        .order_by_asc(task_notes::Column::CreatedAt)
        .all(db)
        .await?)
}

/// Rebuild a task's `notes` column (its list-row preview + search text) from the
/// plaintext of all its note blocks.
async fn recompute_task_notes<C: ConnectionTrait>(db: &C, task_id: &str) -> Result<()> {
    let plain = notes_of(db, task_id)
        .await?
        .iter()
        .map(|n| strip_html(&n.content))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("  ·  ");
    let value: Option<String> = if plain.trim().is_empty() {
        None
    } else {
        Some(plain)
    };
    tasks::Entity::update_many()
        .col_expr(tasks::Column::Notes, Expr::value(value))
        .col_expr(tasks::Column::UpdatedAt, Expr::value(now_millis()))
        .filter(tasks::Column::Id.eq(task_id))
        .exec(db)
        .await?;
    Ok(())
}

/// Move every descendant subtask into `list_id`, mirroring the subtree so a
/// task's children always live in its list. Iterative to avoid boxed async
/// recursion.
async fn relist_task_tree<C: ConnectionTrait>(
    db: &C,
    root: &str,
    list_id: &str,
    now: i64,
) -> Result<()> {
    let mut queue = vec![root.to_string()];
    while let Some(parent) = queue.pop() {
        let children = tasks::Entity::find()
            .filter(tasks::Column::ParentId.eq(parent))
            .all(db)
            .await?;
        for child in children {
            let child_id = child.id.clone();
            let mut active: tasks::ActiveModel = child.into();
            active.list_id = Set(list_id.to_string());
            active.updated_at = Set(now);
            active.update(db).await?;
            queue.push(child_id);
        }
    }
    Ok(())
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Wrap a legacy plaintext note into a minimal HTML paragraph.
fn plaintext_to_html(s: &str) -> String {
    format!("<p>{}</p>", escape_html(s).replace('\n', "<br>"))
}

/// Crude tag-strip for deriving searchable plaintext from note HTML. Every tag
/// boundary becomes whitespace so adjacent blocks don't run together.
/// Reduce sanitized note HTML to a single line of plaintext (tags dropped,
/// entities decoded, whitespace collapsed). Used for the derived `notes`
/// preview and by the "copy tasks" markdown export.
pub fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempStore {
        store: Store,
        dir: std::path::PathBuf,
    }

    impl std::ops::Deref for TempStore {
        type Target = Store;
        fn deref(&self) -> &Store {
            &self.store
        }
    }

    impl Drop for TempStore {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// A store backed by a throwaway on-disk SQLite DB (WAL needs a real file),
    /// built through the runtime migration applier — the same path `open` takes.
    async fn temp_store() -> TempStore {
        let dir = std::env::temp_dir().join(format!("taskscape-test-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open_at(&dir.join("test.db")).await.unwrap();
        TempStore { store, dir }
    }

    #[tokio::test]
    async fn migrations_build_a_working_schema_and_are_idempotent() {
        let dir = std::env::temp_dir().join(format!("taskscape-test-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");

        // Opening twice re-runs the applier against an already-migrated DB.
        let first = Store::open_at(&path).await.unwrap();
        let project = first.create_project("Work").await.unwrap();
        drop(first);
        let second = Store::open_at(&path).await.unwrap();

        // The clean baseline (no IF NOT EXISTS) must not re-run, and the row
        // written by the first open must survive.
        let projects = second.list_projects().await.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, project.id);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn deleting_a_project_cascades_to_lists_tasks_notes_attachments() {
        let store = temp_store().await;
        let project = store.create_project("P").await.unwrap();
        let list = store.create_list(&project.id, "L").await.unwrap();
        let task = store
            .create_task(&list.id, "T", Some("hi"), None)
            .await
            .unwrap();
        store
            .add_attachment(&task.id, "a", LinkType::Reference, "http://x")
            .await
            .unwrap();
        store.create_note(&task.id, "<p>note</p>").await.unwrap();

        store.delete_project(&project.id).await.unwrap();

        // Everything under the project is gone via DB `ON DELETE CASCADE`.
        assert!(store.list_projects().await.unwrap().is_empty());
        assert!(store.list_lists().await.unwrap().is_empty());
        assert!(store.all_tasks().await.unwrap().is_empty());
        assert!(store.list_attachments(&task.id).await.unwrap().is_empty());
        assert!(store.list_notes(&task.id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn deleting_a_task_cascades_to_its_subtree() {
        let store = temp_store().await;
        let project = store.create_project("P").await.unwrap();
        let list = store.create_list(&project.id, "L").await.unwrap();
        let parent = store.create_task(&list.id, "parent", None, None).await.unwrap();
        let child = store
            .create_task(&list.id, "child", None, Some(&parent.id))
            .await
            .unwrap();
        store
            .create_task(&list.id, "grandchild", None, Some(&child.id))
            .await
            .unwrap();

        // Deleting the root removes the whole subtree via the self-ref FK.
        store.delete_task(&parent.id).await.unwrap();
        assert!(store.all_tasks().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn soft_delete_moves_the_subtree_to_trash_and_restores_it() {
        let store = temp_store().await;
        let project = store.create_project("P").await.unwrap();
        let list = store.create_list(&project.id, "L").await.unwrap();
        let parent = store.create_task(&list.id, "parent", None, None).await.unwrap();
        let child = store
            .create_task(&list.id, "child", None, Some(&parent.id))
            .await
            .unwrap();
        let other = store.create_task(&list.id, "other", None, None).await.unwrap();

        // Soft-deleting the root stamps the whole subtree and returns exactly the
        // ids it flagged (parent + child), not the untouched sibling.
        let affected = store.soft_delete_tasks(&[parent.id.clone()]).await.unwrap();
        assert_eq!(affected.len(), 2);
        assert!(affected.contains(&parent.id) && affected.contains(&child.id));

        // Live reads hide the trashed subtree; the Trash surfaces it.
        let live: Vec<_> = store.all_tasks().await.unwrap();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].id, other.id);
        assert_eq!(store.list_trashed().await.unwrap().len(), 2);

        // Re-deleting the sibling and then restoring only the first set leaves the
        // sibling trashed — restore clears exactly the ids handed back.
        store.soft_delete_tasks(&[other.id.clone()]).await.unwrap();
        store.restore_tasks(&affected).await.unwrap();
        let restored = store.all_tasks().await.unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(store.list_trashed().await.unwrap().len(), 1);

        // Purging empties the Trash permanently.
        store.empty_trash().await.unwrap();
        assert!(store.list_trashed().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn moving_a_task_across_lists_relists_its_subtree() {
        let store = temp_store().await;
        let project = store.create_project("P").await.unwrap();
        let l1 = store.create_list(&project.id, "L1").await.unwrap();
        let l2 = store.create_list(&project.id, "L2").await.unwrap();
        let parent = store.create_task(&l1.id, "parent", None, None).await.unwrap();
        let child = store
            .create_task(&l1.id, "child", None, Some(&parent.id))
            .await
            .unwrap();

        store
            .move_task(&parent.id, None, Some(&l2.id), None)
            .await
            .unwrap();

        // The child follows its parent into the new list.
        let moved_child = store.get_task(&child.id).await.unwrap();
        assert_eq!(moved_child.list_id, l2.id);
    }

    #[tokio::test]
    async fn moving_a_task_under_its_own_descendant_is_rejected() {
        let store = temp_store().await;
        let project = store.create_project("P").await.unwrap();
        let list = store.create_list(&project.id, "L").await.unwrap();
        let parent = store.create_task(&list.id, "parent", None, None).await.unwrap();
        let child = store
            .create_task(&list.id, "child", None, Some(&parent.id))
            .await
            .unwrap();

        assert!(store
            .move_task(&parent.id, Some(&child.id), None, None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn notes_recompute_the_task_plaintext_preview() {
        let store = temp_store().await;
        let project = store.create_project("P").await.unwrap();
        let list = store.create_list(&project.id, "L").await.unwrap();
        let task = store.create_task(&list.id, "T", None, None).await.unwrap();

        store
            .create_note(&task.id, "<p>Hello <b>world</b></p>")
            .await
            .unwrap();
        let refreshed = store.get_task(&task.id).await.unwrap();
        assert_eq!(refreshed.notes.as_deref(), Some("Hello world"));
        assert_eq!(refreshed.note_items.len(), 1);
    }
}
