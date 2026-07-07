use std::path::PathBuf;

use anyhow::Result;

/// Capture the full screen instantly and save it as a PNG under
/// `~/.taskscape/screenshots/`, returning the path to the saved file.
///
/// On macOS this shells out to the built-in `screencapture` tool. The first time
/// a given app triggers this, macOS will prompt the user to grant Screen
/// Recording permission to that app.
#[cfg(target_os = "macos")]
pub fn capture_fullscreen() -> Result<PathBuf> {
    use anyhow::bail;
    use std::process::Command;

    crate::paths::ensure_dirs()?;
    let path = crate::paths::screenshots_dir().join(format!(
        "screenshot-{}.png",
        crate::util::now_millis()
    ));

    // -x: do not play the capture sound.
    let status = Command::new("screencapture")
        .arg("-x")
        .arg(&path)
        .status()?;

    if !status.success() {
        bail!("screencapture exited with status {:?}", status.code());
    }
    Ok(path)
}

#[cfg(not(target_os = "macos"))]
pub fn capture_fullscreen() -> Result<PathBuf> {
    anyhow::bail!("full-screen capture is currently only implemented on macOS")
}
