# Taskscape

## Tray Window

- [x] `cmd + shift + return` to attach screenshot automatically
- [x] The screenshot shouldn't include the tray window in it
- [x] The screenshot button is not a toggle button, clicking once takes a screenshots and attaches with the task, clicking again takes another screenshots and attaches another
- [x] Quitting Closes Main Window too
- [x] Allow adding Task Notes from Mini Window as well
  - [x] Open using Hotkey
  - [x] Task Name Field focused currently
  - [x] Field below with text "Press Tab to add notes"
- [x] Dark and Light Mode Theme handling

## Main Window

- [x] MINOR: Show a loading indicator while loading
- [x] Bugs
  - [x] MINOR: Fix White outline when scrolling very hard horizontally or vertically
- [x] Tasks
  - [x] Allow sub tasks
  - [x] Allow Projects with multiple Lists
  - [x] Tasks are timestamped
  - [x] Remove Task Due Date from model
- [x] UI
  - [x] Searching Tasks
  - [x] Dragging Tasks to become subtasks of each other
  - [x] Remove Sidebar
  - [x] Add Settings Window
  - [x] Remove Task Due Date mention
  - [x] Add Browse File Option
  - [x] Dark and Light Mode Theme handling
  - [x] View attachments inside the app

## UI Redesign ("Datum")

- [x] Foundation
  - [x] Bundle Montserrat (body) + Outfit (headings) variable fonts; tray gets fonts only
  - [x] Design tokens: theme-adaptive light/dark palette (warm neutrals, signal-amber accent)
- [x] Backend plumbing
  - [x] Custom window chrome config (macOS Overlay + hidden traffic lights / Windows frameless) — no private API
  - [x] NSPanel modal windows (props registry, present/close commands, opaque rounded panels)
  - [x] `move_task` (re-parent + cross-list subtree move) and `reorder_task` (`sort_order` column)
  - [x] Asset protocol + capabilities for in-app attachment preview
- [x] Main window
  - [x] Custom titlebar: custom traffic lights / Windows controls, project switcher, list tabs, actions
  - [x] Sidebar removed; tabs per list in the active project (notched active tab, count roll)
  - [x] Task rows: datum rail + traveling amber index, select → preview panel, inline rename,
        drag to nest/reorder/promote/move-to-tab, checkbox check-off ceremony
  - [x] Search (⌘F) filtering the tree (matches + ancestors)
  - [x] Split view: pin a second list side-by-side (shared tab strip, resizable)
  - [x] Right preview panel: task details, notes, subtasks + inline attachment preview
        (image/video/audio/pdf/text) with open/reveal/remove
  - [x] Declarative modal system (icon, title, message, buttons, input, timeout drain) as NSPanel popups
  - [x] GitHub-style name suggestions for new projects/lists (landscape-themed)
  - [x] Settings window (theme override, show completed, shortcuts)
  - [x] QOL: context menus, shortcuts (⌘N, ⌘F, ⌘1–9, ⌘,, ⌘\, ⌘⌫, arrows/Space), empty states,
        show/hide completed, persisted layout (split, panel widths)
