//! macOS window mechanics for the main window's custom chrome and the frameless
//! settings panel. The AppKit tricks live in the shared `taskscape_common::macos`
//! module (operating on a raw `NSWindow`) so the standalone Slint modal binary
//! reuses the exact same chrome; these are thin Tauri wrappers that hand it the
//! window's `ns_window()`.

#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;

/// Extract the raw `NSWindow` pointer from a Tauri window, or null if unavailable.
#[cfg(target_os = "macos")]
fn ns_window(window: &tauri::WebviewWindow) -> *mut AnyObject {
    window
        .ns_window()
        .map(|p| p as *mut AnyObject)
        .unwrap_or(std::ptr::null_mut())
}

/// Hide the native traffic lights on the main window: the frontend draws its own
/// controls, while the Overlay titlebar style keeps the native rounded corners,
/// shadow, and resize behavior.
pub fn hide_traffic_lights(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    taskscape_common::macos::hide_traffic_lights(ns_window(window));
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Paint the opaque main window's native background to match the resolved theme.
/// Call only for the main window: the frameless settings panel keeps a
/// `clearColor` background so its rounded-corner mask stays transparent (see
/// [`style_panel`]). Must run on the main thread (AppKit). No-op off macOS.
pub fn set_window_background(window: &tauri::WebviewWindow, dark: bool) {
    #[cfg(target_os = "macos")]
    taskscape_common::macos::set_window_background(ns_window(window), dark);
    #[cfg(not(target_os = "macos"))]
    let _ = (window, dark);
}

/// Stop the WKWebView from painting its own opaque white background, so the themed
/// (opaque) `NSWindow` background from [`set_window_background`] shows through the
/// load gap instead of a white flash. `drawsBackground` is the private KVC key
/// wry's `transparent` feature flips at creation — set here directly at runtime so
/// the window itself needn't become transparent (which would disturb the Overlay
/// titlebar chrome). Runs on the webview's main thread via `with_webview`. No-op
/// off macOS. This one is webview-specific, so it stays here rather than in the
/// shared `macos` module.
pub fn disable_webview_white_background(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let _ = window.with_webview(|webview| {
            use objc2::{
                msg_send,
                runtime::{AnyObject, Bool},
            };

            let wk = webview.inner() as *mut AnyObject;
            if wk.is_null() {
                return;
            }
            unsafe {
                let no: *mut AnyObject =
                    msg_send![objc2::class!(NSNumber), numberWithBool: Bool::NO];
                let key: *mut AnyObject = msg_send![
                    objc2::class!(NSString),
                    stringWithUTF8String: c"drawsBackground".as_ptr()
                ];
                let _: () = msg_send![wk, setValue: no, forKey: key];
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Turn a frameless auxiliary window (the settings panel) into a native panel with
/// rounded corners. No-op on other platforms — there the window stays a plain
/// frameless window.
pub fn style_panel(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    taskscape_common::macos::style_panel(ns_window(window));
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Recompute the window shadow. A panel shown right after [`style_panel`] still
/// carries the shadow of its original square frame; invalidating after the reveal
/// makes it hug the rounded mask.
pub fn invalidate_shadow(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    taskscape_common::macos::invalidate_shadow(ns_window(window));
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Hide a reused panel window instantly. It is only ever hidden, never destroyed
/// (destroying a class-swapped NSPanel aborts during teardown).
pub fn hide_panel(window: &tauri::WebviewWindow) {
    let _ = window.hide();
}
