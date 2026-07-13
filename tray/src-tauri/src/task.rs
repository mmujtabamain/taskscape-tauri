use std::sync::Arc;

use taskscape_common::{attachments, names, server, List, Store, MAIN_PORT};
use tauri::State;

use crate::{err, window::dismiss};

const ACTIVE_LIST_KEY: &str = "last_active_list";

/// Create the task in the active list, attach the screenshot if present, and hide.
#[tauri::command]
pub async fn submit_capture(
    store: State<'_, Arc<Store>>,
    window: tauri::WebviewWindow,
    title: String,
    notes: Option<String>,
    screenshot_paths: Vec<String>,
) -> Result<(), String> {
    let list = target_list(&store).await?;
    let task = store
        .create_task(&list.id, &title, None, None)
        .await
        .map_err(err)?;

    // The tray editor sends sanitized rich-text HTML; store it verbatim as the
    // task's first note (create_task's `notes` path HTML-escapes plain text).
    if let Some(html) = notes.as_deref().filter(|s| !s.trim().is_empty()) {
        store.create_note(&task.id, html).await.map_err(err)?;
    }

    let multiple = screenshot_paths.len() > 1;
    for (i, path) in screenshot_paths.iter().enumerate() {
        let name = if multiple {
            format!("screenshot-{}.png", i + 1)
        } else {
            "screenshot.png".to_string()
        };
        attachments::attach_copy(&store, &task.id, path, Some(&name))
            .await
            .map_err(err)?;
    }

    tauri::async_runtime::spawn(async {
        let _ = server::client::post_json(MAIN_PORT, "/refresh", &serde_json::json!({})).await;
    });

    dismiss(&window);
    Ok(())
}

/// The list captures should land in: the last active list if it still exists,
/// otherwise the first list, otherwise a freshly created Inbox.
pub async fn target_list(store: &Store) -> Result<List, String> {
    let lists = store.list_lists().await.map_err(err)?;
    if let Some(id) = store.get_setting(ACTIVE_LIST_KEY).await.map_err(err)? {
        if let Some(list) = lists.iter().find(|l| l.id == id) {
            return Ok(list.clone());
        }
    }
    if let Some(first) = lists.into_iter().next() {
        return Ok(first);
    }
    let project = store.default_project().await.map_err(err)?;
    store
        .create_list(&project.id, &names::suggest_list_name())
        .await
        .map_err(err)
}
