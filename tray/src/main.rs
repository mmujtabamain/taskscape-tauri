//! Taskscape's always-on menu-bar capture agent, as a standalone Slint app.
//!
//! Replaces the former Tauri build: one process owns a single Slint window (the
//! frameless "mini" capture bar), a menu-bar tray icon (`tray-icon`), the OS
//! global shortcuts (`global-hotkey`), the localhost HTTP endpoint the main app
//! talks to (`axum`), and screenshot capture — all wired through the shared
//! `taskscape_common` crate and driven from one winit/Slint event loop.

// Launch as a macOS agent (no Dock icon) even as a plain executable: an embedded
// Info.plist with LSUIElement is read by LaunchServices the same way a bundle's
// would be.
#![cfg_attr(all(target_os = "macos", not(debug_assertions)), windows_subsystem = "windows")]

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use global_hotkey::{GlobalHotKeyEvent, HotKeyState};
use slint::ComponentHandle;
use tray_icon::menu::MenuEvent;

use taskscape_common::Store;

slint::include_modules!();

mod capture;
mod ctx;
mod http;
mod hotkeys;
#[cfg(target_os = "macos")]
mod macos;
mod menubar;
mod task;
mod theme;
mod window;

#[cfg(target_os = "macos")]
#[used]
#[link_section = "__TEXT,__info_plist"]
static INFO_PLIST: [u8; include_bytes!("../Info.plist").len()] = *include_bytes!("../Info.plist");

thread_local! {
    // Slint timers stop when dropped; keep the boot + event-poll timers alive for
    // the process.
    static TIMERS: RefCell<Vec<Rc<slint::Timer>>> = const { RefCell::new(Vec::new()) };
}
fn keep(timer: Rc<slint::Timer>) {
    TIMERS.with(|v| v.borrow_mut().push(timer));
}

fn main() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    let store = Arc::new(
        runtime
            .block_on(Store::open())
            .expect("open taskscape store"),
    );
    ctx::set_store(store);
    ctx::set_runtime(runtime);

    macos::set_accessory_activation_policy();

    let ui = MiniBar::new().expect("create MiniBar");
    ctx::set_ui(ui.as_weak());
    wire_callbacks(&ui);

    // Serve HTTP once the store + runtime are up.
    http::serve();

    // Rest the window off-screen so its first real reveal doesn't flash.
    ui.window()
        .set_position(slint::PhysicalPosition::new(-10_000, -10_000));

    start_boot(&ui);
    start_event_poll();

    ui.run().expect("run event loop");
    // Quit goes through a hard `exit` (see menubar::quit_all); never reached.
    std::process::exit(0);
}

fn wire_callbacks(ui: &MiniBar) {
    ui.on_submit(capture::submit);
    ui.on_clear_draft(capture::clear_draft);
    ui.on_open_main(window::open_main);
    ui.on_add_screenshot(capture::capture_and_attach);
}

/// Bring up the parts that need the running `NSApplication` (tray icon, global
/// hotkeys, key monitor, observers) and, once the Slint window is realized, style
/// it as a rounded non-activating panel. Armed before the loop starts; it fires
/// during the loop and stops itself once the window is up.
fn start_boot(ui: &MiniBar) {
    macos::set_accessory_activation_policy();

    let weak = ui.as_weak();
    let timer = Rc::new(slint::Timer::default());
    let this = timer.clone();
    let did_services = Cell::new(false);
    let tries = Cell::new(0u32);

    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(16),
        move || {
            macos::set_accessory_activation_policy();
            tries.set(tries.get() + 1);

            if !did_services.replace(true) {
                menubar::build();
                install_monitor_and_observers();
                hotkeys::refresh();
                theme::refresh();
                window::refresh_target();
            }

            if let Some(ui) = weak.upgrade() {
                let ns = macos::ns_window_of(ui.window());
                if !ns.is_null() {
                    ctx::set_ns_window(ns as usize);
                    macos::style_panel(ns);
                    macos::observe_resign_key(ns);
                    macos::move_off_screen(ns);
                    this.stop();
                    return;
                }
            }
            if tries.get() > 300 {
                this.stop();
            }
        },
    );
    keep(timer);
}

fn install_monitor_and_observers() {
    macos::install_key_monitor(handle_key);
    macos::set_on_resign_key(|| {
        // A blur that isn't the panel settling onto a Space is a click-away.
        if ctx::is_open() && !ctx::just_revealed() {
            window::dismiss();
        }
    });
    macos::set_on_space_changed(window::repin_if_open);
    macos::observe_space_changes();
}

/// Window-level keyboard shortcuts, seen before the focused field (see
/// `macos::install_key_monitor`). Returns whether the key was swallowed.
fn handle_key(kp: &macos::KeyPress) -> bool {
    if !ctx::is_open() {
        return false;
    }
    // Escape → dismiss.
    if kp.key_code == 53 && !kp.cmd && !kp.ctrl && !kp.alt {
        window::dismiss();
        return true;
    }
    // The customizable clear-draft combo → wipe the draft.
    if hotkeys::clear_matches(kp) {
        capture::clear_draft();
        return true;
    }
    // Tab (no modifiers) with notes closed → open the notes editor.
    if kp.key_code == 48 && !kp.cmd && !kp.ctrl && !kp.alt && !kp.shift {
        let mut notes_open = true;
        ctx::with_ui_sync(|ui| notes_open = ui.get_notes_open());
        if !notes_open {
            ctx::with_ui_sync(|ui| ui.set_notes_open(true));
            return true;
        }
    }
    false
}

/// Poll the `global-hotkey` and `tray-icon` menu channels on the event loop and
/// dispatch. (These crates deliver events via global channels; polling on a Slint
/// timer keeps all handling on the main thread.)
fn start_event_poll() {
    let timer = Rc::new(slint::Timer::default());
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(30),
        || {
            while let Ok(event) = GlobalHotKeyEvent::receiver().try_recv() {
                if event.state == HotKeyState::Pressed {
                    hotkeys::dispatch(event.id);
                }
            }
            while let Ok(event) = MenuEvent::receiver().try_recv() {
                menubar::dispatch(event.id);
            }
        },
    );
    keep(timer);
}
