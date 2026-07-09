import { useEffect, useRef, useState } from 'react';
import type { Project } from '../api';
import { setOverlay } from '../lib/overlays';
import { Icon } from '@ui/Icon';

interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (project: Project) => void;
  onDelete: (project: Project) => void;
}

/** The recessed pill in the titlebar — the one machined "well" in the chrome. */
export function ProjectSwitcher({
  projects,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    setOverlay(true);
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      setOverlay(false);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex items-center" data-no-drag>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-control bg-surface-0l dark:bg-surface-0d hover:bg-wash-2l dark:hover:bg-wash-2d flex h-8 items-center gap-1.5 py-1.5 pr-2.5 pl-3.5 transition-colors"
        title="Switch project"
      >
        <span className="font-display text-content-1l dark:text-content-1d max-w-44 truncate text-[14px] font-semibold">
          {selected?.name ?? 'Taskscape'}
        </span>
        <Icon
          name="unfold_more"
          size={15}
          weight={300}
          className="text-content-3l dark:text-content-3d"
        />
      </button>

      {open && (
        <div className="z-dropdown rounded-panel border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d shadow-menu absolute top-10 left-0 min-w-60 border py-1.5">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group hover:bg-wash-2l dark:hover:bg-wash-2d flex h-9 cursor-default items-center gap-2 px-3"
              onClick={() => {
                onSelect(p.id);
                setOpen(false);
              }}
            >
              <span className="text-accent-500l dark:text-accent-500d flex w-4 items-center">
                {p.id === selectedId && (
                  <Icon name="check" size={15} weight={900} />
                )}
              </span>
              <span className="text-content-1l dark:text-content-1d flex-1 truncate text-[13.5px]">
                {p.name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onRename(p);
                }}
                className="rounded-field text-content-3l dark:text-content-3d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 place-items-center opacity-0 transition-opacity group-hover:opacity-100"
                title="Rename project"
              >
                <Icon name="edit" size={16} weight={500} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onDelete(p);
                }}
                className="rounded-field text-content-3l dark:text-content-3d hover:text-danger-500l dark:hover:text-danger-500d grid h-6 w-6 place-items-center opacity-0 transition-opacity group-hover:opacity-100"
                title="Delete project"
              >
                <Icon name="delete" size={16} weight={500} />
              </button>
            </div>
          ))}
          <div className="border-edge-1l dark:border-edge-1d mx-2 my-1 border-t" />
          <button
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
            className="hover:bg-wash-2l dark:hover:bg-wash-2d flex h-9 w-full items-center gap-2 px-3 text-left"
          >
            <span className="text-content-3l dark:text-content-3d flex w-4 items-center">
              <Icon name="add" size={15} weight={900} />
            </span>
            <span className="text-content-1l dark:text-content-1d text-[13.5px]">
              New project…
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
