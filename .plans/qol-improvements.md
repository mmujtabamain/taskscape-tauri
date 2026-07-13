# QOL Master Plan — Stores, Hotkeys, Reimagined Selection, Search & App-wide Polish

Status: **proposed** (plan only — not yet implemented) · Owner: TBD · Scope: `main` app (frontend + a little `common`/Rust)

This plan is the output of a case study of the main window (with `TaskPane` as the
centrepiece) plus a broad backlog of quality-of-life features spanning the whole app.
It is deliberately over-stuffed: the intent is to pick from a menu, not to build all of it.

- **Part A — Case study** (how the relevant systems actually work today, and where they hurt).
- **Part B — Reusable patterns** the plan leans on.
- **Part B2 — Frontend stores** (a new foundation for easy access to common data).
- **Part B3 — Mutation architecture** (optimistic updates + undo-ready command objects).
- **Part C — The five requested features**, each with a concrete, specified design.
- **Part D — The wider QOL backlog**, organised by area, tiered by priority.
- **Part E — Build order, risk assessment, testing strategy, open questions.**

Path references are `file:line` against the repo root.

---

## Part A — Case study

### A.1 The shape of the main app

There is **no store**. All domain state is `useState`/`useRef` in `main/src/App.tsx` (963 lines),
derived with `useMemo`, threaded down as props (most visibly through the ~28-field `BaseRowCtx`).
The only React context is `ContextMenuProvider` (menu UI only). Data lives in Rust/SQLite and arrives
via `invoke` wrappers in `main/src/api.ts`. This "everything in App + prop-drilling" shape is itself a
pain point and motivates **Part B2 (stores)**.

Source-of-truth arrays are **flat** (`App.tsx:18-21`): `allTasks: Task[]` (every task, all lists,
flat), `allLists`, `projects`. Everything tree-shaped is *derived*, not stored (`App.tsx:188-238`):
`taskById`, `childrenByParent`, `rootsByList`, `listsInProject`, per-list `counts`, `hasPendingDesc`.
Ordering is a fractional `sort_order: f64` (midpoint inserts, full-group rebalance when the gap
collapses — `App.tsx:512-555`). Nesting is an adjacency list (`parent_id`, cascade delete).

The window is two positional panes (left = `activeListId`, right = `splitListId`) that never swap
sides, plus a right-hand `PreviewPanel`. A single global `keydown` listener (`App.tsx:666-761`)
drives all shortcuts and structural keys.

### A.2 `TaskPane` — the centrepiece

`TaskPane` (`main/src/components/TaskPane.tsx`) is a thin, well-factored component: a composer input at
top (register-a-focus-callback via `registerComposer`, keyed by `list.id` so both panes register
independently — `TaskPane.tsx:83-91`; **this composer is the slot inline search takes over, C.5**); a
scroll body rendering `visibleRoots = roots.filter(ctx.isVisible)` (`TaskPane.tsx:48`) as recursive
`TaskRow`s; a `StatsBar` footer with the **Select / Mark `ModeToggle`**, a done/total tally, and a
progress bar; and root-drop handling to un-nest a task (`TaskPane.tsx:135-158`).

**Modes (to be reimagined — C.2).** `PaneMode = 'select' | 'mark'` (`TaskRow.tsx:12`) is local per-pane
state (`TaskPane.tsx:45-46`). In `select` a row's checkbox toggles membership in a local
`selected: Set<string>`; in `mark` it toggles `done`. Switching mode **clears** the selection
(`TaskPane.tsx:60-63`). The checkbox's meaning changes with the mode — the core confusion.

**Strengths.** Clean separation; split panes are genuinely independent; the `RowCtx` injection
pattern (App builds `BaseRowCtx` once, each pane completes it with its mode/selection —
`TaskPane.tsx:67-70`) is elegant and is the right seam for new row-level actions.

**Gaps / pain points (where "perfect" work lands):**

1. **The selection set is a dead end.** `selectedIds` is consumed in exactly three places, all in
   `TaskRow.tsx`: the checkbox, the row highlight, and the context-menu "Copy N tasks" collapse.
   No bulk delete, no bulk move, no action bar. Never lifted to App, never persisted.
