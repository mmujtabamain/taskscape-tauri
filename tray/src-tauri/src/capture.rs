use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};

use taskscape_common::{screenshot, Store};
use tauri::{Emitter, State, WebviewWindow};

use crate::{err, task::target_list};

/// Where captures land — the project and list names, shown in the mini bar footer.
#[derive(serde::Serialize)]
pub struct CaptureTarget {
    project: String,
    list: String,
}

#[tauri::command]
pub async fn capture_target(store: State<'_, Arc<Store>>) -> Result<CaptureTarget, String> {
    let list = target_list(&store).await?;
    let project = store
        .list_projects()
        .await
        .map_err(err)?
        .into_iter()
        .find(|p| p.id == list.project_id)
        .map(|p| p.name)
        .unwrap_or_default();
    Ok(CaptureTarget {
        project,
        list: list.name,
    })
}

/// A screenshot capture in flight. [`spawn_capture`] parks and restores the mini
/// window, so two overlapping captures would fight over its position — a second
/// trigger is ignored until the first finishes.
fn capturing() -> &'static AtomicBool {
    static CAPTURING: OnceLock<AtomicBool> = OnceLock::new();
    CAPTURING.get_or_init(|| AtomicBool::new(false))
}

/// Clears the [`capturing`] flag when the capture thread unwinds — on success,
/// error, or panic — so a failed shot can never wedge the flag `true` and block
/// every future capture.
struct CaptureFlag;
impl Drop for CaptureFlag {
    fn drop(&mut self) {
        capturing().store(false, Ordering::Release);
    }
}

/// Whether the user has chosen interactive region capture over full-screen.
pub fn region_mode() -> bool {
    screenshot::CaptureMode::current() == screenshot::CaptureMode::Region
}

/// How the mini bar should behave around a capture. Both fields matter only for
/// interactive region grabs, where the bar must not obscure the screen while the
/// user drags a selection.
#[derive(Default, Clone, Copy)]
pub struct CaptureUi {
    /// Reveal the (currently hidden) bar at the cursor once a shot lands. Set on
    /// the ⌘⇧Return path when the bar was closed and we deferred showing it so it
    /// wouldn't cover the region selection.
    pub reveal_on_success: bool,
    /// Fade the (currently visible) bar to 25% for the duration of the grab,
    /// restoring it after. Keeps an already-open bar out of the user's way during
    /// the selection.
    pub dim_during_capture: bool,
}

/// [`spawn_capture_with`] with no special bar handling — the bar stays put and at
/// full opacity throughout (used for full-screen grabs and the mini-bar button).
pub fn spawn_capture(window: &WebviewWindow) {
    spawn_capture_with(window, CaptureUi::default());
}

/// Capture the screen off the caller's thread (full-screen or interactive
/// region, per the user's `screenshot_mode` setting), driving the mini bar's UI
/// with events:
///
///  - `screenshot-pending` immediately (the button shows a spinner),
///  - then `screenshot-captured` (PNG path) on success, `screenshot-cancelled`
///    when a region grab is aborted (Esc), or `screenshot-error` (message) on
///    failure.
///
/// The bar is excluded from *this* grab by flipping its sharing type to `None`
/// for the capture and restoring it right after ([`set_sharing_type`] /
/// [`SharingRestore`]), so it never lands in the shot yet stays capturable by OS
/// tools and the main app. Per [`CaptureUi`] it may also be dimmed during the
/// grab or revealed only once a region selection is finalized. The blocking
/// `screencapture` shell-out never runs on the UI/hotkey thread. If a capture is
/// already running this is a no-op.
pub fn spawn_capture_with(window: &WebviewWindow, ui: CaptureUi) {
    if capturing().swap(true, Ordering::AcqRel) {
        return;
    }
    let _ = window.emit("screenshot-pending", ());
    let window = window.clone();
    std::thread::spawn(move || {
        let _flag = CaptureFlag;
        // Fade the bar down first (if it's visible) so the dim is in place before
        // the crosshair appears; restored on any exit via the guard's drop.
        #[cfg(target_os = "macos")]
        let _dim = ui.dim_during_capture.then(|| {
            crate::setup::set_window_alpha(&window, 0.25);
            OpacityRestore(window.clone())
        });
        // Exclude the bar from this grab only, then restore it (even on
        // error/panic) so OS tools and the main app still capture it.
        #[cfg(target_os = "macos")]
        let _restore = {
            use std::time::Duration;

            use crate::setup::set_sharing_type;

            set_sharing_type(&window, false, true);
            // Let the window server commit the exclusion before the grab.
            std::thread::sleep(Duration::from_millis(60));
            SharingRestore(window.clone())
        };
        match screenshot::capture().map_err(err) {
            Ok(Some(path)) => {
                let _ = window.emit("screenshot-captured", path.to_string_lossy().into_owned());
                // Region path with the bar deferred: reveal it now that the user
                // has finalized a selection.
                if ui.reveal_on_success {
                    let w = window.clone();
                    let _ = window.run_on_main_thread(move || crate::window::reveal_mini(&w));
                }
            }
            Ok(None) => {
                // Region capture cancelled (Esc / empty selection): clear the
                // spinner without surfacing an error. A deferred bar stays hidden.
                let _ = window.emit("screenshot-cancelled", ());
            }
            Err(e) => {
                eprintln!("[taskscape-tray] screenshot failed: {e}");
                let _ = window.emit("screenshot-error", e);
            }
        }
    });
}

/// Restores the bar to the default, capturable sharing type when the capture
/// thread unwinds — on success, error, or panic — so an exclusion set for one
/// shot can never leak past it and keep the bar hidden from OS tools / the main
/// app.
#[cfg(target_os = "macos")]
struct SharingRestore(WebviewWindow);

#[cfg(target_os = "macos")]
impl Drop for SharingRestore {
    fn drop(&mut self) {
        use crate::setup::set_sharing_type;

        set_sharing_type(&self.0, true, false);
    }
}

/// Restores the bar to full opacity when the capture thread unwinds — on
/// success, cancel, error, or panic — so a dim applied for a region selection
/// can never leak past the grab and leave the bar faded.
#[cfg(target_os = "macos")]
struct OpacityRestore(WebviewWindow);

#[cfg(target_os = "macos")]
impl Drop for OpacityRestore {
    fn drop(&mut self) {
        crate::setup::set_window_alpha(&self.0, 1.0);
    }
}
