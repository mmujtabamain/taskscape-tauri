//! The hotkey system's source of truth: the command catalog, the canonical
//! accelerator format, binding resolution and validation.
//!
//! In memory an accelerator is an [`Accel`] — a [`Mods`] set plus a [`Key`] —
//! so an unknown key or a misordered combo is not representable, and the
//! catalog below is checked by the compiler via [`accel!`].
//!
//! Its string form is the cross-runtime contract shared with the frontend
//! (`common-ui/src/hotkeys.ts`): `"<Mod>+…+<Key>"`, modifiers in the fixed
//! order `Cmd, Ctrl, Alt, Shift`, keys normalized (letters `A`–`Z`, digits,
//! named keys like `Enter`/`Backspace`, literal punctuation, and `Plus` for the
//! `+` key so `+` stays an unambiguous separator). Examples: `Cmd+Enter`,
//! `Cmd+Shift+Backspace`, `Cmd+1`. That form is produced only by `Display` and
//! consumed only by `FromStr`, which are the sole crossings between the typed
//! and textual worlds.
//!
//! User overrides live in the shared settings store (`~/.taskscape/settings.json`,
//! see [`crate::settings`]) under one key ([`HOTKEYS_KEY`]) as a JSON object
//! `{ commandId: accel }`. An absent id means "use the default"; an empty string
//! means "intentionally unbound".

use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

use anyhow::{anyhow, bail, Result};
use serde::{Serialize, Serializer};

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

/// One bit per modifier. A plain `u8` rather than a `bitflags` dependency —
/// four flags don't earn one, and every operation stays `const` so the catalog
/// below is built at compile time.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Mods(u8);

impl Mods {
    pub const NONE: Self = Self(0);
    pub const CMD: Self = Self(1 << 0);
    pub const CTRL: Self = Self(1 << 1);
    pub const ALT: Self = Self(1 << 2);
    pub const SHIFT: Self = Self(1 << 3);

    pub const fn with(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }
    pub const fn has(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
    /// ⌘, ⌃ or ⌥. Shift alone never makes a combo safe to bind.
    pub const fn has_primary(self) -> bool {
        self.has(Self::CMD) || self.has(Self::CTRL) || self.has(Self::ALT)
    }
}

/// Generates `Key` plus both directions of its token mapping from one table, so
/// the canonical spelling and the parser cannot drift apart. Adding a key here
/// is a compile error everywhere that must handle it — see the tray's
/// `key_code`, which maps this vocabulary onto the shortcut plugin's.
macro_rules! keys {
    ($($variant:ident => $token:literal),* $(,)?) => {
        /// Every key an accelerator may end in.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum Key { $($variant),* }

        impl Key {
            /// Every key, for consumers that need to sweep the whole vocabulary.
            pub const ALL: &'static [Key] = &[$(Self::$variant),*];

            /// The canonical token this key serializes to.
            pub const fn token(self) -> &'static str {
                match self { $(Self::$variant => $token),* }
            }
            fn from_token(token: &str) -> Option<Self> {
                match token { $($token => Some(Self::$variant),)* _ => None }
            }
        }
    };
}

keys! {
    A => "A", B => "B", C => "C", D => "D", E => "E", F => "F", G => "G",
    H => "H", I => "I", J => "J", K => "K", L => "L", M => "M", N => "N",
    O => "O", P => "P", Q => "Q", R => "R", S => "S", T => "T", U => "U",
    V => "V", W => "W", X => "X", Y => "Y", Z => "Z",

    Digit0 => "0", Digit1 => "1", Digit2 => "2", Digit3 => "3", Digit4 => "4",
    Digit5 => "5", Digit6 => "6", Digit7 => "7", Digit8 => "8", Digit9 => "9",

    F1 => "F1", F2 => "F2", F3 => "F3", F4 => "F4", F5 => "F5", F6 => "F6",
    F7 => "F7", F8 => "F8", F9 => "F9", F10 => "F10", F11 => "F11", F12 => "F12",

    Enter => "Enter", Backspace => "Backspace", Delete => "Delete",
    Space => "Space", Tab => "Tab", Escape => "Escape",
    // The `+` key is spelled out so `+` stays an unambiguous separator.
    Plus => "Plus",
    ArrowUp => "ArrowUp", ArrowDown => "ArrowDown",
    ArrowLeft => "ArrowLeft", ArrowRight => "ArrowRight",

    Comma => ",", Backslash => "\\", Slash => "/", Period => ".",
    Semicolon => ";", Quote => "'", BracketLeft => "[", BracketRight => "]",
    Minus => "-", Equal => "=", Backquote => "`",
}

