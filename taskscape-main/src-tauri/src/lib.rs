use std::sync::Arc;

use axum::{extract::State as AxumState, http::StatusCode, routing::post, Router};
use tauri::{AppHandle, Emitter, Manager, State};
use taskscape_common::{server, Attachment, List, Project, Store, Task, MAIN_PORT};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// In the packaged macOS app the always-on menu-bar agent ships nested inside
/// this bundle at `Contents/Library/LoginItems/taskscape-tray.app`, so the user
/// only ever installs and launches one app. `open` (without `-n`) reuses a
/// running instance, so this never spawns a duplicate tray. In dev the nested
/// bundle doesn't exist, so this is a no-op and `run-dev.sh` starts the tray.
#[cfg(target_os = "macos")]
fn launch_embedded_tray() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    // <bundle>/Contents/MacOS/<exe> → <bundle>/Contents/Library/LoginItems/taskscape-tray.app
    let Some(tray) = exe
        .parent()
        .and_then(|macos| macos.parent())
        .map(|contents| contents.join("Library/LoginItems/taskscape-tray.app"))
    else {
        return;
    };
    if tray.exists() {
        let _ = std::process::Command::new("open").arg(&tray).status();
    }
}

#[tauri::command]
fn list_projects(store: State<'_, Arc<Store>>) -> Result<Vec<Project>, String> {
    store.list_projects().map_err(err)
}

#[tauri::command]
fn create_project(store: State<'_, Arc<Store>>, name: String) -> Result<Project, String> {
    store.create_project(&name).map_err(err)
}

#[tauri::command]
fn rename_project(store: State<'_, Arc<Store>>, id: String, name: String) -> Result<(), String> {
    store.rename_project(&id, &name).map_err(err)
}

#[tauri::command]
fn delete_project(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.delete_project(&id).map_err(err)
}

/// The default project (created on demand). Used to seed a first project when
/// the database has none yet.
#[tauri::command]
fn default_project(store: State<'_, Arc<Store>>) -> Result<Project, String> {
    store.default_project().map_err(err)
}

#[tauri::command]
fn list_lists(store: State<'_, Arc<Store>>) -> Result<Vec<List>, String> {
    store.list_lists().map_err(err)
}

#[tauri::command]
fn create_list(
    store: State<'_, Arc<Store>>,
    project_id: String,
    name: String,
) -> Result<List, String> {
    store.create_list(&project_id, &name).map_err(err)
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
    parent_id: Option<String>,
) -> Result<Task, String> {
    store
        .create_task(&list_id, &title, notes.as_deref(), parent_id.as_deref())
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

/// Remember which list the user last had open, so the tray captures land there.
#[tauri::command]
fn set_active_list(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.set_setting("last_active_list", &id).map_err(err)
}

/// Remember which project the user last had open, so we can restore it on launch.
#[tauri::command]
fn set_active_project(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.set_setting("last_active_project", &id).map_err(err)
}

/// Read a persisted setting (e.g. `last_active_project`).
#[tauri::command]
fn get_setting(store: State<'_, Arc<Store>>, key: String) -> Result<Option<String>, String> {
    store.get_setting(&key).map_err(err)
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
            #[cfg(target_os = "macos")]
            launch_embedded_tray();

            // Extra route so the tray process can ask this window to reload live.
            let handle = app.handle().clone();
            let app_routes = Router::new()
                .route(
                    "/refresh",
                    post(|AxumState(app): AxumState<AppHandle>| async move {
                        let _ = app.emit("refresh", ());
                        StatusCode::OK
                    }),
                )
                .route(
                    "/focus",
                    post(|AxumState(app): AxumState<AppHandle>| async move {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        StatusCode::OK
                    }),
                )
                // Let the tray's "Quit Taskscape" close this window too.
                .route(
                    "/quit",
                    post(|AxumState(app): AxumState<AppHandle>| async move {
                        app.exit(0);
                        StatusCode::OK
                    }),
                )
                .with_state(handle);
            let router = server::data_router(server_store.clone()).merge(app_routes);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::serve(MAIN_PORT, router).await {
                    eprintln!("[taskscape-main] HTTP server error: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            rename_project,
            delete_project,
            default_project,
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
            set_active_list,
            set_active_project,
            get_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
