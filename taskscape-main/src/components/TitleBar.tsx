import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icon";
import { WindowControls } from "./WindowControls";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ListTabs } from "./ListTabs";
import { isMac, cmd } from "../lib/platform";
import { api, type List, type Project } from "../api";

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
  counts: Record<string, number>;
  onSelectList: (id: string) => void;
  onCreateList: () => void;
  onRenameList: (id: string, name: string) => void;
  onDeleteList: (list: List) => void;
  onToggleSplit: (id: string) => void;
  onDropTaskOnTab: (taskId: string, listId: string) => void;

  search: string;
  onSearchChange: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;

  previewOpen: boolean;
  onTogglePreview: () => void;
}

export function TitleBar(props: Props) {
  const splitTarget =
    props.splitListId ?? props.lists.find((l) => l.id !== props.activeListId)?.id ?? null;

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).hasAttribute("data-tauri-drag-region"))
          getCurrentWindow().toggleMaximize();
      }}
      className="relative flex h-12 shrink-0 items-stretch border-b border-hairline bg-window"
    >
      {isMac ? <WindowControls /> : <span className="w-3" />}

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
        counts={props.counts}
        onSelect={props.onSelectList}
        onCreate={props.onCreateList}
        onRename={props.onRenameList}
        onDelete={props.onDeleteList}
        onToggleSplit={props.onToggleSplit}
        onDropTask={props.onDropTaskOnTab}
      />

      <div className="flex items-center gap-1.5 pr-3 pl-3">
        <div className="flex h-7 w-44 items-center gap-1.5 rounded-md bg-recessed px-2 transition-shadow focus-within:ring-1 focus-within:ring-focus">
          <Icon name="search" size={14} weight={300} className="shrink-0 text-ink-3" />
          <input
            ref={props.searchRef}
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                props.onSearchChange("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={`Search  ${cmd}F`}
            className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
          />
          {props.search && (
            <button
              onClick={() => props.onSearchChange("")}
              className="grid h-4 w-4 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
              title="Clear search"
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>

        <BarButton
          icon="vertical_split"
          active={props.splitListId != null}
          disabled={splitTarget == null}
          title={props.splitListId ? "Close split view" : "Split view"}
          onClick={() => splitTarget && props.onToggleSplit(splitTarget)}
        />
        <BarButton
          icon={props.previewOpen ? "right_panel_close" : "right_panel_open"}
          active={props.previewOpen}
          title={`${props.previewOpen ? "Hide" : "Show"} preview panel  ${cmd}\\`}
          onClick={props.onTogglePreview}
        />
        <BarButton icon="settings" title={`Settings  ${cmd},`} onClick={() => api.openSettings()} />
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
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-wash ${
        active ? "text-ink" : "text-ink-2 hover:text-ink"
      } disabled:pointer-events-none disabled:opacity-35`}
    >
      <Icon name={icon} size={18} weight={300} filled={active} />
    </button>
  );
}
