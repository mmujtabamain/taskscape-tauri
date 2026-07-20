//! The menu-bar tray icon and its right-click menu, via the `tray-icon` crate
//! (what Tauri used under the hood). The icon + menu ids live in a main-thread
//! `thread_local`; menu clicks are routed from the event-poll timer.

use std::cell::RefCell;

use taskscape_common::{server, MAIN_PORT};
use tray_icon::menu::{Menu, MenuId, MenuItem};
use tray_icon::{TrayIcon, TrayIconBuilder};

use crate::{ctx, window};

struct Ids {
    open: Option<MenuId>,
    quit: Option<MenuId>,
}

thread_local! {
    static TRAY: RefCell<Option<TrayIcon>> = const { RefCell::new(None) };
    static IDS: RefCell<Ids> = const { RefCell::new(Ids { open: None, quit: None }) };
}

/// Build the tray icon with an "Open / Quit" menu. Must run on the main thread
/// after the app is up (an `NSStatusItem` needs the running `NSApplication`).
pub fn build() {
    let open = MenuItem::new("Open Taskscape", true, None);
    let quit = MenuItem::new("Quit Taskscape", true, None);
    let menu = Menu::new();
    let _ = menu.append(&open);
    let _ = menu.append(&quit);

    IDS.with(|c| {
        let mut ids = c.borrow_mut();
        ids.open = Some(open.id().clone());
        ids.quit = Some(quit.id().clone());
    });

    match TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip("Taskscape")
        .with_icon(load_icon())
        .with_menu_on_left_click(true)
        .build()
    {
        Ok(tray) => TRAY.with(|c| *c.borrow_mut() = Some(tray)),
        Err(e) => eprintln!("[taskscape-tray] failed to build tray icon: {e}"),
    }
}

/// Route a menu click (from the event-poll timer).
pub fn dispatch(id: MenuId) {
    let (open, quit) = IDS.with(|c| {
        let ids = c.borrow();
        (
            ids.open.as_ref() == Some(&id),
            ids.quit.as_ref() == Some(&id),
        )
    });
    if open {
        window::focus_or_launch_main_fire();
    } else if quit {
        quit_all();
    }
}

/// Keep the tray tooltip's advertised capture combo in sync.
pub fn set_tooltip(tip: String) {
    TRAY.with(|c| {
        if let Some(tray) = c.borrow().as_ref() {
            let _ = tray.set_tooltip(Some(tip));
        }
    });
}

/// Quit everything: ask the main app to exit too (best effort), then hard-exit.
/// A hard exit is deliberate — winit must never tear down the class-swapped panel
/// (see `macos::convert_to_panel`).
fn quit_all() -> ! {
    ctx::runtime().block_on(async {
        let _ = server::client::post_json(MAIN_PORT, "/quit", &serde_json::json!({})).await;
    });
    std::process::exit(0);
}

fn load_icon() -> tray_icon::Icon {
    let bytes = include_bytes!("../icons/32x32.png");
    let image = image::load_from_memory(bytes)
        .expect("decode tray icon")
        .into_rgba8();
    let (width, height) = image.dimensions();
    tray_icon::Icon::from_rgba(image.into_raw(), width, height).expect("build tray icon")
}
