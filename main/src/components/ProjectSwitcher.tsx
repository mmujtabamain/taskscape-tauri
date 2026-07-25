import { Icon } from '@taskscape/common-ui/Icon';
import {
  Divider,
  IconButton,
  Label,
  Surface,
} from '@taskscape/common-ui/components';
import { useEffect, useRef, useState } from 'react';
import {
  createProject,
  deleteProject,
  renameProject,
  selectProject,
} from '../commands/projects';
import { setOverlay } from '../lib/overlays';
import { useProjectStore } from '../stores/projectStore';

/** The recessed pill in the titlebar — the one machined "well" in the chrome.
 *  Self-sources the project list and active id from the store. */
export function ProjectSwitcher() {
  const projects = useProjectStore((s) => s.projects);
  const selectedId = useProjectStore((s) => s.activeId);
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
        className="rounded-control bg-surface-0l dark:bg-surface-0d hover:bg-wash-2l dark:hover:bg-wash-2d gap-space-3 py-space-3 pr-space-6 pl-space-7 flex h-8 items-center"
        title="Switch project"
      >
        <Label
          tone="primary"
          weight="semibold"
          truncate
          className="font-display max-w-44 text-[14px]"
        >
          {selected?.name ?? 'Taskscape'}
        </Label>
        <Icon
          name="unfold_more"
          size={15}
          weight={300}
          className="text-content-3l dark:text-content-3d"
        />
      </button>

      {open && (
        <Surface
          elevation="menu"
          surface={3}
          radius="panel"
          className="z-dropdown py-space-3 absolute top-10 left-0 min-w-60"
        >
          {projects.map((p) => (
            <div
              key={p.id}
              className="group hover:bg-wash-2l dark:hover:bg-wash-2d gap-space-4 px-space-6 flex h-9 cursor-default items-center"
              onClick={() => {
                selectProject(p.id);
                setOpen(false);
              }}
            >
              <Label tone="accent" className="flex w-4 items-center">
                {p.id === selectedId && (
                  <Icon name="check" size={15} weight={900} />
                )}
              </Label>
              <Label tone="primary" truncate className="flex-1 text-[13.5px]">
                {p.name}
              </Label>
              <IconButton
                icon="edit"
                iconSize={16}
                iconWeight={500}
                variant="plain"
                className="opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  void renameProject(p);
                }}
                title="Rename project"
              />
              <IconButton
                icon="delete"
                iconSize={16}
                iconWeight={500}
                variant="plain"
                className="hover:text-danger-500l dark:hover:text-danger-500d opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  void deleteProject(p);
                }}
                title="Delete project"
              />
            </div>
          ))}
          <Divider level={1} className="mx-space-5 my-space-3" />
          <button
            onClick={() => {
              setOpen(false);
              void createProject();
            }}
            className="hover:bg-wash-2l dark:hover:bg-wash-2d gap-space-4 px-space-6 flex h-9 w-full items-center text-left"
          >
            <Label tone="muted" className="flex w-4 items-center">
              <Icon name="add" size={15} weight={900} />
            </Label>
            <Label tone="primary" className="text-[13.5px]">
              New project…
            </Label>
          </button>
        </Surface>
      )}
    </div>
  );
}
