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

/// Hold the main WKWebView transparent, then bring the window on screen. Called
/// once in `setup`, after the window's themed background and native boot box are
/// in place: showing it now puts the native boot UI on screen immediately —
/// while the webview beneath stays invisible (`alphaValue = 0`) until
/// [`reveal_webview`] fades it in on first paint. None of WebKit's startup
/// (white default, unstyled frames, theme flip) is ever seen, because the
/// webview simply isn't visible until then.
///
/// Everything happens in one main-thread `with_webview` callback, in order:
/// `drawsBackground = NO` (so the themed window surface — not white — shows in
/// live-resize edges), `alphaValue = 0`, and only THEN `show()` — so the raw
/// webview never flashes in the gap between showing the window and hiding it.
/// `drawsBackground` is the private KVC key wry's `transparent` feature flips at
/// creation; setting it at runtime keeps the window opaque (its Overlay titlebar
/// chrome intact). No-op off macOS.
pub fn hide_webview_and_reveal_window(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let win = window.clone();
        let _ = window.with_webview(move |webview| {
            use objc2::{
                msg_send,
                runtime::{AnyObject, Bool},
            };

            let wk = webview.inner() as *mut AnyObject;
            if wk.is_null() {
                // No webview to hide — show the window anyway so it isn't stuck.
                let _ = win.show();
                let _ = win.set_focus();
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
                let _: () = msg_send![wk, setAlphaValue: 0.0f64];
            }
            // The webview is invisible now — safe to bring the window on screen.
            let _ = win.show();
            let _ = win.set_focus();
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Fade the main WKWebView in over ~180 ms, once the page has presented its
/// first real frame. Until now it has been `alphaValue = 0` over the native boot
/// box (see [`hide_webview_and_reveal_window`]); animating it to opaque means the
/// user sees the finished first frame fade in, never WebKit's startup. The
/// `animator()` proxy applies the change under the current `NSAnimationContext`
/// duration. Runs on the main thread via `with_webview`; idempotent through the
/// caller's `WEBVIEW_REVEALED` guard. No-op off macOS.
pub fn reveal_webview(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let _ = window.with_webview(|webview| {
            use objc2::{msg_send, runtime::AnyObject};

            let wk = webview.inner() as *mut AnyObject;
            if wk.is_null() {
                return;
            }
            unsafe {
                let ctx = objc2::class!(NSAnimationContext);
                let _: () = msg_send![ctx, beginGrouping];
                let current: *mut AnyObject = msg_send![ctx, currentContext];
                let _: () = msg_send![current, setDuration: 0.18f64];
                let animator: *mut AnyObject = msg_send![wk, animator];
                let _: () = msg_send![animator, setAlphaValue: 1.0f64];
                let _: () = msg_send![ctx, endGrouping];
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// The boot indicator's empty checkbox, drawn natively so it's on screen from
/// the window's first frame — before the webview paints anything. Geometry and
/// color mirror the `.boot-box` `<rect>` in `index.html` exactly: a 25×25 box
/// (radius 7, 1.5pt stroke in `--edge-3`) centered in the window. The SVG's rect
/// is inset to 25 within its 28×28 viewBox, so the native box matches the rect,
/// not the viewBox — same size *and* same roundness (7/25), so the webview fades
/// in over an identically-placed, identically-rounded box with no jump. Removed
/// later via the `boot_done` command.
#[cfg(target_os = "macos")]
const BOOT_BOX_SIZE: f64 = 25.0;
#[cfg(target_os = "macos")]
const BOOT_BOX_RADIUS: f64 = 7.0;
#[cfg(target_os = "macos")]
const BOOT_BOX_STROKE: f64 = 1.5;
/// `--edge-3` as sRGB + alpha (light / dark).
#[cfg(target_os = "macos")]
const BOOT_EDGE_LIGHT: (f64, f64, f64, f64) = (0.176, 0.201, 0.240, 0.30);
#[cfg(target_os = "macos")]
const BOOT_EDGE_DARK: (f64, f64, f64, f64) = (0.959, 0.975, 1.0, 0.24);
#[cfg(target_os = "macos")]
const BOOT_BOX_ID: &std::ffi::CStr = c"taskscape-boot-box";

/// Add the native boot box beneath the webview (which draws no background of
/// its own until the page paints — see the window's `backgroundColor` in
/// `tauri.conf.json`). An `NSBox` rather than a bare CALayer because it takes
/// its border as an `NSColor` and needs no Core Graphics types. Must run on the
/// main thread. No-op off macOS.
pub fn show_boot_box(window: &tauri::WebviewWindow, dark: bool) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};
        use objc2_core_foundation::{CGPoint, CGRect, CGSize};

        let (r, g, b, a) = if dark {
            BOOT_EDGE_DARK
        } else {
            BOOT_EDGE_LIGHT
        };
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let ns_window = ns_window as *mut AnyObject;
        unsafe {
            let content_view: *mut AnyObject = msg_send![ns_window, contentView];
            if content_view.is_null() {
                return;
            }
            let bounds: CGRect = msg_send![content_view, bounds];
            // Mirror the HTML boot indicator's centered position. AppKit's coordinate
            // system is bottom-left, so centering is simply half the remaining space.
            let frame = CGRect {
                origin: CGPoint {
                    x: (bounds.size.width - BOOT_BOX_SIZE) / 2.0,
                    y: (bounds.size.height - BOOT_BOX_SIZE) / 2.0,
                },
                size: CGSize {
                    width: BOOT_BOX_SIZE,
                    height: BOOT_BOX_SIZE,
                },
            };
            let boot_box: *mut AnyObject = msg_send![objc2::class!(NSBox), alloc];
            let boot_box: *mut AnyObject = msg_send![boot_box, initWithFrame: frame];
            // NSBoxCustom / NSNoTitle: a plain bordered rounded rect.
            let _: () = msg_send![boot_box, setBoxType: 4usize];
            let _: () = msg_send![boot_box, setTitlePosition: 0usize];
            let _: () = msg_send![boot_box, setBorderWidth: BOOT_BOX_STROKE];
            let _: () = msg_send![boot_box, setCornerRadius: BOOT_BOX_RADIUS];
            let border: *mut AnyObject = msg_send![
                objc2::class!(NSColor),
                colorWithSRGBRed: r,
                green: g,
                blue: b,
                alpha: a,
            ];
            let _: () = msg_send![boot_box, setBorderColor: border];
            let clear: *mut AnyObject = msg_send![objc2::class!(NSColor), clearColor];
            let _: () = msg_send![boot_box, setFillColor: clear];
            // All four margins flexible, so it stays centered through an early
            // live resize.
            let _: () = msg_send![boot_box, setAutoresizingMask: 45usize];
            let id: *mut AnyObject = msg_send![
                objc2::class!(NSString),
                stringWithUTF8String: BOOT_BOX_ID.as_ptr()
            ];
            let _: () = msg_send![boot_box, setIdentifier: id];
            // NSWindowBelow (-1): behind the webview, over the window background.
            let _: () = msg_send![
                content_view,
                addSubview: boot_box,
                positioned: -1isize,
                relativeTo: std::ptr::null_mut::<AnyObject>(),
            ];
            let _: () = msg_send![boot_box, release];
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, dark);
}

/// Remove the native boot box (found by its identifier). The opaque page has
/// covered it since first paint, so this is hygiene, not a visible change.
/// Must run on the main thread. No-op off macOS.
pub fn remove_boot_box(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject, runtime::Bool};

        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let ns_window = ns_window as *mut AnyObject;
        unsafe {
            let content_view: *mut AnyObject = msg_send![ns_window, contentView];
            if content_view.is_null() {
                return;
            }
            let subviews: *mut AnyObject = msg_send![content_view, subviews];
            if subviews.is_null() {
                return;
            }
            let target: *mut AnyObject = msg_send![
                objc2::class!(NSString),
                stringWithUTF8String: BOOT_BOX_ID.as_ptr()
            ];
            let count: usize = msg_send![subviews, count];
            for i in 0..count {
                let view: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
                let id: *mut AnyObject = msg_send![view, identifier];
                if id.is_null() {
                    continue;
                }
                let matches: Bool = msg_send![id, isEqualToString: target];
                if matches.as_bool() {
                    let _: () = msg_send![view, removeFromSuperview];
                    return;
                }
            }
        }
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
