use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, State, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use taskscape_common::{attachments, names, screenshot, server, List, Store, MAIN_PORT, TRAY_PORT};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

const ACTIVE_LIST_KEY: &str = "last_active_list";

/// ⌘Return — the global hotkey that toggles the mini capture window.
fn hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER), Code::Enter)
}

/// ⌘⇧Return — capture a screenshot and attach it, summoning the bar if hidden.
fn screenshot_hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Enter)
}

/// The list captures should land in: the last active list if it still exists,
/// otherwise the first list, otherwise a freshly created Inbox.
async fn target_list(store: &Store) -> Result<List, String> {
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
        .create_list(&project.id, &names::suggest_name())
        .await
        .map_err(err)
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

/// Quit everything: ask the main app's process to exit too (best effort, it may
/// not be running), then exit this agent.
fn quit_all(app: &AppHandle) {
    tauri::async_runtime::block_on(async {
        let _ = server::client::post_json(MAIN_PORT, "/quit", &serde_json::json!({})).await;
    });
    app.exit(0);
}

/// Somewhere no display can reach — the window "rests" here while hidden so that
/// a one-frame show-before-move never flashes at a stale on-screen position.
const PARK: (i32, i32) = (-10_000, -10_000);

/// macOS: let the capture window appear over another app's *native fullscreen*
/// Space, floating in front of it. Two things are required, and `alwaysOnTop`
/// (which only sets the floating window level) provides neither on its own:
///
///  - `CanJoinAllSpaces | FullScreenAuxiliary` collection behavior, so the
///    window is allowed onto the separate Space a full-screen app occupies.
///    Tauri's `set_visible_on_all_workspaces` sets only `CanJoinAllSpaces`.
///  - A window level above the floating level — at floating level the window
///    still draws *behind* the full-screen app — so we raise it to the
///    pop-up-menu level that native menus and popovers use.
#[cfg(target_os = "macos")]
fn allow_over_fullscreen(window: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};

    // NSWindowCollectionBehavior bit flags.
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const MOVE_TO_ACTIVE_SPACE: usize = 1 << 1;
    const MANAGED: usize = 1 << 2;
    const FULL_SCREEN_PRIMARY: usize = 1 << 7;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    const FULL_SCREEN_NONE: usize = 1 << 9;
    // NSPopUpMenuWindowLevel — the level native menus/popovers use.
    const NS_POPUP_MENU_WINDOW_LEVEL: isize = 101;

    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_window = ns_window as *mut AnyObject;
    unsafe {
        let mut behavior: usize = msg_send![ns_window, collectionBehavior];
        // At most one bit from each mutually-exclusive group may be set, so
        // clear the space and fullscreen groups before setting our two flags.
        behavior &= !(CAN_JOIN_ALL_SPACES | MOVE_TO_ACTIVE_SPACE | MANAGED);
        behavior &= !(FULL_SCREEN_PRIMARY | FULL_SCREEN_AUXILIARY | FULL_SCREEN_NONE);
        behavior |= CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY;
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        let _: () = msg_send![ns_window, setLevel: NS_POPUP_MENU_WINDOW_LEVEL];
    }
}

/// macOS: force the window to the front of the *currently active* Space without
/// switching Spaces. `set_focus` activates the app, which — because the window's
/// home Space is the desktop — can drag focus back to the desktop instead of
/// leaving the window on a full-screen app's Space. `orderFrontRegardless`
/// brings it forward on whatever Space is active right now (the full-screen one).
#[cfg(target_os = "macos")]
fn order_front_regardless(window: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};

    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_window = ns_window as *mut AnyObject;
    unsafe {
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }
}

