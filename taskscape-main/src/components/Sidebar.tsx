import { useState } from "react";
import { Icon } from "./Icon";
import type { List, Project } from "../api";

interface Props {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  lists: List[];
  selectedListId: string | null;
  counts: Record<string, number>;
  onSelectList: (id: string) => void;
  onCreateList: (name: string) => void;
  onRenameList: (id: string, name: string) => void;
  onDeleteList: (id: string) => void;
}

export function Sidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  lists,
  selectedListId,
  counts,
  onSelectList,
  onCreateList,
  onRenameList,
  onDeleteList,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const submitNew = () => {
    const name = draft.trim();
    if (name) onCreateList(name);
    setDraft("");
    setAdding(false);
  };

  const submitEdit = (id: string) => {
    const name = editDraft.trim();
    if (name) onRenameList(id, name);
    setEditingId(null);
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          T
        </div>
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Taskscape</h1>
      </div>

      <div className="px-3 pb-2">
        <ProjectSwitcher
          projects={projects}
          selectedProject={selectedProject}
          onSelectProject={onSelectProject}
          onCreateProject={onCreateProject}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
        />
      </div>

      <div className="flex items-center justify-between px-5 pb-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Lists</span>
        <button
          onClick={() => setAdding(true)}
          disabled={!selectedProjectId}
          className="grid place-items-center rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title={selectedProjectId ? "New list" : "Create a project first"}
        >
          <Icon name="add" size={18} />
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-4">
        {lists.map((list) => {
          const active = list.id === selectedListId;
          if (editingId === list.id) {
            return (
              <input
                key={list.id}
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onBlur={() => submitEdit(list.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitEdit(list.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="w-full rounded-lg border border-indigo-400 bg-white px-3 py-1.5 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
              />
            );
          }
          return (
            <div
              key={list.id}
              className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                active
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <button
                onClick={() => onSelectList(list.id)}
                onDoubleClick={() => {
                  setEditingId(list.id);
                  setEditDraft(list.name);
                }}
                className="flex-1 truncate text-left"
                title={list.name}
              >
                {list.name}
              </button>
              <span
                className={`text-xs tabular-nums ${
                  active ? "text-indigo-200" : "text-zinc-400"
                }`}
              >
                {counts[list.id] ?? 0}
              </span>
              <button
                onClick={() => {
                  if (confirm(`Delete list "${list.name}" and all its tasks?`)) onDeleteList(list.id);
                }}
                className={`grid place-items-center opacity-0 group-hover:opacity-100 ${
                  active ? "text-indigo-200 hover:text-white" : "text-zinc-400 hover:text-red-500"
                }`}
                title="Delete list"
              >
                <Icon name="delete" size={16} />
              </button>
            </div>
          );
        })}

        {adding && (
          <input
            autoFocus
            value={draft}
            placeholder="List name…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitNew}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            className="w-full rounded-lg border border-indigo-400 bg-white px-3 py-1.5 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
          />
        )}

        {selectedProjectId && lists.length === 0 && !adding && (
          <p className="px-3 py-6 text-center text-xs text-zinc-400">
            No lists yet. Click + to create one.
          </p>
        )}
        {!selectedProjectId && (
          <p className="px-3 py-6 text-center text-xs text-zinc-400">
            Create a project to get started.
          </p>
        )}
      </nav>
    </aside>
  );
}

interface SwitcherProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
}

function ProjectSwitcher({
  projects,
  selectedProject,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
}: SwitcherProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const close = () => {
    setOpen(false);
    setAdding(false);
    setDraft("");
    setEditingId(null);
  };

  const submitNew = () => {
    const name = draft.trim();
    if (name) onCreateProject(name);
    setDraft("");
    setAdding(false);
    setOpen(false);
  };

  const submitEdit = (id: string) => {
    const name = editDraft.trim();
    if (name) onRenameProject(id, name);
    setEditingId(null);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60"
        title="Switch project"
      >
        <Icon name="folder" size={16} className="shrink-0 text-indigo-500" />
        <span className="flex-1 truncate">{selectedProject?.name ?? "No project"}</span>
        <Icon
          name="unfold_more"
          size={16}
          className="shrink-0 text-zinc-400"
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} />
          <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <div className="max-h-64 overflow-y-auto overscroll-contain">
              {projects.map((project) => {
                const active = project.id === selectedProject?.id;
                if (editingId === project.id) {
                  return (
                    <input
                      key={project.id}
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={() => submitEdit(project.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitEdit(project.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="mx-1 my-0.5 block w-[calc(100%-0.5rem)] rounded-md border border-indigo-400 bg-white px-2 py-1 text-sm outline-none dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  );
                }
                return (
                  <div
                    key={project.id}
                    className={`group flex items-center gap-2 px-2 py-1.5 text-sm ${
                      active
                        ? "text-indigo-600 dark:text-indigo-300"
                        : "text-zinc-700 dark:text-zinc-200"
                    } hover:bg-zinc-100 dark:hover:bg-zinc-700/60`}
                  >
                    <Icon
                      name="check"
                      size={15}
                      className={`shrink-0 ${active ? "opacity-100" : "opacity-0"}`}
                    />
                    <button
                      onClick={() => {
                        onSelectProject(project.id);
                        close();
                      }}
                      onDoubleClick={() => {
                        setEditingId(project.id);
                        setEditDraft(project.name);
                      }}
                      className="flex-1 truncate text-left"
                      title={project.name}
                    >
                      {project.name}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(project.id);
                        setEditDraft(project.name);
                      }}
                      className="grid place-items-center text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-zinc-700 dark:hover:text-zinc-200"
                      title="Rename project"
                    >
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (
                          confirm(`Delete project "${project.name}", all its lists and their tasks?`)
                        ) {
                          onDeleteProject(project.id);
                          close();
                        }
                      }}
                      className="grid place-items-center text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-500"
                      title="Delete project"
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-1 border-t border-zinc-100 pt-1 dark:border-zinc-700">
              {adding ? (
                <input
                  autoFocus
                  value={draft}
                  placeholder="Project name…"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={submitNew}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNew();
                    if (e.key === "Escape") {
                      setDraft("");
                      setAdding(false);
                    }
                  }}
                  className="mx-1 my-0.5 block w-[calc(100%-0.5rem)] rounded-md border border-indigo-400 bg-white px-2 py-1 text-sm outline-none dark:bg-zinc-900 dark:text-zinc-100"
                />
              ) : (
                <button
                  onClick={() => setAdding(true)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
                >
                  <Icon name="add" size={15} />
                  New project
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
