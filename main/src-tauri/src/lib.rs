mod panels;
mod power;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use axum::{extract::State as AxumState, http::StatusCode, routing::post, Router};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};
use taskscape_common::{
    hotkeys, server, Attachment, LinkType, List, Note, Project, Store, Task, MAIN_PORT, TRAY_PORT,
};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Whether the main window should paint dark: the saved `theme` preference wins
/// ("light"/"dark"), otherwise follow the current system appearance.
async fn resolve_dark(store: &Store, window: &tauri::WebviewWindow) -> bool {
    match store.get_setting("theme").await.ok().flatten().as_deref() {
        Some("dark") => true,
        Some("light") => false,
        _ => window
            .theme()
            .map(|t| t == tauri::Theme::Dark)
            .unwrap_or(false),
    }
}

/// The pending modal (id + props), if any. One reusable panel window serves
/// every modal: destroying a class-swapped NSPanel raises an Objective-C
/// exception during teardown (fatal across the FFI boundary), so — like the
/// tray's mini bar — the window is only ever hidden, never destroyed. An id
/// still pending when the window goes away means the modal never answered.
struct ModalState(Mutex<Option<(String, serde_json::Value)>>);

/// The props (which pane + its current view) for the standalone `overlay` filter
/// window, fetched by that window on load / on refresh. Like the modal window, it
/// is a single reused panel that is only ever hidden, never destroyed.
struct OverlayState(Mutex<Option<serde_json::Value>>);

/// Whether the (warmed, reused) settings panel is currently open. Unlike modal /
/// overlay it carries no props, but it still needs an open flag: the panel is
/// created hidden at startup, so its frontend must know not to present itself
/// until `open_settings` has actually asked for it.
struct SettingsState(AtomicBool);

/// Set once the main window has been revealed (by `reveal_main` or the startup
/// fallback), so the two paths never double-reveal it.
static MAIN_REVEALED: AtomicBool = AtomicBool::new(false);

/// Sender into the note-write queue. Autosave streams `update_note` calls as the
/// user types; enqueuing them (instead of writing inline) lets a single worker
/// apply them in arrival order, off the command path, so concurrent edits to the
/// same note never race.
struct NoteQueue(tauri::async_runtime::Sender<(String, String)>);

/// In the packaged macOS app the always-on menu-bar agent ships nested inside
/// this bundle at `Contents/Library/LoginItems/taskscape-tray.app`, so the user
/// only ever installs and launches one app. `open` (without `-n`) reuses a
/// running instance, so this never spawns a duplicate tray. In dev the nested
/// bundle doesn't exist, so this is a no-op and `run-dev.sh` starts the tray.
#[cfg(target_os = "macos")]
fn launch_embedded_tray() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    // <bundle>/Contents/MacOS/<exe> → <bundle>/Contents/Library/LoginItems/taskscape-tray.app
    let Some(tray) = exe
        .parent()
        .and_then(|macos| macos.parent())
        .map(|contents| contents.join("Library/LoginItems/taskscape-tray.app"))
    else {
        return;
    };
    if tray.exists() {
        let _ = std::process::Command::new("open").arg(&tray).status();
    }
}

#[tauri::command]
async fn list_projects(store: State<'_, Arc<Store>>) -> Result<Vec<Project>, String> {
    store.list_projects().await.map_err(err)
}

#[tauri::command]
async fn create_project(store: State<'_, Arc<Store>>, name: String) -> Result<Project, String> {
    store.create_project(&name).await.map_err(err)
}

#[tauri::command]
async fn rename_project(
    store: State<'_, Arc<Store>>,
    id: String,
    name: String,
) -> Result<(), String> {
    store.rename_project(&id, &name).await.map_err(err)
}

#[tauri::command]
async fn delete_project(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.delete_project(&id).await.map_err(err)
}

/// The default project (created on demand). Used to seed a first project when
/// the database has none yet.
#[tauri::command]
async fn default_project(store: State<'_, Arc<Store>>) -> Result<Project, String> {
    store.default_project().await.map_err(err)
}

#[tauri::command]
async fn list_lists(store: State<'_, Arc<Store>>) -> Result<Vec<List>, String> {
    store.list_lists().await.map_err(err)
}

#[tauri::command]
async fn create_list(
    store: State<'_, Arc<Store>>,
    project_id: String,
    name: String,
) -> Result<List, String> {
    store.create_list(&project_id, &name).await.map_err(err)
}

#[tauri::command]
async fn rename_list(store: State<'_, Arc<Store>>, id: String, name: String) -> Result<(), String> {
    store.rename_list(&id, &name).await.map_err(err)
}

#[tauri::command]
async fn delete_list(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.delete_list(&id).await.map_err(err)
}

#[tauri::command]
async fn reorder_list(
    store: State<'_, Arc<Store>>,
    id: String,
    sort_order: f64,
) -> Result<(), String> {
    store.reorder_list(&id, sort_order).await.map_err(err)
}

