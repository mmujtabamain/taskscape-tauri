use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use taskscape_common::{server, List, Store, TRAY_PORT};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Name of the list quick captures land in when the user hasn't picked one.
const INBOX: &str = "Inbox";

/// ⌘Return — the global hotkey that summons the mini capture window.
fn hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER), Code::Enter)
}

fn get_or_create_inbox(store: &Store) -> Result<List, String> {
    if let Some(list) = store
        .list_lists()
        .map_err(err)?
        .into_iter()
        .find(|l| l.name == INBOX)
    {
        return Ok(list);
    }
    store.create_list(INBOX).map_err(err)
}

#[derive(Clone, Serialize)]
struct CapturePayload {
    /// Path to the freshly captured screenshot, if capture succeeded.
    screenshot: Option<String>,
}

/// Hotkey pressed: hide the mini window, grab the screen behind it, then show the
/// window and hand the screenshot path to the frontend.
fn summon_with_screenshot(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.hide();
    std::thread::spawn(move || {
        // Give the compositor a moment to actually hide the window first.
        std::thread::sleep(Duration::from_millis(150));
        let screenshot = taskscape_common::screenshot::capture_fullscreen()
            .ok()
            .map(|p| p.to_string_lossy().into_owned());
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("capture-ready", CapturePayload { screenshot });
    });
}

/// Launch (or focus) the installed main app.
fn open_main_app() {
    let _ = std::process::Command::new("open")
        .args(["-b", "com.taskscape.main.app"])
        .status();
}

#[tauri::command]
fn hide_mini(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(err)
}

/// Read a screenshot file and return it as a data URL for previewing in the webview.
#[tauri::command]
fn screenshot_data_url(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(err)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{encoded}"))
}

/// Save a captured task: create it (in the Inbox by default), attach the
/// screenshot as a copy when present, nudge the main app to refresh, and hide.
#[tauri::command]
fn submit_capture(
    store: State<'_, Arc<Store>>,
    window: tauri::Window,
    title: String,
    notes: Option<String>,
    screenshot_path: Option<String>,
    list_id: Option<String>,
) -> Result<(), String> {
    let list_id = match list_id {
        Some(id) => id,
        None => get_or_create_inbox(&store)?.id,
    };
    let task = store
        .create_task(&list_id, &title, notes.as_deref())
        .map_err(err)?;

    if let Some(path) = screenshot_path {
        taskscape_common::attachments::attach_copy(&store, &task.id, &path, Some("screenshot.png"))
            .map_err(err)?;
    }

    // Best-effort: tell the main app to reload if it is running.
    tauri::async_runtime::spawn(async {
        let _ = server::client::post_json(
            taskscape_common::MAIN_PORT,
            "/refresh",
            &serde_json::json!({}),
        )
        .await;
    });

    let _ = window.hide();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Arc::new(Store::open().expect("failed to open taskscape store"));
    let server_store = store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if shortcut == &hotkey() && event.state() == ShortcutState::Pressed {
                        summon_with_screenshot(app);
                    }
                })
                .build(),
        )
        .manage(store)
        .setup(move |app| {
            // Run as a menu-bar agent: no dock icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Tray icon with a right-click menu.
            let open_item =
                MenuItem::with_id(app, "open_main", "Open Taskscape", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Taskscape Mini", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Taskscape — press ⌘Return to capture")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "open_main" => open_main_app(),
                    _ => {}
                })
                .build(app)?;

            // Register the global hotkey.
            if let Err(e) = app.global_shortcut().register(hotkey()) {
                eprintln!("[taskscape-tray] failed to register hotkey: {e}");
            }

            // Shared HTTP endpoints on the tray port.
            let router = server::data_router(server_store.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::serve(TRAY_PORT, router).await {
                    eprintln!("[taskscape-tray] HTTP server error: {e}");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Never destroy the mini window — just hide it, keeping the agent alive.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            hide_mini,
            screenshot_data_url,
            submit_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
