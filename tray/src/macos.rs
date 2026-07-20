//! macOS AppKit interop for the Slint capture bar.
//!
//! The bar is a single, long-lived Slint (winit) window. To behave like the old
//! Tauri mini bar it must: run as a menu-bar **accessory** (no Dock icon), become
//! a **non-activating `NSPanel`** so its text field is typable while floating over
//! another app's full-screen Space *without* activating us, round its corners, and
//! be excludable from its own screenshot grabs. Everything here operates on the
//! raw `NSWindow` behind the Slint window (obtained via raw-window-handle) using
//! `objc2`, mirroring the original `tray/src-tauri/src/{setup,space}.rs`.
//!
//! All functions touch AppKit and must run on the main thread; background callers
//! hop over with `slint::invoke_from_event_loop`.

#![cfg(target_os = "macos")]

use std::ffi::CStr;
use std::sync::OnceLock;

use objc2::runtime::AnyObject;
use objc2::{class, msg_send, sel, Encode, Encoding};

// ── Geometry (CoreGraphics structs, self-contained so we avoid objc2-app-kit) ──

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct CGPoint {
    pub x: f64,
    pub y: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct CGSize {
    pub width: f64,
    pub height: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct CGRect {
    pub origin: CGPoint,
    pub size: CGSize,
}

unsafe impl Encode for CGPoint {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for CGSize {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for CGRect {
    const ENCODING: Encoding =
        Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
}

// ── Window handle ──────────────────────────────────────────────────────────────

/// The stored bar `NSWindow *` (from [`crate::ctx::ns_window`]); null until the
/// window is realized. Lets other modules call these helpers without naming the
/// AppKit pointer type.
pub fn window_ptr() -> *mut AnyObject {
    crate::ctx::ns_window() as *mut AnyObject
}

/// The `NSWindow *` backing a Slint window, or null before it's realized.
pub fn ns_window_of(window: &slint::Window) -> *mut AnyObject {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let slint_handle = window.window_handle();
    let Ok(handle) = slint_handle.window_handle() else {
        return std::ptr::null_mut();
    };
    match handle.as_raw() {
        RawWindowHandle::AppKit(a) => {
            let ns_view = a.ns_view.as_ptr() as *mut AnyObject;
            if ns_view.is_null() {
                return std::ptr::null_mut();
            }
            unsafe { msg_send![ns_view, window] }
        }
        _ => std::ptr::null_mut(),
    }
}

// ── Application-level ────────────────────────────────────────────────────────────

/// Run as an accessory app: no Dock icon, and showing a window does not switch
/// the active app away from whoever is frontmost. Call once, early, on main.
pub fn set_accessory_activation_policy() {
    // NSApplicationActivationPolicyAccessory = 1.
    const NS_ACCESSORY: isize = 1;
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if app.is_null() {
            return;
        }
        let _: bool = msg_send![app, setActivationPolicy: NS_ACCESSORY];
    }
}

/// Whether the OS is in Dark mode (`AppleInterfaceStyle == "Dark"`). Used to
/// resolve the bar's theme when the shared Appearance setting is "system".
pub fn system_is_dark() -> bool {
    unsafe {
        let ud: *mut AnyObject = msg_send![class!(NSUserDefaults), standardUserDefaults];
        if ud.is_null() {
            return false;
        }
        let key = nsstring(c"AppleInterfaceStyle");
        let val: *mut AnyObject = msg_send![ud, stringForKey: key];
        if val.is_null() {
            return false;
        }
        nsstring_to_string(val).eq_ignore_ascii_case("dark")
    }
}

// ── Panel styling ────────────────────────────────────────────────────────────────

/// Turn the frameless window into a rounded, non-activating `NSPanel`.
pub fn style_panel(ns_window: *mut AnyObject) {
    convert_to_panel(ns_window);
    round_corners(ns_window);
    invalidate_shadow(ns_window);
}

/// Swap the window's backing class for a non-activating `NSPanel` subclass (which
/// answers `canBecomeKeyWindow` YES). Done in place with `object_setClass`. Note:
/// winit tracks its `NSWindow` via declared ivars, so it must never *tear down*
/// this window after the swap — the tray keeps it for the whole process and quits
/// via a hard `exit`, never a graceful winit teardown.
pub fn convert_to_panel(ns_window: *mut AnyObject) {
    // NSWindowStyleMaskNonactivatingPanel — receive keys without activating us.
    const NS_NONACTIVATING_PANEL: usize = 1 << 7;

    if ns_window.is_null() {
        return;
    }
    unsafe {
        objc2::ffi::object_setClass(ns_window, panel_class());
        let mask: usize = msg_send![ns_window, styleMask];
        let _: () = msg_send![ns_window, setStyleMask: mask | NS_NONACTIVATING_PANEL];
        // Always inactive while floating over another Space, so opt out of the
        // panel's default hide-on-deactivate.
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
    }
}

fn panel_class() -> *const objc2::runtime::AnyClass {
    use objc2::runtime::{AnyClass, Bool, ClassBuilder, Sel};

    static CLASS: OnceLock<usize> = OnceLock::new();

    extern "C" fn yes(_this: &AnyObject, _cmd: Sel) -> Bool {
        Bool::YES
    }

    *CLASS.get_or_init(|| {
        let superclass = class!(NSPanel);
        let mut builder = ClassBuilder::new(c"TaskscapeCapturePanel", superclass)
            .expect("failed to register TaskscapeCapturePanel");
        unsafe {
            builder.add_method(sel!(canBecomeKeyWindow), yes as extern "C" fn(_, _) -> _);
        }
        builder.register() as *const AnyClass as usize
    }) as *const AnyClass
}

/// Clip the panel's content to rounded corners (13px) against a clear window
/// backing, so the window shadow follows the rounded card.
pub fn round_corners(ns_window: *mut AnyObject) {
    const CORNER_RADIUS: f64 = 13.0;

    if ns_window.is_null() {
        return;
    }
    unsafe {
        let _: () = msg_send![ns_window, setOpaque: false];
        let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
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

/// Recompute the window shadow so it hugs the rounded mask.
pub fn invalidate_shadow(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let _: () = msg_send![ns_window, invalidateShadow];
    }
}

// ── Space / full-screen float ────────────────────────────────────────────────────

/// Let the bar appear over another app's *native fullscreen* Space, floating in
/// front of it: `CanJoinAllSpaces | FullScreenAuxiliary` + a pop-up-menu window
/// level. Re-assert right before each reveal.
pub fn allow_over_fullscreen(ns_window: *mut AnyObject) {
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const MOVE_TO_ACTIVE_SPACE: usize = 1 << 1;
    const MANAGED: usize = 1 << 2;
    const FULL_SCREEN_PRIMARY: usize = 1 << 7;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    const FULL_SCREEN_NONE: usize = 1 << 9;
    // NSPopUpMenuWindowLevel — the level native menus/popovers use.
    const NS_POPUP_MENU_WINDOW_LEVEL: isize = 101;

    if ns_window.is_null() {
        return;
    }
    unsafe {
        let mut behavior: usize = msg_send![ns_window, collectionBehavior];
        behavior &= !(CAN_JOIN_ALL_SPACES | MOVE_TO_ACTIVE_SPACE | MANAGED);
        behavior &= !(FULL_SCREEN_PRIMARY | FULL_SCREEN_AUXILIARY | FULL_SCREEN_NONE);
        behavior |= CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY;
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        let _: () = msg_send![ns_window, setLevel: NS_POPUP_MENU_WINDOW_LEVEL];
    }
}

/// Bring the window to the front of the *currently active* Space without
/// switching Spaces (unlike `makeKeyAndOrderFront`, which can drag focus to the
/// desktop Space).
pub fn order_front_regardless(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }
}

/// Make the panel key so its text field receives keystrokes.
pub fn make_key(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let nil: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![ns_window, makeKeyAndOrderFront: nil];
    }
}

// ── Capture-time chrome ──────────────────────────────────────────────────────────

/// Set the panel's overall opacity (`alphaValue`, 0–1). Used to fade the bar to
/// 25% during an interactive region selection. Main thread only.
pub fn set_window_alpha(ns_window: *mut AnyObject, alpha: f64) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let _: () = msg_send![ns_window, setAlphaValue: alpha];
    }
}