2. **No keyboard path into selection.** No shift-click range, no ⌘-click, no ⇧+Arrow, no ⌘A.
3. **Two parallel "selection" concepts that don't talk.** App's `selectedTaskId` (single preview task,
   drives arrow-nav) vs. the pane's `selectedIds` (checkbox set) are unrelated.
4. **Mode is modal and the checkbox lies.** You must flip to `select` mode to pick tasks, and there the
   checkbox stops marking done. C.2 rebuilds this.
5. **Static footer.** No "N selected" affordance, no per-pane filter/sort.

### A.3 `PreviewPanel` — single-task only

`PreviewPanel` (`main/src/components/PreviewPanel.tsx`) takes a single `task: Task | null` (`App.tsx:880`,
from `selectedTaskId`), rendering `TaskInspector` **keyed by `task.id`** (remounts on every selection
change). Rich inspector: in-place title edit, metadata, autosaving rich-text notes, subtasks,
attachments (screenshot/file/link, lightbox, rename, drag-to-mention). It has **no concept of a
multi-selection** — select three tasks and it still shows whichever single one is `selectedTaskId`.

### A.4 `TitleBar` — the search box lives here

`TitleBar` (`main/src/components/TitleBar.tsx`) hosts window controls, `ProjectSwitcher`, `ListTabs`, a
**56-unit-wide search input** (`TitleBar.tsx:113-143`), a reduced-motion indicator, and the split /
preview / settings buttons. The search input is the *only* writer of App's global `search` state
(`App.tsx:35`, `795-796`); focused via ⌘F through `registerSearch` (`App.tsx:64-67`,
`TitleBar.tsx:59-67`). **This box is being removed — C.5.**

**Search today** (`App.tsx:240-268`) is 100% client-side: case-insensitive substring on `title` **or**
the derived `notes` plaintext across `allTasks`, plus every match's ancestors (so the tree keeps shape),
combined with hide-completed in `isVisible`. **Global** (all lists/projects), forces the tree open
(`forceExpand`), only changes empty-state copy. No highlighting, no next/prev, no scope/field options.

### A.5 The hotkey system (recently added, well-built)

Rust owns the catalog; TS bridges the DOM — the project's "Rust owns config" principle.

- **Catalog / source of truth:** `common/src/hotkeys.rs` — a static `COMMANDS` array of
  `{ id, label, scope, default_accel }` (`hotkeys.rs:47-150`). `Scope` is `Global | Main | Tray` and
  doubles as the conflict namespace. Canonical accel strings (`"Cmd+Alt+ArrowRight"`), modifier order
  `Cmd, Ctrl, Alt, Shift`. `Alt`/Option and arrow keys fully supported. Overrides persist as JSON under
  the `hotkeys` settings key.
- **DOM bridge:** `common-ui/src/hotkeys.ts` — `matchesEvent` (matches on `e.code`, so ⌥+letter is
  stable on macOS), `eventToAccel`, `formatAccel`.
- **Consumer:** `App.tsx:145-161` fetches the effective map, rebuilds on `hotkeys-changed`;
  `App.tsx:666-761` is a hand-wired `if (pressed('id')) {…}` dispatcher. `ShortcutsPane.tsx` is a full
  customise/record/reset editor that renders every catalog row automatically.

**To add an in-app shortcut:** (1) add a `Scope::Main` entry to `COMMANDS`; (2) add one `pressed(...)`
branch. The settings editor, hint labels, and persistence come free. Global shortcuts additionally need
tray wiring; nearly all QOL shortcuts below are `Main` scope.

**Existing catalog:** `toggle_capture_bar` ⌘↩, `screenshot_capture` ⌘⇧↩ (Global); `new_task` ⌘N,
`search` ⌘F, `toggle_preview` ⌘\, `open_settings` ⌘,, `delete_task` ⌘⌫, `switch_list_1..9` ⌘1–9 (Main);
`clear_draft` ⌘⇧⌫ (Tray). Structural keys (Arrows, Space, Enter/F2, Escape, type-to-capture) are handled
directly in `App.tsx`, deliberately outside the catalog.

### A.6 Drag & drop (single-item only)