#[tauri::command]
async fn list_tasks(store: State<'_, Arc<Store>>, list_id: String) -> Result<Vec<Task>, String> {
    store.list_tasks(&list_id).await.map_err(err)
}

#[tauri::command]
async fn all_tasks(store: State<'_, Arc<Store>>) -> Result<Vec<Task>, String> {
    store.all_tasks().await.map_err(err)
}

#[tauri::command]
async fn create_task(
    store: State<'_, Arc<Store>>,
    list_id: String,
    title: String,
    notes: Option<String>,
    parent_id: Option<String>,
) -> Result<Task, String> {
    store
        .create_task(&list_id, &title, notes.as_deref(), parent_id.as_deref())
        .await
        .map_err(err)
}

#[tauri::command]
async fn update_task(
    store: State<'_, Arc<Store>>,
    id: String,
    title: Option<String>,
    notes: Option<String>,
    done: Option<bool>,
) -> Result<Task, String> {
    store
        .update_task(&id, title.as_deref(), notes.as_deref(), done)
        .await
        .map_err(err)
}

/// Soft-delete a task (move it, with its subtree, to the Trash). Returns every
/// id that was stamped, so the caller can undo the exact set.
#[tauri::command]
async fn delete_task(store: State<'_, Arc<Store>>, id: String) -> Result<Vec<String>, String> {
    store.soft_delete_tasks(&[id]).await.map_err(err)
}

#[tauri::command]
async fn move_task(
    store: State<'_, Arc<Store>>,
    id: String,
    parent_id: Option<String>,
    list_id: Option<String>,
    sort_order: Option<f64>,
) -> Result<Task, String> {
    store
        .move_task(&id, parent_id.as_deref(), list_id.as_deref(), sort_order)
        .await
        .map_err(err)
}

#[tauri::command]
async fn reorder_task(
    store: State<'_, Arc<Store>>,
    id: String,
    sort_order: f64,
) -> Result<Task, String> {
    store.reorder_task(&id, sort_order).await.map_err(err)
}

/// Soft-delete several tasks (and their subtrees) in one transaction. Callers
/// pass the forest roots of the selection. Returns every stamped id so the
/// delete is undoable/restorable as an exact set.
#[tauri::command]
async fn delete_tasks(store: State<'_, Arc<Store>>, ids: Vec<String>) -> Result<Vec<String>, String> {
    store.soft_delete_tasks(&ids).await.map_err(err)
}

/// Restore soft-deleted tasks (undo a delete / restore from Trash).
#[tauri::command]
async fn restore_tasks(store: State<'_, Arc<Store>>, ids: Vec<String>) -> Result<(), String> {
    store.restore_tasks(&ids).await.map_err(err)
}

/// Permanently remove tasks from the Trash.
#[tauri::command]
async fn purge_tasks(store: State<'_, Arc<Store>>, ids: Vec<String>) -> Result<(), String> {
    store.purge_tasks(&ids).await.map_err(err)
}

/// Everything currently in the Trash, most-recently-deleted first.
#[tauri::command]
async fn list_trashed(store: State<'_, Arc<Store>>) -> Result<Vec<Task>, String> {
    store.list_trashed().await.map_err(err)
}

/// Permanently empty the Trash.
#[tauri::command]
async fn empty_trash(store: State<'_, Arc<Store>>) -> Result<(), String> {
    store.empty_trash().await.map_err(err)
}

/// Set the done flag on several tasks at once (bulk mark done / not done).
#[tauri::command]
async fn set_tasks_done(
    store: State<'_, Arc<Store>>,
    ids: Vec<String>,
    done: bool,
) -> Result<(), String> {
    for id in &ids {
        store
            .update_task(id, None, None, Some(done))
            .await
            .map_err(err)?;
    }
    Ok(())
}

/// Group tasks under their parents, preserving the incoming order (callers pass
/// tasks already sorted by `sort_order`, so each group stays in visual order).
/// Returns (roots, children-by-parent-id).
fn group_by_parent(tasks: &[Task]) -> (Vec<&Task>, HashMap<&str, Vec<&Task>>) {
    let mut roots = Vec::new();
    let mut children: HashMap<&str, Vec<&Task>> = HashMap::new();
    for t in tasks {
        match &t.parent_id {
            Some(p) => children.entry(p.as_str()).or_default().push(t),
            None => roots.push(t),
        }
    }
    (roots, children)
}