/// macOS: swap the capture window's backing `NSWindow` for a non-activating
/// `NSPanel`. A regular window can't float above another app's *native
/// fullscreen* Space — showing it (`makeKeyAndOrderFront:`) makes our app the
/// key window, which pulls macOS back out of the full-screen Space. A
/// non-activating panel becomes key (so the field stays typable) and orders
/// onto the active Space *without* activating our app, so the capture bar
/// appears in front of full-screen apps.
///
/// The swap is done in place with `object_setClass`: `NSPanel` adds no instance
/// variables over `NSWindow`, so the object keeps Tao's (larger) allocation and
/// we simply stop using its extra `focusable` ivar. We re-provide
/// `canBecomeKeyWindow` because a borderless panel answers it `NO` by default,
/// which would leave the text field unfocusable.
#[cfg(target_os = "macos")]
fn convert_to_panel(window: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};

    // NSWindowStyleMaskNonactivatingPanel — the bit that lets a panel receive
    // keyboard input without activating its owning application.
    const NS_NONACTIVATING_PANEL: usize = 1 << 7;

    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_window = ns_window as *mut AnyObject;
    unsafe {
        // Raw `object_setClass` rather than objc2's `AnyObject::set_class`: the
        // latter debug-asserts equal instance sizes, which fails because Tao's
        // window subclass carries an extra `focusable` ivar. Shrinking the class
        // over a larger allocation is harmless here.
        objc2::ffi::object_setClass(ns_window, panel_class());
        let mask: usize = msg_send![ns_window, styleMask];
        let _: () = msg_send![ns_window, setStyleMask: mask | NS_NONACTIVATING_PANEL];
        // Panels hide themselves when their app deactivates; ours is *always*
        // inactive while floating over another app's Space, so opt out.
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
    }
}

/// The lazily-registered `NSPanel` subclass used by [`convert_to_panel`], whose
/// only job is to answer `canBecomeKeyWindow` with `YES` (the borderless panel
/// default is `NO`). Returned as a raw pointer so it can cross the `OnceLock`.
#[cfg(target_os = "macos")]
fn panel_class() -> *const objc2::runtime::AnyClass {
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};

    static CLASS: OnceLock<usize> = OnceLock::new();

    extern "C" fn yes(_this: &AnyObject, _cmd: Sel) -> Bool {
        Bool::YES
    }

    *CLASS.get_or_init(|| {
        let superclass = objc2::class!(NSPanel);
        let mut builder = ClassBuilder::new(c"TaskscapeCapturePanel", superclass)
            .expect("failed to register TaskscapeCapturePanel");
        unsafe {
            builder.add_method(
                objc2::sel!(canBecomeKeyWindow),
                yes as extern "C" fn(_, _) -> _,
            );
        }
        builder.register() as *const AnyClass as usize
    }) as *const AnyClass
}

/// When the mini window was last revealed. A blur (`Focused(false)`) that arrives
/// within [`REVEAL_GRACE`] of a reveal is a transient side effect of showing over
/// a full-screen app's Space, not the user clicking away, so we ignore it —
/// otherwise the window is parked off-screen one frame after it appears.
fn last_shown() -> &'static Mutex<Option<Instant>> {
    static LAST_SHOWN: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    LAST_SHOWN.get_or_init(|| Mutex::new(None))
}

const REVEAL_GRACE: Duration = Duration::from_millis(500);

/// Whether the window was revealed within the last [`REVEAL_GRACE`].
fn just_revealed() -> bool {
    last_shown()
        .lock()
        .ok()
        .and_then(|guard| *guard)
        .is_some_and(|t| t.elapsed() < REVEAL_GRACE)
}

/// Hide the window, park it off-screen, and clear the (now-cancelled) draft.
fn dismiss(window: &tauri::Window) {
    let _ = window.hide();
    let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
    let _ = window.emit("mini-reset", ());
}

/// Reveal the mini window at the cursor, focused and pinned onto the current
/// (possibly full-screen) Space.
fn show_mini(app: &AppHandle, window: &tauri::WebviewWindow) {
    // Move to the cursor first, THEN reveal. Because the window rests off-screen
    // while hidden, there is no old on-screen frame to flash.
    if let Ok(pos) = app.cursor_position() {
        let _ = window.set_position(PhysicalPosition::new(
            (pos.x - 24.0) as i32,
            (pos.y - 20.0) as i32,
        ));
    }
    // Re-assert the Space-joining behavior right before showing: it must be in
    // effect at the moment we reveal/focus, or macOS shows the window on the
    // desktop Space instead of the active full-screen one.
    #[cfg(target_os = "macos")]
    allow_over_fullscreen(window);
    if let Ok(mut guard) = last_shown().lock() {
        *guard = Some(Instant::now());
    }
    let _ = window.show();
    let _ = window.set_focus();
    // ...then pin it onto the current (possibly full-screen) Space.
    #[cfg(target_os = "macos")]
    order_front_regardless(window);
    let _ = window.emit("mini-shown", ());
}

/// Toggle the mini window: hide if visible, otherwise show it at the cursor.
fn toggle_mini(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
        let _ = window.emit("mini-reset", ());
    } else {
        show_mini(app, &window);
    }
}

