import { getCurrentWindow } from '@tauri-apps/api/window';
import { formatAccel } from '@taskscape/common-ui/hotkeys';
import { Icon } from '@taskscape/common-ui/Icon';
import { api, type List, type Project } from '../api';
import { isMac } from '../lib/platform';
import { useLowPowerMode } from '../lib/reducedMotion';
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
  onRenameListInline: (id: string, name: string) => void;
  onDeleteList: (list: List) => void;
  onExportList: (list: List) => void;
  onToggleSplit: (id: string) => void;
  onSwapPanes: () => void;
  onDropTaskOnTab: (taskId: string, listId: string) => void;
  onDropTaskSetOnTab: (ids: string[], listId: string) => void;
  onReorderList: (draggedId: string, targetId: string, before: boolean) => void;

  previewOpen: boolean;
  onTogglePreview: () => void;

  /** Effective hotkey combos by command id, for the hint labels. */
  hotkeys: Record<string, string>;
}

export function TitleBar(props: Props) {
  const reducedMotion = useLowPowerMode();

  const splitTarget =
    props.splitListId ??
    props.lists.find((l) => l.id !== props.activeListId)?.id ??
    null;

  // "  ⌘F"-style suffix for a tooltip/placeholder; empty when unbound.
  const hint = (id: string) => {
    const accel = formatAccel(props.hotkeys[id] ?? '');
    return accel ? `  ${accel}` : '';
  };

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
        onSelect={props.onSelectList}
        onCreate={props.onCreateList}
        onRename={props.onRenameList}
        onRenameInline={props.onRenameListInline}
        onDelete={props.onDeleteList}
        onExport={props.onExportList}
        onToggleSplit={props.onToggleSplit}
        onDropTask={props.onDropTaskOnTab}
        onDropTaskSet={props.onDropTaskSetOnTab}
        onReorder={props.onReorderList}
      />

      <div className="flex items-center gap-2 pr-3 pl-3">
        {reducedMotion && (
          <div
            title="Reduced motion active on Low Power Mode"
            className="text-content-3l dark:text-content-3d grid h-8 w-8 shrink-0 place-items-center"
          >
            <Icon name="motion_photos_off" size={19} weight={300} />
          </div>
        )}

        {props.splitListId != null && (
          <BarButton
            icon="swap_horiz"
            title="Swap panes"
            onClick={props.onSwapPanes}
          />
        )}
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
          title={`${props.previewOpen ? 'Hide' : 'Show'} preview panel${hint('toggle_preview')}`}
          onClick={props.onTogglePreview}
        />
        <BarButton
          icon="settings"
          title={`Settings${hint('open_settings')}`}
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