Task DnD carries exactly **one `task.id`** in `application/x-task`. Three drop surfaces: row → row
(`TaskRow.tsx:167-210`, `zoneFromEvent` → before/nest/after → `dropOnRow`, `App.tsx:512-555`); row →
pane root (`TaskPane.tsx:135-158`, un-nest to top level); row → list tab (`ListTabs.tsx:144-184`,
`onDropTaskOnTab` → `moveTask(id, null, listId)` — **already moves a single task to another list**).
Backend `move_task` (`storage.rs:296-350`) handles reparent + relist + reposition in one transaction,
drags the whole subtree across lists (`relist_task_tree`), rejects cycles. **The only gap for multi-task
drag is the payload** — DnD carries one id.

### A.7 Backend surface (what exists vs. missing)

`api.ts` + `main/src-tauri/src/lib.rs` expose single-item mutations only: `createTask`, `updateTask`
(title/notes/done), `deleteTask` (single; children cascade via FK), `moveTask`, `reorderTask`. The
**only** multi-id call is `copyTasks(ids)` → read-only markdown. **No bulk delete, no bulk move.** For
bulk features we add `delete_tasks(ids)` and `move_tasks(ids, parent_id, list_id)` in `storage.rs` +
commands, applying the ancestor-collapsing rule (C.2). No schema change is needed for any feature here.

---

## Part B — Reusable patterns this plan leans on

1. **New shortcut = catalog entry + one dispatch branch** (never hard-code combos in JS). §A.5
2. **New row action = a callback** built once in the store, spread through both panes. `onCopy` is the
   template; add `onDeleteMany`, `onMoveMany`, `onSetDoneMany`.
3. **Selection lives in a store, per pane** (`selectionStore`, B2) — the single source for bulk actions,
   preview, multi-drag, keyboard.
4. **Reuse `flattenVisible`** (`App.tsx:628-641`) — visual-order flattening (respects collapse + search)
   — as the axis for range selection and multi-drag ordering.
5. **Bulk backend commands** mirror single ones in `storage.rs`; register in `lib.rs`.
6. **Overlays** go through `main/src/lib/overlays.ts` for Escape/`overlayOpen()` bookkeeping.
7. **Common data comes from a store, not props** (B2); **mutations go through the command layer** (B3).

---

## Part B2 — Frontend stores (a new foundation)

Today all domain + UI state lives in `App.tsx` and is prop-drilled — most visibly through the
~28-field `BaseRowCtx`. A few focused stores make common data **directly accessible** and shrink `App`
into a composition root. Stores are the frontend cache/coordination layer; **Rust stays the source of
truth** — stores reload via `api.*` on the Tauri `refresh`/`settings-changed`/`hotkeys-changed` events.

**Library — decided: Zustand.** Task apps are a worst case for React Context: selecting 200 tasks
changes selection state that hundreds of rows consume, so a Context value change re-renders many rows
even with memoization. This plan's high-frequency updates — **live search, hover handles, selection,
drag state, preview, inline editing** — make that acute. Zustand (built on `useSyncExternalStore`) gives
**per-selector subscriptions**: a row does `useSelection(s => s.ids.has(myId))` and re-renders **only**
when its own membership flips, not when any selection changes. Tiny, no provider, async actions live in
the store. (Jotai/`useSyncExternalStore` were also candidates; Zustand chosen for the store-shaped API.)

**Split, don't centralise.** A single `dataStore` holding tasks + lists + projects + selectors +
mutations + refresh listeners would just become another 1000-line `App.tsx` — the app's whole domain
layer in one file. Split from the start:

Domain stores (each: state + `load()` + its own mutations):
1. **`taskStore`** — `tasks` + derived `taskById`, `childrenByParent`, `rootsByList`, `counts`,
   `hasPendingDesc`; task mutations (create/update/move/reorder/delete + bulk). The big prop-drilling win.
2. **`listStore`** — `lists`, `listsInProject`, list CRUD + reorder.
3. **`projectStore`** — `projects`, active project, project CRUD.

UI / coordination stores:
4. **`layoutStore`** — `activeListId`, `splitListId`, `paneFocus`, derived `focusedListId`;
   `previewOpen`, `previewW`, `splitRatio`; `collapsed`. Owns localStorage + `last_active_list`
   persistence (writes the **focused** list — the shipped tray fix lives here).
