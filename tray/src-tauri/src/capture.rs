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

/// Capture the full screen off the caller's thread, driving the mini bar's UI
/// with events:
///
///  - `screenshot-pending` immediately (the button shows a spinner),
///  - then `screenshot-captured` (PNG path) on success, or `screenshot-error`
///    (message) on failure.
///
/// The bar stays on screen (showing its spinner) throughout: it's excluded from
/// *this* grab only by flipping its sharing type to `None` for the capture and
/// restoring it right after ([`set_sharing_type`] / [`SharingRestore`]), so it
/// never lands in the shot yet stays capturable by OS tools and the main app.
/// The blocking `screencapture` shell-out never runs on the UI/hotkey thread. If
/// a capture is already running this is a no-op.
pub fn spawn_capture(window: &WebviewWindow) {
    if capturing().swap(true, Ordering::AcqRel) {
        return;
    }
    let _ = window.emit("screenshot-pending", ());
    let window = window.clone();
    std::thread::spawn(move || {
        let _flag = CaptureFlag;
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
        match screenshot::capture_fullscreen().map_err(err) {
            Ok(path) => {
                let _ = window.emit("screenshot-captured", path.to_string_lossy().into_owned());
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
