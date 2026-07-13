/// macOS: `spaceChanged:` — fired by [`observe_space_changes`] on every active-
/// Space change. Re-pins a still-visible bar (one summoned within the reveal
/// grace, just before the switch) onto the new Space so it stays key and typable.
#[cfg(target_os = "macos")]
extern "C" fn space_changed(
    _this: &objc2::runtime::AnyObject,
    _cmd: objc2::runtime::Sel,
    _note: *mut objc2::runtime::AnyObject,
) {
    use tauri::Manager;

    use crate::get_app_handle;

    if let Some(window) = get_app_handle()
        .get()
        .and_then(|app| app.get_webview_window("main"))
    {
        if window.is_visible().unwrap_or(false) {
            use crate::setup::{allow_over_fullscreen, order_front_regardless};

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
    use std::sync::OnceLock;

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
pub fn observe_space_changes() {
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