/// Render selected tasks as a Markdown checklist. The output holds *exactly* the
/// selected tasks in tree order; a task's indent is how many of its ancestors are
/// also selected, so selecting a parent + child nests the child while a lone
/// selected child renders flush left. Each task's note blocks follow it as
/// plaintext lines, indented one level deeper.
fn render_markdown<'a>(
    node: &'a Task,
    depth: usize,
    children: &HashMap<&'a str, Vec<&'a Task>>,
    selected: &HashSet<&str>,
    out: &mut String,
) {
    let picked = selected.contains(node.id.as_str());
    if picked {
        for _ in 0..depth {
            out.push_str("  ");
        }
        out.push_str(if node.done { "- [x] " } else { "- [ ] " });
        out.push_str(&node.title);
        out.push('\n');
        for note in &node.note_items {
            let text = taskscape_common::storage::strip_html(&note.content);
            if text.is_empty() {
                continue;
            }
            // Blockquote, aligned to the list item's content column: `>` opens a
            // real block so the note renders as a quoted description under the
            // task instead of being slurped into its title line.
            for _ in 0..depth + 1 {
                out.push_str("  ");
            }
            out.push_str("> ");
            out.push_str(&text);
            out.push('\n');
        }
    }
    let child_depth = depth + usize::from(picked);
    if let Some(kids) = children.get(node.id.as_str()) {
        for k in kids {
            render_markdown(k, child_depth, children, selected, out);
        }
    }
}

/// Build a Markdown checklist for the given task ids (Select mode's copy action).
#[tauri::command]
async fn copy_tasks(store: State<'_, Arc<Store>>, ids: Vec<String>) -> Result<String, String> {
    let tasks = store.all_tasks().await.map_err(err)?;
    let selected: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let (roots, children) = group_by_parent(&tasks);
    let mut out = String::new();
    for r in &roots {
        render_markdown(r, 0, &children, &selected, &mut out);
    }
    Ok(out.trim_end().to_string())
}

/// A list exported to JSON: full fidelity minus copied-file attachments, which
/// live under `~/.taskscape/` and can't travel in the document.
#[derive(Serialize, Deserialize)]
struct ListExport {
    /// Schema version, so a future import can migrate older documents.
    taskscape_export: u32,
    list: ListMeta,
    tasks: Vec<ExportTask>,
}

#[derive(Serialize, Deserialize)]
struct ListMeta {
    name: String,
}

#[derive(Serialize, Deserialize)]
struct ExportTask {
    title: String,
    done: bool,
    /// Rich-text note blocks (sanitized HTML), in order.
    #[serde(default)]
    notes: Vec<String>,
    /// `reference`-type attachments only.
    #[serde(default)]
    attachments: Vec<ExportAttachment>,
    #[serde(default)]
    children: Vec<ExportTask>,
}

#[derive(Serialize, Deserialize)]
struct ExportAttachment {
    name: String,
    location: String,
}

fn to_export_task<'a>(node: &'a Task, children: &HashMap<&'a str, Vec<&'a Task>>) -> ExportTask {
    ExportTask {
        title: node.title.clone(),
        done: node.done,
        notes: node.note_items.iter().map(|n| n.content.clone()).collect(),
        attachments: node
            .attachments
            .iter()
            .filter(|a| a.link_type == LinkType::Reference)
            .map(|a| ExportAttachment {
                name: a.name.clone(),
                location: a.location.clone(),
            })
            .collect(),
        children: children
            .get(node.id.as_str())
            .map(|kids| kids.iter().map(|k| to_export_task(k, children)).collect())
            .unwrap_or_default(),
    }
}

/// Write a whole list (its tasks, subtasks, notes, and reference attachments) to
/// `path` as JSON.
#[tauri::command]
async fn export_list(
    store: State<'_, Arc<Store>>,
    list_id: String,
    path: String,
) -> Result<(), String> {
    let list = store
        .list_lists()
        .await
        .map_err(err)?
        .into_iter()
        .find(|l| l.id == list_id)
        .ok_or_else(|| format!("list not found: {list_id}"))?;
    let tasks = store.list_tasks(&list_id).await.map_err(err)?;
    let (roots, children) = group_by_parent(&tasks);
    let export = ListExport {
        taskscape_export: 1,
        list: ListMeta { name: list.name },
        tasks: roots.iter().map(|r| to_export_task(r, &children)).collect(),
    };
    let json = serde_json::to_string_pretty(&export).map_err(err)?;
    std::fs::write(&path, json).map_err(err)
}

/// Recreate one exported task (and its subtree) under `parent_id` in `list_id`.
/// Async recursion needs a boxed future, hence the `Box::pin` on the child call.
async fn import_task(
    store: &Store,
    list_id: &str,
    parent_id: Option<&str>,
    t: &ExportTask,
) -> Result<(), String> {
    let task = store
        .create_task(list_id, &t.title, None, parent_id)
        .await
        .map_err(err)?;
    if t.done {
        store
            .update_task(&task.id, None, None, Some(true))
            .await
            .map_err(err)?;
    }
    for note in &t.notes {
        store.create_note(&task.id, note).await.map_err(err)?;
    }
    for a in &t.attachments {
        taskscape_common::attachments::attach_reference(store, &task.id, &a.name, &a.location)
            .await
            .map_err(err)?;
    }
    for child in &t.children {
        Box::pin(import_task(store, list_id, Some(&task.id), child)).await?;
    }
    Ok(())
}