/// Set the panel's `NSWindowSharingType`: `false` → `None` (excluded from every
/// screen capture), `true` → `ReadOnly` (the default, capturable). Applied only
/// around the tray's own grabs so the bar never lands in its own shot. Main
/// thread only.
pub fn set_sharing_type(ns_window: *mut AnyObject, shared: bool) {
    const NS_WINDOW_SHARING_NONE: isize = 0;
    const NS_WINDOW_SHARING_READ_ONLY: isize = 1;

    if ns_window.is_null() {
        return;
    }
    let value = if shared {
        NS_WINDOW_SHARING_READ_ONLY
    } else {
        NS_WINDOW_SHARING_NONE
    };
    unsafe {
        let _: () = msg_send![ns_window, setSharingType: value];
    }
}

// ── Positioning ──────────────────────────────────────────────────────────────────

/// Somewhere no display can reach — the window rests here while "hidden" (it stays
/// shown to winit, which never suspends/drops it; only its position changes).
pub const PARK: CGPoint = CGPoint {
    x: -10_000.0,
    y: -10_000.0,
};

/// Park the window off-screen (an alternative hidden state; kept for the initial
/// boot prewarm).
pub fn move_off_screen(ns_window: *mut AnyObject) {
    set_frame_top_left(ns_window, PARK);
}

