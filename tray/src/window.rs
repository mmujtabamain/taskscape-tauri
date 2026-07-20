//! Show / hide / position the mini bar, and coordinate with the main app. The
//! bar is a converted non-activating `NSPanel` that rests parked off-screen while
//! "hidden" (never torn down) and is repositioned over the cursor on reveal —
//! mirroring the old Tauri `window.rs`, but driving the raw `NSWindow` directly.

use taskscape_common::{server, MAIN_PORT};

use crate::{ctx, hotkeys, macos, task, theme};

// ── Reveal / dismiss ─────────────────────────────────────────────────────────

/// Reveal the bar at the cursor, key and pinned onto the current (possibly
/// full-screen) Space. Main thread only.
pub fn show_mini() {
    let ns = macos::window_ptr();
    if ns.is_null() {
        return;
    }
    // Position first, then reveal — parked off-screen there's no stale frame to flash.
    macos::position_at_cursor(ns);
    // Re-assert Space-joining right before showing (must hold at reveal time).
    macos::allow_over_fullscreen(ns);
    ctx::mark_shown();
    ctx::set_open(true);
    macos::make_key(ns);
    macos::order_front_regardless(ns);
    on_reveal();
}

/// Hide the bar. The draft is intentionally left intact so it survives dismissal
/// and returns on the next reveal — only submit or an explicit clear resets it.
///
/// We `orderOut` the window each time (a real hide) rather than parking it
/// off-screen; `show_mini`'s `makeKeyAndOrderFront` re-displays it. The
/// off-screen park is kept for the boot prewarm, just not used here.
pub fn dismiss() {
    ctx::set_open(false);
    macos::order_out(macos::window_ptr());
    // macos::move_off_screen(macos::window_ptr());
}

/// Reveal from a background (capture) thread once a region shot lands.
pub fn reveal_from_bg() {
    let _ = slint::invoke_from_event_loop(show_mini);
}

/// On an active-Space change, re-pin a still-open bar onto the new Space so it
/// stays key and typable.
pub fn repin_if_open() {
    if !ctx::is_open() {
        return;
    }
    let ns = macos::window_ptr();
    macos::allow_over_fullscreen(ns);
    macos::order_front_regardless(ns);
    macos::make_key(ns);
}

/// ⌘Return while the bar is open: submit from the notes editor, else dismiss.
pub fn on_capture_enter() {
    let mut notes_focused = false;
    ctx::with_ui_sync(|ui| notes_focused = ui.get_notes_focused());
    if notes_focused {
        crate::capture::submit();
    } else {
        dismiss();
    }
}

// ── On-reveal refresh ────────────────────────────────────────────────────────

fn on_reveal() {
    refresh_target();
    hotkeys::refresh();
    theme::refresh();
    ctx::with_ui_sync(|ui| ui.invoke_focus_title());
}

/// Load the capture target (project / list) into the footer.
pub fn refresh_target() {
    ctx::runtime().spawn(async {
        let store = ctx::store();
        if let Ok((project, list)) = task::capture_target(&store).await {
            ctx::with_ui(move |ui| {
                ui.set_target_project(project.into());
                ui.set_target_list(list.into());
                ui.set_has_target(true);
            });
        }
    });
}

// ── Main app coordination ────────────────────────────────────────────────────

/// Fire-and-forget POST to the main app (it's frontmost, so it acts on itself).
pub fn route_to_main(path: &'static str) {
    ctx::runtime().spawn(async move {
        let _ = server::client::post_json(MAIN_PORT, path, &serde_json::json!({})).await;
    });
}

/// Bring the main app forward: focus a running instance (HTTP), else launch the
/// installed app. Returns whether a running instance answered.
async fn focus_or_launch_main() -> bool {
    if server::client::post_json(MAIN_PORT, "/focus", &serde_json::json!({}))
        .await
        .is_ok()
    {
        return true;
    }
    let _ = std::process::Command::new("open")
        .args(["-b", "com.taskscape.main.app"])
        .status();
    false
}

/// Fire-and-forget focus/launch (for the tray menu).
pub fn focus_or_launch_main_fire() {
    ctx::runtime().spawn(async {
        focus_or_launch_main().await;
    });
}

/// Footer target: open the main window, then dismiss the bar once main is up so
/// there's no empty gap where neither is on screen.
pub fn open_main() {
    ctx::runtime().spawn(async {
        focus_or_launch_main().await;
        let _ = slint::invoke_from_event_loop(dismiss);
    });
}
