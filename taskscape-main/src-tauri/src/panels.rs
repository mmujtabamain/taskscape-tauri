//! macOS window mechanics: the main window's custom chrome and the frameless
//! modal/settings panels. Everything here is public AppKit API.

#[cfg(target_os = "macos")]
use std::sync::OnceLock;

/// Hide the native traffic lights on the main window: the frontend draws its
/// own controls, while the Overlay titlebar style keeps the native rounded
/// corners, shadow, and resize behavior.
pub fn hide_traffic_lights(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};

        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let ns_window = ns_window as *mut AnyObject;
        // NSWindowButton: 0 = close, 1 = miniaturize, 2 = zoom.
        for kind in 0usize..=2 {
            unsafe {
                let button: *mut AnyObject = msg_send![ns_window, standardWindowButton: kind];
                if !button.is_null() {
                    let _: () = msg_send![button, setHidden: true];
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Turn a frameless auxiliary window (modal/settings) into a native panel with
/// rounded corners. No-op on other platforms — there the window stays a plain
/// frameless window.
pub fn style_panel(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        convert_to_panel(window);
        round_corners(window);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Recompute the window shadow. A panel shown right after [`style_panel`] still
/// carries the shadow of its original square frame; invalidating after the
/// reveal makes it hug the rounded mask.
pub fn invalidate_shadow(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};

        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let ns_window = ns_window as *mut AnyObject;
        unsafe {
            let _: () = msg_send![ns_window, invalidateShadow];
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// macOS: round the borderless panel's corners. A non-opaque window with a
/// clear background plus a masked content-view layer clips the (opaque)
/// webview to the rounded shape, and the window shadow then follows it.
#[cfg(target_os = "macos")]
fn round_corners(window: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};

    const CORNER_RADIUS: f64 = 13.0;

    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_window = ns_window as *mut AnyObject;
    unsafe {
        let _: () = msg_send![ns_window, setOpaque: false];
        let clear: *mut AnyObject = msg_send![objc2::class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: clear];
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        if content_view.is_null() {
            return;
        }
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: CORNER_RADIUS];
            let _: () = msg_send![layer, setMasksToBounds: true];
        }
    }
}

/// macOS: swap the window's backing `NSWindow` for a non-activating `NSPanel`
/// — the class AppKit itself uses for this kind of auxiliary window.
///
/// The swap is done in place with `object_setClass`: `NSPanel` adds no instance
/// variables over `NSWindow`, so the object keeps Tao's (larger) allocation and
/// we simply stop using its extra `focusable` ivar. We re-provide
/// `canBecomeKeyWindow` because a borderless panel answers it `NO` by default,
/// which would leave the panel's inputs unfocusable.
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
        // Panels hide themselves when their app deactivates; a modal that
        // vanished on ⌘Tab would strand its pending answer, so opt out.
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
        let mut builder = ClassBuilder::new(c"TaskscapeModalPanel", superclass)
            .expect("failed to register TaskscapeModalPanel");
        unsafe {
            builder.add_method(
                objc2::sel!(canBecomeKeyWindow),
                yes as extern "C" fn(_, _) -> _,
            );
        }
        builder.register() as *const AnyClass as usize
    }) as *const AnyClass
}
