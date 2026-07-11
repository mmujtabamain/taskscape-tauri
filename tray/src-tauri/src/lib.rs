use std::sync::atomic::{AtomicBool, Ordering};
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
        .create_list(&project.id, &names::suggest_list_name())
        .await
        .map_err(err)
}

/// Bring the main app forward: ask a running instance to focus (HTTP), otherwise
/// launch the installed app. Returns whether a running instance answered (so
/// callers can tell "already up and focused" from "just kicked off a launch").
async fn focus_or_launch_main_async() -> bool {
    if server::client::post_json(MAIN_PORT, "/focus", &serde_json::json!({}))
        .await
        .is_ok()
    {
        return true;
    }
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

/// macOS: set the mini panel's `NSWindowSharingType`. `false` → `None`, so the
/// bar's contents are excluded from *every* screen capture; `true` → `ReadOnly`
/// (the window default), so OS screenshot tools and the main app include the bar
/// again. The exclusion is applied only for the duration of a capture the tray
/// itself triggers (see [`spawn_capture`]); at every other moment the bar must
/// be capturable like any other window.
///
/// `setSharingType:` touches AppKit, so it's hopped onto the main thread. With
/// `block` set the caller waits until it has actually run, so an about-to-launch
/// `screencapture` can't grab the frame before the exclusion lands.
#[cfg(target_os = "macos")]
fn set_sharing_type(window: &tauri::WebviewWindow, shared: bool, block: bool) {
    use objc2::{msg_send, runtime::AnyObject};
    use std::sync::mpsc;

    // NSWindowSharingType: None = 0 (never shared), ReadOnly = 1 (the default).
    const NS_WINDOW_SHARING_NONE: isize = 0;
    const NS_WINDOW_SHARING_READ_ONLY: isize = 1;
    let value = if shared {
        NS_WINDOW_SHARING_READ_ONLY
    } else {
        NS_WINDOW_SHARING_NONE
    };

    let win = window.clone();
    let (tx, rx) = mpsc::channel();
    let posted = window.run_on_main_thread(move || {
        if let Ok(ns_window) = win.ns_window() {
            let ns_window = ns_window as *mut AnyObject;
            unsafe {
                let _: () = msg_send![ns_window, setSharingType: value];
            }
        }
        let _ = tx.send(());
    });
    if block && posted.is_ok() {
        let _ = rx.recv_timeout(Duration::from_millis(500));
    }
}

/// Restores the bar to the default, capturable sharing type when the capture
/// thread unwinds — on success, error, or panic — so an exclusion set for one
/// shot can never leak past it and keep the bar hidden from OS tools / the main
/// app.
#[cfg(target_os = "macos")]
struct SharingRestore(tauri::WebviewWindow);

#[cfg(target_os = "macos")]
impl Drop for SharingRestore {
    fn drop(&mut self) {
        set_sharing_type(&self.0, true, false);
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

/// A process-global handle to the app, set once at setup so the AppKit
/// notification callback below (a plain C function) can reach the mini window.
fn app_handle() -> &'static OnceLock<AppHandle> {
    static APP: OnceLock<AppHandle> = OnceLock::new();
    &APP
}

/// When the mini window was last revealed. A blur (`Focused(false)`) that arrives
/// within [`REVEAL_GRACE`] of a reveal is a transient side effect of showing over
/// a full-screen app's Space, not the user clicking away, so we ignore it.
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

/// macOS: `spaceChanged:` — fired by [`observe_space_changes`] on every active-
/// Space change. Re-pins a still-visible bar (one summoned within the reveal
/// grace, just before the switch) onto the new Space so it stays key and typable.
#[cfg(target_os = "macos")]
extern "C" fn space_changed(
    _this: &objc2::runtime::AnyObject,
    _cmd: objc2::runtime::Sel,
    _note: *mut objc2::runtime::AnyObject,
) {
    if let Some(window) = app_handle()
        .get()
        .and_then(|app| app.get_webview_window("main"))
    {
        if window.is_visible().unwrap_or(false) {
            allow_over_fullscreen(&window);
            order_front_regardless(&window);
            let _ = window.set_focus();
        }
    }
}

/// macOS: the lazily-registered `NSObject` subclass carrying [`space_changed`] as
/// its `spaceChanged:` method (mirrors [`panel_class`]).
#[cfg(target_os = "macos")]
fn space_observer_class() -> *const objc2::runtime::AnyClass {
    use objc2::runtime::{AnyClass, ClassBuilder};

    static CLASS: OnceLock<usize> = OnceLock::new();
    *CLASS.get_or_init(|| {
        let superclass = objc2::class!(NSObject);
        let mut builder = ClassBuilder::new(c"TaskscapeSpaceObserver", superclass)
            .expect("failed to register TaskscapeSpaceObserver");
        unsafe {
            builder.add_method(
                objc2::sel!(spaceChanged:),
                space_changed as extern "C" fn(_, _, _),
            );
        }
        builder.register() as *const AnyClass as usize
    }) as *const AnyClass
}

/// macOS: subscribe to `NSWorkspaceActiveSpaceDidChangeNotification` so a desktop
/// switch can be told apart from a real click-away. The observer object is
/// intentionally leaked — the notification center holds it unretained, so it must
/// outlive every notification, i.e. the whole process.
#[cfg(target_os = "macos")]
fn observe_space_changes() {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{class, msg_send, sel};

    unsafe {
        let cls: &AnyClass = &*space_observer_class();
        let observer: *mut AnyObject = msg_send![cls, new];

        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let center: *mut AnyObject = msg_send![workspace, notificationCenter];
        let name: *mut AnyObject = msg_send![
            class!(NSString),
            stringWithUTF8String: c"NSWorkspaceActiveSpaceDidChangeNotification".as_ptr()
        ];
        let _: () = msg_send![
            center,
            addObserver: observer,
            selector: sel!(spaceChanged:),
            name: name,
            object: std::ptr::null_mut::<AnyObject>(),
        ];
    }
}

/// Hide the window and park it off-screen. The draft it holds is intentionally
/// left intact so it survives dismissal and is restored on the next reveal —
/// only submitting a capture or an explicit clear (⌘⇧⌫ / the Clear button)
/// resets the form.
fn dismiss(window: &tauri::Window) {
    let _ = window.hide();
    let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
}

/// Where the mini bar is anchored when summoned: just up-and-left of the cursor
/// so the title field lands under it. If placing it there would push the bar
/// past the right or bottom edge of the monitor the cursor is on, it flips to
/// the opposite side of the cursor; a final clamp to the monitor's work area
/// guarantees the whole frame stays on screen wherever the cursor is.
fn cursor_anchor(app: &AppHandle, window: &tauri::WebviewWindow) -> Option<PhysicalPosition<i32>> {
    // Physical offset from the cursor to the bar's top-left in the default
    // (down-and-right) placement.
    const OFF_X: f64 = 24.0;
    const OFF_Y: f64 = 20.0;

    let cursor = app.cursor_position().ok()?;
    let size = window.outer_size().ok()?;
    let (w, h) = (size.width as f64, size.height as f64);

    // The usable area (menu bar / dock excluded) of the monitor under the cursor.
    let monitor = window
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let left = area.position.x as f64;
    let top = area.position.y as f64;
    let right = left + area.size.width as f64;
    let bottom = top + area.size.height as f64;

    // Default down-and-right of the cursor; flip to the other side when that
    // side would spill off the right / bottom edge.
    let mut x = cursor.x - OFF_X;
    if x + w > right {
        x = cursor.x + OFF_X - w;
    }
    let mut y = cursor.y - OFF_Y;
    if y + h > bottom {
        y = cursor.y + OFF_Y - h;
    }

    // Whatever the flip chose, never let the frame leave the work area (covers
    // the top/left edges and monitors smaller than the bar).
    x = x.clamp(left, (right - w).max(left));
    y = y.clamp(top, (bottom - h).max(top));

    Some(PhysicalPosition::new(x as i32, y as i32))
}

/// Reveal the mini window at the cursor, focused and pinned onto the current
/// (possibly full-screen) Space.
fn show_mini(app: &AppHandle, window: &tauri::WebviewWindow) {
    // Move to the cursor first, THEN reveal. Because the window rests off-screen
    // while hidden, there is no old on-screen frame to flash.
    if let Some(pos) = cursor_anchor(app, window) {
        let _ = window.set_position(pos);
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
    } else {
        show_mini(app, &window);
    }
}

#[tauri::command]
fn hide_mini(window: tauri::Window) -> Result<(), String> {
    dismiss(&window);
    Ok(())
}

/// Where captures land — the project and list names, shown in the mini bar footer.
#[derive(serde::Serialize)]
struct CaptureTarget {
    project: String,
    list: String,
}

#[tauri::command]
async fn capture_target(store: State<'_, Arc<Store>>) -> Result<CaptureTarget, String> {
    let list = target_list(&store).await?;
    let project = store
        .list_projects()
        .await
        .map_err(err)?
        .into_iter()
        .find(|p| p.id == list.project_id)
        .map(|p| p.name)
        .unwrap_or_default();
    Ok(CaptureTarget {
        project,
        list: list.name,
    })
}

/// Open the main window, then dismiss the bar *after* main is up so there's no
/// empty gap where neither is on screen. If main is already running the `/focus`
/// POST brings it forward and returns before we hide; otherwise we launch it and
/// hide once the launch is under way.
#[tauri::command]
async fn open_main(window: tauri::Window) {
    focus_or_launch_main_async().await;
    dismiss(&window);
}

/// A screenshot capture in flight. [`spawn_capture`] parks and restores the mini
/// window, so two overlapping captures would fight over its position — a second
/// trigger is ignored until the first finishes.
fn capturing() -> &'static AtomicBool {
    static CAPTURING: OnceLock<AtomicBool> = OnceLock::new();
    CAPTURING.get_or_init(|| AtomicBool::new(false))
}

/// Clears the [`capturing`] flag when the capture thread unwinds — on success,
/// error, or panic — so a failed shot can never wedge the flag `true` and block
/// every future capture.
struct CaptureFlag;
impl Drop for CaptureFlag {
    fn drop(&mut self) {
        capturing().store(false, Ordering::Release);
    }
}

/// Capture the full screen off the caller's thread, driving the mini bar's UI
/// with events:
///
///  - `screenshot-pending` immediately (the button shows a spinner),
///  - then `screenshot-captured` (PNG path) on success, or `screenshot-error`
///    (message) on failure.
///
/// The bar stays on screen (showing its spinner) throughout: it's excluded from
/// *this* grab only by flipping its sharing type to `None` for the capture and
/// restoring it right after ([`set_sharing_type`] / [`SharingRestore`]), so it
/// never lands in the shot yet stays capturable by OS tools and the main app.
/// The blocking `screencapture` shell-out never runs on the UI/hotkey thread. If
/// a capture is already running this is a no-op.
fn spawn_capture(window: &tauri::WebviewWindow) {
    if capturing().swap(true, Ordering::AcqRel) {
        return;
    }
    let _ = window.emit("screenshot-pending", ());
    let window = window.clone();
    std::thread::spawn(move || {
        let _flag = CaptureFlag;
        // Exclude the bar from this grab only, then restore it (even on
        // error/panic) so OS tools and the main app still capture it.
        #[cfg(target_os = "macos")]
        let _restore = {
            set_sharing_type(&window, false, true);
            // Let the window server commit the exclusion before the grab.
            std::thread::sleep(Duration::from_millis(60));
            SharingRestore(window.clone())
        };
        match screenshot::capture_fullscreen().map_err(err) {
            Ok(path) => {
                let _ = window.emit("screenshot-captured", path.to_string_lossy().into_owned());
            }
            Err(e) => {
                eprintln!("[taskscape-tray] screenshot failed: {e}");
                let _ = window.emit("screenshot-error", e);
            }
        }
    });
}

/// Screenshot button: capture the screen and attach it. Fire-and-forget — the
/// frontend shows a spinner and attaches the result when the `screenshot-*`
/// events arrive, exactly like the ⌘⇧Return path. Each click adds another shot.
#[tauri::command]
fn capture_and_attach(window: tauri::WebviewWindow) {
    spawn_capture(&window);
}

/// ⌘⇧Return handler: summon the bar *instantly* (so the keypress has immediate
/// feedback), then capture in the background. The bar shows a spinner until the
/// shot lands and is attached, staying on screen the whole time.
fn capture_and_show(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        show_mini(app, &window);
    }
    spawn_capture(&window);
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
            // Make the app handle reachable from the AppKit notification callback.
            let _ = app_handle().set(app.handle().clone());

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
                convert_to_panel(&window);
            }

            // The mini bar is an opaque card now — no vibrancy. The window keeps
            // its transparent backing (`transparent: true`) only so the card's
            // rounded corners render; the webview paints the solid surface.

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
            // Click-away dismisses the bar instantly — except the transient blur
            // while a fresh reveal settles onto a Space (`just_revealed`), which
            // isn't a click-away.
            WindowEvent::Focused(false) => {
                if just_revealed() {
                    return;
                }
                dismiss(window);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            hide_mini,
            capture_target,
            open_main,
            capture_and_attach,
            submit_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
