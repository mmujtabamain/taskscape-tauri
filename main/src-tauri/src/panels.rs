//! macOS window mechanics: the main window's custom chrome and the frameless
//! modal / overlay / settings windows. Everything here is public AppKit API.

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

/// The main window's native background, matched to `--bg-window` in `index.css`
/// (near-white in light, cool graphite in dark). Painting it means the load gap
/// on launch — and the window edges during a live resize — show the themed
/// surface instead of the default white, before/behind the webview paints.
/// sRGB components.
#[cfg(target_os = "macos")]
const WINDOW_BG_LIGHT: (f64, f64, f64) = (0.955, 0.958, 0.964);
#[cfg(target_os = "macos")]
const WINDOW_BG_DARK: (f64, f64, f64) = (0.087, 0.091, 0.098);

/// Paint the main window's native background to match the resolved theme. Call
/// only for the opaque main window: the modal/settings panels keep a `clearColor`
/// background so their rounded-corner mask stays transparent (see [`round_corners`]).
/// Must run on the main thread (AppKit). No-op off macOS.
pub fn set_window_background(window: &tauri::WebviewWindow, dark: bool) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};

        let (r, g, b) = if dark { WINDOW_BG_DARK } else { WINDOW_BG_LIGHT };
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let ns_window = ns_window as *mut AnyObject;
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
    #[cfg(not(target_os = "macos"))]
    let _ = (window, dark);
}

/// Stop the WKWebView from painting its own opaque white background, so the
/// themed (opaque) `NSWindow` background from [`set_window_background`] shows
/// through the load gap instead of a white flash. `drawsBackground` is the
/// private KVC key wry's `transparent` feature flips at creation — set here
/// directly at runtime so the window itself needn't become transparent (which
/// would disturb the Overlay titlebar chrome). Runs on the webview's main
/// thread via `with_webview`. No-op off macOS.
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

/// Recompute the window shadow. A frameless window shown right after
/// [`round_corners`] still carries the shadow of its original square frame;
/// invalidating after the reveal makes it hug the rounded mask.
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

/// macOS: round a frameless auxiliary window's (modal/overlay/settings) corners.
/// A non-opaque window with a clear background plus a masked content-view layer
/// clips the (opaque) webview to the rounded shape, and the window shadow then
/// follows it. No-op off macOS — there the window stays a plain frameless window.
pub fn round_corners(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
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
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}
