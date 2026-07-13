import { getCurrentWindow } from '@tauri-apps/api/window';
import { Icon } from '@taskscape/common-ui/Icon';
import { useEffect, useRef } from 'react';
import { api, type List, type Project } from '../api';
import { cmd, isMac } from '../lib/platform';
import { ListTabs } from './ListTabs';
import { ProjectSwitcher } from './ProjectSwitcher';
import { WindowControls } from './WindowControls';

interface Props {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;

  lists: List[];
  activeListId: string | null;
  splitListId: string | null;
  focusedListId: string | null;
  counts: Record<string, number>;
  onSelectList: (id: string) => void;
  onCreateList: () => void;
  onRenameList: (list: List) => void;
  onDeleteList: (list: List) => void;
  onToggleSplit: (id: string) => void;
  onDropTaskOnTab: (taskId: string, listId: string) => void;
  onReorderList: (draggedId: string, targetId: string, before: boolean) => void;

  search: string;
  onSearchChange: (q: string) => void;
  registerSearch: (focus: (() => void) | null) => void;

  previewOpen: boolean;
  onTogglePreview: () => void;
}

export function TitleBar(props: Props) {
  const splitTarget =
    props.splitListId ??
    props.lists.find((l) => l.id !== props.activeListId)?.id ??
    null;

  const searchRef = useRef<HTMLInputElement>(null);
  const { registerSearch } = props;
  useEffect(() => {
    registerSearch(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
    return () => registerSearch(null);
  }, [registerSearch]);

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).hasAttribute('data-tauri-drag-region'))
          getCurrentWindow().toggleMaximize();
      }}
      className="border-edge-2l dark:border-edge-2d bg-surface-1l dark:bg-surface-1d relative flex h-13 shrink-0 items-stretch border-b"
    >
      {isMac ? <WindowControls /> : <span className="w-3" />}

      <div
        data-tauri-drag-region
        className="pointer-events-none mr-2 flex h-full w-6 items-center justify-center"
      >
        <Icon name="drag_indicator" size={20} className="pointer-events-none" />
      </div>

      <div className="flex items-center pr-4">
        <ProjectSwitcher
          projects={props.projects}
          selectedId={props.selectedProjectId}
          onSelect={props.onSelectProject}
          onCreate={props.onCreateProject}
          onRename={props.onRenameProject}
          onDelete={props.onDeleteProject}
        />
      </div>

      <ListTabs
        lists={props.lists}
        activeListId={props.activeListId}
        splitListId={props.splitListId}
        focusedListId={props.focusedListId}
        counts={props.counts}
        onSelect={props.onSelectList}
        onCreate={props.onCreateList}
        onRename={props.onRenameList}
        onDelete={props.onDeleteList}
        onToggleSplit={props.onToggleSplit}
        onDropTask={props.onDropTaskOnTab}
        onReorder={props.onReorderList}
      />

      <div className="flex items-center gap-2 pr-3 pl-3">
        <div className="rounded-control bg-surface-0l dark:bg-surface-0d focus-within:ring-focus-1l dark:focus-within:ring-focus-1d flex h-8 w-56 items-center gap-2 px-2.5 transition-shadow focus-within:ring-1">
          <Icon
            name="search"
            size={16}
            weight={300}
            className="text-content-3l dark:text-content-3d shrink-0"
          />
          <input
            ref={searchRef}
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                props.onSearchChange('');
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={`Search  ${cmd}F`}
            className="text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d w-full bg-transparent text-[13px] outline-none"
          />
          {props.search && (
            <button
              onClick={() => props.onSearchChange('')}
              className="rounded-field text-content-3l dark:text-content-3d hover:text-content-1l dark:hover:text-content-1d grid h-5 w-5 shrink-0 place-items-center"
              title="Clear search"
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>

        <BarButton
          icon="vertical_split"
          active={props.splitListId != null}
          disabled={splitTarget == null}
          title={props.splitListId ? 'Close split view' : 'Split view'}
          onClick={() => splitTarget && props.onToggleSplit(splitTarget)}
        />
        <BarButton
          icon={props.previewOpen ? 'right_panel_close' : 'right_panel_open'}
          active={props.previewOpen}
          title={`${props.previewOpen ? 'Hide' : 'Show'} preview panel  ${cmd}\\`}
          onClick={props.onTogglePreview}
        />
        <BarButton
          icon="settings"
          title={`Settings  ${cmd},`}
          onClick={() => api.openSettings()}
        />
      </div>

      {!isMac && <WindowControls />}
    </header>
  );
}

function BarButton({
  icon,
  title,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-control hover:bg-wash-1l dark:hover:bg-wash-1d grid h-8 w-8 place-items-center transition-colors ${
        active
          ? 'text-content-1l dark:text-content-1d'
          : 'text-content-2l dark:text-content-2d hover:text-content-1l dark:hover:text-content-1d'
      } disabled:pointer-events-none disabled:opacity-35`}
    >
      <Icon name={icon} size={19} weight={300} filled={active} />
    </button>
  );
}
