use std::path::PathBuf;

use anyhow::Result;

/// The kind of grab [`capture`] performs, chosen by the user in Settings and
/// persisted as the `screenshot_mode` setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureMode {
    /// Grab the whole screen instantly (`screencapture -x`).
    Fullscreen,
    /// Native interactive selection (`screencapture -i`): drag a region, press
    /// Space to pick a window, Esc to cancel.
    Region,
}

/// The settings key backing [`CaptureMode`].
pub const SCREENSHOT_MODE_KEY: &str = "screenshot_mode";

impl CaptureMode {
    /// Read the persisted `screenshot_mode` setting, defaulting to
    /// [`Fullscreen`](CaptureMode::Fullscreen) when unset or unrecognized.
    pub fn current() -> Self {
        match crate::settings::get(SCREENSHOT_MODE_KEY).as_deref() {
            Some("region") => CaptureMode::Region,
            _ => CaptureMode::Fullscreen,
        }
    }
}

/// Capture the screen per the user's [`CaptureMode`] and save it as a PNG under
/// `~/.taskscape/screenshots/`, returning the path to the saved file.
///
/// Returns `Ok(None)` when a region capture is cancelled (Esc / empty
/// selection) — the caller treats that as a silent no-op, not an error.
///
/// On macOS this shells out to the built-in `screencapture` tool. The first time
/// a given app triggers this, macOS will prompt the user to grant Screen
/// Recording permission to that app.
#[cfg(target_os = "macos")]
pub fn capture() -> Result<Option<PathBuf>> {
    use anyhow::bail;
    use std::process::Command;

    crate::paths::ensure_dirs()?;
    let path = crate::paths::screenshots_dir()
        .join(format!("screenshot-{}.png", crate::util::now_millis()));

    // -x: do not play the capture sound. -i (region only): interactive selection.
    let mut cmd = Command::new("screencapture");
    cmd.arg("-x");
    if CaptureMode::current() == CaptureMode::Region {
        cmd.arg("-i");
    }
    let status = cmd.arg(&path).status()?;

    if !status.success() {
        bail!("screencapture exited with status {:?}", status.code());
    }

    // Interactive capture exits successfully but writes no file when the user
    // cancels; report that as a no-op so it never surfaces as a broken shot.
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(path))
}

#[cfg(not(target_os = "macos"))]
pub fn capture() -> Result<Option<PathBuf>> {
    anyhow::bail!("screen capture is currently only implemented on macOS")
}
