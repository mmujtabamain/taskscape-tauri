import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { setOverlay } from "../lib/overlays";
import type { Project } from "../api";

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
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      setOverlay(false);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex items-center" data-no-drag>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-surface-0l dark:bg-surface-0d py-1.5 pr-2.5 pl-3.5 transition-colors hover:bg-wash-2l dark:hover:bg-wash-2d"
        title="Switch project"
      >
        <span className="max-w-44 truncate font-display text-[14px] font-semibold text-content-1l dark:text-content-1d">
          {selected?.name ?? "Taskscape"}
        </span>
        <Icon name="unfold_more" size={15} weight={300} className="text-content-3l dark:text-content-3d" />
      </button>

      {open && (
        <div className="absolute top-10 left-0 z-40 min-w-60 rounded-xl border border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d py-1.5 shadow-menu">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group flex h-9 cursor-default items-center gap-2 px-3 hover:bg-wash-2l dark:hover:bg-wash-2d"
              onClick={() => {
                onSelect(p.id);
                setOpen(false);
              }}
            >
              <span className="flex items-center w-4 text-accent-500l dark:text-accent-500d">
                {p.id === selectedId && <Icon name="check" size={15} weight={900} />}
              </span>
              <span className="flex-1 truncate text-[13.5px] text-content-1l dark:text-content-1d">{p.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onRename(p);
                }}
                className="grid h-6 w-6 place-items-center rounded text-content-3l dark:text-content-3d opacity-0 transition-opacity group-hover:opacity-100 hover:text-content-1l dark:hover:text-content-1d"
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
                className="grid h-6 w-6 place-items-center rounded text-content-3l dark:text-content-3d opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger-500l dark:hover:text-danger-500d"
                title="Delete project"
              >
                <Icon name="delete" size={16} weight={500} />
              </button>
            </div>
          ))}
          <div className="mx-2 my-1 border-t border-edge-1l dark:border-edge-1d" />
          <button
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
            className="flex h-9 w-full items-center gap-2 px-3 text-left hover:bg-wash-2l dark:hover:bg-wash-2d"
          >
            <span className="w-4 flex items-center text-content-3l dark:text-content-3d">
              <Icon name="add" size={15} weight={900} />
            </span>
            <span className="text-[13.5px] text-content-1l dark:text-content-1d">New project…</span>
          </button>
        </div>
      )}
    </div>
  );
}
