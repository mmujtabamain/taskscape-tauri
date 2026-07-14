import { formatAccel } from '@taskscape/common-ui/hotkeys';
import { useCallback } from 'react';
import { api } from './api';
import { Footer } from './components/Footer';
import { NotesSection } from './components/NotesSection';
import { TitleRow } from './components/TitleRow';
import { useCaptureBarEvents } from './hooks/useCaptureBarEvents';
import { useCaptureDraft } from './hooks/useCaptureDraft';
import { useCaptureTarget } from './hooks/useCaptureTarget';
import { useClearDraftHotkey } from './hooks/useClearDraftHotkey';
import { useCursorAutohide } from './hooks/useCursorAutohide';
import { useHotkeyMap } from './hooks/useHotkeyMap';

/** The frameless mini capture bar. Each concern (draft state, Rust event wiring,
 *  cursor auto-hide, hotkeys, target) lives in its own hook; this composes them
 *  and lays out the three rows. */
function App() {
  const draft = useCaptureDraft();
  const { target, refresh: refreshTarget } = useCaptureTarget();
  const { hotkeyMap, reload: reloadHotkeys } = useHotkeyMap();

  // On reveal, refresh the target name and pick up hotkey changes made while the
  // bar was hidden (theme + focus are handled inside the events hook).
  const onReveal = useCallback(() => {
    refreshTarget();
    reloadHotkeys();
  }, [refreshTarget, reloadHotkeys]);

  useCaptureBarEvents(draft, onReveal);
  useCursorAutohide();

  const clearAccel = hotkeyMap['clear_draft'] ?? '';
  const screenshotHint = formatAccel(hotkeyMap['screenshot_capture'] ?? '');
  useClearDraftHotkey(clearAccel, draft.clearDraft);

  // The editor stops its own keydowns from bubbling here, so this only ever sees
  // the title field (and the footer, which isn't tabbable).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      draft.save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      api.hideMini();
    } else if (e.key === 'Tab' && !e.shiftKey && !draft.notesOpen) {
      e.preventDefault();
      draft.setNotesOpen(true);
    }
  };

  return (
    // The window is taller than the collapsed card; the card sizes to its own
    // content and the rest of the (transparent) window shows through.
    <div
      data-tauri-drag-region
      className="rounded-panel border-edge-2l bg-surface-2l text-content-1l dark:border-edge-2d dark:bg-surface-2d dark:text-content-1d flex w-screen flex-col overflow-hidden border"
      onKeyDown={onKeyDown}
    >
      <TitleRow
        title={draft.title}
        onChange={draft.setTitle}
        titleRef={draft.titleRef}
        hasDraft={draft.hasDraft}
        clearAccel={clearAccel}
        onClear={draft.clearDraft}
      />

      <div className="bg-edge-2l dark:bg-edge-2d h-px shrink-0" />

      <NotesSection
        notesOpen={draft.notesOpen}
        editorRef={draft.editorRef}
        onOpen={() => draft.setNotesOpen(true)}
        onSave={draft.save}
        onCollapse={() => draft.setNotesOpen(false)}
      />

      <Footer
        target={target}
        capturing={draft.capturing}
        error={draft.error}
        count={draft.count}
        screenshotHint={screenshotHint}
        onAddScreenshot={draft.addScreenshot}
      />
    </div>
  );
}

export default App;
