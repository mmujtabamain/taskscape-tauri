use std::sync::Arc;
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use taskscape_common::{attachments, screenshot, server, List, Store, MAIN_PORT, TRAY_PORT};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

const INBOX: &str = "Inbox";
const ACTIVE_LIST_KEY: &str = "last_active_list";

/// ⌘Return — the global hotkey that toggles the mini capture window.
fn hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER), Code::Enter)
}

/// The list captures should land in: the last active list if it still exists,
/// otherwise the first list, otherwise a freshly created Inbox.
fn target_list(store: &Store) -> Result<List, String> {
    let lists = store.list_lists().map_err(err)?;
    if let Some(id) = store.get_setting(ACTIVE_LIST_KEY).map_err(err)? {
        if let Some(list) = lists.iter().find(|l| l.id == id) {
            return Ok(list.clone());
        }
    }
    if let Some(first) = lists.into_iter().next() {
        return Ok(first);
    }
    store.create_list(INBOX).map_err(err)
}

/// Focus the main app if it's running (HTTP), otherwise launch the installed app.
fn focus_or_launch_main() {
    tauri::async_runtime::spawn(async {
        if server::client::post_json(MAIN_PORT, "/focus", &serde_json::json!({}))
            .await
            .is_err()
        {
            let _ = std::process::Command::new("open")
                .args(["-b", "com.taskscape.main.app"])
                .status();
        }
    });
}

/// Somewhere no display can reach — the window "rests" here while hidden so that
/// a one-frame show-before-move never flashes at a stale on-screen position.
const PARK: (i32, i32) = (-10_000, -10_000);

/// Hide the window and park it off-screen.
fn dismiss(window: &tauri::Window) {
    let _ = window.hide();
    let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
}

/// Toggle the mini window: hide if visible, otherwise show it at the cursor.
fn toggle_mini(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
    } else {
        // Move to the cursor first, THEN reveal. Because the window rests
        // off-screen while hidden, there is no old on-screen frame to flash.
        if let Ok(pos) = app.cursor_position() {
            let _ = window.set_position(PhysicalPosition::new(
                (pos.x - 24.0) as i32,
                (pos.y - 20.0) as i32,
            ));
        }
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("mini-shown", ());
    }
}

#[tauri::command]
fn hide_mini(window: tauri::Window) -> Result<(), String> {
    dismiss(&window);
    Ok(())
}

/// The name of the list captures will go to (shown in the mini window).
#[tauri::command]
fn active_list_name(store: State<'_, Arc<Store>>) -> Result<String, String> {
    target_list(&store).map(|l| l.name)
}

#[tauri::command]
fn open_main(window: tauri::Window) {
    dismiss(&window);
    focus_or_launch_main();
}

/// Slide the window off-screen (keeping it focused so the blur auto-hide doesn't
/// fire), grab the screen without the bar in it, then move it back.
#[tauri::command]
fn capture_and_attach(window: tauri::Window) -> Result<String, String> {
    let restore = window.outer_position().ok();
    let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
    std::thread::sleep(Duration::from_millis(120));
    let path = screenshot::capture_fullscreen().map_err(err)?;
    if let Some(pos) = restore {
        let _ = window.set_position(pos);
    }
    let _ = window.set_focus();
    Ok(path.to_string_lossy().into_owned())
}

/// Create the task in the active list, attach the screenshot if present, and hide.
#[tauri::command]
fn submit_capture(
    store: State<'_, Arc<Store>>,
    window: tauri::Window,
    title: String,
    notes: Option<String>,
    screenshot_path: Option<String>,
) -> Result<(), String> {
    let list = target_list(&store)?;
    let task = store
        .create_task(&list.id, &title, notes.as_deref())
        .map_err(err)?;

    if let Some(path) = screenshot_path {
        attachments::attach_copy(&store, &task.id, &path, Some("screenshot.png")).map_err(err)?;
    }

    tauri::async_runtime::spawn(async {
        let _ = server::client::post_json(MAIN_PORT, "/refresh", &serde_json::json!({})).await;
    });

    dismiss(&window);
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
                        toggle_mini(app);
                    }
                })
                .build(),
        )
        .manage(store)
        .setup(move |app| {
            // Run as a menu-bar agent: no dock icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Native translucent (vibrancy) background for the frameless window.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                let _ = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::HudWindow,
                    Some(NSVisualEffectState::Active),
                    Some(16.0),
                );
            }

            // Rest the hidden window off-screen so its first reveal doesn't flash.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
            }

            // Tray icon with a right-click menu.
            let open_item =
                MenuItem::with_id(app, "open_main", "Open Taskscape", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit Taskscape Mini", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Taskscape — press ⌘Return to capture")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "open_main" => focus_or_launch_main(),
                    _ => {}
                })
                .build(app)?;

            if let Err(e) = app.global_shortcut().register(hotkey()) {
                eprintln!("[taskscape-tray] failed to register hotkey: {e}");
            }

            let router = server::data_router(server_store.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::serve(TRAY_PORT, router).await {
                    eprintln!("[taskscape-tray] HTTP server error: {e}");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Never destroy the window — hide it, keeping the agent alive.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                dismiss(window);
            }
            // Dismiss when the user clicks away.
            WindowEvent::Focused(false) => {
                dismiss(window);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            hide_mini,
            active_list_name,
            open_main,
            capture_and_attach,
            submit_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
