//! The hotkey system's source of truth: the command catalog, the canonical
//! accelerator string format, binding resolution and validation.
//!
//! Accelerator strings are the cross-runtime contract shared with the frontend
//! (`common-ui/src/hotkeys.ts`): `"<Mod>+…+<Key>"`, modifiers in the fixed
//! order `Cmd, Ctrl, Alt, Shift`, keys normalized (letters `A`–`Z`, digits,
//! named keys like `Enter`/`Backspace`, literal punctuation, and `Plus` for the
//! `+` key so `+` stays an unambiguous separator). Examples: `Cmd+Enter`,
//! `Cmd+Shift+Backspace`, `Cmd+1`.
//!
//! User overrides live in the shared settings store (`~/.taskscape/settings.json`,
//! see [`crate::settings`]) under one key ([`HOTKEYS_KEY`]) as a JSON object
//! `{ commandId: accel }`. An absent id means "use the default"; an empty string
//! means "intentionally unbound".

use std::collections::BTreeMap;

use anyhow::{anyhow, bail, Result};
use serde::Serialize;

use crate::storage::Store;

/// Settings key holding the JSON override map.
pub const HOTKEYS_KEY: &str = "hotkeys";

/// Where a command is dispatched — and its conflict namespace: the same combo
/// may be bound in different scopes without clashing.
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// OS-global, registered by the tray via `tauri-plugin-global-shortcut`.
    Global,
    /// Main window, matched by its webview's keydown handler.
    Main,
    /// Tray mini bar, matched by its webview's keydown handler.
    Tray,
}

pub struct Command {
    pub id: &'static str,
    pub label: &'static str,
    pub scope: Scope,
    pub default_accel: &'static str,
}