5. **`selectionStore`** — `selectedTaskId` **and** per-pane multi-selection
   `Record<paneId, { ids: Set<string>, anchor: string | null }>` + actions (`focus`, `toggle`, `range`,
   `selectAllVisible`, `clear`). See ownership note below.
6. **`searchStore`** — per-pane `{ query, scope, fields }` (C.5), plus **one shared search engine**
   (below). Split panes search independently.
7. **`hotkeyStore`** — the effective `hotkeyMap` + `hotkeys-changed` refresh.
8. **`settingsStore`** — `showCompleted`, theme, reduced-motion.

A thin **`bootstrap`** wires the Tauri events (`refresh`, `settings-changed`, `hotkeys-changed`) to the
relevant stores' `load()` — one subscription point instead of three scattered listeners.

**Store ownership — `selectedTaskId` lives in `selectionStore`, and here's why.** It's the *active
member* of the selection (the anchor / last-focused task), not a layout concern (panes are geometry, not
content) and not a separate preview concern (the preview panel is a **view** of the selection, not an
owner of it). Keeping "what is selected and which one is active" in one store makes the preview,
keyboard nav, and bulk bar read a single coherent source and keeps the C.3 state machine in one place.

**One search engine, not per-pane recompute.** Even though each pane has its own query, the *index* is
built once over `taskStore.tasks` and shared: a memoized selector `matchIds(query, scope, fields) →
Set<id>` (keyed by its args, so two panes with the same query compute once). Panes consume the result:
`query → engine → matching ids → per-pane visibility`. We never re-tokenise per pane.

**Optimistic updates (unlocked by stores).** Every mutation today does `await api.*(); await load()` — a
full reload per change. Stores let high-frequency ops apply locally first, then reconcile: toggle-done,
reorder, and move should update `taskStore` optimistically and roll back on failure (via the B3 command's
inverse); create/delete can stay reload-based initially (or use temp ids). This removes the visible
round-trip on the ops users repeat most. Tradeoff: rollback logic — which B3's command objects provide.

**Migration is incremental and bottom-up:** **`taskStore`/`listStore`/`projectStore` first** (everything
depends on domain data), then **`layoutStore`**, then **`selectionStore`**, then `searchStore` + the
rest. `App` keeps working throughout — each store is a lift-and-shift of existing state, not a rewrite.

---

## Part B3 — Mutation architecture (optimistic + undo-ready)

Undo is a Phase-3 feature, but its **architecture must land now** — retrofitting undo onto fire-and-
forget mutations is painful, whereas designing mutations to be invertible from day one is nearly free.

**Command objects.** Every mutation (single and bulk) is expressed as a command:

```
interface Command {
  label: string;              // "Delete 3 tasks", "Move to Inbox"
  apply(): Promise<void>;     // the forward op (api call + optimistic store update)
  invert(): Promise<void>;    // the exact inverse (for rollback AND undo)
}
```

- **Optimistic path (B2):** `apply()` mutates the store immediately, fires the `api.*` call, and on
  failure runs `invert()` to roll back — the same inverse undo will use.
- **Undo stack (Phase 3):** a `historyStore` pushes each executed command; ⌘Z pops and `invert()`s,
  ⌘⇧Z re-`apply()`s. Because bulk APIs already emit commands, undo covers them for free.
- **Invertibility by op:** move / reorder / toggle-done / rename / create are trivially invertible now
  (store prior `parent_id`/`sort_order`/`done`/`title`, or delete the created id). **Delete is the hard
  case** — cascade delete destroys the subtree, so its inverse needs the data back. That's exactly why
  the durable form is a **soft-delete/trash** (D.10): `delete_tasks` flips a `deleted_at` flag (invert =
  clear it) rather than dropping rows. Ship bulk-delete as soft-delete from the start so it's undoable.

This section is the reason to specify the bulk backend semantics precisely (C.2) — the command's
`invert()` must reconstruct exactly what `apply()` changed.

---

## Part C — The five requested features

### C.1 ⌘⌥←/→ to switch tabs (wrap-around — decided)