/// Order the window off-screen (a real hide, without the winit teardown a `close`
/// would trigger). Used to dismiss the bar; `make_key` re-shows it.
pub fn order_out(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let nil: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![ns_window, orderOut: nil];
    }
}

/// Anchor the bar just up-and-left of the mouse so the title field lands under
/// the cursor, flipping to the other side of the cursor when that would spill off
/// the right/bottom edge of the monitor the cursor is on, then clamping to the
/// monitor's visible frame. Mirrors the old Tauri `cursor_anchor`, computed in a
/// global top-down space and converted back to Cocoa for `setFrameTopLeftPoint:`.
pub fn position_at_cursor(ns_window: *mut AnyObject) {
    // Physical/point offset from the cursor to the bar's top-left.
    const OFF_X: f64 = 24.0;
    const OFF_Y: f64 = 20.0;

    if ns_window.is_null() {
        return;
    }
    let (w, h) = window_size(ns_window);
    let cursor_bl = mouse_location();
    let h0 = primary_height();
    // Global top-down cursor (CoreGraphics-style: origin top-left of primary).
    let cx = cursor_bl.x;
    let cy = h0 - cursor_bl.y;

    let vf = visible_frame_under(cursor_bl);
    let left = vf.origin.x;
    let right = vf.origin.x + vf.size.width;
    // Convert the visible frame to top-down.
    let top = h0 - (vf.origin.y + vf.size.height);
    let bottom = h0 - vf.origin.y;

    let mut x = cx - OFF_X;
    if x + w > right {
        x = cx + OFF_X - w;
    }
    let mut y = cy - OFF_Y;
    if y + h > bottom {
        y = cy + OFF_Y - h;
    }
    x = x.clamp(left, (right - w).max(left));
    y = y.clamp(top, (bottom - h).max(top));

    // Back to Cocoa bottom-left; the top-left point's y is measured from bottom.
    set_frame_top_left(ns_window, CGPoint { x, y: h0 - y });
}

fn set_frame_top_left(ns_window: *mut AnyObject, point: CGPoint) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let _: () = msg_send![ns_window, setFrameTopLeftPoint: point];
    }
}

fn window_size(ns_window: *mut AnyObject) -> (f64, f64) {
    unsafe {
        let frame: CGRect = msg_send![ns_window, frame];
        (frame.size.width, frame.size.height)
    }
}

