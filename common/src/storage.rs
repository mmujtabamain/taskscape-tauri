use std::sync::Mutex;
use std::time::Duration;

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::{Attachment, LinkType, List, Note, Project, Task};
use crate::util::{new_id, now_millis};

/// A handle to the Taskscape SQLite database.
///
/// Each process keeps its own connection to the shared `~/.taskscape/taskscape.db`
/// file. WAL journaling plus a busy timeout let the main app and the tray app
/// read and write the same database concurrently.
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Open (creating if needed) the shared database and run migrations.
    pub fn open() -> Result<Self> {
        crate::paths::ensure_dirs()?;
        let conn = Connection::open(crate::paths::db_path())?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;",
        )?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS projects (
                 id         TEXT PRIMARY KEY,
                 name       TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS lists (
                 id         TEXT PRIMARY KEY,
                 project_id TEXT,
                 name       TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS tasks (
                 id         TEXT PRIMARY KEY,
                 list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
                 parent_id  TEXT,
                 title      TEXT NOT NULL,
                 notes      TEXT,
                 done       INTEGER NOT NULL DEFAULT 0,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS attachments (
                 id         TEXT PRIMARY KEY,
                 task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                 name       TEXT NOT NULL,
                 link_type  TEXT NOT NULL,
                 location   TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS task_notes (
                 id         TEXT PRIMARY KEY,
                 task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                 content    TEXT NOT NULL,
                 sort_order REAL NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS settings (
                 key   TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);
             CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
             CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id);",
        )?;
        // Bring older databases up to date. `ensure_column` is a no-op when the
        // column already exists, so this runs safely on every open.
        ensure_column(&conn, "lists", "project_id", "TEXT")?;
        ensure_column(&conn, "lists", "sort_order", "REAL")?;
        ensure_column(&conn, "tasks", "parent_id", "TEXT")?;
        ensure_column(&conn, "tasks", "sort_order", "REAL")?;
        // Seed manual ordering from creation time so pre-migration rows keep
        // their chronological order.
        conn.execute(
            "UPDATE tasks SET sort_order = created_at WHERE sort_order IS NULL",
            [],
        )?;
        conn.execute(
            "UPDATE lists SET sort_order = created_at WHERE sort_order IS NULL",
            [],
        )?;
        // Indexes on the migrated columns — created after `ensure_column` so the
        // column is guaranteed to exist on databases that predate it.
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_lists_project ON lists(project_id);
             CREATE INDEX IF NOT EXISTS idx_tasks_parent  ON tasks(parent_id);",
        )?;
        // Adopt any project-less lists (pre-projects databases) into a default project.
        backfill_default_project(&conn)?;
        // Wrap each task's legacy single note into an initial rich note block.
        backfill_task_notes(&conn)?;
        Ok(())
    }

    // ---- settings (shared key/value, e.g. the last active list) -----------

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let value = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(value)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )?;
        Ok(())
    }

    // ---- projects --------------------------------------------------------

    pub fn create_project(&self, name: &str) -> Result<Project> {
        let now = now_millis();
        let project = Project {
            id: new_id(),
            name: name.to_string(),
            created_at: now,
            updated_at: now,
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![project.id, project.name, project.created_at, project.updated_at],
        )?;
        Ok(project)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, updated_at FROM projects ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], row_to_project)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn rename_project(&self, id: &str, name: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE projects SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, name, now_millis()],
        )?;
        Ok(())
    }

    /// Delete a project and everything under it. Its lists are removed first so
    /// their tasks (and attachments) cascade via the existing foreign keys.
    pub fn delete_project(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM lists WHERE project_id = ?1", params![id])?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// The project new lists/captures fall into when none is specified: the
    /// oldest existing project, created on demand if the database has none.
    pub fn default_project(&self) -> Result<Project> {
        {
            let conn = self.conn.lock().unwrap();
            let existing = conn
                .query_row(
                    "SELECT id, name, created_at, updated_at FROM projects
                     ORDER BY created_at ASC LIMIT 1",
                    [],
                    row_to_project,
                )
                .optional()?;
            if let Some(project) = existing {
                return Ok(project);
            }
        }
        self.create_project(&crate::names::suggest_name())
    }

    // ---- lists -----------------------------------------------------------

    pub fn create_list(&self, project_id: &str, name: &str) -> Result<List> {
        let now = now_millis();
        let list = List {
            id: new_id(),
            project_id: project_id.to_string(),
            name: name.to_string(),
            // New lists land after existing tabs (they keep their created_at
            // seed), so a fresh list appears last.
            sort_order: now as f64,
            created_at: now,
            updated_at: now,
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO lists (id, project_id, name, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                list.id,
                list.project_id,
                list.name,
                list.sort_order,
                list.created_at,
                list.updated_at
            ],
        )?;
        Ok(list)
    }

    pub fn list_lists(&self) -> Result<Vec<List>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, name, sort_order, created_at, updated_at
             FROM lists ORDER BY COALESCE(sort_order, created_at) ASC, created_at ASC",
        )?;
        let rows = stmt.query_map([], row_to_list)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Move a list to a new manual position among its sibling tabs.
    pub fn reorder_list(&self, id: &str, sort_order: f64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let updated = conn.execute(
            "UPDATE lists SET sort_order = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, sort_order, now_millis()],
        )?;
        if updated == 0 {
            anyhow::bail!("list not found: {id}");
        }
        Ok(())
    }

    pub fn rename_list(&self, id: &str, name: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE lists SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, name, now_millis()],
        )?;
        Ok(())
    }

    pub fn delete_list(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM lists WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ---- tasks -----------------------------------------------------------

    pub fn create_task(
        &self,
        list_id: &str,
        title: &str,
        notes: Option<&str>,
        parent_id: Option<&str>,
    ) -> Result<Task> {
        let now = now_millis();
        let task = Task {
            id: new_id(),
            list_id: list_id.to_string(),
            title: title.to_string(),
            notes: notes.map(|s| s.to_string()),
            done: false,
            sort_order: now as f64,
            created_at: now,
            updated_at: now,
            parent_id: parent_id.map(|s| s.to_string()),
            attachments: Vec::new(),
            note_items: Vec::new(),
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, list_id, parent_id, title, notes, done, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                task.id,
                task.list_id,
                task.parent_id,
                task.title,
                task.notes,
                task.done as i64,
                task.sort_order,
                task.created_at,
                task.updated_at
            ],
        )?;
        // A capture that arrives with note text (e.g. from the tray) becomes the
        // task's first rich note.
        if let Some(text) = notes.filter(|s| !s.trim().is_empty()) {
            conn.execute(
                "INSERT INTO task_notes (id, task_id, content, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![new_id(), task.id, plaintext_to_html(text), now as f64, now, now],
            )?;
        }
        Ok(task)
    }

    pub fn list_tasks(&self, list_id: &str) -> Result<Vec<Task>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, list_id, parent_id, title, notes, done, sort_order, created_at, updated_at
             FROM tasks WHERE list_id = ?1
             ORDER BY COALESCE(sort_order, created_at) ASC, created_at ASC",
        )?;
        let tasks = stmt
            .query_map(params![list_id], row_to_task)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        drop(conn);
        self.attach_all(tasks)
    }

    pub fn all_tasks(&self) -> Result<Vec<Task>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, list_id, parent_id, title, notes, done, sort_order, created_at, updated_at
             FROM tasks ORDER BY COALESCE(sort_order, created_at) ASC, created_at ASC",
        )?;
        let tasks = stmt
            .query_map([], row_to_task)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        drop(conn);
        self.attach_all(tasks)
    }

    pub fn update_task(
        &self,
        id: &str,
        title: Option<&str>,
        notes: Option<&str>,
        done: Option<bool>,
    ) -> Result<Task> {
        {
            let conn = self.conn.lock().unwrap();
            if let Some(title) = title {
                conn.execute(
                    "UPDATE tasks SET title = ?2, updated_at = ?3 WHERE id = ?1",
                    params![id, title, now_millis()],
                )?;
            }
            if let Some(notes) = notes {
                conn.execute(
                    "UPDATE tasks SET notes = ?2, updated_at = ?3 WHERE id = ?1",
                    params![id, notes, now_millis()],
                )?;
            }
            if let Some(done) = done {
                conn.execute(
                    "UPDATE tasks SET done = ?2, updated_at = ?3 WHERE id = ?1",
                    params![id, done as i64, now_millis()],
                )?;
            }
        }
        self.get_task(id)
    }

    pub fn get_task(&self, id: &str) -> Result<Task> {
        let conn = self.conn.lock().unwrap();
        let task = conn.query_row(
            "SELECT id, list_id, parent_id, title, notes, done, sort_order, created_at, updated_at
             FROM tasks WHERE id = ?1",
            params![id],
            row_to_task,
        )?;
        drop(conn);
        Ok(self.attach_all(vec![task])?.pop().unwrap())
    }

    /// Delete a task and, recursively, every subtask beneath it. Subtask
    /// cascade is done in code rather than via a self-referential foreign key so
    /// the `parent_id` column can be added to older databases with a plain
    /// `ALTER TABLE`.
    pub fn delete_task(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        delete_task_tree(&conn, id)?;
        Ok(())
    }

    /// Re-home a task: place it under `parent_id` (`None` = top level) in
    /// `list_id` (`None` = keep current / derive from parent). Descendants
    /// follow across lists.
    pub fn move_task(
        &self,
        id: &str,
        parent_id: Option<&str>,
        list_id: Option<&str>,
        sort_order: Option<f64>,
    ) -> Result<Task> {
        {
            let conn = self.conn.lock().unwrap();
            let current_list: String = conn
                .query_row(
                    "SELECT list_id FROM tasks WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?
                .ok_or_else(|| anyhow::anyhow!("task not found: {id}"))?;

            let target_list = match parent_id {
                Some(parent) => {
                    if parent == id {
                        anyhow::bail!("cannot move a task under itself");
                    }
                    let (parent_list, mut ancestor): (String, Option<String>) = conn
                        .query_row(
                            "SELECT list_id, parent_id FROM tasks WHERE id = ?1",
                            params![parent],
                            |r| Ok((r.get(0)?, r.get(1)?)),
                        )
                        .optional()?
                        .ok_or_else(|| anyhow::anyhow!("parent task not found: {parent}"))?;
                    // Walk the parent chain up from the target parent; reaching
                    // `id` means the parent lives inside this task's subtree.
                    while let Some(above) = ancestor {
                        if above == id {
                            anyhow::bail!("cannot move a task under its own subtask");
                        }
                        ancestor = conn
                            .query_row(
                                "SELECT parent_id FROM tasks WHERE id = ?1",
                                params![above],
                                |r| r.get(0),
                            )
                            .optional()?
                            .flatten();
                    }
                    parent_list
                }
                None => list_id.map(str::to_string).unwrap_or(current_list.clone()),
            };

            let now = now_millis();
            conn.execute(
                "UPDATE tasks SET parent_id = ?2, list_id = ?3, sort_order = ?4, updated_at = ?5
                 WHERE id = ?1",
                params![
                    id,
                    parent_id,
                    target_list,
                    sort_order.unwrap_or(now as f64),
                    now
                ],
            )?;
            if target_list != current_list {
                relist_task_tree(&conn, id, &target_list, now)?;
            }
        }
        self.get_task(id)
    }

    pub fn reorder_task(&self, id: &str, sort_order: f64) -> Result<Task> {
        {
            let conn = self.conn.lock().unwrap();
            let updated = conn.execute(
                "UPDATE tasks SET sort_order = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, sort_order, now_millis()],
            )?;
            if updated == 0 {
                anyhow::bail!("task not found: {id}");
            }
        }
        self.get_task(id)
    }

    // ---- attachments -----------------------------------------------------

    pub fn add_attachment(
        &self,
        task_id: &str,
        name: &str,
        link_type: LinkType,
        location: &str,
    ) -> Result<Attachment> {
        let attachment = Attachment {
            id: new_id(),
            task_id: task_id.to_string(),
            name: name.to_string(),
            link_type,
            location: location.to_string(),
            created_at: now_millis(),
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (id, task_id, name, link_type, location, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                attachment.id,
                attachment.task_id,
                attachment.name,
                attachment.link_type.as_str(),
                attachment.location,
                attachment.created_at
            ],
        )?;
        Ok(attachment)
    }

    pub fn list_attachments(&self, task_id: &str) -> Result<Vec<Attachment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, name, link_type, location, created_at
             FROM attachments WHERE task_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![task_id], row_to_attachment)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_attachment(&self, id: &str) -> Result<Attachment> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT id, task_id, name, link_type, location, created_at
             FROM attachments WHERE id = ?1",
            params![id],
            row_to_attachment,
        )?)
    }

    /// Update an attachment's display name and stored location (the latter
    /// changes only when a copy's on-disk file is renamed).
    pub fn update_attachment(&self, id: &str, name: &str, location: &str) -> Result<Attachment> {
        {
            let conn = self.conn.lock().unwrap();
            let updated = conn.execute(
                "UPDATE attachments SET name = ?2, location = ?3 WHERE id = ?1",
                params![id, name, location],
            )?;
            if updated == 0 {
                anyhow::bail!("attachment not found: {id}");
            }
        }
        self.get_attachment(id)
    }

    pub fn delete_attachment(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ---- notes -----------------------------------------------------------

    pub fn list_notes(&self, task_id: &str) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        list_notes_conn(&conn, task_id)
    }

    /// Append a rich-text note to a task (`content` is sanitized HTML from the
    /// caller). Refreshes the task's derived plaintext.
    pub fn create_note(&self, task_id: &str, content: &str) -> Result<Note> {
        let now = now_millis();
        let note = Note {
            id: new_id(),
            task_id: task_id.to_string(),
            content: content.to_string(),
            sort_order: now as f64,
            created_at: now,
            updated_at: now,
        };
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO task_notes (id, task_id, content, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![note.id, note.task_id, note.content, note.sort_order, note.created_at, note.updated_at],
            )?;
            recompute_task_notes(&conn, task_id)?;
        }
        Ok(note)
    }

    pub fn update_note(&self, id: &str, content: &str) -> Result<Note> {
        {
            let conn = self.conn.lock().unwrap();
            let task_id: String = conn
                .query_row("SELECT task_id FROM task_notes WHERE id = ?1", params![id], |r| r.get(0))
                .optional()?
                .ok_or_else(|| anyhow::anyhow!("note not found: {id}"))?;
            conn.execute(
                "UPDATE task_notes SET content = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, content, now_millis()],
            )?;
            recompute_task_notes(&conn, &task_id)?;
        }
        self.get_note(id)
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let task_id: Option<String> = conn
            .query_row("SELECT task_id FROM task_notes WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?;
        conn.execute("DELETE FROM task_notes WHERE id = ?1", params![id])?;
        if let Some(task_id) = task_id {
            recompute_task_notes(&conn, &task_id)?;
        }
        Ok(())
    }

    fn get_note(&self, id: &str) -> Result<Note> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT id, task_id, content, sort_order, created_at, updated_at
             FROM task_notes WHERE id = ?1",
            params![id],
            row_to_note,
        )?)
    }

    /// Populate the `attachments` and `note_items` fields of each task.
    fn attach_all(&self, mut tasks: Vec<Task>) -> Result<Vec<Task>> {
        for task in &mut tasks {
            task.attachments = self.list_attachments(&task.id)?;
            task.note_items = self.list_notes(&task.id)?;
        }
        Ok(tasks)
    }
}

