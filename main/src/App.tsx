import { cn } from '@taskscape/common-ui/cn';
import { useEffect, useMemo, useState } from 'react';
import { buildCommands } from './commands/palette';
import { CommandPalette } from './components/CommandPalette';
import { ContextMenuProvider } from './components/ContextMenu';
import { ModalHost } from './components/Modal';
import { FilterPanel } from './components/preview/FilterPanel';
import { PreviewPanel } from './components/preview/PreviewPanel';
import { TaskPane } from './components/TaskPane';
import { TitleBar } from './components/TitleBar';
import { Toast } from './components/Toast';
import { TrashPane } from './components/TrashPane';
import { useAppKeyboard } from './hooks/useAppKeyboard';
import { useMenuEvents } from './hooks/useMenuEvents';
import { useTrayRouting } from './hooks/useTrayRouting';
import { dismissBoot } from './lib/boot';
import { initialLoad, startBootstrap } from './stores/bootstrap';
import { useLayoutStore } from './stores/layoutStore';
import { useListStore } from './stores/listStore';
import { useProjectStore } from './stores/projectStore';
import { useUiStore } from './stores/uiStore';

function App() {
  const activeProjectId = useProjectStore((s) => s.activeId);
  const lists = useListStore((s) => s.lists);
  const activeListId = useLayoutStore((s) => s.activeListId);
  const splitListId = useLayoutStore((s) => s.splitListId);
  const previewOpen = useLayoutStore((s) => s.previewOpen);
  const previewW = useLayoutStore((s) => s.previewW);
  const splitRatio = useLayoutStore((s) => s.splitRatio);
  const trashOpen = useUiStore((s) => s.trashOpen);
  const filterOpen = useUiStore((s) => s.filterOpen);
  const paletteOpen = useUiStore((s) => s.paletteOpen);

  const listsInProject = useMemo(
    () => lists.filter((l) => l.project_id === activeProjectId),
    [lists, activeProjectId]
  );
  const activeList = listsInProject.find((l) => l.id === activeListId) ?? null;
  const splitList = listsInProject.find((l) => l.id === splitListId) ?? null;

  // One bootstrap wires events + does the first load. The boot overlay stays
  // up until that load lands (or fails), then cross-fades to the real content.
  useEffect(() => {
    const cleanup = startBootstrap();
    void initialLoad().finally(dismissBoot);
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
            <div className="bg-surface-2l dark:bg-surface-2d flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="font-display text-content-2l dark:text-content-2d text-[17px] font-medium">
                {listsInProject.length === 0 ? 'No lists yet' : 'No list selected'}
              </p>
              <p className="text-content-3l dark:text-content-3d text-[13px]">
                {listsInProject.length === 0
                  ? 'Create a list to start adding tasks'
                  : 'Pick a list tab to view its tasks'}
              </p>
            </div>
          )}

          {(previewOpen || trashOpen || filterOpen) && (
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
                ) : filterOpen ? (
                  <FilterPanel
                    onClose={() => useUiStore.getState().setFilterOpen(false)}
                  />
                ) : (
                  <PreviewPanel />
                )}
              </aside>
            </>
          )}
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette
          getCommands={buildCommands}
          onClose={() => useUiStore.getState().setPaletteOpen(false)}
        />
      )}
      <ModalHost />
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
          'absolute inset-y-0 left-0 w-px',
          active
            ? 'bg-edge-3l dark:bg-edge-3d'
            : 'hover:bg-edge-2l dark:hover:bg-edge-2d bg-transparent'
        )}
      />
    </div>
  );
}

export default App;
