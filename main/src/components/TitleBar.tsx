import { cn } from '@taskscape/common-ui/cn';
import { formatAccel } from '@taskscape/common-ui/hotkeys';
import { Icon } from '@taskscape/common-ui/Icon';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../api';
import { splitTargetId } from '../commands/view';
import { isMac } from '../lib/platform';
import { useLowPowerMode } from '../lib/reducedMotion';
import { useHotkeyStore } from '../stores/hotkeyStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { ListTabs } from './ListTabs';
import { ProjectSwitcher } from './ProjectSwitcher';
import { WindowControls } from './WindowControls';

/** The window chrome: project switcher, list tabs, and the view controls. A thin
 *  layout shell — each child self-sources its own state from the stores. */
export function TitleBar() {
  const reducedMotion = useLowPowerMode();
  const splitListId = useLayoutStore((s) => s.splitListId);
  const previewOpen = useLayoutStore((s) => s.previewOpen);
  const hotkeys = useHotkeyStore((s) => s.map);
  // Subscribe (values unused) so the split button's availability re-evaluates
  // when the project's lists or the left pane change.
  useLayoutStore((s) => s.activeListId);
  useListStore((s) => s.lists);
  const splitTarget = splitTargetId();

  // "  ⌘F"-style suffix for a tooltip; empty when unbound.
  const hint = (id: string) => {
    const accel = formatAccel(hotkeys[id] ?? '');
    return accel ? `  ${accel}` : '';
  };

  const toggleSplit = () => {
    if (splitTarget) useLayoutStore.getState().toggleSplit(splitTarget);
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
        <ProjectSwitcher />
      </div>

      <ListTabs />

      <div className="flex items-center gap-2 pr-3 pl-3">
        {reducedMotion && (
          <div
            title="Reduced motion active on Low Power Mode"
            className="text-content-3l dark:text-content-3d grid h-8 w-8 shrink-0 place-items-center"
          >
            <Icon name="motion_photos_off" size={19} weight={300} />
          </div>
        )}

        {splitListId != null && (
          <BarButton
            icon="swap_horiz"
            title="Swap panes"
            onClick={() => useLayoutStore.getState().swapPanes()}
          />
        )}
        <BarButton
          icon="vertical_split"
          active={splitListId != null}
          disabled={splitTarget == null}
          title={splitListId ? 'Close split view' : 'Split view'}
          onClick={toggleSplit}
        />
        <BarButton
          icon={previewOpen ? 'right_panel_close' : 'right_panel_open'}
          active={previewOpen}
          title={`${previewOpen ? 'Hide' : 'Show'} preview panel${hint('toggle_preview')}`}
          onClick={() => useLayoutStore.getState().togglePreview()}
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
      className={cn(
        'rounded-control hover:bg-wash-1l dark:hover:bg-wash-1d grid h-8 w-8 place-items-center transition-colors disabled:pointer-events-none disabled:opacity-35',
        active
          ? 'text-content-1l dark:text-content-1d'
          : 'text-content-2l dark:text-content-2d hover:text-content-1l dark:hover:text-content-1d'
      )}
    >
      <Icon name={icon} size={19} weight={300} filled={active} />
    </button>
  );
}
