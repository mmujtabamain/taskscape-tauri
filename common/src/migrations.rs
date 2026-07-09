//! Runtime migration applier.
//!
//! Atlas (a dev-time tool) authors the versioned SQL in `common/migrations/`;
//! this module embeds those files and, at startup, applies any version not yet
//! recorded in `schema_migrations`. The Atlas binary is never shipped — the app
//! only replays the SQL Atlas produced.
//!
//! See `.plans/orm-migration.md` §8.

use std::collections::HashSet;

use anyhow::{Context, Result};
use include_dir::{include_dir, Dir};
use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};

use crate::util::now_millis;

/// The migration SQL, embedded at compile time. `atlas.sum` (the checksum file)
/// rides along but is skipped — only `*.sql` files are versions.
static MIGRATIONS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/migrations");

/// Apply every embedded migration not already recorded, in filename order.
/// Atlas prefixes files with a sortable UTC timestamp, so lexical order is
/// application order. Each migration runs in its own transaction with its
/// version recorded atomically alongside it.
pub async fn apply<C: ConnectionTrait + TransactionTrait>(db: &C) -> Result<()> {
    db.execute_unprepared(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
             version    TEXT PRIMARY KEY,
             applied_at INTEGER NOT NULL
         )",
    )
    .await?;

    let applied: HashSet<String> = db
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT version FROM schema_migrations",
        ))
        .await?
        .into_iter()
        .filter_map(|row| row.try_get::<String>("", "version").ok())
        .collect();

    let mut files: Vec<_> = MIGRATIONS
        .files()
        .filter(|f| f.path().extension().and_then(|e| e.to_str()) == Some("sql"))
        .collect();
    files.sort_by_key(|f| f.path().to_path_buf());

    for file in files {
        let version = file
            .path()
            .file_stem()
            .and_then(|s| s.to_str())
            .context("migration file name is not valid UTF-8")?
            .to_string();
        if applied.contains(&version) {
            continue;
        }
        let sql = file
            .contents_utf8()
            .with_context(|| format!("migration {version} is not valid UTF-8"))?;

        let txn = db.begin().await?;
        txn.execute_unprepared(sql)
            .await
            .with_context(|| format!("applying migration {version}"))?;
        txn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            [version.clone().into(), now_millis().into()],
        ))
        .await?;
        txn.commit().await?;
    }
    Ok(())
}