/// Every user-customizable command. Structural keys (Escape, Enter, Tab,
/// arrows, …) are deliberately not here — they are fixed conventions.
pub const COMMANDS: &[Command] = &[
    Command {
        id: "toggle_capture_bar",
        label: "Capture bar",
        scope: Scope::Global,
        default_accel: "Cmd+Enter",
    },
    Command {
        id: "screenshot_capture",
        label: "Screenshot capture",
        scope: Scope::Global,
        default_accel: "Cmd+Shift+Enter",
    },
    Command {
        id: "new_task",
        label: "New task",
        scope: Scope::Main,
        default_accel: "Cmd+N",
    },
    Command {
        id: "search",
        label: "Search",
        scope: Scope::Main,
        default_accel: "Cmd+F",
    },
    Command {
        id: "toggle_preview",
        label: "Toggle preview",
        scope: Scope::Main,
        default_accel: "Cmd+\\",
    },
    Command {
        id: "open_settings",
        label: "Open settings",
        scope: Scope::Main,
        default_accel: "Cmd+,",
    },
    Command {
        id: "delete_task",
        label: "Delete task",
        scope: Scope::Main,
        default_accel: "Cmd+Backspace",
    },
    Command {
        id: "switch_list_1",
        label: "Switch to list 1",
        scope: Scope::Main,
        default_accel: "Cmd+1",
    },
    Command {
        id: "switch_list_2",
        label: "Switch to list 2",
        scope: Scope::Main,
        default_accel: "Cmd+2",
    },
    Command {
        id: "switch_list_3",
        label: "Switch to list 3",
        scope: Scope::Main,
        default_accel: "Cmd+3",
    },
    Command {
        id: "switch_list_4",
        label: "Switch to list 4",
        scope: Scope::Main,
        default_accel: "Cmd+4",
    },
    Command {
        id: "switch_list_5",
        label: "Switch to list 5",
        scope: Scope::Main,
        default_accel: "Cmd+5",
    },
    Command {
        id: "switch_list_6",
        label: "Switch to list 6",
        scope: Scope::Main,
        default_accel: "Cmd+6",
    },
    Command {
        id: "switch_list_7",
        label: "Switch to list 7",
        scope: Scope::Main,
        default_accel: "Cmd+7",
    },
    Command {
        id: "switch_list_8",
        label: "Switch to list 8",
        scope: Scope::Main,
        default_accel: "Cmd+8",
    },
    Command {
        id: "switch_list_9",
        label: "Switch to list 9",
        scope: Scope::Main,
        default_accel: "Cmd+9",
    },
    Command {
        id: "prev_tab",
        label: "Previous list tab",
        scope: Scope::Main,
        default_accel: "Cmd+Alt+ArrowLeft",
    },
    Command {
        id: "next_tab",
        label: "Next list tab",
        scope: Scope::Main,
        default_accel: "Cmd+Alt+ArrowRight",
    },
    Command {
        id: "prev_project",
        label: "Previous project",
        scope: Scope::Main,
        default_accel: "Cmd+Shift+[",
    },
    Command {
        id: "next_project",
        label: "Next project",
        scope: Scope::Main,
        default_accel: "Cmd+Shift+]",
    },
    Command {
        id: "move_up",
        label: "Move task up",
        scope: Scope::Main,
        default_accel: "Cmd+Alt+ArrowUp",
    },
    Command {
        id: "move_down",
        label: "Move task down",
        scope: Scope::Main,
        default_accel: "Cmd+Alt+ArrowDown",
    },
    Command {
        id: "select_all",
        label: "Select all tasks",
        scope: Scope::Main,
        default_accel: "Cmd+A",
    },
    Command {
        id: "command_palette",
        label: "Command palette",
        scope: Scope::Main,
        default_accel: "Cmd+K",
    },
    Command {
        id: "toggle_split",
        label: "Toggle split view",
        scope: Scope::Main,
        default_accel: "Cmd+Alt+S",
    },
    Command {
        id: "focus_other_pane",
        label: "Focus other pane",
        scope: Scope::Main,
        default_accel: "Cmd+Alt+O",
    },
    Command {
        id: "new_list",
        label: "New list",
        scope: Scope::Main,
        default_accel: "Cmd+Shift+N",
    },
    Command {
        id: "new_project",
        label: "New project",
        scope: Scope::Main,
        default_accel: "Cmd+Shift+P",
    },
    Command {
        id: "toggle_completed",
        label: "Show/hide completed",
        scope: Scope::Main,
        default_accel: "Cmd+Shift+H",
    },
    Command {
        id: "collapse_all",
        label: "Collapse all",
        scope: Scope::Main,
        default_accel: "Cmd+Alt+-",
    },
    Command {
        id: "expand_all",
        label: "Expand all",
        scope: Scope::Main,
        default_accel: "Cmd+Alt+=",
    },
    Command {
        id: "undo",
        label: "Undo",
        scope: Scope::Main,
        default_accel: "Cmd+Z",
    },
    Command {
        id: "redo",
        label: "Redo",
        scope: Scope::Main,
        default_accel: "Cmd+Shift+Z",
    },
    Command {
        id: "clear_draft",
        label: "Clear capture draft",
        scope: Scope::Tray,
        default_accel: "Cmd+Shift+Backspace",
    },
];

/// A catalog entry with its effective combo, as served to the frontends.
#[derive(Clone, Serialize)]
pub struct ResolvedBinding {
    pub id: &'static str,
    pub label: &'static str,
    pub scope: Scope,
    /// Effective accelerator; `""` when intentionally unbound.
    pub accel: String,
    pub default: &'static str,
}

/// An accelerator string decomposed into neutral parts. `common` has no Tauri
/// dependency, so conversion to a plugin `Shortcut` happens in the tray.
pub struct ParsedAccel {
    pub cmd: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub key: String,
}

fn normalize_key(key: &str) -> Option<String> {
    if key.len() == 1 {
        let c = key.chars().next().unwrap();
        return match c {
            'a'..='z' => Some(c.to_ascii_uppercase().to_string()),
            'A'..='Z' | '0'..='9' => Some(c.to_string()),
            ',' | '\\' | '/' | '.' | ';' | '\'' | '[' | ']' | '-' | '=' | '`' => {
                Some(c.to_string())
            }
            ' ' => Some("Space".into()),
            _ => None,
        };
    }
    match key {
        "Enter" | "Backspace" | "Delete" | "Space" | "Tab" | "Escape" | "Plus" | "ArrowUp"
        | "ArrowDown" | "ArrowLeft" | "ArrowRight" => Some(key.into()),
        _ if key.strip_prefix('F').is_some_and(|n| matches!(n.parse::<u8>(), Ok(1..=12))) => {
            Some(key.into())
        }
        _ => None,
    }
}

