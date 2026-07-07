use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct List {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub list_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub done: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// Optional due date, unix millis at local midnight.
    pub due_at: Option<i64>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

/// How an attachment points at its underlying file.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LinkType {
    /// Records a pointer (online URL, `file://` URL, or network path). Nothing is copied.
    Reference,
    /// The file was copied into `~/.taskscape/attachments/`.
    Copy,
}

impl LinkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            LinkType::Reference => "reference",
            LinkType::Copy => "copy",
        }
    }

    pub fn from_db(s: &str) -> LinkType {
        match s {
            "copy" => LinkType::Copy,
            _ => LinkType::Reference,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    /// Display name (usually the original file name).
    pub name: String,
    pub link_type: LinkType,
    /// For `Reference`: the URL/path as given. For `Copy`: a path relative to the root dir.
    pub location: String,
    pub created_at: i64,
}