impl Key {
    /// Lenient parse for runtime input (key recordings, stored overrides):
    /// accepts a lowercase letter or a literal space, which the canonical form
    /// spells `A`–`Z` and `Space`.
    pub fn parse(token: &str) -> Option<Self> {
        if let Some(c) = token.chars().next().filter(|_| token.len() == 1) {
            if c == ' ' {
                return Some(Self::Space);
            }
            if c.is_ascii_lowercase() {
                let mut buf = [0u8; 4];
                return Self::from_token(c.to_ascii_uppercase().encode_utf8(&mut buf));
            }
        }
        Self::from_token(token)
    }

    /// F-keys are the only keys bindable without a modifier — they don't
    /// collide with typing.
    pub const fn is_function(self) -> bool {
        matches!(
            self,
            Self::F1
                | Self::F2
                | Self::F3
                | Self::F4
                | Self::F5
                | Self::F6
                | Self::F7
                | Self::F8
                | Self::F9
                | Self::F10
                | Self::F11
                | Self::F12
        )
    }

    /// macOS display glyph, falling back to the token itself.
    pub const fn glyph(self) -> &'static str {
        match self {
            Self::Enter => "↩",
            Self::Backspace => "⌫",
            Self::Delete => "⌦",
            Self::Tab => "⇥",
            Self::Escape => "⎋",
            Self::Space => "␣",
            Self::ArrowUp => "↑",
            Self::ArrowDown => "↓",
            Self::ArrowLeft => "←",
            Self::ArrowRight => "→",
            Self::Plus => "+",
            other => other.token(),
        }
    }
}

/// A modifier set plus the key it applies to — the typed form of an
/// accelerator. Its `Display` is the canonical string, so a non-canonical
/// spelling is not constructible.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Accel {
    pub mods: Mods,
    pub key: Key,
}

impl Accel {
    pub const fn new(mods: Mods, key: Key) -> Self {
        Self { mods, key }
    }
    pub const fn cmd(self) -> bool {
        self.mods.has(Mods::CMD)
    }
    pub const fn ctrl(self) -> bool {
        self.mods.has(Mods::CTRL)
    }
    pub const fn alt(self) -> bool {
        self.mods.has(Mods::ALT)
    }
    pub const fn shift(self) -> bool {
        self.mods.has(Mods::SHIFT)
    }

    /// macOS display form: `Cmd+Shift+Enter` → `⌘⇧↩`.
    pub fn glyphs(self) -> String {
        let mut out = String::new();
        for (on, glyph) in [
            (self.cmd(), "⌘"),
            (self.ctrl(), "⌃"),
            (self.alt(), "⌥"),
            (self.shift(), "⇧"),
        ] {
            if on {
                out.push_str(glyph);
            }
        }
        out.push_str(self.key.glyph());
        out
    }
}

impl fmt::Display for Accel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (on, name) in [
            (self.cmd(), "Cmd"),
            (self.ctrl(), "Ctrl"),
            (self.alt(), "Alt"),
            (self.shift(), "Shift"),
        ] {
            if on {
                write!(f, "{name}+")?;
            }
        }
        f.write_str(self.key.token())
    }
}

/// The accelerator was malformed: an unknown token, no key, or two keys.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ParseAccelError;

impl fmt::Display for ParseAccelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("not a valid accelerator")
    }
}

impl std::error::Error for ParseAccelError {}

impl FromStr for Accel {
    type Err = ParseAccelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut mods = Mods::NONE;
        let mut key = None;
        for part in s.split('+') {
            match part {
                "Cmd" => mods = mods.with(Mods::CMD),
                "Ctrl" => mods = mods.with(Mods::CTRL),
                "Alt" => mods = mods.with(Mods::ALT),
                "Shift" => mods = mods.with(Mods::SHIFT),
                other => {
                    let parsed = Key::parse(other).ok_or(ParseAccelError)?;
                    if key.replace(parsed).is_some() {
                        return Err(ParseAccelError);
                    }
                }
            }
        }
        Ok(Self::new(mods, key.ok_or(ParseAccelError)?))
    }
}

