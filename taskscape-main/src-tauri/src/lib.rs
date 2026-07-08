mod panels;

use std::sync::{Arc, Mutex};

use axum::{extract::State as AxumState, http::StatusCode, routing::post, Router};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};
use taskscape_common::{server, Attachment, List, Project, Store, Task, MAIN_PORT};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The pending modal (id + props), if any. One reusable panel window serves
/// every modal: destroying a class-swapped NSPanel raises an Objective-C
/// exception during teardown (fatal across the FFI boundary), so — like the
/// tray's mini bar — the window is only ever hidden, never destroyed. An id
/// still pending when the window goes away means the modal never answered.
struct ModalState(Mutex<Option<(String, serde_json::Value)>>);

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
fn reorder_list(store: State<'_, Arc<Store>>, id: String, sort_order: f64) -> Result<(), String> {
    store.reorder_list(&id, sort_order).map_err(err)
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
fn move_task(
    store: State<'_, Arc<Store>>,
    id: String,
    parent_id: Option<String>,
    list_id: Option<String>,
    sort_order: Option<f64>,
) -> Result<Task, String> {
    store
        .move_task(&id, parent_id.as_deref(), list_id.as_deref(), sort_order)
        .map_err(err)
}

#[tauri::command]
fn reorder_task(store: State<'_, Arc<Store>>, id: String, sort_order: f64) -> Result<Task, String> {
    store.reorder_task(&id, sort_order).map_err(err)
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

/// Capture the full screen and attach it to a task as a copy. macOS prompts for
/// Screen Recording permission the first time this app triggers a capture.
#[tauri::command]
fn attach_screenshot(store: State<'_, Arc<Store>>, task_id: String) -> Result<Attachment, String> {
    let path = taskscape_common::screenshot::capture_fullscreen().map_err(err)?;
    taskscape_common::attachments::attach_copy(
        &store,
        &task_id,
        &path.to_string_lossy(),
        Some("screenshot.png"),
    )
    .map_err(err)
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

#[tauri::command]
fn set_setting(store: State<'_, Arc<Store>>, key: String, value: String) -> Result<(), String> {
    store.set_setting(&key, &value).map_err(err)
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

/// Reveal an attachment in Finder/Explorer. Copies resolve to their file under
/// `~/.taskscape/`; file references reveal as given. Web URLs have no file to
/// reveal.
#[tauri::command]
fn reveal_attachment(link_type: String, location: String) -> Result<(), String> {
    let target = if link_type == "copy" {
        taskscape_common::paths::resolve(&location)
            .to_string_lossy()
            .into_owned()
    } else if location.starts_with("http://") || location.starts_with("https://") {
        return Err("cannot reveal a URL in the file manager".into());
    } else {
        location
    };
    tauri_plugin_opener::reveal_item_in_dir(&target).map_err(err)
}

/// Show a modal in the shared panel window (created on first use, then reused
/// hidden — never destroyed). Its outcome comes back to "main" as a
/// `modal-result:{id}` event via `close_modal`.
#[tauri::command]
fn open_modal(
    app: AppHandle,
    state: State<'_, ModalState>,
    id: String,
    props: serde_json::Value,
) -> Result<(), String> {
    // A modal opened over an unanswered one cancels the first, so the first
    // caller's pending promise still resolves.
    if let Some((old_id, _)) = state.0.lock().unwrap().replace((id.clone(), props)) {
        if old_id != id {
            let _ = app.emit_to(
                "main",
                &format!("modal-result:{old_id}"),
                serde_json::json!({ "buttonId": null }),
            );
        }
    }
    if app.get_webview_window("modal").is_some() {
        app.emit_to("modal", "modal-refresh", &id).map_err(err)?;
        return Ok(());
    }
    let window =
        WebviewWindowBuilder::new(&app, "modal", WebviewUrl::App("index.html#modal".into()))
            .title("")
            .inner_size(420., 240.)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .decorations(false)
            .shadow(true)
            .visible(false)
            .skip_taskbar(true)
            .build()
            .map_err(err)?;
    // AppKit is main-thread-only; commands run on a worker thread.
    let w = window.clone();
    window
        .run_on_main_thread(move || panels::style_panel(&w))
        .map_err(err)?;
    Ok(())
}

/// The pending modal (id + props), fetched by the shared modal window on load
/// and on every `modal-refresh`.
#[tauri::command]
fn modal_current(state: State<'_, ModalState>) -> Result<serde_json::Value, String> {
    state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|(id, props)| serde_json::json!({ "id": id, "props": props }))
        .ok_or_else(|| "no modal pending".to_string())
}

/// Called by a modal/settings window once its content is measured: size it,
/// center it over the main window, and only then reveal — so the user never
/// sees it resize or jump.
#[tauri::command]
fn present_window(
    window: tauri::WebviewWindow,
    app: AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    window.set_size(LogicalSize::new(width, height)).map_err(err)?;
    match app.get_webview_window("main") {
        Some(main) => {
            let main_pos = main.outer_position().map_err(err)?;
            let main_size = main.outer_size().map_err(err)?;
            // outer_position/outer_size are physical, the given size is logical
            // — scale it by the MAIN window's factor (the display the panel will
            // be centered on) so it lands right on mixed-DPI multi-monitor setups.
            let scale = main.scale_factor().map_err(err)?;
            let x = main_pos.x + (main_size.width as i32 - (width * scale) as i32) / 2;
            let y = main_pos.y + (main_size.height as i32 - (height * scale) as i32) / 2;
            window.set_position(PhysicalPosition::new(x, y)).map_err(err)?;
        }
        None => window.center().map_err(err)?,
    }
    window.show().map_err(err)?;
    window.set_focus().map_err(err)?;
    let w = window.clone();
    let _ = window.run_on_main_thread(move || panels::invalidate_shadow(&w));
    Ok(())
}

#[tauri::command]
fn close_modal(
    app: AppHandle,
    state: State<'_, ModalState>,
    id: String,
    result: serde_json::Value,
) -> Result<(), String> {
    app.emit_to("main", &format!("modal-result:{id}"), result)
        .map_err(err)?;
    let mut pending = state.0.lock().unwrap();
    if pending.as_ref().is_some_and(|(cur, _)| *cur == id) {
        *pending = None;
    }
    drop(pending);
    // Hide, never destroy — see ModalState.
    if let Some(window) = app.get_webview_window("modal") {
        let _ = window.hide();
    }
    Ok(())
}

/// Show the settings window, creating it on first use. It stays hidden until
/// its content calls `present_window`.
#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(err)?;
        window.set_focus().map_err(err)?;
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("index.html#settings".into()),
    )
    .title("Settings")
    .inner_size(520., 560.)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .decorations(false)
    .shadow(true)
    .visible(false)
    .skip_taskbar(true)
    .build()
    .map_err(err)?;
    let w = window.clone();
    window
        .run_on_main_thread(move || panels::style_panel(&w))
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
        .manage(ModalState(Mutex::new(None)))
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            launch_embedded_tray();

            // The frontend draws its own window controls; hiding the native
            // traffic lights (while keeping the Overlay titlebar style) keeps
            // the native rounded corners, shadow, and resize behavior.
            if let Some(window) = app.get_webview_window("main") {
                panels::hide_traffic_lights(&window);
            }

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
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing the main window quits the app — otherwise the hidden,
            // never-destroyed panels would keep the process alive headless.
            ("main", WindowEvent::Destroyed) => window.app_handle().exit(0),
            // Panels hide instead of closing: destroying a class-swapped
            // NSPanel aborts with a foreign exception during teardown.
            ("modal" | "settings", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                if window.label() == "modal" {
                    let pending = window.state::<ModalState>().0.lock().unwrap().take();
                    if let Some((id, _)) = pending {
                        let _ = window.app_handle().emit_to(
                            "main",
                            &format!("modal-result:{id}"),
                            serde_json::json!({ "buttonId": null }),
                        );
                    }
                }
                let _ = window.hide();
            }
            _ => {}
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
            reorder_list,
            list_tasks,
            all_tasks,
            create_task,
            update_task,
            delete_task,
            move_task,
            reorder_task,
            list_attachments,
            add_reference,
            add_copy,
            delete_attachment,
            attach_screenshot,
            open_attachment,
            reveal_attachment,
            set_active_list,
            set_active_project,
            get_setting,
            set_setting,
            open_modal,
            modal_current,
            present_window,
            close_modal,
            open_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
