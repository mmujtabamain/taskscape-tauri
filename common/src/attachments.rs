use std::path::Path;

use anyhow::{Context, Result};

use crate::models::{Attachment, LinkType};
use crate::storage::Store;

/// Attach a file *by reference*: records a pointer (online URL, `file://` URL, or
/// network path) without copying anything.
pub async fn attach_reference(
    store: &Store,
    task_id: &str,
    name: &str,
    location: &str,
) -> Result<Attachment> {
    store
        .add_attachment(task_id, name, LinkType::Reference, location)
        .await
}

/// Attach a file *by copy*: copies the source file into `~/.taskscape/attachments/`
/// and records a location relative to the root data directory.
pub async fn attach_copy(
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
    store
        .add_attachment(task_id, &file_name, LinkType::Copy, &location)
        .await
}

/// Rename an attachment. For a **copy**, the real file on disk is renamed (its
/// unique id prefix and original extension are preserved) and both the display
/// name and stored location are updated. For a **reference**, only the display
/// name is stored — the underlying URL/path is left untouched.
pub async fn rename_attachment(store: &Store, id: &str, new_name: &str) -> Result<Attachment> {
    let att = store.get_attachment(id).await?;
    let new_name = new_name.trim();
    if new_name.is_empty() {
        anyhow::bail!("attachment name cannot be empty");
    }

    match att.link_type {
        LinkType::Reference => store.update_attachment(id, new_name, &att.location).await,
        LinkType::Copy => {
            let old_abs = crate::paths::resolve(&att.location);
            let old_ext = Path::new(&att.location)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_string();

            // Keep the original extension so the file stays openable (Finder-style).
            let mut base = sanitize_filename(new_name);
            if !old_ext.is_empty() {
                let has_ext = Path::new(&base)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case(&old_ext))
                    .unwrap_or(false);
                if !has_ext {
                    base = format!("{base}.{old_ext}");
                }
            }

            let stored_name = format!("{}-{}", crate::util::new_id(), base);
            let new_location = format!("attachments/{stored_name}");
            if old_abs.exists() {
                crate::paths::ensure_dirs()?;
                let new_abs = crate::paths::attachments_dir().join(&stored_name);
                std::fs::rename(&old_abs, &new_abs).with_context(|| {
                    format!("renaming {} -> {}", old_abs.display(), new_abs.display())
                })?;
                store.update_attachment(id, &base, &new_location).await
            } else {
                // The backing file is missing — keep the pointer, update the name only.
                store.update_attachment(id, &base, &att.location).await
            }
        }
    }
}

/// Make a display name safe to use as an on-disk file name.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '\0' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed.to_string()
    }
}
