//! Standalone Slint helper for Taskscape's confirm/prompt modals and the per-pane
//! filter/sort overlay. The main app keeps one helper of each kind **pre-warmed**
//! (window created + styled, hidden off-screen) and, when a dialog is needed,
//! writes one `Launch` payload to its stdin; the helper shows the (already warm)
//! window and, on close, writes its result on stdout, then exits — the main app
//! respawns a fresh warm helper. No Tauri IPC / HTTP, just the pipes the parent
//! owns. `argv[1]` selects the kind ("modal" | "overlay").

#![cfg_attr(all(target_os = "macos", not(debug_assertions)), windows_subsystem = "windows")]

use std::cell::{Cell, RefCell};
use std::io::Write;
use std::rc::Rc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use slint::{ComponentHandle, ModelRc, VecModel};
use taskscape_common::modal_ipc::{Launch, MainFrame, ModalResult, Outbound};

slint::include_modules!();

// Launch as a macOS agent (no Dock icon, no app-switch) even though this is a
// plain executable, not a .app bundle: an embedded Info.plist with LSUIElement is
// read by LaunchServices the same way a bundle's would be.
#[cfg(target_os = "macos")]
#[used]
#[link_section = "__TEXT,__info_plist"]
static INFO_PLIST: [u8; include_bytes!("../Info.plist").len()] = *include_bytes!("../Info.plist");

// Timers must outlive the call that arms them; a short-lived helper can keep them
// in a thread-local for the process lifetime.
thread_local! {
    static KEEP_TIMERS: RefCell<Vec<Rc<slint::Timer>>> = const { RefCell::new(Vec::new()) };
}

// ── Surface-specific props (the opaque `props` the parent forwards) ──────────

