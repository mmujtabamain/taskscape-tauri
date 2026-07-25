// modules
pub mod capture;
pub mod hotkeys;
pub mod setup;
pub mod space;
pub mod task;
pub mod window;

// imports
use crate::{capture::capture_target, hotkeys::*, task::submit_capture, window::*};
#[cfg(target_os = "macos")]
use crate::{setup::allow_over_fullscreen, space::observe_space_changes};
use axum::{extract::State as AxumState, http::StatusCode, routing::post, Router};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use taskscape_common::{server, Store, MAIN_PORT, TRAY_PORT};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::ShortcutState;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Whether the main app's window is currently focused/frontmost, as reported by
/// main over HTTP (`/main-focused` · `/main-blurred`). When true, the global
/// capture and screenshot combos act on the main window instead of the mini bar.
fn main_focused() -> &'static AtomicBool {
    static FOCUSED: OnceLock<AtomicBool> = OnceLock::new();
    FOCUSED.get_or_init(|| AtomicBool::new(false))
}

/// POST to the main app (it's frontmost, so it acts on itself), falling back to
/// a local mini-bar action if it isn't actually reachable. `main_focused` is only
/// a cache of main's last-reported focus; it goes stale when main is closed while
/// frontmost (it exits before `/main-blurred` lands — or a crash/force-quit never
/// sends it), which would otherwise wedge the hotkey routing every press to a dead
/// port. On a failed POST we clear the stale flag and run `fallback` on the main
/// thread (window ops must), so the combo still works with main gone.
fn route_to_main_or(app: &AppHandle, path: &'static str, fallback: fn(&AppHandle)) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if server::client::post_json(MAIN_PORT, path, &serde_json::json!({}))
            .await
            .is_ok()
        {
            return;
        }
        main_focused().store(false, Ordering::Release);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || fallback(&handle));
    });
}

/// Bring the main app forward: ask a running instance to focus (HTTP), otherwise
/// launch the installed app. Returns whether a running instance answered (so
/// callers can tell "already up and focused" from "just kicked off a launch").
async fn focus_or_launch_main_async() -> bool {
    // try focus
    if server::client::post_json(MAIN_PORT, "/focus", &serde_json::json!({}))
        .await
        .is_ok()
    {
        return true;
    }
    // open new using CLI
    let _ = std::process::Command::new("open")
        .args(["-b", "com.taskscape.main.app"])
        .status();

    false
}

/// Fire-and-forget [`focus_or_launch_main_async`] (for the tray menu, which has
/// no bar to coordinate with).
fn focus_or_launch_main() {
    tauri::async_runtime::spawn(focus_or_launch_main_async());
}

/// Quit everything: ask the main app's process to exit too (best effort, it may
/// not be running), then exit this agent.
fn quit_all(app: &AppHandle) {
    tauri::async_runtime::block_on(async {
        let _ = server::client::post_json(MAIN_PORT, "/quit", &serde_json::json!({})).await;
    });
    app.exit(0);
}