pub fn parse_accel(accel: &str) -> Option<ParsedAccel> {
    let mut parsed = ParsedAccel {
        cmd: false,
        ctrl: false,
        alt: false,
        shift: false,
        key: String::new(),
    };
    let mut key = None;
    for part in accel.split('+') {
        match part {
            "Cmd" => parsed.cmd = true,
            "Ctrl" => parsed.ctrl = true,
            "Alt" => parsed.alt = true,
            "Shift" => parsed.shift = true,
            other => {
                if key.replace(normalize_key(other)?).is_some() {
                    return None;
                }
            }
        }
    }
    parsed.key = key?;
    Some(parsed)
}

/// Rebuild the canonical string form (fixed modifier order).
fn canonical(p: &ParsedAccel) -> String {
    let mut out = String::new();
    for (on, name) in [
        (p.cmd, "Cmd"),
        (p.ctrl, "Ctrl"),
        (p.alt, "Alt"),
        (p.shift, "Shift"),
    ] {
        if on {
            out.push_str(name);
            out.push('+');
        }
    }
    out.push_str(&p.key);
    out
}

fn is_function_key(key: &str) -> bool {
    key.len() >= 2 && key.starts_with('F')
}

async fn load_overrides(store: &Store) -> Result<BTreeMap<String, String>> {
    Ok(match store.get_setting(HOTKEYS_KEY).await? {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => BTreeMap::new(),
    })
}

async fn save_overrides(store: &Store, overrides: &BTreeMap<String, String>) -> Result<()> {
    store
        .set_setting(HOTKEYS_KEY, &serde_json::to_string(overrides)?)
        .await
}

/// The full catalog with effective combos (stored override, else default).
pub async fn resolve(store: &Store) -> Result<Vec<ResolvedBinding>> {
    let overrides = load_overrides(store).await?;
    Ok(COMMANDS
        .iter()
        .map(|c| ResolvedBinding {
            id: c.id,
            label: c.label,
            scope: c.scope,
            accel: overrides
                .get(c.id)
                .cloned()
                .unwrap_or_else(|| c.default_accel.to_string()),
            default: c.default_accel,
        })
        .collect())
}

/// Validate and persist one binding. `""` unbinds the command; assigning a
/// combo already in use within the same scope is rejected, naming the holder.
pub async fn set_binding(store: &Store, id: &str, accel: &str) -> Result<()> {
    let command = COMMANDS
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| anyhow!("unknown hotkey command: {id}"))?;

    let canon = if accel.is_empty() {
        String::new()
    } else {
        let parsed = parse_accel(accel).ok_or_else(|| anyhow!("invalid shortcut: {accel}"))?;
        // A bare key would swallow normal typing (and a bare global would fire
        // constantly); require a real modifier everywhere except F-keys.
        if !(parsed.cmd || parsed.ctrl || parsed.alt) && !is_function_key(&parsed.key) {
            bail!("shortcut needs ⌘, ⌃ or ⌥");
        }
        let canon = canonical(&parsed);
        for other in resolve(store).await? {
            if other.id != id && other.scope == command.scope && other.accel == canon {
                bail!("already used by “{}”", other.label);
            }
        }
        canon
    };

    let mut overrides = load_overrides(store).await?;
    if canon == command.default_accel {
        overrides.remove(id);
    } else {
        overrides.insert(id.to_string(), canon);
    }
    save_overrides(store, &overrides).await
}

/// Drop the override for `id`, restoring its default combo.
pub async fn reset_binding(store: &Store, id: &str) -> Result<()> {
    let mut overrides = load_overrides(store).await?;
    if overrides.remove(id).is_some() {
        save_overrides(store, &overrides).await?;
    }
    Ok(())
}