#[tauri::command]
fn hide_mini(window: tauri::Window) -> Result<(), String> {
    dismiss(&window);
    Ok(())
}

/// The name of the list captures will go to (shown in the mini window).
#[tauri::command]
async fn active_list_name(store: State<'_, Arc<Store>>) -> Result<String, String> {
    target_list(&store).await.map(|l| l.name)
}

#[tauri::command]
fn open_main(window: tauri::Window) {
    dismiss(&window);
    focus_or_launch_main();
}

/// Grab the full screen *without the bar in the shot*. If the bar is visible it's
/// slid off-screen first (staying focused so the blur auto-hide doesn't fire),
/// captured, then restored; if it's already hidden the screen is grabbed as-is.
fn capture_no_bar(window: &tauri::WebviewWindow) -> Result<std::path::PathBuf, String> {
    let visible = window.is_visible().unwrap_or(false);
    let restore = if visible { window.outer_position().ok() } else { None };
    if visible {
        let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
        std::thread::sleep(Duration::from_millis(120));
    }
    let path = screenshot::capture_fullscreen().map_err(err)?;
    if let Some(pos) = restore {
        let _ = window.set_position(pos);
        let _ = window.set_focus();
    }
    Ok(path)
}

/// Screenshot button: capture the screen and return the PNG path for the
/// frontend to hold until submit. Each click adds another screenshot.
#[tauri::command]
fn capture_and_attach(window: tauri::WebviewWindow) -> Result<String, String> {
    Ok(capture_no_bar(&window)?.to_string_lossy().into_owned())
}

/// ⌘⇧Return handler: capture a screenshot, summon the bar if it's hidden, and
/// tell the frontend to attach the new capture.
fn capture_and_show(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let path = match capture_no_bar(&window) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[taskscape-tray] screenshot failed: {e}");
            return;
        }
    };
    if !window.is_visible().unwrap_or(false) {
        show_mini(app, &window);
    }
    let _ = window.emit("screenshot-captured", path.to_string_lossy().into_owned());
}

/// Create the task in the active list, attach the screenshot if present, and hide.
#[tauri::command]
async fn submit_capture(
    store: State<'_, Arc<Store>>,
    window: tauri::Window,
    title: String,
    notes: Option<String>,
    screenshot_paths: Vec<String>,
) -> Result<(), String> {
    let list = target_list(&store).await?;
    let task = store
        .create_task(&list.id, &title, notes.as_deref(), None)
        .await
        .map_err(err)?;

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
                    if shortcut == &hotkey() {
                        toggle_mini(app);
                    } else if shortcut == &screenshot_hotkey() {
                        capture_and_show(app);
                    }
                })
                .build(),
        )
        .manage(store)
        .setup(move |app| {
            // Run as a menu-bar agent: no dock icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Turn the window into a non-activating NSPanel so it can float over
            // other apps' native-fullscreen Spaces without pulling us out of them.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                convert_to_panel(&window);
            }

            // Native translucent (vibrancy) background for the frameless window.
            // `Popover` follows the system appearance (frosted-light in Light Mode,
            // frosted-dark in Dark Mode); `HudWindow` would force a dark bar always.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                let _ = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Popover,
                    Some(NSVisualEffectState::Active),
                    Some(16.0),
                );
            }

            // Rest the hidden window off-screen so its first reveal doesn't flash.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
                #[cfg(target_os = "macos")]
                allow_over_fullscreen(&window);
            }

            // Tray icon with a right-click menu.
            let open_item =
                MenuItem::with_id(app, "open_main", "Open Taskscape", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Taskscape", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Taskscape — press ⌘Return to capture")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => quit_all(app),
                    "open_main" => focus_or_launch_main(),
                    _ => {}
                })
                .build(app)?;

            if let Err(e) = app.global_shortcut().register(hotkey()) {
                eprintln!("[taskscape-tray] failed to register hotkey: {e}");
            }
            if let Err(e) = app.global_shortcut().register(screenshot_hotkey()) {
                eprintln!("[taskscape-tray] failed to register screenshot hotkey: {e}");
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
            // Dismiss when the user clicks away — but ignore the transient blur
            // that fires while the window is settling onto a full-screen Space,
            // which would otherwise hide it one frame after it appears.
            WindowEvent::Focused(false) if !just_revealed() => {
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
