//! Global hotkeys via the `global-hotkey` crate (what Tauri's plugin wrapped),
//! plus the display strings for the bar's kbd hints and the tray tooltip, and the
//! matcher the local key monitor uses for the customizable clear-draft combo.
//!
//! The manager and its registrations live in a main-thread `thread_local`; the
//! resolve-from-settings step runs off-thread and applies on the event loop.

use std::cell::RefCell;

use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::GlobalHotKeyManager;
use taskscape_common::hotkeys::{self, ParsedAccel};

use crate::macos::KeyPress;
use crate::{capture, ctx, menubar, window, MiniBar};

#[derive(Default)]
struct State {
    manager: Option<GlobalHotKeyManager>,
    toggle: Option<HotKey>,
    screenshot: Option<HotKey>,
    clear: Option<ParsedAccel>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

// ── Registration ─────────────────────────────────────────────────────────────

/// Re-resolve the hotkey settings off-thread, then (re)register the globals and
/// refresh the bar's kbd hints + the tray tooltip on the event loop.
pub fn refresh() {
    ctx::runtime().spawn(async {
        let store = ctx::store();
        if let Ok(bindings) = hotkeys::resolve(&store).await {
            let _ = slint::invoke_from_event_loop(move || apply(bindings));
        }
    });
}

fn apply(bindings: Vec<hotkeys::ResolvedBinding>) {
    let accel = |id: &str| {
        bindings
            .iter()
            .find(|b| b.id == id)
            .map(|b| b.accel.as_str())
            .unwrap_or("")
    };
    let toggle_accel = accel("toggle_capture_bar");
    let shot_accel = accel("screenshot_capture");
    let clear_accel = accel("clear_draft");

    STATE.with(|cell| {
        let mut s = cell.borrow_mut();
        if s.manager.is_none() {
            s.manager = GlobalHotKeyManager::new().ok();
        }
        // Take the manager out so we can reassign the hotkey fields alongside.
        let manager = s.manager.take();
        s.toggle = swap(manager.as_ref(), s.toggle.take(), to_hotkey(toggle_accel), "capture-bar");
        s.screenshot = swap(
            manager.as_ref(),
            s.screenshot.take(),
            to_hotkey(shot_accel),
            "screenshot",
        );
        s.clear = hotkeys::parse_accel(clear_accel);
        s.manager = manager;
    });

    let clear_disp = accel_glyphs(clear_accel);
    let shot_disp = accel_glyphs(shot_accel);
    ctx::with_ui_sync(|ui: &MiniBar| {
        ui.set_clear_hint(clear_disp.into());
        ui.set_screenshot_hint(shot_disp.into());
    });

    let tip = if toggle_accel.is_empty() {
        "Taskscape".to_string()
    } else {
        format!("Taskscape — press {} to capture", accel_glyphs(toggle_accel))
    };
    menubar::set_tooltip(tip);
}

/// Replace one registered global. If the OS refuses the new combo (taken by
/// another app) the previous one is restored so the command isn't lost.
fn swap(
    manager: Option<&GlobalHotKeyManager>,
    old: Option<HotKey>,
    new: Option<HotKey>,
    label: &str,
) -> Option<HotKey> {
    if old == new {
        return old;
    }
    let Some(m) = manager else { return new };
    if let Some(o) = old {
        let _ = m.unregister(o);
    }
    let Some(n) = new else { return None };
    match m.register(n) {
        Ok(()) => Some(n),
        Err(e) => {
            eprintln!("[taskscape-tray] failed to register {label} hotkey: {e}");
            old.filter(|o| m.register(*o).is_ok())
        }
    }
}

/// Canonical accel string → `HotKey`; `None` for an unbound accel or a key the
/// backend can't register.
fn to_hotkey(accel: &str) -> Option<HotKey> {
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
    Some(HotKey::new(Some(mods), code_of(&p.key)?))
}

// ── Dispatch (from the event-poll timer) ─────────────────────────────────────

/// Route a fired global hotkey. Mirrors the old Tauri plugin handler: when the
/// main app is frontmost the combos act on it; otherwise they drive the bar.
pub fn dispatch(id: u32) {
    let (is_toggle, is_shot) = STATE.with(|cell| {
        let s = cell.borrow();
        (
            s.toggle.map(|h| h.id()) == Some(id),
            s.screenshot.map(|h| h.id()) == Some(id),
        )
    });

    if is_toggle {
        if ctx::is_open() {
            window::on_capture_enter();
        } else if ctx::main_focused() {
            window::route_to_main("/new-task");
        } else {
            window::show_mini();
        }
    } else if is_shot {
        if ctx::main_focused() {
            window::route_to_main("/attach-screenshot");
        } else {
            capture::capture_and_show();
        }
    }
}

// ── Clear-draft combo matching (local key monitor) ───────────────────────────

/// Whether a key press matches the (customizable) clear-draft combo.
pub fn clear_matches(kp: &KeyPress) -> bool {
    STATE.with(|cell| {
        let s = cell.borrow();
        let Some(p) = s.clear.as_ref() else {
            return false;
        };
        kp.cmd == p.cmd
            && kp.ctrl == p.ctrl
            && kp.alt == p.alt
            && kp.shift == p.shift
            && key_matches(kp, &p.key)
    })
}

/// Compare a physical key press to an accel key name. Named keys use macOS
/// virtual key codes; everything else compares the produced character.
fn key_matches(kp: &KeyPress, key: &str) -> bool {
    match key {
        "Backspace" => kp.key_code == 51,
        "Delete" => kp.key_code == 117,
        "Enter" => kp.key_code == 36,
        "Escape" => kp.key_code == 53,
        "Tab" => kp.key_code == 48,
        "Space" => kp.key_code == 49,
        "ArrowUp" => kp.key_code == 126,
        "ArrowDown" => kp.key_code == 125,
        "ArrowLeft" => kp.key_code == 123,
        "ArrowRight" => kp.key_code == 124,
        other => kp.chars.eq_ignore_ascii_case(other),
    }
}

// ── Display ──────────────────────────────────────────────────────────────────

/// macOS display form of an accel ("Cmd+Shift+Enter" → "⌘⇧↩").
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
    // `⏎` (U+23CE) rather than `↩` (U+21A9): the latter has an emoji
    // presentation that Slint's font fallback renders as a colored box.
    out.push_str(match p.key.as_str() {
        "Enter" => "⏎",
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

/// Accel key name → `global-hotkey` `Code`.
fn code_of(key: &str) -> Option<Code> {
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
