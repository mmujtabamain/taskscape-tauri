//! Shared library for the Taskscape apps.
//!
//! Both `taskscape-main` and `taskscape-tray` link against this crate and use it
//! to persist data (SQLite in `~/.taskscape/`), capture screenshots, manage
//! attachments, and serve/consume the cross-process HTTP endpoints.

pub mod attachments;
pub mod models;
pub mod paths;
pub mod screenshot;
pub mod server;
pub mod storage;
pub mod util;

pub use models::{Attachment, LinkType, List, Task};
pub use storage::Store;

/// Fixed localhost ports used for cross-process HTTP IPC.
pub const MAIN_PORT: u16 = 7420;
pub const TRAY_PORT: u16 = 7421;
