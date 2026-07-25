import { Icon } from '@taskscape/common-ui/Icon';
import {
  DashedButton,
  IconButton,
  Label,
  SectionHeader,
} from '@taskscape/common-ui/components';
import { useEffect, useRef, useState } from 'react';
import { runDraftAction } from '../../commands/tasks';
import { useListStore } from '../../stores/listStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUiStore } from '../../stores/uiStore';

/** The new-task draft: a title field plus "start with" actions, shown before any
 *  DB row exists. Typing a title (commit) creates the task with that title; the
 *  actions create it as "Untitled" and add a note / screenshot. Escape or a
 *  click-away with no title drops the draft — nothing is written. The draft's
 *  target list lives in uiStore; this reads its project/list names for the
 *  breadcrumb and runs the lifecycle via the command layer. */
export function DraftInspector() {
  const draftListId = useUiStore((s) => s.draftListId);
  const lists = useListStore((s) => s.lists);
  const projects = useProjectStore((s) => s.projects);
  const list = lists.find((l) => l.id === draftListId);
  const listName = list?.name ?? null;
  const projectName =
    projects.find((p) => p.id === list?.project_id)?.name ?? null;

  const [title, setTitle] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  // Grow the field to fit the wrapped title (matches the task inspector), so a
  // long title expands over multiple lines instead of clipping to one.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);
  const noBlur = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="animate-rise flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 p-4">
        <span className="bg-accent-500l dark:bg-accent-500d absolute top-4.75 left-0 h-4 w-0.5" />
        <div className="flex items-start gap-2.5">
          <span className="border-edge-3l dark:border-edge-3d rounded-field mt-0.5 grid h-5 w-5 shrink-0 place-items-center border-[1.5px]" />
          <div className="min-w-0 flex-1">
            <textarea
              ref={ref}
              rows={1}
              spellCheck={false}
              value={title}
              placeholder="Untitled"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void runDraftAction(title, 'commit')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runDraftAction(title, 'commit');
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  void runDraftAction('', 'cancel');
                }
              }}
              className="font-display text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d bg-surface-0l dark:bg-surface-0d ring-surface-0l dark:ring-surface-0d rounded-field -ml-1 block w-full resize-none overflow-hidden border-0 px-1 py-0 text-[18px] leading-6 font-semibold ring-2 outline-none"
            />
            <Label
              as="div"
              tone="muted"
              className="mt-2.5 flex items-center gap-1.5 text-[11.5px]"
            >
              <Icon
                name="folder_open"
                size={13}
                weight={300}
                className="shrink-0"
              />
              <Label tone="secondary" truncate>
                {projectName ?? '—'}
              </Label>
              {listName && <span className="shrink-0">/ {listName}</span>}
            </Label>
          </div>
          <IconButton
            icon="last_page"
            iconSize={16}
            onMouseDown={noBlur}
            onClick={() => void runDraftAction('', 'cancel')}
            title="Discard draft"
          />
        </div>
      </div>

      <div className="p-4 pt-0">
        <SectionHeader label="Start with" />
        <div className="gap-space-4 flex">
          <DashedButton
            onMouseDown={noBlur}
            onClick={() => void runDraftAction(title, 'note')}
            className="h-10 flex-1 text-[13px] font-semibold"
          >
            <Icon name="add" size={16} />
            Note
          </DashedButton>
          <DashedButton
            onMouseDown={noBlur}
            onClick={() => void runDraftAction(title, 'shot')}
            className="h-10 flex-1 text-[13px] font-semibold"
          >
            <Icon name="screenshot_monitor" size={15} />
            Screenshot
          </DashedButton>
        </div>
        <Label as="p" tone="muted" className="mt-3 text-[12px] leading-4">
          Type a title, add a note, or take a screenshot — the task is created
          the moment it has something in it.
        </Label>
      </div>
    </div>
  );
}
