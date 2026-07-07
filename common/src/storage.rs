use std::sync::Mutex;
use std::time::Duration;

use anyhow::Result;
use rusqlite::{params, Connection, Row};

use crate::models::{Attachment, LinkType, List, Task};
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
            "CREATE TABLE IF NOT EXISTS lists (
                 id         TEXT PRIMARY KEY,
                 name       TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS tasks (
                 id         TEXT PRIMARY KEY,
                 list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
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
             CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);
             CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);",
        )?;
        Ok(())
    }

    // ---- lists -----------------------------------------------------------

    pub fn create_list(&self, name: &str) -> Result<List> {
        let now = now_millis();
        let list = List {
            id: new_id(),
            name: name.to_string(),
            created_at: now,
            updated_at: now,
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO lists (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![list.id, list.name, list.created_at, list.updated_at],
        )?;
        Ok(list)
    }

    pub fn list_lists(&self) -> Result<Vec<List>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, updated_at FROM lists ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], row_to_list)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
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

    pub fn create_task(&self, list_id: &str, title: &str, notes: Option<&str>) -> Result<Task> {
        let now = now_millis();
        let task = Task {
            id: new_id(),
            list_id: list_id.to_string(),
            title: title.to_string(),
            notes: notes.map(|s| s.to_string()),
            done: false,
            created_at: now,
            updated_at: now,
            attachments: Vec::new(),
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, list_id, title, notes, done, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                task.id,
                task.list_id,
                task.title,
                task.notes,
                task.done as i64,
                task.created_at,
                task.updated_at
            ],
        )?;
        Ok(task)
    }

    pub fn list_tasks(&self, list_id: &str) -> Result<Vec<Task>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, list_id, title, notes, done, created_at, updated_at
             FROM tasks WHERE list_id = ?1 ORDER BY created_at ASC",
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
            "SELECT id, list_id, title, notes, done, created_at, updated_at
             FROM tasks ORDER BY created_at ASC",
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
            "SELECT id, list_id, title, notes, done, created_at, updated_at
             FROM tasks WHERE id = ?1",
            params![id],
            row_to_task,
        )?;
        drop(conn);
        Ok(self.attach_all(vec![task])?.pop().unwrap())
    }

    pub fn delete_task(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
        Ok(())
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

    pub fn delete_attachment(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Populate the `attachments` field of each task.
    fn attach_all(&self, mut tasks: Vec<Task>) -> Result<Vec<Task>> {
        for task in &mut tasks {
            task.attachments = self.list_attachments(&task.id)?;
        }
        Ok(tasks)
    }
}

fn row_to_list(row: &Row) -> rusqlite::Result<List> {
    Ok(List {
        id: row.get("id")?,
        name: row.get("name")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get("id")?,
        list_id: row.get("list_id")?,
        title: row.get("title")?,
        notes: row.get("notes")?,
        done: row.get::<_, i64>("done")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        attachments: Vec::new(),
    })
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