/// Create a new list in `project_id` from an exported JSON file. `name` overrides
/// the document's embedded list name when provided (non-blank).
#[tauri::command]
async fn import_list(
    store: State<'_, Arc<Store>>,
    project_id: String,
    path: String,
    name: Option<String>,
) -> Result<List, String> {
    let raw = std::fs::read_to_string(&path).map_err(err)?;
    let export: ListExport = serde_json::from_str(&raw).map_err(err)?;
    let list_name = name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(export.list.name);
    let list = store.create_list(&project_id, &list_name).await.map_err(err)?;
    for t in &export.tasks {
        import_task(&store, &list.id, None, t).await?;
    }
    Ok(list)
}

#[tauri::command]
async fn list_notes(store: State<'_, Arc<Store>>, task_id: String) -> Result<Vec<Note>, String> {
    store.list_notes(&task_id).await.map_err(err)
}

#[tauri::command]
async fn create_note(
    store: State<'_, Arc<Store>>,
    task_id: String,
    content: String,
) -> Result<Note, String> {
    store.create_note(&task_id, &content).await.map_err(err)
}

#[tauri::command]
async fn update_note(
    queue: State<'_, NoteQueue>,
    id: String,
    content: String,
) -> Result<(), String> {
    // Fire-and-forget: hand the edit to the ordered write queue and return. The
    // worker spawned in `run`'s setup applies each one via `Store::update_note`.
    queue.0.send((id, content)).await.map_err(err)
}

#[tauri::command]
async fn delete_note(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.delete_note(&id).await.map_err(err)
}

#[tauri::command]
async fn list_attachments(
    store: State<'_, Arc<Store>>,
    task_id: String,
) -> Result<Vec<Attachment>, String> {
    store.list_attachments(&task_id).await.map_err(err)
}

#[tauri::command]
async fn add_reference(
    store: State<'_, Arc<Store>>,
    task_id: String,
    name: String,
    location: String,
) -> Result<Attachment, String> {
    taskscape_common::attachments::attach_reference(&store, &task_id, &name, &location)
        .await
        .map_err(err)
}

#[tauri::command]
async fn add_copy(
    store: State<'_, Arc<Store>>,
    task_id: String,
    source_path: String,
    name: Option<String>,
) -> Result<Attachment, String> {
    taskscape_common::attachments::attach_copy(&store, &task_id, &source_path, name.as_deref())
        .await
        .map_err(err)
}

#[tauri::command]
async fn delete_attachment(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.delete_attachment(&id).await.map_err(err)
}

#[tauri::command]
async fn rename_attachment(
    store: State<'_, Arc<Store>>,
    id: String,
    name: String,
) -> Result<Attachment, String> {
    taskscape_common::attachments::rename_attachment(&store, &id, &name)
        .await
        .map_err(err)
}

/// Capture the screen (full-screen or interactive region, per the user's
/// `screenshot_mode` setting) and return the saved PNG path, without attaching
/// it to anything. Returns `None` when a region capture is cancelled. The
/// frontend uses this to grab the shot *before* deciding whether to create a
/// task, so a cancelled region capture leaves no empty task behind.
#[tauri::command]
async fn capture_screenshot() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(taskscape_common::screenshot::capture)
        .await
        .map_err(err)?
        .map_err(err)
        .map(|opt| opt.map(|p| p.to_string_lossy().into_owned()))
}

/// Capture the screen (full-screen or interactive region, per the user's
/// `screenshot_mode` setting) and attach it to a task as a copy. macOS prompts
/// for Screen Recording permission the first time this app triggers a capture.
/// Returns `None` when a region capture is cancelled.
#[tauri::command]
async fn attach_screenshot(
    store: State<'_, Arc<Store>>,
    task_id: String,
) -> Result<Option<Attachment>, String> {
    // `screencapture` is a blocking shell-out — keep it off the async runtime.
    let Some(path) = tauri::async_runtime::spawn_blocking(taskscape_common::screenshot::capture)
        .await
        .map_err(err)?
        .map_err(err)?
    else {
        return Ok(None);
    };
    taskscape_common::attachments::attach_copy(
        &store,
        &task_id,
        &path.to_string_lossy(),
        Some("screenshot.png"),
    )
    .await
    .map(Some)
    .map_err(err)
}

/// Remember which list the user last had open, so the tray captures land there.
#[tauri::command]
async fn set_active_list(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store.set_setting("last_active_list", &id).await.map_err(err)
}

/// Remember which project the user last had open, so we can restore it on launch.
#[tauri::command]
async fn set_active_project(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    store
        .set_setting("last_active_project", &id)
        .await
        .map_err(err)
}

/// Read a persisted setting (e.g. `last_active_project`).
#[tauri::command]
async fn get_setting(
    store: State<'_, Arc<Store>>,
    key: String,
) -> Result<Option<String>, String> {
    store.get_setting(&key).await.map_err(err)
}