Two new `Scope::Main` catalog commands: `prev_tab` (`Cmd+Alt+ArrowLeft`), `next_tab`
(`Cmd+Alt+ArrowRight`). Dispatch:

```
const idx = listsInProject.findIndex(l => l.id === focusedListId);
const n = listsInProject.length;
const next = listsInProject[(idx + dir + n) % n];   // dir = -1 | +1 ; wrap-around (decided)
if (next) selectList(next.id);
```

**Decided:** wrap-around at the ends; fires regardless of typing focus (⌘⌥+Arrow doesn't collide with
text editing). Switches the **focused** pane's list via `selectList`. **Effort:** S (frontend + 2 Rust
catalog lines).

### C.2 Reimagined selection & bulk actions (replaces Select/Mark modes)

**Why the current model is broken.** Two modes toggled in the footer where the *checkbox changes
meaning*: in Mark it marks done; in Select it silently stops marking done and toggles a copy set. A
control that sometimes doesn't do its obvious thing is the core confusion; flipping modes before any
bulk action is the friction.

**New model — no modes (fully modeless, decided):**

1. **The checkbox always marks done.** Delete `PaneMode`, `ModeToggle`, and mode-clears-selection.
2. **Selection is ambient** (`selectionStore`, per pane): plain click = preview + reset selection to
   this row (sets anchor); ⌘-click = toggle; ⇧-click = range from anchor along `flattenVisible`;
   ⇧+↑/↓ extend; ⌘A select-all-visible; Escape clears selection then (if empty) the preview.
3. **Discoverability:** a hover-revealed **selection handle** in the row's leading gutter (distinct from
   the done checkbox); an optional footer **"Select"** button that pins a selection column visible — a
   *view affordance*, never a gate. (Mark mode gone; checkbox always means done.)
4. **Bulk action bar:** non-empty selection → footer hosts
   `N selected · Done · Undone · Move to… · Copy · Delete · Clear`.
5. **Deletion:** ⌘⌫ deletes the selection when non-empty (else the previewed task). Confirm modal counts
   tasks + subtrees. Goes through a B3 command backed by `delete_tasks` (soft-delete, undoable).

**Ancestor-collapsing algorithm (canonical — its own spec so FE/BE can't diverge).** A selection can
contain both a task and its descendant. Because every operation carries the subtree, the operative set
is always the **roots of the selection forest**:

```
collapseToRoots(ids, parentOf):
  roots = {}
  for id in ids:
    p = parentOf(id)
    while p != null and p not in ids: p = parentOf(p)   // any selected ancestor?
    if p == null: roots.add(id)                          // no selected ancestor → it's a root
  return roots
```

Given `A > B` with both selected, `roots = {A}`. **Delete** removes roots (subtrees cascade). **Move**
moves roots (subtrees follow via `relist_task_tree`). **Copy** renders roots' subtrees (already how
`copy_tasks` nests). **Authoritative in Rust** (`common`, shared by `delete_tasks`/`move_tasks`, and
consistent with `copy_tasks`); the **frontend mirrors the same pure function** for accurate selection
counts and the preview, kept in lockstep by a **shared test vector** (identical inputs → identical
outputs, asserted on both sides). **Effort:** L (anchor feature; C.3/C.4 build on it).

### C.3 PreviewPanel handles multiple selected tasks

**Design.** `selection.size > 1` → multi-select inspector: header `N tasks selected` + combined tally
(reuse `TaskPane.tsx:73-81`); bulk actions mirrored from the bar; a scrollable list of the selected
tasks (title + list badge + done state); Copy preview via the ancestor-aware markdown model.

**State machine (explicit — resolves "does clicking collapse?").** Two pieces of state coexist:
`selection.ids` and `selectedTaskId` (the *active* member).

- `selection.size ≤ 1` → **single inspector** for `selectedTaskId` (or empty state).
- `selection.size > 1` → **multi inspector**; `selectedTaskId` is highlighted in the list.
- **Plain click a pane row** → selection = {row}, active = row → single inspector (collapses).
- **⌘/⇧-click** → selection grows (>1) → multi inspector.
- **Click a task in the multi-inspector's list** = *peek*: sets `selectedTaskId` (highlights it),
  **does not collapse** the selection — multi view persists (explicit pinning respected).