fn mouse_location() -> CGPoint {
    unsafe { msg_send![class!(NSEvent), mouseLocation] }
}

/// Height of the primary screen (screens[0], origin (0,0)) — the flip reference
/// for converting between Cocoa's bottom-left and a global top-down space.
fn primary_height() -> f64 {
    unsafe {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        if screens.is_null() {
            return 0.0;
        }
        let count: usize = msg_send![screens, count];
        if count == 0 {
            return 0.0;
        }
        let screen: *mut AnyObject = msg_send![screens, objectAtIndex: 0usize];
        let frame: CGRect = msg_send![screen, frame];
        frame.size.height
    }
}

/// The visible frame (menu bar / Dock excluded) of the screen containing `point`
/// (Cocoa bottom-left coords), falling back to the primary screen.
fn visible_frame_under(point: CGPoint) -> CGRect {
    unsafe {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        if screens.is_null() {
            return CGRect::default();
        }
        let count: usize = msg_send![screens, count];
        let mut fallback = CGRect::default();
        for i in 0..count {
            let screen: *mut AnyObject = msg_send![screens, objectAtIndex: i];
            let frame: CGRect = msg_send![screen, frame];
            let visible: CGRect = msg_send![screen, visibleFrame];
            if i == 0 {
                fallback = visible;
            }
            if point.x >= frame.origin.x
                && point.x < frame.origin.x + frame.size.width
                && point.y >= frame.origin.y
                && point.y < frame.origin.y + frame.size.height
            {
                return visible;
            }
        }
        fallback
    }
}

// ── Local key monitor (window-level shortcuts) ───────────────────────────────────

