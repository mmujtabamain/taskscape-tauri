import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import { useState } from 'react';
import type { List } from '../api';
import { createList, deleteList, exportList, renameList } from '../commands/lists';
import { dropSetOnRoot as actDropSetOnRoot, move as actMove } from '../stores/actions';
import { readDroppedIds } from '../stores/dragStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { useProjectStore } from '../stores/projectStore';
import { useContextMenu } from './contextMenuContext';

const TAB_MIME = 'application/x-list-tab';

/** The per-project list tabs. Self-sources the project's lists and the pane
 *  layout from the stores; tab CRUD/drag route through the command + action
 *  layers directly. */
export function ListTabs() {
  const menu = useContextMenu();
  const activeProjectId = useProjectStore((s) => s.activeId);
  const lists = useListStore((s) => s.lists).filter(
    (l) => l.project_id === activeProjectId
  );
  const activeListId = useLayoutStore((s) => s.activeListId);
  const splitListId = useLayoutStore((s) => s.splitListId);
  const focusedListId = useLayoutStore((s) => s.focusedListId());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  const [tabOver, setTabOver] = useState<{ id: string; before: boolean } | null>(null);
  const [tabOverEnd, setTabOverEnd] = useState(false);
  const focusedIdx = lists.findIndex((l) => l.id === focusedListId);
  const inSplit = splitListId != null;

  const selectList = (id: string) => useLayoutStore.getState().selectList(id);
  const toggleSplit = (id: string) => useLayoutStore.getState().toggleSplit(id);
  const renameInline = (id: string, name: string) =>
    void useListStore.getState().rename(id, name);
  const reorder = (draggedId: string, targetId: string, before: boolean) =>
    void useListStore.getState().reorder(draggedId, targetId, before);
  const dropTask = (taskId: string, listId: string) => void actMove(taskId, null, listId);
  const dropTaskSet = (ids: string[], listId: string) => void actDropSetOnRoot(ids, listId);

  const openMenu = (e: React.MouseEvent, list: List) => {
    e.preventDefault();
    menu.open({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: 'rename', label: 'Rename', icon: 'edit' },
        {
          id: 'split',
          label: list.id === splitListId ? 'Close split' : 'Open in split view',
          icon: 'vertical_split',
          disabled: list.id === activeListId && list.id !== splitListId,
        },
        { id: 'export', label: 'Export list…', icon: 'ios_share', dividerAbove: true },
        { id: 'delete', label: 'Delete list…', icon: 'delete', danger: true, dividerAbove: true },
      ],
      onPick: (id) => {
        if (id === 'rename') void renameList(list);
        if (id === 'split') toggleSplit(list.id);
        if (id === 'export') void exportList(list);
        if (id === 'delete') void deleteList(list);
      },
    });
  };

  return (
    <div
      className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto [&::-webkit-scrollbar]:hidden"
      data-no-drag
    >
      {lists.map((list, i) => {
        const isLeft = list.id === activeListId;
        const isRight = list.id === splitListId;
        const focused = list.id === focusedListId;
        const sepAdjacentActive = i === focusedIdx || i - 1 === focusedIdx;
        // The split indicator marks the two panes on screen — shown on BOTH panes,
        // and only while split view is on. The icon points to the side each pane
        // sits on (left = active list, right = split list).
        const paneDot = inSplit && (isLeft || isRight);
        // This separator sits to the LEFT of `list`, so it marks the drop point
        // between the previous tab and this one: light it when dropping BEFORE
        // this tab, or AFTER the previous tab.
        const prev = lists[i - 1];
        const sepDragOver =
          tabOver != null &&
          ((tabOver.id === list.id && tabOver.before) ||
            (prev != null && tabOver.id === prev.id && !tabOver.before));
        return (
          <div key={list.id} className="relative flex items-stretch">
            {/* SEPARATOR */}
            <span
              className={cn(
                'bg-edge-1l dark:bg-edge-1d my-auto h-4 w-px shrink-0',
                sepAdjacentActive && 'bg-edge-2l dark:bg-edge-2d h-full',
                sepDragOver && 'bg-accent-500l dark:bg-accent-500d h-6 w-1 rounded-full'
              )}
            />
            <div
              draggable={editingId !== list.id}
              onClick={() => selectList(list.id)}
              onDoubleClick={() => setEditingId(list.id)}
              onAuxClick={(e) => {
                if (e.button === 1) void deleteList(list);
              }}
              onContextMenu={(e) => openMenu(e, list)}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, list.id);
                e.dataTransfer.effectAllowed = 'move';
                setDraggingTab(list.id);
              }}
              onDragEnd={() => {
                setDraggingTab(null);
                setTabOver(null);
                setTabOverEnd(false);
              }}
              onDragOver={(e) => {
                const types = e.dataTransfer.types;
                if (types.includes('application/x-task')) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropOver(list.id);
                } else if (types.includes(TAB_MIME) && draggingTab !== list.id) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const before = e.clientX < r.left + r.width / 2;
                  setTabOver((v) =>
                    v?.id === list.id && v.before === before ? v : { id: list.id, before }
                  );
                }
              }}
              onDragLeave={() => {
                setDropOver((v) => (v === list.id ? null : v));
                setTabOver((v) => (v?.id === list.id ? null : v));
              }}
              onDrop={(e) => {
                const taskIds = readDroppedIds(e);
                const tabId = e.dataTransfer.getData(TAB_MIME);
                setDropOver(null);
                const over = tabOver;
                setTabOver(null);
                if (taskIds.length > 1) {
                  e.preventDefault();
                  dropTaskSet(taskIds, list.id);
                } else if (taskIds.length === 1) {
                  e.preventDefault();
                  dropTask(taskIds[0], list.id);
                } else if (tabId && tabId !== list.id) {
                  e.preventDefault();
                  reorder(tabId, list.id, over?.before ?? true);
                }
              }}
              className={cn(
                'group hover:bg-wash-1l dark:hover:bg-wash-1d relative flex cursor-default items-center gap-2 border-b border-transparent pr-2 pl-4 transition-colors',
                focused && 'bg-surface-2l dark:bg-surface-2d',
                dropOver === list.id && 'bg-selection-1l dark:bg-selection-1d',
                draggingTab === list.id && 'opacity-40'
              )}
            >
              {paneDot && (
                <Icon
                  name={isLeft ? 'line_start_circle' : 'line_end_circle'}
                  className="text-accent-500l dark:text-accent-500d"
                />
              )}
              {editingId === list.id ? (
                <input
                  autoFocus
                  defaultValue={list.name}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      const name = (e.target as HTMLInputElement).value.trim();
                      if (name && name !== list.name) renameInline(list.id, name);
                      setEditingId(null);
                    } else if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== list.name) renameInline(list.id, name);
                    setEditingId(null);
                  }}
                  className="rounded-field bg-surface-0l dark:bg-surface-0d text-content-1l dark:text-content-1d ring-focus-1l dark:ring-focus-1d max-w-40 px-1.5 py-0.5 text-[13px] font-medium ring-1 outline-none"
                />
              ) : (
                <span
                  className={cn(
                    'max-w-40 truncate text-[13px] font-medium tracking-[0.01em]',
                    focused
                      ? 'text-content-1l dark:text-content-1d'
                      : 'text-content-3l dark:text-content-3d'
                  )}
                >
                  {list.name}
                </span>
              )}
              <span className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteList(list);
                  }}
                  className="rounded-field text-content-3l dark:text-content-3d hover:bg-danger-100l dark:hover:bg-danger-100d hover:text-danger-500l dark:hover:text-danger-500d grid h-6 w-6 shrink-0 place-items-center transition-colors"
                  title="Delete list"
                >
                  <Icon name="close" size={15} weight={500} />
                </button>
              </span>
            </div>
          </div>
        );
      })}
      {lists.length > 0 && (
        <div
          className="relative flex items-stretch pr-2"
          onDragOver={(e) => {
            const last = lists[lists.length - 1];
            if (
              e.dataTransfer.types.includes(TAB_MIME) &&
              draggingTab != null &&
              draggingTab !== last?.id
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setTabOverEnd(true);
            }
          }}
          onDragLeave={() => setTabOverEnd(false)}
          onDrop={(e) => {
            const tabId = e.dataTransfer.getData(TAB_MIME);
            setTabOverEnd(false);
            const last = lists[lists.length - 1];
            if (tabId && last && tabId !== last.id) {
              e.preventDefault();
              reorder(tabId, last.id, false);
            }
          }}
        >
          {/* Trailing SEPARATOR — also a drop zone to reorder a tab to the end. */}
          <span
            className={cn(
              'bg-edge-1l dark:bg-edge-1d my-auto h-4 w-px shrink-0',
              focusedIdx === lists.length - 1 && 'bg-edge-2l dark:bg-edge-2d h-full',
              (tabOverEnd ||
                (tabOver != null &&
                  tabOver.id === lists[lists.length - 1]?.id &&
                  !tabOver.before)) &&
                'bg-accent-500l dark:bg-accent-500d h-6 w-1 rounded-full'
            )}
          />
        </div>
      )}
      <button
        onClick={() => void createList()}
        className="text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d my-auto ml-2 grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors"
        title="New list"
      >
        <Icon name="add" size={18} weight={300} />
      </button>
      {/* Trailing empty strip drags the window (the tabs themselves are interactive). */}
      <span data-tauri-drag-region className="min-w-6 flex-1 self-stretch" />
    </div>
  );
}
