//! Theme resolution. The tray has no theme UI of its own; it mirrors the main
//! app's Appearance preference (the shared "theme" setting), falling back to the
//! system appearance — resolved exactly like the old `get_dark` command, then
//! pushed into the Slint `Palette` global.

use slint::ComponentHandle;
use taskscape_common::Store;

use crate::{ctx, macos, Palette};

/// Resolve the effective dark/light: the shared setting if set, else the OS.
pub async fn resolve_dark(store: &Store) -> bool {
    match store.get_setting("theme").await.ok().flatten().as_deref() {
        Some("dark") => true,
        Some("light") => false,
        _ => macos::system_is_dark(),
    }
}

/// Re-resolve the theme off-thread and apply it to the bar (called on startup and
/// on every reveal).
pub fn refresh() {
    ctx::runtime().spawn(async {
        let dark = resolve_dark(&ctx::store()).await;
        ctx::with_ui(move |ui| ui.global::<Palette>().set_dark(dark));
    });
}
