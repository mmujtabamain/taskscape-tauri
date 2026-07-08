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
        className="flex h-8 items-center gap-1.5 rounded-lg bg-recessed py-1.5 pr-2.5 pl-3.5 transition-colors hover:bg-wash-strong"
        title="Switch project"
      >
        <span className="max-w-44 truncate font-display text-[14px] font-semibold text-ink">
          {selected?.name ?? "Taskscape"}
        </span>
        <Icon name="unfold_more" size={15} weight={300} className="text-ink-3" />
      </button>

      {open && (
        <div className="absolute top-10 left-0 z-40 min-w-60 rounded-xl border border-hairline bg-raised py-1.5 shadow-menu">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group flex h-9 cursor-default items-center gap-2 px-3 hover:bg-wash-strong"
              onClick={() => {
                onSelect(p.id);
                setOpen(false);
              }}
            >
              <span className="w-4 shrink-0 text-accent">
                {p.id === selectedId && <Icon name="check" size={15} weight={500} />}
              </span>
              <span className="flex-1 truncate text-[13.5px] text-ink">{p.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onRename(p);
                }}
                className="grid h-6 w-6 place-items-center rounded text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
                title="Rename project"
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onDelete(p);
                }}
                className="grid h-6 w-6 place-items-center rounded text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                title="Delete project"
              >
                <Icon name="delete" size={14} />
              </button>
            </div>
          ))}
          <div className="mx-2 my-1 border-t border-hairline-faint" />
          <button
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
            className="flex h-9 w-full items-center gap-2 px-3 text-left hover:bg-wash-strong"
          >
            <span className="w-4 shrink-0 text-ink-3">
              <Icon name="add" size={15} />
            </span>
            <span className="text-[13.5px] text-ink">New project…</span>
          </button>
        </div>
      )}
    </div>
  );
}
