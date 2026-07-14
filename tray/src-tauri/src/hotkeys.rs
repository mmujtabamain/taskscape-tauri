use std::sync::{Arc, Mutex, OnceLock};

use taskscape_common::{hotkeys, Store};
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

fn key_code(key: &str) -> Option<Code> {
    use Code::*;
    Some(match key {
        "A" => KeyA,
        "B" => KeyB,
        "C" => KeyC,
        "D" => KeyD,
        "E" => KeyE,
        "F" => KeyF,
        "G" => KeyG,
        "H" => KeyH,
        "I" => KeyI,
        "J" => KeyJ,
        "K" => KeyK,
        "L" => KeyL,
        "M" => KeyM,
        "N" => KeyN,
        "O" => KeyO,
        "P" => KeyP,
        "Q" => KeyQ,
        "R" => KeyR,
        "S" => KeyS,
        "T" => KeyT,
        "U" => KeyU,
        "V" => KeyV,
        "W" => KeyW,
        "X" => KeyX,
        "Y" => KeyY,
        "Z" => KeyZ,
        "0" => Digit0,
        "1" => Digit1,
        "2" => Digit2,
        "3" => Digit3,
        "4" => Digit4,
        "5" => Digit5,
        "6" => Digit6,
        "7" => Digit7,
        "8" => Digit8,
        "9" => Digit9,
        "Enter" => Enter,
        "Backspace" => Backspace,
        "Delete" => Delete,
        "Space" => Space,
        "Tab" => Tab,
        "Escape" => Escape,
        "ArrowUp" => ArrowUp,
        "ArrowDown" => ArrowDown,
        "ArrowLeft" => ArrowLeft,
        "ArrowRight" => ArrowRight,
        "," => Comma,
        "\\" => Backslash,
        "/" => Slash,
        "." => Period,
        ";" => Semicolon,
        "'" => Quote,
        "[" => BracketLeft,
        "]" => BracketRight,
        "-" => Minus,
        "=" => Equal,
        "`" => Backquote,
        "F1" => F1,
        "F2" => F2,
        "F3" => F3,
        "F4" => F4,
        "F5" => F5,
        "F6" => F6,
        "F7" => F7,
        "F8" => F8,
        "F9" => F9,
        "F10" => F10,
        "F11" => F11,
        "F12" => F12,
        _ => return None,
    })
}

/// Canonical accel string → plugin `Shortcut`. `None` for the empty (unbound)
/// accel or a key the plugin can't register.
fn to_shortcut(accel: &str) -> Option<Shortcut> {
    let p = hotkeys::parse_accel(accel)?;
    let mut mods = Modifiers::empty();
    if p.cmd {
        mods |= Modifiers::SUPER;
    }
    if p.ctrl {
        mods |= Modifiers::CONTROL;
    }
    if p.alt {
        mods |= Modifiers::ALT;
    }
    if p.shift {
        mods |= Modifiers::SHIFT;
    }
    Some(Shortcut::new(Some(mods), key_code(&p.key)?))
}

/// macOS display form of an accel ("Cmd+Shift+Enter" → "⌘⇧↩") for the tray
/// tooltip.
fn accel_glyphs(accel: &str) -> String {
    let Some(p) = hotkeys::parse_accel(accel) else {
        return accel.to_string();
    };
    let mut out = String::new();
    for (on, glyph) in [(p.cmd, "⌘"), (p.ctrl, "⌃"), (p.alt, "⌥"), (p.shift, "⇧")] {
        if on {
            out.push_str(glyph);
        }
    }
    out.push_str(match p.key.as_str() {
        "Enter" => "↩",
        "Backspace" => "⌫",
        "Delete" => "⌦",
        "Tab" => "⇥",
        "Escape" => "⎋",
        "ArrowUp" => "↑",
        "ArrowDown" => "↓",
        "ArrowLeft" => "←",
        "ArrowRight" => "→",
        other => other,
    });
    out
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
    let accel = |id: &str| {
        bindings
            .iter()
            .find(|b| b.id == id)
            .map(|b| b.accel.as_str())
            .unwrap_or("")
    };
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
        let tip = if toggle_accel.is_empty() {
            "Taskscape".to_string()
        } else {
            format!(
                "Taskscape — press {} to capture",
                accel_glyphs(toggle_accel)
            )
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}