#[tauri::command]
async fn set_setting(
    store: State<'_, Arc<Store>>,
    key: String,
    value: String,
) -> Result<(), String> {
    store.set_setting(&key, &value).await.map_err(err)
}

/// The hotkey catalog with effective (user-customized) combos.
#[tauri::command]
async fn list_hotkeys(
    store: State<'_, Arc<Store>>,
) -> Result<Vec<hotkeys::ResolvedBinding>, String> {
    hotkeys::resolve(&store).await.map_err(err)
}

/// Persist one binding (`""` unbinds). The error carries the conflict message
/// the shortcuts editor shows inline.
#[tauri::command]
async fn set_hotkey(
    store: State<'_, Arc<Store>>,
    id: String,
    accel: String,
) -> Result<(), String> {
    hotkeys::set_binding(&store, &id, &accel).await.map_err(err)
}

/// Restore one binding to its default combo.
#[tauri::command]
async fn reset_hotkey(store: State<'_, Arc<Store>>, id: String) -> Result<(), String> {
    hotkeys::reset_binding(&store, &id).await.map_err(err)
}

/// Open an attachment with the OS default handler. Copies resolve to their file
/// under `~/.taskscape/`; references (URLs / file / network paths) open as-is.
#[tauri::command]
fn open_attachment(link_type: String, location: String) -> Result<(), String> {
    let target = if link_type == "copy" {
        taskscape_common::paths::resolve(&location)
            .to_string_lossy()
            .into_owned()
    } else {
        location
    };
    std::process::Command::new("open")
        .arg(&target)
        .status()
        .map_err(err)?;
    Ok(())
}

/// Reveal an attachment in Finder/Explorer. Copies resolve to their file under
/// `~/.taskscape/`; file references reveal as given. Web URLs have no file to
/// reveal.
#[tauri::command]
fn reveal_attachment(link_type: String, location: String) -> Result<(), String> {
    let target = if link_type == "copy" {
        taskscape_common::paths::resolve(&location)
            .to_string_lossy()
            .into_owned()
    } else if location.starts_with("http://") || location.starts_with("https://") {
        return Err("cannot reveal a URL in the file manager".into());
    } else {
        location
    };
    tauri_plugin_opener::reveal_item_in_dir(&target).map_err(err)
}

/// Build one auxiliary panel window — hidden, primed transparent, and styled as a
/// rounded NSPanel. Shared by startup warming ([`warm_panels`]) and the lazy
/// fallback in the `open_*` commands. All three panels load the shared
/// `panels.html` bundle (separate from the main app's), routed by URL fragment.
/// `min` sets an optional minimum inner size (settings only).
fn build_panel(
    app: &AppHandle,
    label: &str,
    fragment: &str,
    title: &str,
    width: f64,
    height: f64,
    resizable: bool,
    min: Option<(f64, f64)>,
) -> Result<tauri::WebviewWindow, String> {
    let url = format!("panels.html{fragment}");
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(width, height)
        .resizable(resizable)
        .minimizable(false)
        .maximizable(false)
        .decorations(false)
        .shadow(true)
        .visible(false)
        .skip_taskbar(true);
    if let Some((mw, mh)) = min {
        builder = builder.min_inner_size(mw, mh);
    }
    let window = builder.build().map_err(err)?;
    // AppKit is main-thread-only; commands (and setup) run off it.
    let w = window.clone();
    window
        .run_on_main_thread(move || panels::style_panel(&w))
        .map_err(err)?;
    Ok(window)
}

/// Pre-build the modal / overlay / settings panels at startup (hidden) so the
/// first time one is opened it's an instant fade-in rather than a cold webview
/// boot. Errors are logged, not fatal — the `open_*` commands rebuild on demand.
fn warm_panels(app: &AppHandle) {
    let panels = [
        ("modal", "#modal", "", 420., 240., false, None),
        ("overlay", "#overlay", "Filters", 340., 420., false, None),
        (
            "settings",
            "#settings",
            "Settings",
            640.,
            520.,
            true,
            Some((640., 520.)),
        ),
    ];
    for (label, fragment, title, w, h, resizable, min) in panels {
        if let Err(e) = build_panel(app, label, fragment, title, w, h, resizable, min) {
            eprintln!("[taskscape-main] failed to warm {label} panel: {e}");
        }
    }
}

/// Show a modal in the shared panel window (warmed at startup, then reused hidden
/// — never destroyed). Its outcome comes back to "main" as a `modal-result:{id}`
/// event via `close_modal`. The frontend reveals it (fade-in) via `present_window`
/// once it has measured its content.
#[tauri::command]
fn open_modal(
    app: AppHandle,
    state: State<'_, ModalState>,
    id: String,
    props: serde_json::Value,
) -> Result<(), String> {
    // A modal opened over an unanswered one cancels the first, so the first
    // caller's pending promise still resolves.
    if let Some((old_id, _)) = state.0.lock().unwrap().replace((id.clone(), props)) {
        if old_id != id {
            let _ = app.emit_to(
                "main",
                &format!("modal-result:{old_id}"),
                serde_json::json!({ "buttonId": null }),
            );
        }
    }
    if app.get_webview_window("modal").is_none() {
        build_panel(&app, "modal", "#modal", "", 420., 240., false, None)?;
    }
    app.emit_to("modal", "modal-refresh", &id).map_err(err)?;
    Ok(())
}

