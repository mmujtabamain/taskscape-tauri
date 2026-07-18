//! The stdin/stdout wire protocol between the main app and the standalone Slint
//! modal binary. The main app spawns the binary, writes one [`Launch`] JSON blob
//! to its stdin, and reads back `type`-tagged [`Outbound`] lines on its stdout:
//! a single `result` line for a modal, or a stream of `apply` lines for the
//! overlay. No Tauri IPC and no HTTP crosses the process boundary.
//!
//! `props` stays an opaque `serde_json::Value`: the main app forwards whatever
//! the frontend passed (a `ModalProps` or the overlay's pane view) straight
//! through, and only the Slint binary interprets it.

use serde::{Deserialize, Serialize};

/// The main window's frame in **physical** pixels plus its scale factor, so the
/// child can center itself over the main window on mixed-DPI setups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MainFrame {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
}

/// The single JSON payload written to the child's stdin at launch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Launch {
    /// `"modal"` or `"overlay"` — selects which surface the one binary renders.
    pub kind: String,
    /// Opaque, surface-specific props (a `ModalProps`, or `{ paneId, paneName, view }`).
    pub props: serde_json::Value,
    pub main_frame: MainFrame,
    /// Snapshot of the resolved theme at launch (modals are short-lived).
    pub dark: bool,
}

impl Launch {
    pub const KIND_MODAL: &'static str = "modal";
    pub const KIND_OVERLAY: &'static str = "overlay";
}

/// A modal's outcome — the JSON shape the frontend already consumes
/// (`buttonId` / `value` / `timedOut`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModalResult {
    #[serde(rename = "buttonId")]
    pub button_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(
        rename = "timedOut",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub timed_out: Option<bool>,
}

/// One line the child writes to stdout. Internally tagged by `type`:
/// `{"type":"result", ...}` (modal, exactly one) or
/// `{"type":"apply", paneId, view}` (overlay, streamed).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Outbound {
    Result(ModalResult),
    Apply {
        #[serde(rename = "paneId")]
        pane_id: String,
        view: serde_json::Value,
    },
}