#[derive(Debug, Default, Deserialize)]
struct ModalProps {
    title: String,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    tone: Option<String>,
    #[serde(default)]
    input: Option<ModalInput>,
    #[serde(default)]
    buttons: Vec<ModalButtonProp>,
    #[serde(rename = "timeoutMs", default)]
    timeout_ms: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
struct ModalInput {
    #[serde(default)]
    placeholder: Option<String>,
    #[serde(rename = "initialValue", default)]
    initial_value: Option<String>,
    #[serde(default)]
    suggest: Option<String>,
    #[serde(default)]
    suffix: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModalButtonProp {
    id: String,
    label: String,
    #[serde(default)]
    variant: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OverlayProps {
    #[serde(rename = "paneId")]
    pane_id: String,
    #[serde(rename = "paneName")]
    pane_name: String,
    view: PaneView,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PaneView {
    sort: String,
    dir: String,
    filter: String,
    #[serde(rename = "hasNotes")]
    has_notes: bool,
    #[serde(rename = "hasAttachments")]
    has_attachments: bool,
    #[serde(rename = "hasSubtasks")]
    has_subtasks: bool,
    created: String,
}

// ── Icons ────────────────────────────────────────────────────────────────────

/// Map a Material Symbols icon name to its codepoint char (only the icons the
/// modals actually use are in the embedded subset — see modals/assets).
fn icon_char(name: &str) -> Option<char> {
    let cp: u32 = match name {
        "help" => 0xe887,
        "delete" => 0xe872,
        "edit" => 0xe150,
        "list_alt_add" => 0xf756,
        "create_new_folder" => 0xe2cc,
        "add_link" => 0xe178,
        "drive_file_rename_outline" => 0xe9a2,
        "casino" => 0xeb40,
        "warning" => 0xe002,
        "link" => 0xe157,
        "folder" => 0xe2c7,
        _ => return None,
    };
    char::from_u32(cp)
}

fn suggest(kind: Option<&str>) -> String {
    match kind {
        Some("project") => taskscape_common::names::suggest_project_name(),
        Some("list") => taskscape_common::names::suggest_list_name(),
        _ => String::new(),
    }
}

// ── stdout protocol ──────────────────────────────────────────────────────────

fn print_line(s: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{s}");
    let _ = out.flush();
}

fn emit_result(button_id: Option<String>, value: Option<String>, timed_out: bool) {
    let result = ModalResult {
        button_id,
        value,
        timed_out: if timed_out { Some(true) } else { None },
    };
    if let Ok(line) = serde_json::to_string(&Outbound::Result(result)) {
        print_line(&line);
    }
    let _ = slint::quit_event_loop();
}

// ── native window styling / positioning ──────────────────────────────────────

fn position_over(window: &slint::Window, frame: &MainFrame) {
    if frame.width <= 0 || frame.height <= 0 {
        return;
    }
    let size = window.size();
    let x = frame.x + (frame.width - size.width as i32) / 2;
    let y = frame.y + (frame.height - size.height as i32) / 2;
    window.set_position(slint::PhysicalPosition::new(x, y));
}

#[cfg(target_os = "macos")]
fn ns_window_of(window: &slint::Window) -> *mut objc2::runtime::AnyObject {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let handle = window.window_handle();
    let Ok(raw) = handle.window_handle() else {
        return std::ptr::null_mut();
    };
    match raw.as_raw() {
        RawWindowHandle::AppKit(a) => {
            let ns_view = a.ns_view.as_ptr() as *mut objc2::runtime::AnyObject;
            if ns_view.is_null() {
                return std::ptr::null_mut();
            }
            unsafe { objc2::msg_send![ns_view, window] }
        }
        _ => std::ptr::null_mut(),
    }
}

/// Poll (on the event loop) until the native window is realized, then style it as
/// a rounded floating modal (property changes only — no NSPanel class-swap, which
/// aborts under winit). When `frame` is set the window is centered over it; when
/// `focus` is set it's made key + the app activated so typing works. The accessory
/// activation policy is (re)asserted every tick until styled, so it wins over
/// winit's default before any Dock icon can stick.
fn style_when_ready<T: ComponentHandle + 'static>(ui: &T, frame: Option<MainFrame>, focus: bool) {
    let weak = ui.as_weak();
    let timer = Rc::new(slint::Timer::default());
    let tc = timer.clone();
    let tries = Cell::new(0u32);
    timer.start(slint::TimerMode::Repeated, Duration::from_millis(16), move || {
        #[cfg(target_os = "macos")]
        taskscape_common::macos::set_accessory_activation_policy();
        tries.set(tries.get() + 1);

        if let Some(ui) = weak.upgrade() {
            #[cfg(target_os = "macos")]
            {
                let ns = ns_window_of(ui.window());
                if !ns.is_null() {
                    taskscape_common::macos::style_modal_window(ns);
                    if let Some(frame) = &frame {
                        position_over(ui.window(), frame);
                    }
                    if focus {
                        taskscape_common::macos::make_key(ns);
                        taskscape_common::macos::activate_app();
                    }
                    taskscape_common::macos::invalidate_shadow(ns);
                    tc.stop();
                    return;
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(frame) = &frame {
                    position_over(ui.window(), frame);
                }
                tc.stop();
                return;
            }
        }
        if tries.get() > 120 {
            tc.stop();
        }
    });
    KEEP_TIMERS.with(|v| v.borrow_mut().push(timer));
}

/// Warm the window off-screen so the first real open is an instant reveal rather
/// than a cold Slint/window boot. It is parked off-screen (still "visible" to
/// winit, so winit never suspends/drops it — that teardown is what aborts), never
/// hidden; the real open just repositions it over the main window.
fn prewarm<T: ComponentHandle + 'static>(ui: &T) {
    ui.window()
        .set_position(slint::PhysicalPosition::new(-10000, -10000));
    let _ = ui.show();
    style_when_ready(ui, None, false);
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    taskscape_common::macos::set_accessory_activation_policy();

    let kind = std::env::args().nth(1).unwrap_or_default();
    if kind == Launch::KIND_OVERLAY {
        run_overlay()
    } else {
        run_modal()
    }
}

// ── Modal ────────────────────────────────────────────────────────────────────

fn run_modal() -> Result<(), Box<dyn std::error::Error>> {
    let ui = ModalView::new()?;
    prewarm(&ui);

    let weak = ui.as_weak();
    std::thread::spawn(move || {
        let input = std::io::read_to_string(std::io::stdin()).unwrap_or_default();
        let launch: Option<Launch> = serde_json::from_str(&input).ok();
        let _ = weak.upgrade_in_event_loop(move |ui| match launch {
            Some(l) => configure_modal(&ui, l),
            None => {
                let _ = slint::quit_event_loop();
            }
        });
    });

    slint::run_event_loop()?;
    Ok(())
}

fn configure_modal(ui: &ModalView, launch: Launch) {
    let props: ModalProps = serde_json::from_value(launch.props).unwrap_or_default();
    ui.global::<Palette>().set_dark(launch.dark);

    ui.set_heading(props.title.clone().into());
    ui.set_has_message(props.message.is_some());
    ui.set_message(props.message.clone().unwrap_or_default().into());

    if let Some(ch) = props.icon.as_deref().and_then(icon_char) {
        ui.set_has_icon(true);
        ui.set_icon_glyph(ch.to_string().into());
    }
    ui.set_icon_tone(props.tone.clone().unwrap_or_else(|| "default".into()).into());

    let props = Rc::new(props);

    ui.set_has_input(props.input.is_some());
    if let Some(inp) = &props.input {
        ui.set_input_placeholder(inp.placeholder.clone().unwrap_or_default().into());
        ui.set_has_suffix(inp.suffix.is_some());
        ui.set_input_suffix(inp.suffix.clone().unwrap_or_default().into());
        ui.set_has_suggest(inp.suggest.is_some());
        let initial = inp
            .initial_value
            .clone()
            .unwrap_or_else(|| suggest(inp.suggest.as_deref()));
        ui.set_input_value(initial.into());
    }

    let buttons: Vec<ButtonData> = props
        .buttons
        .iter()
        .map(|b| ButtonData {
            id: b.id.clone().into(),
            label: b.label.clone().into(),
            variant: b.variant.clone().unwrap_or_else(|| "ghost".into()).into(),
        })
        .collect();
    ui.set_buttons(ModelRc::new(VecModel::from(buttons)));

    let value_of = {
        let props = props.clone();
        move |ui: &ModalView| -> Option<String> {
            if props.input.is_none() {
                return None;
            }
            let text = ui.get_input_value().to_string();
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return None;
            }
            let suffix = props
                .input
                .as_ref()
                .and_then(|i| i.suffix.clone())
                .unwrap_or_default();
            Some(format!("{trimmed}{suffix}"))
        }
    };

    let press: Rc<dyn Fn(String, bool)> = {
        let weak = ui.as_weak();
        let props = props.clone();
        let value_of = value_of.clone();
        Rc::new(move |id: String, is_default: bool| {
            let Some(ui) = weak.upgrade() else { return };
            let empty = ui.get_input_value().to_string().trim().is_empty();
            if is_default && props.input.is_some() && empty {
                return;
            }
            emit_result(Some(id), value_of(&ui), false);
        })
    };

    {
        let press = press.clone();
        ui.on_button_clicked(move |id, is_default| press(id.to_string(), is_default));
    }
    {
        let press = press.clone();
        let props = props.clone();
        ui.on_activate_default(move || {
            if let Some(last) = props.buttons.last() {
                press(last.id.clone(), true);
            }
        });
    }
    {
        let weak = ui.as_weak();
        let value_of = value_of.clone();
        ui.on_dismiss(move || {
            let value = weak.upgrade().and_then(|ui| value_of(&ui));
            emit_result(None, value, false);
        });
    }
    {
        let weak = ui.as_weak();
        let props = props.clone();
        ui.on_roll(move || {
            if let Some(ui) = weak.upgrade() {
                let name = suggest(props.input.as_ref().and_then(|i| i.suggest.as_deref()));
                ui.set_input_value(name.into());
            }
        });
    }

    if let Some(ms) = props.timeout_ms {
        let weak = ui.as_weak();
        let value_of = value_of.clone();
        slint::Timer::single_shot(Duration::from_millis(ms), move || {
            let value = weak.upgrade().and_then(|ui| value_of(&ui));
            emit_result(None, value, true);
        });
    }

    let _ = ui.show();
    style_when_ready(ui, Some(launch.main_frame), true);
}

// ── Overlay ──────────────────────────────────────────────────────────────────

fn run_overlay() -> Result<(), Box<dyn std::error::Error>> {
    let ui = OverlayView::new()?;
    prewarm(&ui);

    let weak = ui.as_weak();
    std::thread::spawn(move || {
        let input = std::io::read_to_string(std::io::stdin()).unwrap_or_default();
        let launch: Option<Launch> = serde_json::from_str(&input).ok();
        let _ = weak.upgrade_in_event_loop(move |ui| match launch {
            Some(l) => configure_overlay(&ui, l),
            None => {
                let _ = slint::quit_event_loop();
            }
        });
    });

    slint::run_event_loop()?;
    Ok(())
}

fn configure_overlay(ui: &OverlayView, launch: Launch) {
    let props: OverlayProps = match serde_json::from_value(launch.props) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[taskscape-modals] bad overlay props: {e}");
            let _ = slint::quit_event_loop();
            return;
        }
    };
    ui.global::<Palette>().set_dark(launch.dark);
    ui.set_pane_name(props.pane_name.clone().into());
    ui.set_sort(props.view.sort.clone().into());
    ui.set_dir(props.view.dir.clone().into());
    ui.set_filter(props.view.filter.clone().into());
    ui.set_has_notes(props.view.has_notes);
    ui.set_has_attachments(props.view.has_attachments);
    ui.set_has_subtasks(props.view.has_subtasks);
    ui.set_created(props.view.created.clone().into());

    {
        let weak = ui.as_weak();
        let pane_id = props.pane_id.clone();
        ui.on_changed(move || {
            let Some(ui) = weak.upgrade() else { return };
            let view = PaneView {
                sort: ui.get_sort().to_string(),
                dir: ui.get_dir().to_string(),
                filter: ui.get_filter().to_string(),
                has_notes: ui.get_has_notes(),
                has_attachments: ui.get_has_attachments(),
                has_subtasks: ui.get_has_subtasks(),
                created: ui.get_created().to_string(),
            };
            if let Ok(view) = serde_json::to_value(&view) {
                let out = Outbound::Apply {
                    pane_id: pane_id.clone(),
                    view,
                };
                if let Ok(line) = serde_json::to_string(&out) {
                    print_line(&line);
                }
            }
        });
    }
    ui.on_dismiss(|| {
        let _ = slint::quit_event_loop();
    });

    let _ = ui.show();
    style_when_ready(ui, Some(launch.main_frame), true);
}