/// The pending modal (id + props), fetched by the shared modal window on load
/// and on every `modal-refresh`.
#[tauri::command]
fn modal_current(state: State<'_, ModalState>) -> Result<serde_json::Value, String> {
    state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|(id, props)| serde_json::json!({ "id": id, "props": props }))
        .ok_or_else(|| "no modal pending".to_string())
}

/// Called by a modal/overlay/settings window once its content is measured: size
/// it, center it over the main window, then show it — so the user never sees it
/// resize or jump. The window is warmed hidden, so `show()` reveals it already
/// laid out at the right size.
#[tauri::command]
fn present_window(
    window: tauri::WebviewWindow,
    app: AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    window.set_size(LogicalSize::new(width, height)).map_err(err)?;
    match app.get_webview_window("main") {
        Some(main) => {
            let main_pos = main.outer_position().map_err(err)?;
            let main_size = main.outer_size().map_err(err)?;
            // outer_position/outer_size are physical, the given size is logical
            // — scale it by the MAIN window's factor (the display the panel will
            // be centered on) so it lands right on mixed-DPI multi-monitor setups.
            let scale = main.scale_factor().map_err(err)?;
            let x = main_pos.x + (main_size.width as i32 - (width * scale) as i32) / 2;
            let y = main_pos.y + (main_size.height as i32 - (height * scale) as i32) / 2;
            window.set_position(PhysicalPosition::new(x, y)).map_err(err)?;
        }
        None => window.center().map_err(err)?,
    }
    window.show().map_err(err)?;
    window.set_focus().map_err(err)?;
    let w = window.clone();
    let _ = window.run_on_main_thread(move || panels::invalidate_shadow(&w));
    Ok(())
}

#[tauri::command]
fn close_modal(
    app: AppHandle,
    state: State<'_, ModalState>,
    id: String,
    result: serde_json::Value,
) -> Result<(), String> {
    app.emit_to("main", &format!("modal-result:{id}"), result)
        .map_err(err)?;
    let mut pending = state.0.lock().unwrap();
    if pending.as_ref().is_some_and(|(cur, _)| *cur == id) {
        *pending = None;
    }
    drop(pending);
    // Hide, never destroy — see ModalState. `modal-clear` empties the panel's
    // content so the reused window doesn't hold this modal for the next open.
    if let Some(window) = app.get_webview_window("modal") {
        let _ = app.emit_to("modal", "modal-clear", ());
        panels::hide_panel(&window);
    }
    Ok(())
}

/// Open the per-pane filter overlay window for the given props (pane id + name +
/// its current view). Reuses the warmed hidden panel (rebuilt on demand if it's
/// somehow gone); the frontend reveals it via `present_window`. Edits stream back
/// to the main window as `overlay-apply` events, so there is no result to plumb.
#[tauri::command]
fn open_overlay(
    app: AppHandle,
    state: State<'_, OverlayState>,
    props: serde_json::Value,
) -> Result<(), String> {
    *state.0.lock().unwrap() = Some(props);
    if app.get_webview_window("overlay").is_none() {
        build_panel(&app, "overlay", "#overlay", "Filters", 340., 420., false, None)?;
    }
    app.emit_to("overlay", "overlay-refresh", ()).map_err(err)?;
    Ok(())
}

/// The pending overlay props, fetched by the overlay window on load and on every
/// `overlay-refresh`.
#[tauri::command]
fn overlay_current(state: State<'_, OverlayState>) -> Result<serde_json::Value, String> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no overlay pending".to_string())
}

#[tauri::command]
fn close_overlay(app: AppHandle, state: State<'_, OverlayState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None;
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = app.emit_to("overlay", "overlay-clear", ());
        panels::hide_panel(&window);
    }
    Ok(())
}

/// Mark the (warmed, reused) settings panel open and ask its frontend to present
/// itself. It's built at startup hidden; rebuilt on demand only if it's gone.
#[tauri::command]
fn open_settings(app: AppHandle, state: State<'_, SettingsState>) -> Result<(), String> {
    state.0.store(true, Ordering::SeqCst);
    if app.get_webview_window("settings").is_none() {
        build_panel(
            &app,
            "settings",
            "#settings",
            "Settings",
            640.,
            520.,
            true,
            Some((640., 520.)),
        )?;
    }
    app.emit_to("settings", "settings-refresh", ()).map_err(err)?;
    Ok(())
}

/// Whether the settings panel is currently open — queried by its frontend on
/// mount so a warmed-but-not-yet-opened panel knows not to present itself.
#[tauri::command]
fn settings_current(state: State<'_, SettingsState>) -> bool {
    state.0.load(Ordering::SeqCst)
}

