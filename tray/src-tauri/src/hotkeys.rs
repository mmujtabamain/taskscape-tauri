use std::sync::{Arc, Mutex, OnceLock};

use taskscape_common::{
    hotkeys::{self, Accel, Key},
    Store,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcut, GlobalShortcutExt, Modifiers, Shortcut};

use crate::err;

/// The hotkey catalog with effective combos (the mini bar reads `clear_draft`).
#[tauri::command]
pub async fn list_hotkeys(
    store: State<'_, Arc<Store>>,
) -> Result<Vec<hotkeys::ResolvedBinding>, String> {
    hotkeys::resolve(&store).await.map_err(err)
}

/// Whether the mini bar should render dark, resolved exactly like the main app:
/// the shared Appearance setting ("dark"/"light"), otherwise the current system
/// appearance. Resolved in Rust (via `window.theme()`, not the webview's
/// `prefers-color-scheme`, which an accessory NSPanel doesn't report reliably) so
/// the tray matches the theme the user picked in the main window.
#[tauri::command]
pub async fn get_dark(
    window: tauri::WebviewWindow,
    store: State<'_, Arc<Store>>,
) -> Result<bool, String> {
    Ok(
        match store.get_setting("theme").await.map_err(err)?.as_deref() {
            Some("dark") => true,
            Some("light") => false,
            _ => window
                .theme()
                .map(|t| t == tauri::Theme::Dark)
                .unwrap_or(false),
        },
    )
}

/// The OS-global shortcuts as currently registered, resolved from the user's
/// hotkey settings. The plugin's handler dispatches by comparing against these.
#[derive(Default)]
pub struct GlobalHotkeys {
    pub(crate) toggle: Option<Shortcut>,
    pub(crate) screenshot: Option<Shortcut>,
}

pub fn global_hotkeys() -> &'static Mutex<GlobalHotkeys> {
    static HOTKEYS: OnceLock<Mutex<GlobalHotkeys>> = OnceLock::new();
    HOTKEYS.get_or_init(|| Mutex::new(GlobalHotkeys::default()))
}

/// `Key` → the plugin's `Code`. Deliberately an exhaustive match rather than a
/// name lookup: adding a key to the catalog's vocabulary then fails to build
/// here, instead of registering nothing at runtime.
fn key_code(key: Key) -> Option<Code> {
    use Code::*;
    Some(match key {
        Key::A => KeyA,
        Key::B => KeyB,
        Key::C => KeyC,
        Key::D => KeyD,
        Key::E => KeyE,
        Key::F => KeyF,
        Key::G => KeyG,
        Key::H => KeyH,
        Key::I => KeyI,
        Key::J => KeyJ,
        Key::K => KeyK,
        Key::L => KeyL,
        Key::M => KeyM,
        Key::N => KeyN,
        Key::O => KeyO,
        Key::P => KeyP,
        Key::Q => KeyQ,
        Key::R => KeyR,
        Key::S => KeyS,
        Key::T => KeyT,
        Key::U => KeyU,
        Key::V => KeyV,
        Key::W => KeyW,
        Key::X => KeyX,
        Key::Y => KeyY,
        Key::Z => KeyZ,
        Key::Digit0 => Digit0,
        Key::Digit1 => Digit1,
        Key::Digit2 => Digit2,
        Key::Digit3 => Digit3,
        Key::Digit4 => Digit4,
        Key::Digit5 => Digit5,
        Key::Digit6 => Digit6,
        Key::Digit7 => Digit7,
        Key::Digit8 => Digit8,
        Key::Digit9 => Digit9,
        Key::Enter => Enter,
        Key::Backspace => Backspace,
        Key::Delete => Delete,
        Key::Space => Space,
        Key::Tab => Tab,
        Key::Escape => Escape,
        Key::ArrowUp => ArrowUp,
        Key::ArrowDown => ArrowDown,
        Key::ArrowLeft => ArrowLeft,
        Key::ArrowRight => ArrowRight,
        Key::Comma => Comma,
        Key::Backslash => Backslash,
        Key::Slash => Slash,
        Key::Period => Period,
        Key::Semicolon => Semicolon,
        Key::Quote => Quote,
        Key::BracketLeft => BracketLeft,
        Key::BracketRight => BracketRight,
        Key::Minus => Minus,
        Key::Equal => Equal,
        Key::Backquote => Backquote,
        Key::F1 => F1,
        Key::F2 => F2,
        Key::F3 => F3,
        Key::F4 => F4,
        Key::F5 => F5,
        Key::F6 => F6,
        Key::F7 => F7,
        Key::F8 => F8,
        Key::F9 => F9,
        Key::F10 => F10,
        Key::F11 => F11,
        Key::F12 => F12,
        // The `+` key has no code of its own — it is typed as Shift+Equal.
        Key::Plus => return None,
    })
}

