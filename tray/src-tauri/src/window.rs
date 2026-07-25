use std::{
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

#[cfg(target_os = "macos")]
use crate::setup::{allow_over_fullscreen, order_front_regardless};
use crate::{
    capture::{region_mode, spawn_capture, spawn_capture_with, CaptureUi},
    err, focus_or_launch_main_async,
};

/// Somewhere no display can reach — the window "rests" here while hidden so that
/// a one-frame show-before-move never flashes at a stale on-screen position.
const PARK: (i32, i32) = (-10_000, -10_000);

/// The tallest the card can grow (logical px), i.e. notes expanded to the
/// editor's `max-h-40` cap. The window itself is fitted to the card, so this is
/// only used to pick the summon anchor: the growth direction has to hold for the
/// expanded card, not just the collapsed one it's summoned as.
const MAX_BAR_HEIGHT: f64 = 300.0;

/// Reveal the mini window at the cursor, focused and pinned onto the current
/// (possibly full-screen) Space.
fn show_mini(app: &AppHandle, window: &tauri::WebviewWindow) {
    // Move to the cursor first, THEN reveal. Because the window rests off-screen
    // while hidden, there is no old on-screen frame to flash.
    let anchor = match cursor_anchor(app, window) {
        Some((pos, anchor)) => {
            let _ = window.set_position(pos);
            anchor
        }
        None => VAnchor::Top,
    };
    // Remember it: `set_bar_height` holds this edge still as the card resizes.
    if let Ok(mut guard) = current_anchor().lock() {
        *guard = anchor;
    }
    // Re-assert the Space-joining behavior right before showing: it must be in
    // effect at the moment we reveal/focus, or macOS shows the window on the
    // desktop Space instead of the active full-screen one.
    #[cfg(target_os = "macos")]
    allow_over_fullscreen(window);
    if let Ok(mut guard) = last_shown().lock() {
        *guard = Some(Instant::now());
    }
    let _ = window.show();
    let _ = window.set_focus();
    // ...then pin it onto the current (possibly full-screen) Space.
    #[cfg(target_os = "macos")]
    order_front_regardless(window);
    // Tell the webview which window edge to anchor the card to for this reveal
    // (and, by arriving, that it's safe to paint the card again — see `dismiss`).
    let _ = window.emit("mini-shown", anchor.as_str());
}

/// Reveal the mini bar from a background thread's `run_on_main_thread` callback
/// (the deferred-reveal region-capture path): derive the app handle from the
/// window and show it at the cursor.
pub(crate) fn reveal_mini(window: &tauri::WebviewWindow) {
    let app = window.app_handle().clone();
    show_mini(&app, window);
}

/// Toggle the mini window: hide if visible, otherwise show it at the cursor.
pub fn toggle_mini(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        dismiss(&window);
    } else {
        show_mini(app, &window);
    }
}

#[tauri::command]
pub fn hide_mini(window: tauri::WebviewWindow) -> Result<(), String> {
    dismiss(&window);
    Ok(())
}

/// Hide the window and park it off-screen. The draft it holds is intentionally
/// left intact so it survives dismissal and is restored on the next reveal —
/// only submitting a capture or an explicit clear (⌘⇧⌫ / the Clear button)
/// resets the form.
pub fn dismiss(window: &tauri::WebviewWindow) {
    // Hide the card too, so the next reveal can't flash it at this summon's
    // anchor for a frame before Rust reports the new one (see `show_mini`).
    let _ = window.emit("mini-hidden", ());
    let _ = window.hide();
    let _ = window.set_position(PhysicalPosition::new(PARK.0, PARK.1));
}

/// Which edge of the window stays put for a given reveal as the card resizes.
/// `Top` lets the card grow downward, `Bottom` upward — chosen so it keeps
/// landing at the cursor whether it was summoned near the top or the bottom of
/// the screen.
#[derive(Clone, Copy)]
enum VAnchor {
    Top,
    Bottom,
}

impl VAnchor {
    fn as_str(self) -> &'static str {
        match self {
            VAnchor::Top => "top",
            VAnchor::Bottom => "bottom",
        }
    }
}

