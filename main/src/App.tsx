import { cn } from '@taskscape/common-ui/cn';
import { Spinner } from '@taskscape/common-ui/Spinner';
import { useEffect, useMemo, useState } from 'react';
import { createList } from './commands/lists';
import { buildCommands } from './commands/palette';
import { CheatSheet } from './components/CheatSheet';
import { CommandPalette } from './components/CommandPalette';
import { ContextMenuProvider } from './components/ContextMenu';
import { PreviewPanel } from './components/preview/PreviewPanel';
import { TaskPane } from './components/TaskPane';
import { TitleBar } from './components/TitleBar';
import { Toast } from './components/Toast';
import { TrashPane } from './components/TrashPane';
import { useAppKeyboard } from './hooks/useAppKeyboard';
import { useMenuEvents } from './hooks/useMenuEvents';
import { useTrayRouting } from './hooks/useTrayRouting';
import { initialLoad, startBootstrap } from './stores/bootstrap';
import { useLayoutStore } from './stores/layoutStore';
import { useListStore } from './stores/listStore';
import { useProjectStore } from './stores/projectStore';
import { useTaskStore } from './stores/taskStore';
import { useUiStore } from './stores/uiStore';

function App() {
  const activeProjectId = useProjectStore((s) => s.activeId);
  const projectsLoaded = useProjectStore((s) => s.loaded);
  const tasksLoaded = useTaskStore((s) => s.loaded);
  const lists = useListStore((s) => s.lists);
  const activeListId = useLayoutStore((s) => s.activeListId);
  const splitListId = useLayoutStore((s) => s.splitListId);
  const previewOpen = useLayoutStore((s) => s.previewOpen);
  const previewW = useLayoutStore((s) => s.previewW);
  const splitRatio = useLayoutStore((s) => s.splitRatio);
  const trashOpen = useUiStore((s) => s.trashOpen);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const cheatOpen = useUiStore((s) => s.cheatOpen);

  const ready = projectsLoaded && tasksLoaded;
  const listsInProject = useMemo(
    () => lists.filter((l) => l.project_id === activeProjectId),
    [lists, activeProjectId]
  );
  const activeList = listsInProject.find((l) => l.id === activeListId) ?? null;
  const splitList = listsInProject.find((l) => l.id === splitListId) ?? null;

  // One bootstrap wires events + does the first load.
  useEffect(() => {
    const cleanup = startBootstrap();
    void initialLoad();
    return cleanup;
  }, []);

  useAppKeyboard();
  useMenuEvents();
  useTrayRouting();

  return (
    <ContextMenuProvider>
      <div className="bg-surface-1l dark:bg-surface-1d text-content-1l dark:text-content-1d flex h-screen w-screen flex-col overflow-hidden">
        <TitleBar />

        <div className="flex min-h-0 flex-1">
          {activeList ? (
            <div className="flex min-w-0 flex-1">
              <div
                className="flex min-w-0"
                style={{ flexBasis: splitList ? `${splitRatio * 100}%` : '100%' }}
              >
                <TaskPane list={activeList} isSplit={false} />
              </div>
              {splitList && (
                <>
                  <Resizer
                    onResize={(x, rect) =>
                      useLayoutStore
                        .getState()
                        .setSplitRatio(Math.min(0.75, Math.max(0.25, (x - rect.left) / rect.width)))
                    }
                    onReset={() => useLayoutStore.getState().resetSplitRatio()}
                  />
                  <div className="border-edge-2l dark:border-edge-2d flex min-w-0 flex-1 border-l">
                    <TaskPane list={splitList} isSplit />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="bg-surface-2l dark:bg-surface-2d flex flex-1 flex-col items-center justify-center gap-3">
              <p className="font-display text-content-2l dark:text-content-2d text-[17px] font-medium">
                No lists yet
              </p>
              <button
                onClick={() => void createList()}
                className="rounded-control bg-accent-500l dark:bg-accent-500d text-on-accent hover:bg-accent-600l dark:hover:bg-accent-600d active:bg-accent-700l dark:active:bg-accent-700d px-4 py-2 text-[13px] font-semibold tracking-[0.01em] transition-colors"
              >
                Create your first list
              </button>
            </div>
          )}

          {(previewOpen || trashOpen) && (
            <>
              <Resizer
                onResize={(x, rect) =>
                  useLayoutStore
                    .getState()
                    .setPreviewW(Math.min(420, Math.max(280, rect.right - x)))
                }
              />
              <aside
                style={{ width: previewW }}
                className="border-edge-2l dark:border-edge-2d shrink-0 border-l"
              >
                {trashOpen ? (
                  <TrashPane onClose={() => useUiStore.getState().setTrashOpen(false)} />
                ) : (
                  <PreviewPanel />
                )}
              </aside>
            </>
          )}
        </div>

        {!ready && (
          <div className="z-overlay bg-surface-1l dark:bg-surface-1d absolute inset-0 grid place-items-center">
            <Spinner size={26} label="Loading…" />
          </div>
        )}
      </div>

      {paletteOpen && (
        <CommandPalette
          getCommands={buildCommands}
          onClose={() => useUiStore.getState().setPaletteOpen(false)}
        />
      )}
      {cheatOpen && <CheatSheet onClose={() => useUiStore.getState().setCheatOpen(false)} />}
      <Toast />
    </ContextMenuProvider>
  );
}

/** Invisible grab strip over a hairline that brightens while resizing. */
function Resizer({
  onResize,
  onReset,
}: {
  onResize: (clientX: number, rect: DOMRect) => void;
  onReset?: () => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <div
      onDoubleClick={onReset}
      onMouseDown={(e) => {
        e.preventDefault();
        setActive(true);
        const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const move = (ev: MouseEvent) => onResize(ev.clientX, rect);
        const up = () => {
          setActive(false);
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
      className="z-raised relative -mr-1.25 w-1.25 shrink-0 cursor-col-resize"
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 w-px transition-colors',
          active
            ? 'bg-edge-3l dark:bg-edge-3d'
            : 'hover:bg-edge-2l dark:hover:bg-edge-2d bg-transparent'
        )}
      />
    </div>
  );
}

export default App;