fn row_to_project(row: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_list(row: &Row) -> rusqlite::Result<List> {
    let created_at: i64 = row.get("created_at")?;
    Ok(List {
        id: row.get("id")?,
        project_id: row.get::<_, Option<String>>("project_id")?.unwrap_or_default(),
        name: row.get("name")?,
        sort_order: row
            .get::<_, Option<f64>>("sort_order")?
            .unwrap_or(created_at as f64),
        created_at,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    let created_at: i64 = row.get("created_at")?;
    Ok(Task {
        id: row.get("id")?,
        list_id: row.get("list_id")?,
        parent_id: row.get("parent_id")?,
        title: row.get("title")?,
        notes: row.get("notes")?,
        done: row.get::<_, i64>("done")? != 0,
        sort_order: row
            .get::<_, Option<f64>>("sort_order")?
            .unwrap_or(created_at as f64),
        created_at,
        updated_at: row.get("updated_at")?,
        attachments: Vec::new(),
        note_items: Vec::new(),
    })
}

fn row_to_note(row: &Row) -> rusqlite::Result<Note> {
    let created_at: i64 = row.get("created_at")?;
    Ok(Note {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        content: row.get("content")?,
        sort_order: row
            .get::<_, Option<f64>>("sort_order")?
            .unwrap_or(created_at as f64),
        created_at,
        updated_at: row.get("updated_at")?,
    })
}

fn list_notes_conn(conn: &Connection, task_id: &str) -> Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, content, sort_order, created_at, updated_at
         FROM task_notes WHERE task_id = ?1
         ORDER BY COALESCE(sort_order, created_at) ASC, created_at ASC",
    )?;
    let rows = stmt.query_map(params![task_id], row_to_note)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Rebuild a task's `notes` column (its list-row preview + search text) from the
/// plaintext of all its note blocks.
fn recompute_task_notes(conn: &Connection, task_id: &str) -> Result<()> {
    let notes = list_notes_conn(conn, task_id)?;
    let plain = notes
        .iter()
        .map(|n| strip_html(&n.content))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("  ·  ");
    let value: Option<String> = if plain.trim().is_empty() { None } else { Some(plain) };
    conn.execute(
        "UPDATE tasks SET notes = ?2, updated_at = ?3 WHERE id = ?1",
        params![task_id, value, now_millis()],
    )?;
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
fn strip_html(html: &str) -> String {
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

/// One-time: wrap each task's pre-existing plaintext note into an initial rich
/// note block. Guarded by a settings flag so it runs only once.
fn backfill_task_notes(conn: &Connection) -> Result<()> {
    let done: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'task_notes_backfilled'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if done.is_some() {
        return Ok(());
    }
    let rows: Vec<(String, String, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT id, notes, created_at FROM tasks
             WHERE notes IS NOT NULL AND TRIM(notes) != ''
               AND id NOT IN (SELECT task_id FROM task_notes)",
        )?;
        let collected = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        collected
    };
    let now = now_millis();
    for (task_id, notes, created) in rows {
        conn.execute(
            "INSERT INTO task_notes (id, task_id, content, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id(), task_id, plaintext_to_html(&notes), created as f64, created, now],
        )?;
    }
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('task_notes_backfilled', '1')",
        [],
    )?;
    Ok(())
}

/// Depth-first delete of a task and all of its descendant subtasks.
fn delete_task_tree(conn: &Connection, id: &str) -> Result<()> {
    let children: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM tasks WHERE parent_id = ?1")?;
        let ids = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids
    };
    for child in children {
        delete_task_tree(conn, &child)?;
    }
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

/// Depth-first move of every descendant subtask into `list_id`, mirroring
/// [`delete_task_tree`]: a task's subtree always lives in its list.
fn relist_task_tree(conn: &Connection, id: &str, list_id: &str, now: i64) -> Result<()> {
    let children: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM tasks WHERE parent_id = ?1")?;
        let ids = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids
    };
    for child in children {
        conn.execute(
            "UPDATE tasks SET list_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![child, list_id, now],
        )?;
        relist_task_tree(conn, &child, list_id, now)?;
    }
    Ok(())
}

/// Assign any project-less lists (created before projects existed) to a default
/// project, creating that project only if some orphan list needs one.
fn backfill_default_project(conn: &Connection) -> Result<()> {
    let orphans: i64 =
        conn.query_row("SELECT COUNT(*) FROM lists WHERE project_id IS NULL", [], |r| {
            r.get(0)
        })?;
    if orphans == 0 {
        return Ok(());
    }
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM projects ORDER BY created_at ASC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let project_id = match existing {
        Some(id) => id,
        None => {
            let now = now_millis();
            let id = new_id();
            conn.execute(
                "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params![id, crate::names::suggest_name(), now, now],
            )?;
            id
        }
    };
    conn.execute(
        "UPDATE lists SET project_id = ?1 WHERE project_id IS NULL",
        params![project_id],
    )?;
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let has_column = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<String>>>()?
        .iter()
        .any(|name| name == column);
    if !has_column {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])?;
    }
    Ok(())
}

fn row_to_attachment(row: &Row) -> rusqlite::Result<Attachment> {
    let link_type: String = row.get("link_type")?;
    Ok(Attachment {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        name: row.get("name")?,
        link_type: LinkType::from_db(&link_type),
        location: row.get("location")?,
        created_at: row.get("created_at")?,
    })
}
