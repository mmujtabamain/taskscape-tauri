import { cn } from '@taskscape/common-ui/cn';
import { HotkeyHint, ToolbarButton } from '@taskscape/common-ui/components';
import {
  formatAccel,
  parseAccel,
  type Accel,
} from '@taskscape/common-ui/hotkeys';
import { Icon } from '@taskscape/common-ui/Icon';
import { Spinner } from '@taskscape/common-ui/Spinner';
import { api, type CaptureTarget } from '../api';

/** The capture bar's footer: the target (project / list, opens the main window)
 *  and the screenshot control with its spinner / count / error states. */
export function Footer({
  target,
  capturing,
  error,
  count,
  screenshotAccel,
  onAddScreenshot,
}: {
  target: CaptureTarget | null;
  capturing: boolean;
  error: string | null;
  count: number;
  screenshotAccel: Accel;
  onAddScreenshot: () => void;
}) {
  const shotTextColor = error
    ? 'text-red-500 dark:text-red-400'
    : count && !capturing
      ? 'text-accent-500 dark:text-accent-400'
      : 'text-content-2l hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d';

  const hint = formatAccel(screenshotAccel);
  const hintSuffix = hint ? ` (${hint})` : '';

  return (
    <div
      data-tauri-drag-region
      className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"
    >
      <button
        onClick={() => api.openMain()}
        tabIndex={-1}
        className="text-content-2l hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d flex min-w-0 items-center gap-1.5 text-xs"
        title="Open the main Taskscape window"
      >
        <Icon name="open_in_new" size={14} />
        <span className="truncate">
          {target ? (
            <>
              {target.project && (
                <span>
                  {target.project}
                  <span className="px-1 opacity-60">/</span>
                </span>
              )}
              {target.list}
            </>
          ) : (
            'Taskscape'
          )}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <ToolbarButton
          size="xs"
          variant="well"
          icon={capturing ? undefined : error ? 'error' : 'screenshot_monitor'}
          iconSize={15}
          filled={!capturing && !error && count > 0}
          onClick={onAddScreenshot}
          disabled={capturing}
          tabIndex={-1}
          // Disabled here means "busy", not "unavailable" — the in-flight state
          // keeps its contrast and its tooltip.
          className={cn(
            'shrink-0 disabled:pointer-events-auto disabled:opacity-100',
            shotTextColor
          )}
          title={
            capturing
              ? 'Capturing screenshot …'
              : error
                ? error
                : count
                  ? `${count} screenshot${count > 1 ? 's' : ''} attached — add another${hintSuffix}`
                  : `Attach a full-screen screenshot${hintSuffix}`
          }
        >
          {capturing ? (
            <>
              <Spinner size={13} />
              <span>Capturing …</span>
            </>
          ) : error ? (
            <span>Capture failed</span>
          ) : (
            <>
              <span>
                {count ? `${count} shot${count > 1 ? 's' : ''}` : 'Screenshot'}
              </span>
              <HotkeyHint hotkey={parseAccel(screenshotAccel)} />
            </>
          )}
        </ToolbarButton>
      </div>
    </div>
  );
}
