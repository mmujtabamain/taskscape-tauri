use std::path::PathBuf;

/// Root data directory: `~/.taskscape`.
pub fn root_dir() -> PathBuf {
    dirs::home_dir()
        .expect("could not resolve home directory")
        .join(".taskscape")
}

/// SQLite database file: `~/.taskscape/taskscape.db`.
pub fn db_path() -> PathBuf {
    root_dir().join("taskscape.db")
}

/// Directory holding files copied in via "copy" attachments.
pub fn attachments_dir() -> PathBuf {
    root_dir().join("attachments")
}

/// Directory holding captured screenshots.
pub fn screenshots_dir() -> PathBuf {
    root_dir().join("screenshots")
}

/// Resolve a stored attachment `location` (relative to the root dir) to an absolute path.
pub fn resolve(location: &str) -> PathBuf {
    root_dir().join(location)
}

/// Create the data directories if they do not already exist.
pub fn ensure_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(attachments_dir())?;
    std::fs::create_dir_all(screenshots_dir())?;
    Ok(())
}