/// Serialized as its canonical string, so the IPC payload and the stored
/// override JSON keep the format the frontend already speaks.
impl Serialize for Accel {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

macro_rules! modbit {
    (Cmd) => {
        Mods::CMD
    };
    (Ctrl) => {
        Mods::CTRL
    };
    (Alt) => {
        Mods::ALT
    };
    (Shift) => {
        Mods::SHIFT
    };
}

/// Builds an [`Accel`] from modifier and key *names*, checked by the compiler:
/// `accel!(Cmd + Shift + Enter)`. A typo is a build error rather than a
/// shortcut that silently never registers.
///
/// Written as a token muncher because `$($m:ident +)* $k:ident` is ambiguous to
/// `macro_rules` — it can't tell a trailing modifier from the key.
macro_rules! accel {
    // No modifiers: the lone ident is the key.
    ($k:ident) => {
        Accel::new(Mods::NONE, Key::$k)
    };
    ($m:ident + $($rest:tt)+) => {
        accel!(@mods modbit!($m), $($rest)+)
    };
    // Peel modifiers off the front, accumulating the bit set.
    (@mods $acc:expr, $m:ident + $($rest:tt)+) => {
        accel!(@mods $acc.with(modbit!($m)), $($rest)+)
    };
    (@mods $acc:expr, $k:ident) => {
        Accel::new($acc, Key::$k)
    };
}

pub struct Command {
    pub id: &'static str,
    pub label: &'static str,
    pub scope: Scope,
    pub default_accel: Accel,
}

/// Every user-customizable command. Structural keys (Escape, Enter, Tab,
/// arrows, …) are deliberately not here — they are fixed conventions.
pub const COMMANDS: &[Command] = &[
    Command {
        id: "toggle_capture_bar",
        label: "Capture bar",
        scope: Scope::Global,
        default_accel: accel!(Cmd + Enter),
    },
    Command {
        id: "screenshot_capture",
        label: "Screenshot capture",
        scope: Scope::Global,
        default_accel: accel!(Cmd + Shift + Enter),
    },
    Command {
        id: "new_task",
        label: "New task",
        scope: Scope::Main,
        default_accel: accel!(Cmd + N),
    },
    Command {
        id: "search",
        label: "Search",
        scope: Scope::Main,
        default_accel: accel!(Cmd + F),
    },
    Command {
        id: "toggle_preview",
        label: "Toggle preview",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Backslash),
    },
    Command {
        id: "open_settings",
        label: "Open settings",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Comma),
    },
    Command {
        id: "delete_task",
        label: "Delete task",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Backspace),
    },
    Command {
        id: "switch_list_1",
        label: "Switch to list 1",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Digit1),
    },
    Command {
        id: "switch_list_2",
        label: "Switch to list 2",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Digit2),
    },
    Command {
        id: "switch_list_3",
        label: "Switch to list 3",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Digit3),
    },
    Command {
        id: "switch_list_4",
        label: "Switch to list 4",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Digit4),
    },
    Command {
        id: "switch_list_5",
        label: "Switch to list 5",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Digit5),
    },
    Command {
        id: "switch_list_6",
        label: "Switch to list 6",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Digit6),
    },
    Command {
        id: "switch_list_7",
        label: "Switch to list 7",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Digit7),
    },
    Command {
        id: "switch_list_8",
        label: "Switch to list 8",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Digit8),
    },
    Command {
        id: "switch_list_9",
        label: "Switch to list 9",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Digit9),
    },
    Command {
        id: "prev_tab",
        label: "Previous list tab",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Alt + ArrowLeft),
    },
    Command {
        id: "next_tab",
        label: "Next list tab",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Alt + ArrowRight),
    },
    Command {
        id: "prev_project",
        label: "Previous project",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Shift + BracketLeft),
    },
    Command {
        id: "next_project",
        label: "Next project",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Shift + BracketRight),
    },
    Command {
        id: "move_up",
        label: "Move task up",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Alt + ArrowUp),
    },
    Command {
        id: "move_down",
        label: "Move task down",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Alt + ArrowDown),
    },
    Command {
        id: "select_all",
        label: "Select all tasks",
        scope: Scope::Main,
        default_accel: accel!(Cmd + A),
    },
    Command {
        id: "command_palette",
        label: "Command palette",
        scope: Scope::Main,
        default_accel: accel!(Cmd + K),
    },
    Command {
        id: "toggle_split",
        label: "Toggle split view",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Alt + S),
    },
    Command {
        id: "focus_other_pane",
        label: "Focus other pane",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Alt + O),
    },
    Command {
        id: "new_list",
        label: "New list",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Shift + N),
    },
    Command {
        id: "new_project",
        label: "New project",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Shift + P),
    },
    Command {
        id: "toggle_completed",
        label: "Show/hide completed",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Shift + H),
    },
    Command {
        id: "collapse_all",
        label: "Collapse all",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Alt + Minus),
    },
    Command {
        id: "expand_all",
        label: "Expand all",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Alt + Equal),
    },
    Command {
        id: "undo",
        label: "Undo",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Z),
    },
    Command {
        id: "redo",
        label: "Redo",
        scope: Scope::Main,
        default_accel: accel!(Cmd + Shift + Z),
    },
    Command {
        id: "clear_draft",
        label: "Clear capture draft",
        scope: Scope::Tray,
        default_accel: accel!(Cmd + Shift + Backspace),
    },
];

