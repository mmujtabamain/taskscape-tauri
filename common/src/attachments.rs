use std::path::Path;

use anyhow::{Context, Result};

use crate::models::{Attachment, LinkType};
use crate::storage::Store;

/// Attach a file *by reference*: records a pointer (online URL, `file://` URL, or
/// network path) without copying anything.
pub fn attach_reference(
    store: &Store,
    task_id: &str,
    name: &str,
    location: &str,
) -> Result<Attachment> {
    store.add_attachment(task_id, name, LinkType::Reference, location)
}

/// Attach a file *by copy*: copies the source file into `~/.taskscape/attachments/`
/// and records a location relative to the root data directory.
pub fn attach_copy(
    store: &Store,
    task_id: &str,
    source_path: &str,
    name: Option<&str>,
) -> Result<Attachment> {
    let src = Path::new(source_path);
    let file_name = name
        .map(|s| s.to_string())
        .or_else(|| src.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "attachment".to_string());

    let stored_name = format!("{}-{}", crate::util::new_id(), file_name);
    let dest = crate::paths::attachments_dir().join(&stored_name);
    crate::paths::ensure_dirs()?;
    std::fs::copy(src, &dest)
        .with_context(|| format!("copying {source_path} -> {}", dest.display()))?;

    let location = format!("attachments/{stored_name}");
    store.add_attachment(task_id, &file_name, LinkType::Copy, &location)
}