/// The anchor the current summon chose — the window edge [`set_bar_height`]
/// keeps still while the card grows and shrinks.
fn current_anchor() -> &'static Mutex<VAnchor> {
    static ANCHOR: OnceLock<Mutex<VAnchor>> = OnceLock::new();
    ANCHOR.get_or_init(|| Mutex::new(VAnchor::Top))
}

/// The display a bar frame is being placed on: the box its frame is kept inside,
/// plus that display's scale factor (all physical pixels). The bar is a
/// pop-up-menu-level panel, so it may draw over the Dock like a context menu —
/// left / right / bottom clamp to the physical display — but never over the menu
/// bar, so the top clamps to the work area.
struct Display {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
    scale: f64,
}

impl Display {
    /// The display containing (`x`, `y`), falling back to the primary.
    fn at(window: &tauri::WebviewWindow, x: f64, y: f64) -> Option<Self> {
        let monitor = window
            .monitor_from_point(x, y)
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten())?;
        let pos = monitor.position();
        let size = monitor.size();
        let area = monitor.work_area();
        Some(Self {
            left: pos.x as f64,
            top: area.position.y as f64,
            right: pos.x as f64 + size.width as f64,
            bottom: pos.y as f64 + size.height as f64,
            scale: monitor.scale_factor(),
        })
    }

    /// Keep a `w`×`h` frame at (`x`, `y`) fully on this display.
    fn clamp(&self, x: f64, y: f64, w: f64, h: f64) -> (f64, f64) {
        (
            x.clamp(self.left, (self.right - w).max(self.left)),
            y.clamp(self.top, (self.bottom - h).max(self.top)),
        )
    }
}

/// Where the mini bar is anchored when summoned: just up-and-left of the cursor
/// so the title field lands under it. If placing it there would push the bar
/// past the right or bottom edge of the monitor the cursor is on, it flips to
/// the opposite side of the cursor; a final clamp keeps the whole frame on the
/// display (it may overlap the Dock, but its top stays below the menu bar).
fn cursor_anchor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
) -> Option<(PhysicalPosition<i32>, VAnchor)> {
    // Physical offset from the cursor to the bar's top-left in the default
    // (down-and-right) placement.
    const OFF_X: f64 = 24.0;
    const OFF_Y: f64 = 20.0;

    let cursor = app.cursor_position().ok()?;
    let size = window.outer_size().ok()?;
    let (w, h) = (size.width as f64, size.height as f64);
    let display = Display::at(window, cursor.x, cursor.y)?;

    // Default down-and-right of the cursor; flip to the other side when that
    // side would spill off the right / bottom edge. A vertical flip means the
    // cursor is near the bottom, so the card anchors to the window's bottom and
    // grows upward instead of downward.
    let mut x = cursor.x - OFF_X;
    if x + w > display.right {
        x = cursor.x + OFF_X - w;
    }
    let mut y = cursor.y - OFF_Y;
    let mut anchor = VAnchor::Top;
    // Flip against the *expanded* card, not the (usually collapsed) one being
    // summoned: near the screen's bottom there's room for the collapsed bar
    // below the cursor but not for the notes it may grow, and the growth
    // direction is fixed for the whole summon.
    if y + MAX_BAR_HEIGHT * display.scale > display.bottom {
        y = cursor.y + OFF_Y - h;
        anchor = VAnchor::Bottom;
    }

    // Whatever the flip chose, never let the frame leave the display — the top
    // clamps below the menu bar, the other edges to the physical bounds (covers
    // the top/left edges and monitors smaller than the bar).
    let (x, y) = display.clamp(x, y, w, h);

    Some((PhysicalPosition::new(x as i32, y as i32), anchor))
}

/// The window height (physical px) we last asked for. macOS applies `set_size`
/// asynchronously, so reading the window back right after a resize can still
/// report the old height — which would make the next resize move the anchored
/// edge by the wrong amount. `0` means "not measured yet".
fn applied_height() -> &'static AtomicU32 {
    static HEIGHT: OnceLock<AtomicU32> = OnceLock::new();
    HEIGHT.get_or_init(|| AtomicU32::new(0))
}

