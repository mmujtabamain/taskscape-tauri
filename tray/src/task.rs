//! Building a captured task from the draft: create it in the active list, attach
//! screenshots, notify the main app. Ported from the old Tauri `submit_capture`
//! command — the notes are now plain text, stored via `create_task`'s notes path
//! (which HTML-escapes them into the task's first note).

use anyhow::Result;
use taskscape_common::{attachments, names, server, List, Store, MAIN_PORT};

const ACTIVE_LIST_KEY: &str = "last_active_list";

/// Create the task in the active list, attach any screenshots, and ping main.
pub async fn create(
    store: &Store,
    title: &str,
    notes: Option<&str>,
    screenshots: &[String],
) -> Result<()> {
    let list = target_list(store).await?;
    let task = store.create_task(&list.id, title, notes, None).await?;

    let multiple = screenshots.len() > 1;
    for (i, path) in screenshots.iter().enumerate() {
        let name = if multiple {
            format!("screenshot-{}.png", i + 1)
        } else {
            "screenshot.png".to_string()
        };
        attachments::attach_copy(store, &task.id, path, Some(&name)).await?;
    }

    let _ = server::client::post_json(MAIN_PORT, "/refresh", &serde_json::json!({})).await;
    Ok(())
}

/// The list captures land in: the last active list if it still exists, else the
/// first list, else a freshly created one under the default project.
pub async fn target_list(store: &Store) -> Result<List> {
    let lists = store.list_lists().await?;
    if let Some(id) = store.get_setting(ACTIVE_LIST_KEY).await? {
        if let Some(list) = lists.iter().find(|l| l.id == id) {
            return Ok(list.clone());
        }
    }
    if let Some(first) = lists.into_iter().next() {
        return Ok(first);
    }
    let project = store.default_project().await?;
    let list = store
        .create_list(&project.id, &names::suggest_list_name())
        .await?;
    Ok(list)
}

/// The project + list name a capture will land in (shown in the footer).
pub async fn capture_target(store: &Store) -> Result<(String, String)> {
    let list = target_list(store).await?;
    let project = store
        .list_projects()
        .await?
        .into_iter()
        .find(|p| p.id == list.project_id)
        .map(|p| p.name)
        .unwrap_or_default();
    Ok((project, list.name))
}
