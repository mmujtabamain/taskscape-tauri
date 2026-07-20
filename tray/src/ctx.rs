//! Process-wide state for the tray agent, replacing what Tauri's managed state /
//! `AppHandle` used to hold: the DB store, a tokio runtime, the resolved theme,
//! the mini bar's `slint::Weak` handle, and the small flags the show/hide and
//! capture logic coordinate through.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use taskscape_common::Store;

use crate::MiniBar;

static STORE: OnceLock<Arc<Store>> = OnceLock::new();
static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
static UI: Mutex<Option<slint::Weak<MiniBar>>> = Mutex::new(None);

/// The raw `NSWindow *` (as `usize`) once the Slint window is realized; 0 before.
static NS_WINDOW: AtomicUsize = AtomicUsize::new(0);
/// Whether the main app reports itself frontmost (global combos then act on it).
static MAIN_FOCUSED: AtomicBool = AtomicBool::new(false);
/// A screenshot capture is in flight (a second trigger is ignored until it ends).
static CAPTURING: AtomicBool = AtomicBool::new(false);
/// Whether the bar is currently revealed (on-screen), vs parked off-screen.
static OPEN: AtomicBool = AtomicBool::new(false);
static LAST_SHOWN: Mutex<Option<Instant>> = Mutex::new(None);

/// A blur arriving within this window of a reveal is the panel settling onto a
/// Space, not a click-away.
const REVEAL_GRACE: Duration = Duration::from_millis(500);

// ── Store / runtime ──────────────────────────────────────────────────────────

pub fn set_store(store: Arc<Store>) {
    let _ = STORE.set(store);
}
pub fn store() -> Arc<Store> {
    STORE.get().expect("store not initialized").clone()
}

pub fn set_runtime(rt: tokio::runtime::Runtime) {
    let _ = RUNTIME.set(rt);
}
pub fn runtime() -> &'static tokio::runtime::Runtime {
    RUNTIME.get().expect("runtime not initialized")
}

// ── UI handle ────────────────────────────────────────────────────────────────

pub fn set_ui(weak: slint::Weak<MiniBar>) {
    *UI.lock().unwrap() = Some(weak);
}
fn ui_weak() -> Option<slint::Weak<MiniBar>> {
    UI.lock().unwrap().clone()
}

/// Run `f` against the bar on the Slint event loop (safe from any thread).
pub fn with_ui(f: impl FnOnce(MiniBar) + Send + 'static) {
    if let Some(weak) = ui_weak() {
        let _ = weak.upgrade_in_event_loop(f);
    }
}

/// Run `f` against the bar *now* — only valid on the Slint (main) thread, e.g.
/// from a hotkey/menu dispatch or an AppKit notification callback.
pub fn with_ui_sync(f: impl FnOnce(&MiniBar)) {
    if let Some(weak) = ui_weak() {
        if let Some(ui) = weak.upgrade() {
            f(&ui);
        }
    }
}

// ── NSWindow pointer ─────────────────────────────────────────────────────────

pub fn set_ns_window(ptr: usize) {
    NS_WINDOW.store(ptr, Ordering::Release);
}
pub fn ns_window() -> usize {
    NS_WINDOW.load(Ordering::Acquire)
}

// ── Flags ────────────────────────────────────────────────────────────────────

pub fn set_main_focused(v: bool) {
    MAIN_FOCUSED.store(v, Ordering::Release);
}
pub fn main_focused() -> bool {
    MAIN_FOCUSED.load(Ordering::Acquire)
}

/// Atomically claim the capture slot; returns the previous value (true → a
/// capture is already running, so the caller should bail).
pub fn capturing_swap(v: bool) -> bool {
    CAPTURING.swap(v, Ordering::AcqRel)
}
pub fn set_capturing(v: bool) {
    CAPTURING.store(v, Ordering::Release);
}

pub fn set_open(v: bool) {
    OPEN.store(v, Ordering::Release);
}
pub fn is_open() -> bool {
    OPEN.load(Ordering::Acquire)
}

pub fn mark_shown() {
    if let Ok(mut g) = LAST_SHOWN.lock() {
        *g = Some(Instant::now());
    }
}
/// Whether the bar was revealed within the last [`REVEAL_GRACE`].
pub fn just_revealed() -> bool {
    LAST_SHOWN
        .lock()
        .ok()
        .and_then(|g| *g)
        .is_some_and(|t| t.elapsed() < REVEAL_GRACE)
}
