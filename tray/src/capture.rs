//! Screenshot capture + the in-progress draft. What used to be the React
//! `useCaptureDraft` hook (attached screenshots, in-flight count, error) now lives
//! here in Rust; the title/notes text lives in the Slint UI. The blocking
//! `screencapture` shell-out runs off the event loop and drives the bar through
//! `ctx::with_ui`, exactly like the old `screenshot-*` events did.

use std::sync::Mutex;
use std::time::Duration;

use slint::ComponentHandle;
use taskscape_common::screenshot;

use crate::{ctx, macos, task, window, MiniBar};

#[derive(Default)]
struct Draft {
    screenshots: Vec<String>,
    pending: u32,
}

static DRAFT: Mutex<Draft> = Mutex::new(Draft {
    screenshots: Vec::new(),
    pending: 0,
});

/// Whether the user has chosen interactive region capture over full-screen.
pub fn region_mode() -> bool {
    screenshot::CaptureMode::current() == screenshot::CaptureMode::Region
}

/// How the bar should behave around a capture (matters only for region grabs).
#[derive(Default, Clone, Copy)]
pub struct CaptureUi {
    pub reveal_on_success: bool,
    pub dim_during_capture: bool,
}

// ── Triggers ─────────────────────────────────────────────────────────────────

/// The bar's screenshot button: capture and attach, never revealing/hiding.
pub fn capture_and_attach() {
    spawn_capture(CaptureUi {
        reveal_on_success: false,
        dim_during_capture: region_mode(),
    });
}

/// The ⌘⇧Return path. Full-screen: summon the bar instantly (it's excluded from
/// the grab), then capture. Region: don't reveal a closed bar until the user
/// finalizes a selection; dim an already-open bar while selecting.
pub fn capture_and_show() {
    let open = ctx::is_open();
    if region_mode() {
        spawn_capture(CaptureUi {
            reveal_on_success: !open,
            dim_during_capture: open,
        });
    } else {
        if !open {
            window::show_mini();
        }
        spawn_capture(CaptureUi::default());
    }
}

// ── Capture thread ───────────────────────────────────────────────────────────

fn spawn_capture(ui: CaptureUi) {
    if ctx::capturing_swap(true) {
        return; // a capture is already running
    }
    pending_inc();

    std::thread::spawn(move || {
        struct Flag;
        impl Drop for Flag {
            fn drop(&mut self) {
                ctx::set_capturing(false);
            }
        }
        let _flag = Flag;

        // Fade the bar down first (region grabs), restored on any exit.
        let _dim = ui.dim_during_capture.then(|| {
            on_main(|| macos::set_window_alpha(macos::window_ptr(), 0.25));
            DimRestore
        });

        // Exclude the bar from *this* grab, restored (even on error) afterwards.
        on_main_blocking(|| macos::set_sharing_type(macos::window_ptr(), false));
        std::thread::sleep(Duration::from_millis(60));
        let _restore = SharingRestore;

        match screenshot::capture() {
            Ok(Some(path)) => {
                captured(path.to_string_lossy().into_owned());
                if ui.reveal_on_success {
                    window::reveal_from_bg();
                }
            }
            Ok(None) => cancelled(),
            Err(e) => errored(e.to_string()),
        }
    });
}

// ── Draft mutation → UI ──────────────────────────────────────────────────────

fn pending_inc() {
    DRAFT.lock().unwrap().pending += 1;
    ctx::with_ui(|ui: MiniBar| {
        ui.set_capturing(true);
        ui.set_capture_error("".into());
    });
}

fn captured(path: String) {
    let count = {
        let mut d = DRAFT.lock().unwrap();
        d.pending = d.pending.saturating_sub(1);
        d.screenshots.push(path);
        d.screenshots.len()
    };
    let capturing = pending() > 0;
    ctx::with_ui(move |ui: MiniBar| {
        ui.set_shot_count(count as i32);
        ui.set_capturing(capturing);
        ui.invoke_focus_title();
    });
}

fn cancelled() {
    dec_pending();
    let capturing = pending() > 0;
    ctx::with_ui(move |ui: MiniBar| {
        ui.set_capturing(capturing);
        ui.invoke_focus_title();
    });
}

fn errored(msg: String) {
    dec_pending();
    let capturing = pending() > 0;
    let msg = if msg.trim().is_empty() {
        "Screenshot failed".to_string()
    } else {
        msg
    };
    ctx::with_ui(move |ui: MiniBar| {
        ui.set_capturing(capturing);
        ui.set_capture_error(msg.into());
        ui.invoke_focus_title();
        // Clear the surfaced error after a few seconds.
        let weak = ui.as_weak();
        slint::Timer::single_shot(Duration::from_secs(4), move || {
            if let Some(ui) = weak.upgrade() {
                ui.set_capture_error("".into());
            }
        });
    });
}

fn dec_pending() {
    let mut d = DRAFT.lock().unwrap();
    d.pending = d.pending.saturating_sub(1);
}
fn pending() -> u32 {
    DRAFT.lock().unwrap().pending
}

// ── Submit / clear ───────────────────────────────────────────────────────────

/// Create the task from the current draft, then clear + dismiss on success.
pub fn submit() {
    let mut title = String::new();
    let mut notes = String::new();
    ctx::with_ui_sync(|ui| {
        title = ui.get_title_text().to_string();
        notes = ui.get_notes_text().to_string();
    });
    let title = title.trim().to_string();
    if title.is_empty() {
        return;
    }
    let notes = (!notes.trim().is_empty()).then_some(notes);
    let screenshots = DRAFT.lock().unwrap().screenshots.clone();

    ctx::runtime().spawn(async move {
        let store = ctx::store();
        match task::create(&store, &title, notes.as_deref(), &screenshots).await {
            Ok(()) => {
                clear_draft();
                let _ = slint::invoke_from_event_loop(window::dismiss);
            }
            Err(e) => eprintln!("[taskscape-tray] submit failed: {e}"),
        }
    });
}

/// Wipe the draft back to an empty capture (submit + explicit clear).
pub fn clear_draft() {
    {
        let mut d = DRAFT.lock().unwrap();
        d.screenshots.clear();
        d.pending = 0;
    }
    ctx::with_ui(|ui: MiniBar| {
        ui.set_title_text("".into());
        ui.set_notes_text("".into());
        ui.set_notes_open(false);
        ui.set_shot_count(0);
        ui.set_capturing(false);
        ui.set_capture_error("".into());
        ui.invoke_focus_title();
    });
}

// ── main-thread hops ─────────────────────────────────────────────────────────

fn on_main(f: impl FnOnce() + Send + 'static) {
    let _ = slint::invoke_from_event_loop(f);
}

/// Run `f` on the event loop and wait for it (so an exclusion is committed before
/// the grab). Times out rather than hanging if the loop is busy.
fn on_main_blocking(f: impl FnOnce() + Send + 'static) {
    let (tx, rx) = std::sync::mpsc::channel();
    let posted = slint::invoke_from_event_loop(move || {
        f();
        let _ = tx.send(());
    });
    if posted.is_ok() {
        let _ = rx.recv_timeout(Duration::from_millis(500));
    }
}

struct DimRestore;
impl Drop for DimRestore {
    fn drop(&mut self) {
        on_main(|| macos::set_window_alpha(macos::window_ptr(), 1.0));
    }
}

struct SharingRestore;
impl Drop for SharingRestore {
    fn drop(&mut self) {
        on_main(|| macos::set_sharing_type(macos::window_ptr(), true));
    }
}
