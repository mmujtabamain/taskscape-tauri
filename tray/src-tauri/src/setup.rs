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
pub fn convert_to_panel(window: &tauri::WebviewWindow) {
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
    use std::sync::OnceLock;

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
pub fn allow_over_fullscreen(window: &tauri::WebviewWindow) {
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
pub fn order_front_regardless(window: &tauri::WebviewWindow) {
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
pub fn set_sharing_type(window: &tauri::WebviewWindow, shared: bool, block: bool) {
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
        use std::time::Duration;

        let _ = rx.recv_timeout(Duration::from_millis(500));
    }
}