/// A catalog entry with its effective combo, as served to the frontends.
#[derive(Clone, Serialize)]
pub struct ResolvedBinding {
    pub id: &'static str,
    pub label: &'static str,
    pub scope: Scope,
    /// Effective accelerator; `None` when intentionally unbound, which the
    /// frontend contract spells as the empty string.
    #[serde(serialize_with = "serialize_opt_accel")]
    pub accel: Option<Accel>,
    pub default: Accel,
}

fn serialize_opt_accel<S: Serializer>(
    accel: &Option<Accel>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match accel {
        Some(a) => serializer.collect_str(a),
        None => serializer.serialize_str(""),
    }
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

/// The full catalog with effective combos (stored override, else default). A
/// stored value that no longer parses is treated as unbound rather than passed
/// on — nothing downstream can receive a malformed accelerator.
pub async fn resolve(store: &Store) -> Result<Vec<ResolvedBinding>> {
    let overrides = load_overrides(store).await?;
    Ok(COMMANDS
        .iter()
        .map(|c| ResolvedBinding {
            id: c.id,
            label: c.label,
            scope: c.scope,
            accel: match overrides.get(c.id) {
                Some(stored) => stored.parse().ok(),
                None => Some(c.default_accel),
            },
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

    let bound = if accel.is_empty() {
        None
    } else {
        let parsed: Accel = accel
            .parse()
            .map_err(|_| anyhow!("invalid shortcut: {accel}"))?;
        // A bare key would swallow normal typing (and a bare global would fire
        // constantly); require a real modifier everywhere except F-keys.
        if !parsed.mods.has_primary() && !parsed.key.is_function() {
            bail!("shortcut needs ⌘, ⌃ or ⌥");
        }
        for other in resolve(store).await? {
            if other.id != id && other.scope == command.scope && other.accel == Some(parsed) {
                bail!("already used by “{}”", other.label);
            }
        }
        Some(parsed)
    };

    let mut overrides = load_overrides(store).await?;
    if bound == Some(command.default_accel) {
        overrides.remove(id);
    } else {
        // Canonical by construction — `Display` is the only way out of `Accel`.
        overrides.insert(
            id.to_string(),
            bound.map(|a| a.to_string()).unwrap_or_default(),
        );
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique_and_defaults_dont_collide_in_scope() {
        for (i, a) in COMMANDS.iter().enumerate() {
            for b in &COMMANDS[i + 1..] {
                assert_ne!(a.id, b.id, "duplicate command id: {}", a.id);
                assert!(
                    a.scope != b.scope || a.default_accel != b.default_accel,
                    "{} and {} both default to {} in the same scope",
                    a.id,
                    b.id,
                    a.default_accel
                );
            }
        }
    }

    #[test]
    fn catalog_defaults_are_bindable() {
        // The rule set_binding enforces on user input — the defaults must pass
        // it too, or a command ships with a combo the user can never restore.
        for c in COMMANDS {
            assert!(
                c.default_accel.mods.has_primary() || c.default_accel.key.is_function(),
                "{} defaults to {}, which set_binding would reject",
                c.id,
                c.default_accel
            );
        }
    }

    #[test]
    fn accels_round_trip_through_their_string_form() {
        for c in COMMANDS {
            let text = c.default_accel.to_string();
            assert_eq!(
                text.parse::<Accel>().expect("catalog accel must re-parse"),
                c.default_accel,
                "{} did not survive the string round trip",
                c.id
            );
        }
    }

    #[test]
    fn parsing_normalizes_case_and_modifier_order() {
        let canonical: Accel = "Cmd+Alt+Shift+K".parse().unwrap();
        assert_eq!(canonical.to_string(), "Cmd+Alt+Shift+K");
        // Same combo, written out of order and in lowercase.
        assert_eq!("Shift+Alt+Cmd+k".parse::<Accel>().unwrap(), canonical);
        assert_eq!(" ".parse::<Accel>().unwrap().key, Key::Space);
    }

    #[test]
    fn parsing_rejects_malformed_accels() {
        for bad in ["", "Cmd", "Cmd+", "Cmd+Shft+K", "Cmd+K+J", "Cmd+%", "Cmd+F13"] {
            assert!(
                bad.parse::<Accel>().is_err(),
                "{bad:?} should not parse as an accelerator"
            );
        }
    }

    #[test]
    fn every_key_token_parses_back_to_itself() {
        for &key in Key::ALL {
            assert_eq!(Key::parse(key.token()), Some(key), "{key:?}");
        }
    }

    #[test]
    fn key_tokens_are_unique() {
        for (i, &a) in Key::ALL.iter().enumerate() {
            for &b in &Key::ALL[i + 1..] {
                assert_ne!(a.token(), b.token(), "{a:?} and {b:?} share a token");
            }
        }
    }
}