/// A process-global handle to the app, set once at setup so the AppKit
/// notification callback below (a plain C function) can reach the mini window.
fn get_app_handle() -> &'static OnceLock<AppHandle> {
    static APP: OnceLock<AppHandle> = OnceLock::new();
    &APP
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Arc::new(
        tauri::async_runtime::block_on(Store::open()).expect("failed to open taskscape store"),
    );
    let server_store = store.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let (toggle, screenshot) = {
                        let state = global_hotkeys().lock().unwrap();
                        (state.toggle, state.screenshot)
                    };
                    // When the main app is frontmost these act on it instead of
                    // the mini bar: ⌘Enter starts a new task, ⌘⇧Enter attaches a
                    // screenshot to the selected task (see main's HTTP routes).
                    if Some(*shortcut) == toggle {
                        let bar = app.get_webview_window("main");
                        let open = bar
                            .as_ref()
                            .and_then(|w| w.is_visible().ok())
                            .unwrap_or(false);
                        if open {
                            // ⌘Enter is a global shortcut, so it never reaches the
                            // focused mini bar's webview — let it decide: submit
                            // from the notes editor, or dismiss from the title.
                            if let Some(w) = bar {
                                let _ = w.emit("capture-enter", ());
                            }
                        } else if main_focused().load(Ordering::Acquire) {
                            route_to_main_or(app, "/new-task", toggle_mini);
                        } else {
                            toggle_mini(app);
                        }
                    } else if Some(*shortcut) == screenshot {
                        if main_focused().load(Ordering::Acquire) {
                            route_to_main_or(app, "/attach-screenshot", capture_and_show);
                        } else {
                            capture_and_show(app);
                        }
                    }
                })
                .build(),
        )
        .manage(store)
        .setup(move |app| window_setup(app, server_store.clone()))
        .on_window_event(window_event_handler)
        .invoke_handler(tauri::generate_handler![
            hide_mini,
            list_hotkeys,
            get_dark,
            capture_target,
            open_main,
            capture_and_attach,
            submit_capture,
            set_bar_height,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn window_setup(
    app: &mut tauri::App,
    server_store: Arc<Store>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Make the app handle reachable from the AppKit notification callback.
    let _ = get_app_handle().set(app.handle().clone());

    // Run as a menu-bar agent: no dock icon.
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    // Learn when the active Space changes so a desktop switch can be told
    // apart from a real click-away (see the `Focused(false)` handler).
    #[cfg(target_os = "macos")]
    observe_space_changes();

    // Turn the window into a non-activating NSPanel so it can float over
    // other apps' native-fullscreen Spaces without pulling us out of them.
    // The bar is deliberately NOT excluded from capture here: a permanent
    // exclusion would also hide it from OS screenshot tools and the main
    // app. It's excluded only around the tray's own grab (`spawn_capture`).
    #[cfg(target_os = "macos")]
    if let Some(window) = app.get_webview_window("main") {
        use crate::setup::convert_to_panel;

        convert_to_panel(&window);
    }

    // The mini bar is an opaque card now — no vibrancy. The window keeps
    // its transparent backing (`transparent: true`) only so the card's
    // rounded corners render; the webview paints the solid surface.

    // Rest the hidden window off-screen so its first reveal doesn't flash.
    if let Some(window) = app.get_webview_window("main") {
        dismiss(&window);
        #[cfg(target_os = "macos")]
        allow_over_fullscreen(&window);
    }

    // Tray icon with a right-click menu.
    let open_item = MenuItem::with_id(app, "open_main", "Open Taskscape", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Taskscape", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => quit_all(app),
            "open_main" => focus_or_launch_main(),
            _ => {}
        })
        .build(app)?;

    refresh_global_shortcuts(app.handle().clone());

    // Main POSTs here after the settings window closes: re-register the
    // globals from the (shared) settings and tell the mini bar's webview
    // to rebuild its own key map.
    let handle = app.handle().clone();
    let app_routes = Router::new()
        .route(
            "/reload-hotkeys",
            post(|AxumState(app): AxumState<AppHandle>| async move {
                refresh_global_shortcuts(app.clone());
                let _ = app.emit_to("main", "hotkeys-changed", ());
                StatusCode::OK
            }),
        )
        // Main reports its focus so the global combos know whether to act on it.
        .route(
            "/main-focused",
            post(|| async {
                main_focused().store(true, Ordering::Release);
                StatusCode::OK
            }),
        )
        .route(
            "/main-blurred",
            post(|| async {
                main_focused().store(false, Ordering::Release);
                StatusCode::OK
            }),
        )
        .with_state(handle);
    let router = server::data_router(server_store.clone()).merge(app_routes);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = server::serve(TRAY_PORT, router).await {
            eprintln!("[taskscape-tray] HTTP server error: {e}");
        }
    });

    Ok(())
}

fn window_event_handler(window: &tauri::Window, event: &tauri::WindowEvent) {
    let Some(webview) = window.app_handle().get_webview_window(window.label()) else {
        return;
    };

    match event {
        // Never destroy the window — hide it, keeping the agent alive.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            dismiss(&webview);
        }
        // Click-away dismisses the bar instantly — except the transient blur
        // while a fresh reveal settles onto a Space (`just_revealed`), which
        // isn't a click-away.
        WindowEvent::Focused(false) => {
            if just_revealed() {
                return;
            }
            dismiss(&webview);
        }
        _ => {}
    }
}
