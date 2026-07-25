import { cn } from '@taskscape/common-ui/cn';
import { IconButton, Label, TextInput } from '@taskscape/common-ui/components';
import { Icon } from '@taskscape/common-ui/Icon';
import { useState } from 'react';
import type { List } from '../api';
import {
  createList,
  deleteList,
  exportList,
  renameList,
} from '../commands/lists';
import {
  dropSetOnRoot as actDropSetOnRoot,
  move as actMove,
} from '../stores/actions';
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
  const [tabOver, setTabOver] = useState<{
    id: string;
    before: boolean;
  } | null>(null);
  const [tabOverEnd, setTabOverEnd] = useState(false);
  const focusedIdx = lists.findIndex((l) => l.id === focusedListId);
  const inSplit = splitListId != null;

  const selectList = (id: string) => useLayoutStore.getState().selectList(id);
  const toggleSplit = (id: string) => useLayoutStore.getState().toggleSplit(id);
  const renameInline = (id: string, name: string) =>
    void useListStore.getState().rename(id, name);
  const reorder = (draggedId: string, targetId: string, before: boolean) =>
    void useListStore.getState().reorder(draggedId, targetId, before);
  const dropTask = (taskId: string, listId: string) =>
    void actMove(taskId, null, listId);
  const dropTaskSet = (ids: string[], listId: string) =>
    void actDropSetOnRoot(ids, listId);

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
        {
          id: 'export',
          label: 'Export list…',
          icon: 'ios_share',
          dividerAbove: true,
        },
        {
          id: 'delete',
          label: 'Delete list…',
          icon: 'delete',
          danger: true,
          dividerAbove: true,
        },
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
                sepDragOver &&
                  'bg-accent-500l dark:bg-accent-500d h-6 w-1 rounded-full'
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
                } else if (
                  types.includes(TAB_MIME) &&
                  draggingTab !== list.id
                ) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const r = (
                    e.currentTarget as HTMLElement
                  ).getBoundingClientRect();
                  const before = e.clientX < r.left + r.width / 2;
                  setTabOver((v) =>
                    v?.id === list.id && v.before === before
                      ? v
                      : { id: list.id, before }
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
                'group hover:bg-wash-1l dark:hover:bg-wash-1d gap-space-4 pr-space-5 pl-space-7 relative flex cursor-default items-center border-b border-transparent',
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
                <TextInput
                  autoFocus
                  defaultValue={list.name}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      const name = (e.target as HTMLInputElement).value.trim();
                      if (name && name !== list.name)
                        renameInline(list.id, name);
                      setEditingId(null);
                    } else if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== list.name) renameInline(list.id, name);
                    setEditingId(null);
                  }}
                  className="ring-focus-1l dark:ring-focus-1d px-space-4 h-6 max-w-40 py-0 font-medium ring-1"
                />
              ) : (
                <Label
                  truncate
                  weight="medium"
                  tone={focused ? 'primary' : 'muted'}
                  className="max-w-40 text-[13px] tracking-[0.01em]"
                >
                  {list.name}
                </Label>
              )}
              <span className="relative">
                <IconButton
                  icon="close"
                  iconSize={15}
                  iconWeight={500}
                  variant="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteList(list);
                  }}
                  title="Delete list"
                />
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
              focusedIdx === lists.length - 1 &&
                'bg-edge-2l dark:bg-edge-2d h-full',
              (tabOverEnd ||
                (tabOver != null &&
                  tabOver.id === lists[lists.length - 1]?.id &&
                  !tabOver.before)) &&
                'bg-accent-500l dark:bg-accent-500d h-6 w-1 rounded-full'
            )}
          />
        </div>
      )}
      <IconButton
        icon="add"
        iconSize={18}
        iconWeight={300}
        size="lg"
        onClick={() => void createList()}
        className="my-auto ml-2 rounded-md"
        title="New list"
      />
      {/* Trailing empty strip drags the window (the tabs themselves are interactive). */}
      <span data-tauri-drag-region className="min-w-6 flex-1 self-stretch" />
    </div>
  );
}