/// A key-down seen by the local monitor while the bar is key.
pub struct KeyPress {
    pub key_code: u16,
    pub chars: String,
    pub cmd: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

/// Install an app-local key-down monitor. It fires only while one of our windows
/// is key (i.e. the bar is open and focused), before the focused Slint field sees
/// the key. `handler` returns `true` to swallow the event (window-level shortcut),
/// `false` to let it fall through to the field. Runs on the main thread.
pub fn install_key_monitor<F>(handler: F)
where
    F: Fn(&KeyPress) -> bool + 'static,
{
    use block2::RcBlock;

    // NSEventMaskKeyDown == 1 << NSKeyDown(10).
    const NS_EVENT_MASK_KEY_DOWN: usize = 1 << 10;
    const NS_SHIFT: usize = 1 << 17;
    const NS_CONTROL: usize = 1 << 18;
    const NS_OPTION: usize = 1 << 19;
    const NS_COMMAND: usize = 1 << 20;

    let block = RcBlock::new(move |event: *mut AnyObject| -> *mut AnyObject {
        if event.is_null() {
            return event;
        }
        unsafe {
            let key_code: u16 = msg_send![event, keyCode];
            let flags: usize = msg_send![event, modifierFlags];
            let ns: *mut AnyObject = msg_send![event, charactersIgnoringModifiers];
            let chars = nsstring_to_string(ns);
            let press = KeyPress {
                key_code,
                chars,
                cmd: flags & NS_COMMAND != 0,
                ctrl: flags & NS_CONTROL != 0,
                alt: flags & NS_OPTION != 0,
                shift: flags & NS_SHIFT != 0,
            };
            if handler(&press) {
                std::ptr::null_mut()
            } else {
                event
            }
        }
    });

    unsafe {
        let _monitor: *mut AnyObject = msg_send![
            class!(NSEvent),
            addLocalMonitorForEventsMatchingMask: NS_EVENT_MASK_KEY_DOWN,
            handler: &*block,
        ];
    }
    // The monitor copies the block; keep ours alive for the process regardless.
    std::mem::forget(block);
}

unsafe fn nsstring_to_string(ns: *mut AnyObject) -> String {
    if ns.is_null() {
        return String::new();
    }
    let cstr: *const std::os::raw::c_char = msg_send![ns, UTF8String];
    if cstr.is_null() {
        return String::new();
    }
    CStr::from_ptr(cstr).to_string_lossy().into_owned()
}

// ── Notification observers (resign-key dismiss + active-Space change) ─────────────
//
// The callbacks are delivered on the main thread, so the actions live in a
// main-thread `thread_local` — no `Send + Sync` bound (which Slint's `Weak`
// wouldn't satisfy).

thread_local! {
    static ON_RESIGN_KEY: std::cell::RefCell<Option<Box<dyn Fn()>>> =
        const { std::cell::RefCell::new(None) };
    static ON_SPACE_CHANGED: std::cell::RefCell<Option<Box<dyn Fn()>>> =
        const { std::cell::RefCell::new(None) };
}

pub fn set_on_resign_key(f: impl Fn() + 'static) {
    ON_RESIGN_KEY.with(|c| *c.borrow_mut() = Some(Box::new(f)));
}
pub fn set_on_space_changed(f: impl Fn() + 'static) {
    ON_SPACE_CHANGED.with(|c| *c.borrow_mut() = Some(Box::new(f)));
}

extern "C" fn resign_key(_this: &AnyObject, _cmd: objc2::runtime::Sel, _n: *mut AnyObject) {
    ON_RESIGN_KEY.with(|c| {
        if let Some(f) = c.borrow().as_ref() {
            f();
        }
    });
}
extern "C" fn space_changed(_this: &AnyObject, _cmd: objc2::runtime::Sel, _n: *mut AnyObject) {
    ON_SPACE_CHANGED.with(|c| {
        if let Some(f) = c.borrow().as_ref() {
            f();
        }
    });
}

fn observer_class() -> *const objc2::runtime::AnyClass {
    use objc2::runtime::{AnyClass, ClassBuilder};

    static CLASS: OnceLock<usize> = OnceLock::new();
    *CLASS.get_or_init(|| {
        let superclass = class!(NSObject);
        let mut builder = ClassBuilder::new(c"TaskscapeBarObserver", superclass)
            .expect("failed to register TaskscapeBarObserver");
        unsafe {
            builder.add_method(sel!(resignKey:), resign_key as extern "C" fn(_, _, _));
            builder.add_method(sel!(spaceChanged:), space_changed as extern "C" fn(_, _, _));
        }
        builder.register() as *const AnyClass as usize
    }) as *const AnyClass
}

/// One shared, intentionally-leaked observer object carrying both callbacks (the
/// notification centers hold it unretained, so it must outlive the process).
fn shared_observer() -> *mut AnyObject {
    static OBSERVER: OnceLock<usize> = OnceLock::new();
    (*OBSERVER.get_or_init(|| {
        let cls: *const objc2::runtime::AnyClass = observer_class();
        let obj: *mut AnyObject = unsafe { msg_send![cls, new] };
        obj as usize
    })) as *mut AnyObject
}

/// Subscribe to `NSWorkspaceActiveSpaceDidChangeNotification` so a desktop switch
/// can be told apart from a click-away (a still-visible bar is re-pinned).
pub fn observe_space_changes() {
    unsafe {
        let observer = shared_observer();
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let center: *mut AnyObject = msg_send![workspace, notificationCenter];
        let name = nsstring(c"NSWorkspaceActiveSpaceDidChangeNotification");
        let _: () = msg_send![
            center,
            addObserver: observer,
            selector: sel!(spaceChanged:),
            name: name,
            object: std::ptr::null_mut::<AnyObject>(),
        ];
    }
}

/// Subscribe to `NSWindowDidResignKeyNotification` for our bar so a click-away
/// (the panel losing key) dismisses it. Call once, after the window is realized.
pub fn observe_resign_key(ns_window: *mut AnyObject) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let observer = shared_observer();
        let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
        let name = nsstring(c"NSWindowDidResignKeyNotification");
        let _: () = msg_send![
            center,
            addObserver: observer,
            selector: sel!(resignKey:),
            name: name,
            object: ns_window,
        ];
    }
}

unsafe fn nsstring(s: &CStr) -> *mut AnyObject {
    msg_send![class!(NSString), stringWithUTF8String: s.as_ptr()]
}
