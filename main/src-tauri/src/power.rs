//! macOS Low Power Mode detection. When the system enters Low Power Mode the
//! app forces its reduced-motion path (the same neutralization as the OS
//! "Reduce Motion" accessibility setting): the frontend zeroes animation
//! durations and shows a title-bar indicator. Public Foundation API throughout.

#[cfg(target_os = "macos")]
use std::sync::OnceLock;

use tauri::{AppHandle, Emitter};

/// Event the frontend listens on; payload is the current Low Power Mode boolean.
pub const POWER_EVENT: &str = "power-state-changed";

/// Whether macOS is currently in Low Power Mode. Always false off macOS — the
/// concept doesn't exist there.
pub fn is_low_power_mode() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2::{
            msg_send,
            runtime::{AnyObject, Bool},
        };

        unsafe {
            let info: *mut AnyObject = msg_send![objc2::class!(NSProcessInfo), processInfo];
            if info.is_null() {
                return false;
            }
            let enabled: Bool = msg_send![info, isLowPowerModeEnabled];
            enabled.as_bool()
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Watch for Low Power Mode changes, emitting [`POWER_EVENT`] with the new state
/// each time it flips. Registers a Foundation notification observer
/// (`NSProcessInfoPowerStateDidChangeNotification`); the observer instance lives
/// for the app's lifetime. No-op off macOS.
pub fn start_watching(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        // Ignore a second call: the observer is registered exactly once.
        if APP.set(app.clone()).is_err() {
            return;
        }

        use objc2::{msg_send, runtime::AnyObject};

        // SAFETY: AppKit registration is main-thread-only, but the notification
        // center and NSObject registration used here are thread-safe. This runs
        // from Tauri's `setup`, off the AppKit main thread, which is fine for
        // adding an observer.
        unsafe {
            let class = &*observer_class();
            // +1 retained and intentionally never released: it must outlive the app.
            let observer: *mut AnyObject = msg_send![class, new];
            let center: *mut AnyObject =
                msg_send![objc2::class!(NSNotificationCenter), defaultCenter];
            let name: *mut AnyObject = msg_send![
                objc2::class!(NSString),
                stringWithUTF8String: c"NSProcessInfoPowerStateDidChangeNotification".as_ptr()
            ];
            let _: () = msg_send![
                center,
                addObserver: observer,
                selector: objc2::sel!(powerStateChanged:),
                name: name,
                object: std::ptr::null_mut::<AnyObject>(),
            ];
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

/// A tiny `NSObject` subclass whose only job is to forward the power-state
/// notification into a Tauri event. Mirrors the `ClassBuilder` pattern used for
/// the modal panel subclass in `panels.rs`. Returned as a raw pointer so it can
/// cross the `OnceLock`.
#[cfg(target_os = "macos")]
fn observer_class() -> *const objc2::runtime::AnyClass {
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};

    static CLASS: OnceLock<usize> = OnceLock::new();

    extern "C" fn power_state_changed(_this: &AnyObject, _cmd: Sel, _note: *mut AnyObject) {
        if let Some(app) = APP.get() {
            let _ = app.emit(POWER_EVENT, is_low_power_mode());
        }
    }

    *CLASS.get_or_init(|| {
        let superclass = objc2::class!(NSObject);
        let mut builder = ClassBuilder::new(c"TaskscapePowerObserver", superclass)
            .expect("failed to register TaskscapePowerObserver");
        unsafe {
            builder.add_method(
                objc2::sel!(powerStateChanged:),
                power_state_changed as extern "C" fn(_, _, _),
            );
        }
        builder.register() as *const AnyClass as usize
    }) as *const AnyClass
}
