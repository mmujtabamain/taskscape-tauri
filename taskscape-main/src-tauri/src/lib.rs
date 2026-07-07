use std::sync::Arc;

use axum::{extract::State as AxumState, http::StatusCode, routing::post, Router};
use tauri::{AppHandle, Emitter, State};
use taskscape_common::{server, Attachment, List, Store, Task, MAIN_PORT};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
fn list_lists(store: State<'_, Arc<Store>>) -> Result<Vec<List>, String> {
    store.list_lists().map_err(err)
}

#[tauri::command]
fn create_list(store: State<'_, Arc<Store>>, name: String) -> Result<List, String> {
    store.create_list(&name).map_err(err)
}

#[tauri::command]
fn rename_list(store: State<'_, Arc<Store>>, id: String, name: String) -> Result<(), String> {
    store.rename_list(&id, &name).map_err(err)
}

#[tauri::command]
fn delete_list(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.delete_list(&id).map_err(err)
}

#[tauri::command]
fn list_tasks(store: State<'_, Arc<Store>>, list_id: String) -> Result<Vec<Task>, String> {
    store.list_tasks(&list_id).map_err(err)
}

#[tauri::command]
fn all_tasks(store: State<'_, Arc<Store>>) -> Result<Vec<Task>, String> {
    store.all_tasks().map_err(err)
}

#[tauri::command]
fn create_task(
    store: State<'_, Arc<Store>>,
    list_id: String,
    title: String,
    notes: Option<String>,
) -> Result<Task, String> {
    store
        .create_task(&list_id, &title, notes.as_deref())
        .map_err(err)
}

#[tauri::command]
fn update_task(
    store: State<'_, Arc<Store>>,
    id: String,
    title: Option<String>,
    notes: Option<String>,
    done: Option<bool>,
) -> Result<Task, String> {
    store
        .update_task(&id, title.as_deref(), notes.as_deref(), done)
        .map_err(err)
}

#[tauri::command]
fn delete_task(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.delete_task(&id).map_err(err)
}

#[tauri::command]
fn list_attachments(store: State<'_, Arc<Store>>, task_id: String) -> Result<Vec<Attachment>, String> {
    store.list_attachments(&task_id).map_err(err)
}

#[tauri::command]
fn add_reference(
    store: State<'_, Arc<Store>>,
    task_id: String,
    name: String,
    location: String,
) -> Result<Attachment, String> {
    taskscape_common::attachments::attach_reference(&store, &task_id, &name, &location).map_err(err)
}

#[tauri::command]
fn add_copy(
    store: State<'_, Arc<Store>>,
    task_id: String,
    source_path: String,
    name: Option<String>,
) -> Result<Attachment, String> {
    taskscape_common::attachments::attach_copy(&store, &task_id, &source_path, name.as_deref())
        .map_err(err)
}

#[tauri::command]
fn delete_attachment(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.delete_attachment(&id).map_err(err)
}

/// Open an attachment with the OS default handler. Copies resolve to their file
/// under `~/.taskscape/`; references (URLs / file / network paths) open as-is.
#[tauri::command]
fn open_attachment(link_type: String, location: String) -> Result<(), String> {
    let target = if link_type == "copy" {
        taskscape_common::paths::resolve(&location)
            .to_string_lossy()
            .into_owned()
    } else {
        location
    };
    std::process::Command::new("open")
        .arg(&target)
        .status()
        .map_err(err)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Arc::new(Store::open().expect("failed to open taskscape store"));
    let server_store = store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(store)
        .setup(move |app| {
            // Extra route so the tray process can ask this window to reload live.
            let handle = app.handle().clone();
            let refresh = Router::new()
                .route(
                    "/refresh",
                    post(|AxumState(app): AxumState<AppHandle>| async move {
                        let _ = app.emit("refresh", ());
                        StatusCode::OK
                    }),
                )
                .with_state(handle);
            let router = server::data_router(server_store.clone()).merge(refresh);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::serve(MAIN_PORT, router).await {
                    eprintln!("[taskscape-main] HTTP server error: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_lists,
            create_list,
            rename_list,
            delete_list,
            list_tasks,
            all_tasks,
            create_task,
            update_task,
            delete_task,
            list_attachments,
            add_reference,
            add_copy,
            delete_attachment,
            open_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