/// Fit the window to the card. The webview reports the card's height (logical
/// px) whenever it changes — the notes opening, the editor growing with the text
/// — because the window is transparent but not click-through: any part of it the
/// card doesn't cover would swallow clicks meant for the app underneath.
///
/// The summon's anchored edge stays put, so a top-anchored bar grows downward
/// and a bottom-anchored one upward, and the card never crawls off the cursor.
#[tauri::command]
pub fn set_bar_height(window: tauri::WebviewWindow, height: f64) -> Result<(), String> {
    if !height.is_finite() || height < 1.0 {
        return Ok(());
    }
    let scale = window.scale_factor().map_err(err)?;
    let size = window.inner_size().map_err(err)?;
    let target = (height * scale).round() as u32;

    let prev = match applied_height().swap(target, Ordering::AcqRel) {
        0 => size.height,
        h => h,
    };
    if target == prev {
        return Ok(());
    }

    // While hidden the window rests at PARK; leave it there and just resize.
    if window.is_visible().unwrap_or(false) {
        if let Ok(pos) = window.outer_position() {
            let anchor = current_anchor().lock().map_or(VAnchor::Top, |g| *g);
            let x = pos.x as f64;
            let mut y = pos.y as f64;
            if matches!(anchor, VAnchor::Bottom) {
                y -= target as f64 - prev as f64;
            }
            let (x, y) = match Display::at(&window, x, y) {
                Some(display) => display.clamp(x, y, size.width as f64, target as f64),
                None => (x, y),
            };
            // Move first: `setContentSize:` holds the window's top-left, so
            // placing the new top edge before the resize lands the anchored edge
            // in one step (both are queued on the main thread, in order).
            let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
        }
    }
    window
        .set_size(PhysicalSize::new(size.width, target))
        .map_err(err)
}

/// Open the main window, then dismiss the bar *after* main is up so there's no
/// empty gap where neither is on screen. If main is already running the `/focus`
/// POST brings it forward and returns before we hide; otherwise we launch it and
/// hide once the launch is under way.
#[tauri::command]
pub async fn open_main(window: tauri::WebviewWindow) {
    focus_or_launch_main_async().await;
    dismiss(&window);
}

/// Screenshot button: capture the screen and attach it. Fire-and-forget — the
/// frontend shows a spinner and attaches the result when the `screenshot-*`
/// events arrive, exactly like the ⌘⇧Return path. Each click adds another shot.
/// The button lives in the (visible) bar, so a region grab dims it to 25% while
/// the user selects rather than leaving it in the way.
#[tauri::command]
pub fn capture_and_attach(window: tauri::WebviewWindow) {
    spawn_capture_with(
        &window,
        CaptureUi {
            reveal_on_success: false,
            dim_during_capture: region_mode(),
        },
    );
}

/// ⌘⇧Return handler. Full-screen: summon the bar *instantly* (immediate
/// feedback; the bar is excluded from the grab), then capture. Region: don't
/// reveal a closed bar until the user finalizes a selection — so it never covers
/// the screen — and dim an already-open bar to 25% while selecting.
pub fn capture_and_show(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    if region_mode() {
        spawn_capture_with(
            &window,
            CaptureUi {
                reveal_on_success: !visible,
                dim_during_capture: visible,
            },
        );
    } else {
        if !visible {
            show_mini(app, &window);
        }
        spawn_capture(&window);
    }
}

/// When the mini window was last revealed. A blur (`Focused(false)`) that arrives
/// within [`REVEAL_GRACE`] of a reveal is a transient side effect of showing over
/// a full-screen app's Space, not the user clicking away, so we ignore it.
fn last_shown() -> &'static Mutex<Option<Instant>> {
    static LAST_SHOWN: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    LAST_SHOWN.get_or_init(|| Mutex::new(None))
}

const REVEAL_GRACE: Duration = Duration::from_millis(500);

/// Whether the window was revealed within the last [`REVEAL_GRACE`].
pub fn just_revealed() -> bool {
    last_shown()
        .lock()
        .ok()
        .and_then(|guard| *guard)
        .is_some_and(|t| t.elapsed() < REVEAL_GRACE)
}
