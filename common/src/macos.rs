//! Shared macOS AppKit helpers for styling an auxiliary window as a native panel.
//!
//! These operate directly on a raw `NSWindow` pointer so the exact same chrome is
//! reused by two very different owners: the main app's Tauri webview panels
//! (`main/src-tauri/src/panels.rs`, which passes `window.ns_window()`) and the
//! standalone Slint modal binary (which passes the `NSWindow` behind its Slint
//! window). Everything here is public AppKit API via `objc2`.
//!
//! macOS only — the whole module is `#[cfg(target_os = "macos")]` at the crate
//! root, so callers guard their use the same way.

use std::sync::OnceLock;

use objc2::runtime::AnyObject;

/// A window's native background, matched to `--surface-2`-ish neutrals in the
/// shared token set (near-white in light, cool graphite in dark). Only the
/// opaque main window is painted with this; panels keep a `clearColor`
/// background (see [`round_corners`]). sRGB components.
const WINDOW_BG_LIGHT: (f64, f64, f64) = (0.955, 0.958, 0.964);
const WINDOW_BG_DARK: (f64, f64, f64) = (0.087, 0.091, 0.098);

/// Hide the three native traffic-light buttons (the frontend / Slint UI draws its
/// own controls). No-op on a null pointer.
pub fn hide_traffic_lights(ns_window: *mut AnyObject) {
    use objc2::msg_send;

    if ns_window.is_null() {
        return;
    }
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

/// Paint an opaque window's native background to match the resolved theme, so the
/// load gap / live-resize edges show the themed surface rather than default white.
/// Only for the opaque main window; panels stay transparent. Must run on the main
/// thread (AppKit).
pub fn set_window_background(ns_window: *mut AnyObject, dark: bool) {
    use objc2::msg_send;

    if ns_window.is_null() {
        return;
    }
    let (r, g, b) = if dark { WINDOW_BG_DARK } else { WINDOW_BG_LIGHT };
    unsafe {
        let color: *mut AnyObject = msg_send![
            objc2::class!(NSColor),
            colorWithSRGBRed: r,
            green: g,
            blue: b,
            alpha: 1.0_f64,
        ];
        let _: () = msg_send![ns_window, setBackgroundColor: color];
    }
}

/// Turn a frameless auxiliary window into a rounded native panel: swap its class
/// to a non-activating `NSPanel` subclass and clip its content to rounded corners.
/// Must run on the main thread (AppKit).
pub fn style_panel(ns_window: *mut AnyObject) {
    convert_to_panel(ns_window);
    round_corners(ns_window);
}

/// Order the panel to the front and make it key (so its text inputs receive
/// keystrokes).
pub fn make_key(ns_window: *mut AnyObject) {
    use objc2::msg_send;

    if ns_window.is_null() {
        return;
    }
    unsafe {
        let nil: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![ns_window, makeKeyAndOrderFront: nil];
    }
}

/// Style a standalone **winit/Slint** window as a modal using only property
/// changes — rounded corners + float above other windows. It deliberately does
/// NOT do the [`style_panel`] `NSPanel` class-swap: winit tracks its `NSWindow`
/// via objc2 declared ivars, so swapping the class aborts (non-unwinding panic)
/// when winit tears the window down. Safe to call repeatedly.
pub fn style_modal_window(ns_window: *mut AnyObject) {
    round_corners(ns_window);
    set_floating_level(ns_window);
}

/// Keep the window above normal windows (NSFloatingWindowLevel) so a modal shown
/// by an accessory helper floats over the main app.
pub fn set_floating_level(ns_window: *mut AnyObject) {
    use objc2::msg_send;

    if ns_window.is_null() {
        return;
    }
    // NSFloatingWindowLevel == 3.
    const NS_FLOATING_WINDOW_LEVEL: isize = 3;
    unsafe {
        let _: () = msg_send![ns_window, setLevel: NS_FLOATING_WINDOW_LEVEL];
    }
}

/// Activate this (accessory) process so a just-shown window becomes key and
/// receives keystrokes. An accessory app shows no Dock icon even when active.
pub fn activate_app() {
    use objc2::msg_send;

    unsafe {
        let app: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
        if app.is_null() {
            return;
        }
        let _: () = msg_send![app, activateIgnoringOtherApps: true];
    }
}

/// Recompute the window shadow so it hugs the rounded mask after [`style_panel`].
pub fn invalidate_shadow(ns_window: *mut AnyObject) {
    use objc2::msg_send;

    if ns_window.is_null() {
        return;
    }
    unsafe {
        let _: () = msg_send![ns_window, invalidateShadow];
    }
}

/// Make the current process an **accessory** app (`NSApplicationActivationPolicy
/// Accessory`): no dock icon, and showing a window does not switch the active app
/// away from whoever is frontmost. Call once, early, on the main thread.
pub fn set_accessory_activation_policy() {
    use objc2::{msg_send, runtime::Bool};

    // NSApplicationActivationPolicyAccessory = 1.
    const NS_ACCESSORY: isize = 1;
    unsafe {
        let app: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
        if app.is_null() {
            return;
        }
        let _: Bool = msg_send![app, setActivationPolicy: NS_ACCESSORY];
    }
}

/// Round the borderless panel's corners: a non-opaque window with a clear
/// background plus a masked content-view layer clips the (opaque) content to the
/// rounded shape, and the window shadow then follows it.
fn round_corners(ns_window: *mut AnyObject) {
    use objc2::msg_send;

    const CORNER_RADIUS: f64 = 13.0;

    if ns_window.is_null() {
        return;
    }
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

/// Swap the window's backing `NSWindow` for a non-activating `NSPanel` — the class
/// AppKit itself uses for auxiliary windows. Done in place with `object_setClass`
/// (the subclass adds no ivars). We re-provide `canBecomeKeyWindow` because a
/// borderless panel answers it `NO` by default, which would leave inputs
/// unfocusable.
fn convert_to_panel(ns_window: *mut AnyObject) {
    use objc2::msg_send;

    // NSWindowStyleMaskNonactivatingPanel — lets a panel receive keyboard input
    // without activating its owning application.
    const NS_NONACTIVATING_PANEL: usize = 1 << 7;

    if ns_window.is_null() {
        return;
    }
    unsafe {
        // Raw `object_setClass` rather than objc2's checked variant: the source
        // subclass (Tao / winit) may carry extra ivars, and shrinking the class
        // over a larger allocation is harmless here.
        objc2::ffi::object_setClass(ns_window, panel_class());
        let mask: usize = msg_send![ns_window, styleMask];
        let _: () = msg_send![ns_window, setStyleMask: mask | NS_NONACTIVATING_PANEL];
        // Panels hide themselves when their app deactivates; a modal that vanished
        // on ⌘Tab would strand its pending answer, so opt out.
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
    }
}

/// The lazily-registered `NSPanel` subclass used by [`convert_to_panel`], whose
/// only job is to answer `canBecomeKeyWindow` with `YES`. Registered once per
/// process; returned as a raw pointer so it can cross the `OnceLock`.
fn panel_class() -> *const objc2::runtime::AnyClass {
    use objc2::runtime::{AnyClass, Bool, ClassBuilder, Sel};

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