- **"Open" affordance** (button / double-click) on a list item → collapse selection to that one → single
  inspector. So narrowing is always explicit, never a side effect of a peek.

**Wiring:** reads `selectionStore`. **Effort:** M (depends on C.2).

### C.4 Multi-task drag into another list

**Payload.** `dragstart` on a row **in** the selection sets the whole set (keep `application/x-task` =
primary id for back-compat, add `application/x-task-set` = JSON id array; drop handlers prefer the set);
a count badge shows `3`. `dragstart` on a row **not** in the selection = single, as today.

**Ordering algorithm (explicit).** On drop:

1. `R = collapseToRoots(selection)` — only forest roots move (subtrees follow).
2. Sort `R` by **visual order** (index in the source pane's `flattenVisible`) — preserves the order the
   user sees.
3. Find the drop gap in the *target* sibling group (neighbours `prev`/`next`, excluding dragged ids),
   reusing `dropOnRow`'s neighbour logic. Assign the members of `R`, in visual order, evenly-spaced
   `sort_order` values across `(prev, next)`; if the gap is too tight, rebalance the target group (reuse
   the existing `App.tsx:533-547` rebalance).

So selection `{2,5,8}` dropped **below** `20` → `20, 2, 5, 8`; dropped **above** `20` → `2, 5, 8, 20`.
The set stays **contiguous** and in **visual order**. Cross-list drops set `list_id`/`parent_id` per the
target (tab, pane root, or row) and the subtree follows. Backend: `move_tasks(ids, parent_id, list_id)`
(atomic; applies `collapseToRoots`; assigns the contiguous band). **Effort:** M–L.

### C.5 Inline search (replaces the composer) + match highlighting

⌘F **transforms the focused pane's composer** ("Add a task — Enter to save") into a search field in
place; Escape returns it to composer mode.

- Filters **the current open list by default** (decided). A small options control (gear/popover or chip
  row) offers **scope** (current list / project / all) and **fields** (title / notes / both). No
  case-sensitive / whole-word / regex in v1 (decided).
- **Per-pane** (`searchStore`) — split panes search independently — but backed by the **one shared
  search engine** (B2): `matchIds(query, scope, fields)` is memoized and deduped across panes, so
  identical queries compute once and we never re-tokenise per pane. Replaces today's global `search`.
- **Match count + next/prev** (Enter / ⇧Enter cycles matches, scrolls into view, sets preview). Escape
  closes → composer returns.
- **Highlight matched text:** add a helper that wraps hits in an accent `<mark>` span when a query is
  active (titles are plain text → safe). Notes preview too.
- **Remove** the search input from `TitleBar` (`TitleBar.tsx:113-143`), reclaiming space. ⌘F now targets
  the focused pane's composer.

**Effort:** M. Frontend-only, but **invasive** — touches `TaskPane` (composer↔search), `TaskRow`
(highlight), `TitleBar` (remove box), `searchStore` + engine, and the visibility predicate. Scheduled
**after** bulk actions for that reason (Part E).

---

## Part D — The wider QOL backlog

Tiered **P1 · P2 · P3**; effort **S/M/L**; **FE** = frontend-only, **BE** = needs Rust.

### D.1 TaskPane & rows (make this area perfect)

- **P1·S·FE — Roving keyboard focus / clearer nav cursor** (distinct focus ring vs. preview-selected;
  wrap at ends, currently clamps).
- **P1·S·FE — ⌘↑/↓ reorder the selected task** within its sibling group (reuse `dropOnRow` sort math;
  ⌘⌥↑/↓ if plain ⌘-arrows are reserved).
- **P1·S·FE — Enter toggles collapse on a parent**; ←/→ collapse/expand (tree-nav convention).
- **P1·S·FE — Inline "Add subtask" on hover** (the action exists in the menu; surface a hover `+`).
- **P2·S·FE — Collapse all / Expand all** (footer button + shortcut).
- **P2·M·FE — Per-pane sort control** (manual / created / alphabetical / done-last) + **filter chip**
  (all / active / completed).
- **P2·S·FE — Drag multiple to reorder** (falls out of C.4).
- **P2·M·FE — Indent / outdent with Tab / ⇧Tab** (reparent to previous sibling / promote).

### D.2 Selection & bulk actions (beyond C.2/C.3)

- **P1·S·FE — Selection count + Clear** always visible when active.
- **P2·S·FE — Invert selection / Select all completed / Select all in subtree.**
- **P2·S·FE — Persist last selection** across a refresh.

### D.3 Keyboard & command surface

- **P1·M·FE — Command palette (⌘K)** — fuzzy-run any catalog command + navigate to any list/project +
  quick task actions. Nearly free now that the catalog is centralised; big UX win — **promoted to Phase 1**.
- **P1·S·FE/BE — `next_tab`/`prev_tab`** (C.1), **`next/prev project`** (⌘⇧[ / ⌘⇧]).
- **P1·S·FE/BE — `toggle_split`**, **`focus_other_pane`** as catalog commands.
- **P2·S·BE — `toggle_completed`, `select_all`, `clear_selection`** as catalog entries.
- **P2·S·FE — `?` keyboard cheat-sheet** overlay (rendered from the catalog — free once the palette
  helper exists).
- **P2·S·BE — `new_list` / `new_project`** shortcuts. **P3·M·FE — Chorded shortcuts** ("g then l").

### D.5 Preview panel (beyond C.3)

- **P1·S·FE — ⌘C copies the inspected task/selection**; ⌘⌫ deletes from the panel.
- **P2·S·FE — Keyboard nav inside the panel.** **P2·M·FE — Collapsible sections + remembered state.**
- **P2·S·FE — Quick-add subtask field** in the inspector.
- **P3·M·FE — Pin/detach preview** as a floating window; **markdown paste** into notes.

### D.6 Lists & tabs

- **P1·S·FE — Double-click tab to rename inline.** **P2·S·FE — Tab overflow** (scroll / "more" menu).
- **P3·M·BE — List templates.**

### D.7 Projects

- **P1·S·FE — ⌘⇧[ / ] switch project**; palette quick-switcher.
- **P2·S·FE — Reorder projects, project colour, task counts in the switcher.**

### D.8 Split view & layout

- **P1·S·FE — Swap panes shortcut**; **reset split ratio** (double-click the resizer).

### D.9 Notes & attachments

- **P2·S·FE — Drag a file onto a task row** to attach. **P2·S·FE — Attachment quick-look** on hover/space.
- **P3·M·BE — Note templates / slash-commands.**

### D.10 Data safety & history

- **P1·L·FE/BE — Undo/redo** — the `historyStore` over B3 command objects; ⌘Z / ⌘⇧Z. Move/reorder/done/
  rename/create invertible immediately; delete via soft-delete.
- **P1·M·BE — Trash / recently deleted** (soft-delete `deleted_at` + restore/purge) — the durable base
  for undoable delete (B3).
- **P2·S·FE — Toast with "Undo"** after delete/move/bulk (short-lived `invert()` of the last command).
- **P2·M·BE — Autosave backup / export project.**

### D.11 Accessibility & polish

- **P1·S·FE — Focus-visible rings** everywhere; **ARIA** on the checkbox/selection handle.
- **P1·S·FE — Respect reduced-motion** (infra exists via `useLowPowerMode`; audit animations).

> _Removed from this plan (per direction): App-level onboarding/window items and Tray/capture-bar QOL.
> Onboarding + multiple themes will be planned separately later._

---

## Part E — Build order, risk, testing, open questions

### Build order

**Phase 1 — Foundations & the requested set:**

1. **Domain stores** — `taskStore` → `listStore` → `projectStore` (everything depends on domain data),
   then **`layoutStore`**, then **`selectionStore`**. Stand up **B3 command objects** alongside (the
   store mutations become commands). *(B2, B3)*
2. **Command palette (⌘K)** — promoted here; nearly free once `hotkeyStore` + the catalog are in place,
   and it makes every later command instantly reachable. *(D.3)*
3. **Reimagined selection** — kill Select/Mark modes; ambient ⌘/⇧-click + ⇧-Arrow + ⌘A on
   `selectionStore`; `collapseToRoots` (Rust + mirrored FE + shared test vector). *(C.2)*
4. **Bulk action bar + `delete_tasks`/`move_tasks`** (delete as soft-delete) + ⌘⌫-deletes-selection. *(C.2, D.10)*
5. **`next_tab`/`prev_tab` (⌘⌥←/→)** — trivial, parallelisable warm-up. *(C.1)*
6. **Multi-select PreviewPanel** (state machine). *(C.3)*
7. **Multi-task drag into a list** (payload + ordering algorithm + `move_tasks`). *(C.4)*
8. **Inline search** (composer-replacing) + highlighting + remove title-bar box — **last**, because it's
   the most invasive and touches the most surfaces. *(C.5)*

**Phase 2 — Power-user layer:** `?` cheat-sheet, per-pane sort/filter, reorder shortcuts (⌘↑/↓),
Tab/⇧Tab indent, project-switch shortcuts, optimistic updates rollout across the common ops.

**Phase 3 — Durability & breadth:** full undo/redo UI over the B3 stack, trash restore/purge,
paste-image-to-note, tab overflow, list colour/emoji (schema change — confirm first), a11y audit.

### Risk assessment

| Risk | Items | Mitigation |
|---|---|---|
| **Low** | ⌘⌥ tab shortcuts, bulk action bar (UI), multi-select preview, palette/hotkeys | Small, isolated, reuse existing patterns |
| **Medium** | Stores migration, inline search, multi-drag | Incremental store migration; search scheduled last; drag ordering spec'd in C.4 |
| **High** | Bulk backend semantics, undo integration | `collapseToRoots` spec'd once + shared FE/BE test vector; B3 command objects + soft-delete designed up front |

> Context-performance was the original top risk; **choosing Zustand removes it** (per-selector
> subscriptions), which is why it's absent from the High row.

### Testing strategy

Extract the tricky logic as **pure functions** specifically so they're testable without React, and
mirror the Rust bulk commands with integration tests (as `storage.rs` already does for tasks).

- **Selection reducer** (pure): ⌘-click toggle, ⇧-click range along `flattenVisible`, ⇧+Arrow extend,
  ⌘A select-all-visible, Escape (clear selection → then clear preview), anchor tracking.
- **`collapseToRoots`** (pure, **shared FE/BE vector**): ancestor+descendant both selected → root only;
  deep subtree; disjoint sets; whole-tree selected. Same inputs asserted identical on both sides.
- **Multi-drag ordering** (pure): `{2,5,8}` below `20` → `20,2,5,8`; above → `2,5,8,20`; visual order
  preserved; contiguous; tight-gap rebalance; cross-list carries subtree.
- **Bulk backend** (Rust integration): `delete_tasks` with ancestor+descendant overlap deletes once and
  is a no-op on missing ids; soft-delete sets `deleted_at` and `invert()` restores; `move_tasks` is
  atomic and subtree-aware.
- **Search** (pure engine): scope (list/project/all), fields (title/notes/both), highlight span
  boundaries, split-pane independence, shared-index dedupe of identical queries.
- **Command/undo** (B3): each command's `invert()` restores exact prior state (move, reorder, done,
  rename, create, soft-delete).

### Decisions locked

- **Tab cycling:** wrap-around; fires while typing. *(C.1)*
- **Selection:** fully modeless — checkbox always marks done; ⌘/⇧-click always select; Select/Mark deleted. *(C.2)*
- **Stores:** **Zustand**, split into `task`/`list`/`project`/`layout`/`selection`/`search`/`hotkey`/
  `settings` stores (no monolithic `dataStore`). *(B2)*
- **Mutations:** command objects from the start (optimistic + undo-ready); delete ships as soft-delete. *(B3)*
- **Search:** one shared engine; per-pane query; default scope = current list; options = scope + fields. *(C.5)*
- **Order changes:** ⌘K palette promoted to Phase 1; inline search moved last. *(Build order)*

### Open questions (confirm before building the affected piece)

- **Schema changes** (soft-delete `deleted_at`, list colour) — the migration policy in
  `done.orm-migration.md` requires data-preserving migrations from `0002` on; get sign-off before
  editing `common/schema.hcl`. Soft-delete is the first such change (needed for undoable bulk-delete in
  Phase 1) — worth deciding early.
