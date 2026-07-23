import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import { Spinner } from '@taskscape/common-ui/Spinner';
import { api, type CaptureTarget } from '../api';
import { ghostButtonBase } from '../ui';

/** The capture bar's footer: the target (project / list, opens the main window)
 *  and the screenshot control with its spinner / count / error states. */
export function Footer({
  target,
  capturing,
  error,
  count,
  screenshotHint,
  onAddScreenshot,
}: {
  target: CaptureTarget | null;
  capturing: boolean;
  error: string | null;
  count: number;
  screenshotHint: string;
  onAddScreenshot: () => void;
}) {
  const shotTextColor = error
    ? 'text-red-500 dark:text-red-400'
    : count && !capturing
      ? 'text-accent-500 dark:text-accent-400'
      : 'text-content-2l hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d';

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
        <button
          onClick={onAddScreenshot}
          disabled={capturing}
          tabIndex={-1}
          className={cn(ghostButtonBase, shotTextColor)}
          title={
            capturing
              ? 'Capturing screenshot …'
              : error
                ? error
                : count
                  ? `${count} screenshot${count > 1 ? 's' : ''} attached — add another${screenshotHint ? ` (${screenshotHint})` : ''}`
                  : `Attach a full-screen screenshot${screenshotHint ? ` (${screenshotHint})` : ''}`
          }
        >
          {capturing ? (
            <>
              <Spinner size={13} />
              <span>Capturing …</span>
            </>
          ) : error ? (
            <>
              <Icon name="error" size={15} />
              <span>Capture failed</span>
            </>
          ) : (
            <>
              <Icon name="screenshot_monitor" size={15} filled={count > 0} />
              <span>{count ? `${count} shot${count > 1 ? 's' : ''}` : 'Screenshot'}</span>
              {screenshotHint && (
                <kbd className="text-content-3l dark:text-content-3d font-sans text-[11px] not-italic">
                  {screenshotHint}
                </kbd>
              )}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
