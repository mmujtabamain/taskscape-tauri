//! File-backed application settings — a small string→string map persisted as
//! JSON at `~/.taskscape/settings.json`, deliberately kept out of the SQLite
//! database so copying the data file (`taskscape.db`) doesn't carry preferences.
//!
//! Only the main app writes settings; the tray only reads. Writes are serialized
//! by a process mutex and land atomically (write-temp-then-rename) so a reader in
//! the other process never observes a half-written file. Reads are read-through
//! (the file is re-parsed each call), so a value written by one process is
//! immediately visible to the other — matching the old shared-table behavior.

use std::collections::BTreeMap;
use std::fs;
use std::sync::Mutex;

use anyhow::{Context, Result};

use crate::paths::settings_path;

/// Serializes read-modify-write within this process so concurrent `set` calls
/// can't clobber each other. Cross-process write races don't arise — only the
/// main app writes.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

type Map = BTreeMap<String, String>;

/// Parse the settings file, treating a missing or unreadable/corrupt file as an
/// empty map (an absent key means "use the default" everywhere it's read).
fn load() -> Map {
    match fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Map::new(),
    }
}

/// The stored value for `key`, or `None` if unset.
pub fn get(key: &str) -> Option<String> {
    load().get(key).cloned()
}

/// Insert or replace `key`, persisting the whole map atomically.
pub fn set(key: &str, value: &str) -> Result<()> {
    let _guard = WRITE_LOCK.lock().unwrap();
    let mut map = load();
    map.insert(key.to_string(), value.to_string());
    write_atomic(&map)
}

fn write_atomic(map: &Map) -> Result<()> {
    let path = settings_path();
    let dir = path.parent().context("settings path has no parent")?;
    fs::create_dir_all(dir)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(map)?)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}
