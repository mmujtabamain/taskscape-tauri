import { Label } from '@taskscape/common-ui/components';
import { Icon } from '@taskscape/common-ui/Icon';
import { api } from '../../api';

export interface PathButtonProps {
  /** Absolute path from `api.dataPaths()`; null while it loads. */
  path: string | null;
}

/** A data location, clickable to open it in Finder/Explorer. Rust falls back to
 *  the nearest existing ancestor, so a folder the app hasn't created yet (an
 *  empty `screenshots/`) still opens something sensible. */
export function PathButton({ path }: PathButtonProps) {
  if (!path)
    return (
      <Label tone="muted" className="text-[11.5px]">
        —
      </Label>
    );

  return (
    <button
      type="button"
      onClick={() => void api.openPath(path).catch(() => {})}
      title={`Open ${path}`}
      aria-label={`Open ${path} in the file manager`}
      className="gap-space-3 rounded-field px-space-4 hover:bg-wash-1l dark:hover:bg-wash-1d text-content-2l dark:text-content-2d hover:text-content-1l dark:hover:text-content-1d flex h-6 max-w-full items-center self-start"
    >
      <Icon name="folder_open" size={14} />
      <span className="truncate font-mono text-[11.5px]">{path}</span>
    </button>
  );
}