/// Reveal the main window once its webview signals it has loaded. Idempotent
/// (and raced against a startup fallback) via [`MAIN_REVEALED`], so the window is
/// shown exactly once.
#[tauri::command]
fn reveal_main(app: AppHandle) -> Result<(), String> {
    if MAIN_REVEALED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(err)?;
        window.set_focus().map_err(err)?;
    }
    Ok(())
}

/// Keep the main window's native background in sync with the live theme — a
/// system light/dark flip or a manual override from Settings — so a later
/// resize never reveals a stale white/wrong-mode edge. Called from the frontend
/// theme `apply()` in every window, but only the opaque main window is painted;
/// the transparent panels are skipped so their rounded mask stays clear.
#[tauri::command]
fn set_window_theme(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    if window.label() == "main" {
        let w = window.clone();
        window
            .run_on_main_thread(move || panels::set_window_background(&w, dark))
            .map_err(err)?;
    }
    Ok(())
}

/// Whether macOS is currently in Low Power Mode, read once at frontend startup.
/// Live changes arrive as `power-state-changed` events (see `power::start_watching`).
#[tauri::command]
fn is_low_power_mode() -> bool {
    power::is_low_power_mode()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Arc::new(
        tauri::async_runtime::block_on(Store::open()).expect("failed to open taskscape store"),
    );
    let server_store = store.clone();

    // Ordered note-write queue: autosave enqueues `update_note` edits here and a
    // worker (spawned in `setup`) applies them in order. Bounded so a runaway
    // producer can't grow memory without bound; 512 is far above the debounced
    // autosave rate.
    let (note_tx, note_rx) = tauri::async_runtime::channel::<(String, String)>(512);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Start from the standard menu (keeps the App/Edit menus, so ⌘C/⌘V/⌘X/⌘A
        // still work in text fields) and append a "List" category for import/export.
        .menu(|handle| {
            let menu = Menu::default(handle)?;
            let import = MenuItem::with_id(
                handle,
                "import_list",
                "Import List from JSON…",
                true,
                None::<&str>,
            )?;
            let export = MenuItem::with_id(
                handle,
                "export_list",
                "Export List to JSON…",
                true,
                None::<&str>,
            )?;
            let list_menu = Submenu::with_items(handle, "List", true, &[&import, &export])?;
            menu.append(&list_menu)?;
            Ok(menu)
        })
        // Menu clicks drive frontend flows (they need the dialog + clipboard), so
        // forward them as events — the same pattern as `refresh`/`modal-result`.
        .on_menu_event(|app, event| match event.id.as_ref() {
            "import_list" => {
                let _ = app.emit_to("main", "menu:import-list", ());
            }
            "export_list" => {
                let _ = app.emit_to("main", "menu:export-list", ());
            }
            _ => {}
        })
        .manage(store)
        .manage(ModalState(Mutex::new(None)))
        .manage(OverlayState(Mutex::new(None)))
        .manage(SettingsState(AtomicBool::new(false)))
        .manage(NoteQueue(note_tx))
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            launch_embedded_tray();

            // Follow macOS Low Power Mode so the frontend can force reduced motion.
            power::start_watching(app.handle());

            // The frontend draws its own window controls; hiding the native
            // traffic lights (while keeping the Overlay titlebar style) keeps
            // the native rounded corners, shadow, and resize behavior.
            if let Some(window) = app.get_webview_window("main") {
                panels::hide_traffic_lights(&window);
                // Paint the native background to match the theme so no white
                // frame flashes on launch before the webview has painted...
                let dark = tauri::async_runtime::block_on(resolve_dark(&server_store, &window));
                panels::set_window_background(&window, dark);
                // ...and make the webview itself transparent while it loads, so
                // its default white doesn't cover that themed background.
                panels::disable_webview_white_background(&window);
                // The window starts hidden (tauri.conf `visible: false`) and is
                // shown by `reveal_main` once its webview has loaded.
            }

            // Warm the auxiliary panels now (hidden) so the first modal / filter /
            // settings open is an instant fade-in, not a cold webview boot.
            warm_panels(app.handle());

            // Safety net: if the frontend never calls `reveal_main` (a webview that
            // failed to load), show the main window anyway so the app isn't stuck
            // invisible. Whichever path fires first wins via `MAIN_REVEALED`.
            let fallback = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if !MAIN_REVEALED.swap(true, Ordering::SeqCst) {
                    if let Some(window) = fallback.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });

            // Extra route so the tray process can ask this window to reload live.
            let handle = app.handle().clone();
            let app_routes = Router::new()
                .route(
                    "/refresh",
                    post(|AxumState(app): AxumState<AppHandle>| async move {
                        let _ = app.emit("refresh", ());
                        StatusCode::OK
                    }),
                )
                .route(
                    "/focus",
                    post(|AxumState(app): AxumState<AppHandle>| async move {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        StatusCode::OK
                    }),
                )
                // Let the tray's "Quit Taskscape" close this window too.
                .route(
                    "/quit",
                    post(|AxumState(app): AxumState<AppHandle>| async move {
                        app.exit(0);
                        StatusCode::OK
                    }),
                )
                // The tray forwards its global ⌘Enter / ⌘⇧Enter here when this
                // window is frontmost, so they act on it instead of the mini bar.
                .route(
                    "/new-task",
                    post(|AxumState(app): AxumState<AppHandle>| async move {
                        let _ = app.emit("new-task", ());
                        StatusCode::OK
                    }),
                )
                .route(
                    "/attach-screenshot",
                    post(|AxumState(app): AxumState<AppHandle>| async move {
                        let _ = app.emit("attach-screenshot", ());
                        StatusCode::OK
                    }),
                )
                .with_state(handle);
            let router = server::data_router(server_store.clone()).merge(app_routes);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::serve(MAIN_PORT, router).await {
                    eprintln!("[taskscape-main] HTTP server error: {e}");
                }
            });

            // Drain the note-write queue: apply each autosave edit in arrival
            // order. An update whose note was meanwhile deleted just errors
            // harmlessly (logged), then we move on to the next.
            let queue_store = server_store.clone();
            let mut note_rx = note_rx;
            tauri::async_runtime::spawn(async move {
                while let Some((id, content)) = note_rx.recv().await {
                    if let Err(e) = queue_store.update_note(&id, &content).await {
                        eprintln!("[taskscape-main] queued note update failed ({id}): {e}");
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing the main window quits the app — otherwise the hidden,
            // never-destroyed panels would keep the process alive headless.
            ("main", WindowEvent::Destroyed) => window.app_handle().exit(0),
            // Report focus to the tray so its global ⌘Enter / ⌘⇧Enter act on this
            // window (new task / screenshot) while it's frontmost.
            ("main", WindowEvent::Focused(focused)) => {
                let path = if *focused { "/main-focused" } else { "/main-blurred" };
                tauri::async_runtime::spawn(async move {
                    let _ = server::client::post_json(TRAY_PORT, path, &serde_json::json!({}))
                        .await;
                });
            }
            // Panels hide instead of closing: destroying a class-swapped
            // NSPanel aborts with a foreign exception during teardown. Each also
            // clears its content and its pending state, then fades out — mirroring
            // the `close_*` commands, for the native (⌘W / settings close) path.
            ("modal" | "settings" | "overlay", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let app = window.app_handle();
                let label = window.label().to_string();
                match label.as_str() {
                    "modal" => {
                        let pending = window.state::<ModalState>().0.lock().unwrap().take();
                        if let Some((id, _)) = pending {
                            let _ = app.emit_to(
                                "main",
                                &format!("modal-result:{id}"),
                                serde_json::json!({ "buttonId": null }),
                            );
                        }
                        let _ = app.emit_to("modal", "modal-clear", ());
                    }
                    "overlay" => {
                        *window.state::<OverlayState>().0.lock().unwrap() = None;
                        let _ = app.emit_to("overlay", "overlay-clear", ());
                    }
                    "settings" => {
                        window.state::<SettingsState>().0.store(false, Ordering::SeqCst);
                        let _ = app.emit_to("settings", "settings-clear", ());
                    }
                    _ => {}
                }
                if let Some(webview) = app.get_webview_window(&label) {
                    panels::hide_panel(&webview);
                }
                // Settings may have rebound hotkeys: tell this window's frontend
                // to rebuild its key map, and the tray to re-register its globals.
                if label == "settings" {
                    let _ = app.emit_to("main", "hotkeys-changed", ());
                    tauri::async_runtime::spawn(async {
                        let _ = server::client::post_json(
                            TRAY_PORT,
                            "/reload-hotkeys",
                            &serde_json::json!({}),
                        )
                        .await;
                    });
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            rename_project,
            delete_project,
            default_project,
            list_lists,
            create_list,
            rename_list,
            delete_list,
            reorder_list,
            list_tasks,
            all_tasks,
            create_task,
            update_task,
            delete_task,
            move_task,
            reorder_task,
            delete_tasks,
            restore_tasks,
            purge_tasks,
            list_trashed,
            empty_trash,
            set_tasks_done,
            copy_tasks,
            export_list,
            import_list,
            list_notes,
            create_note,
            update_note,
            delete_note,
            list_attachments,
            add_reference,
            add_copy,
            delete_attachment,
            rename_attachment,
            capture_screenshot,
            attach_screenshot,
            open_attachment,
            reveal_attachment,
            set_active_list,
            set_active_project,
            get_setting,
            set_setting,
            list_hotkeys,
            set_hotkey,
            reset_hotkey,
            open_modal,
            modal_current,
            present_window,
            close_modal,
            open_overlay,
            overlay_current,
            close_overlay,
            open_settings,
            settings_current,
            reveal_main,
            set_window_theme,
            is_low_power_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