/// Typed accel → plugin `Shortcut`. `None` for an unbound command or a key the
/// plugin can't register; the accel itself is already known-good.
fn to_shortcut(accel: Option<Accel>) -> Option<Shortcut> {
    let accel = accel?;
    let mut mods = Modifiers::empty();
    if accel.cmd() {
        mods |= Modifiers::SUPER;
    }
    if accel.ctrl() {
        mods |= Modifiers::CONTROL;
    }
    if accel.alt() {
        mods |= Modifiers::ALT;
    }
    if accel.shift() {
        mods |= Modifiers::SHIFT;
    }
    Some(Shortcut::new(Some(mods), key_code(accel.key)?))
}

/// Replace one registered shortcut with a new combo. If the OS refuses the new
/// one (taken by another app), the previous registration is restored so the
/// command isn't silently lost.
fn swap_registration(
    gs: &GlobalShortcut<tauri::Wry>,
    old: Option<Shortcut>,
    new: Option<Shortcut>,
    label: &str,
) -> Option<Shortcut> {
    if old == new {
        return old;
    }
    if let Some(o) = old {
        let _ = gs.unregister(o);
    }
    let Some(n) = new else { return None };
    match gs.register(n) {
        Ok(()) => Some(n),
        Err(e) => {
            eprintln!("[taskscape-tray] failed to register {label} hotkey: {e}");
            old.filter(|o| gs.register(*o).is_ok())
        }
    }
}

/// Resolve the hotkey settings off-thread, then apply them on the main thread.
/// Fire-and-forget: startup and the `/reload-hotkeys` route both use this so
/// neither blocks on the DB read or the registration.
pub fn refresh_global_shortcuts(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let store = app.state::<Arc<Store>>().inner().clone();
        match hotkeys::resolve(&store).await {
            Ok(bindings) => {
                let app2 = app.clone();
                let _ = app.run_on_main_thread(move || {
                    apply_global_shortcuts(&app2, &bindings);
                });
            }
            Err(e) => eprintln!("[taskscape-tray] failed to load hotkeys: {e}"),
        }
    });
}

/// Register the resolved global shortcuts, replacing the current ones, and keep
/// the tray tooltip's advertised combo in sync. macOS hotkey registration
/// belongs on the main thread — callers off it hop over via
/// `run_on_main_thread`.
fn apply_global_shortcuts(app: &AppHandle, bindings: &[hotkeys::ResolvedBinding]) {
    let accel = |id: &str| bindings.iter().find(|b| b.id == id).and_then(|b| b.accel);
    let toggle_accel = accel("toggle_capture_bar");

    let gs = app.global_shortcut();
    let mut state = global_hotkeys().lock().unwrap();
    state.toggle = swap_registration(gs, state.toggle, to_shortcut(toggle_accel), "capture-bar");
    state.screenshot = swap_registration(
        gs,
        state.screenshot,
        to_shortcut(accel("screenshot_capture")),
        "screenshot",
    );
    drop(state);

    if let Some(tray) = app.tray_by_id("tray") {
        let tip = match toggle_accel {
            Some(a) => format!("Taskscape — press {} to capture", a.glyphs()),
            None => "Taskscape".to_string(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The match in `key_code` is exhaustive, so the compiler already proves
    /// every key has an arm. What it can't prove is that each arm is the *right*
    /// code — `Key::Comma => Period` would build happily. Two keys landing on
    /// one code is what that mistake looks like.
    #[test]
    fn key_code_maps_each_key_to_a_distinct_code() {
        let mut seen: Vec<(Key, Code)> = Vec::new();
        for &key in Key::ALL {
            let Some(code) = key_code(key) else { continue };
            if let Some((other, _)) = seen.iter().find(|(_, c)| *c == code) {
                panic!("{key:?} and {other:?} both map to {code:?}");
            }
            seen.push((key, code));
        }
    }
}
