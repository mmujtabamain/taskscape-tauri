import {
  IconButton,
  InputWell,
  KeyAction,
  Sheet,
  SuffixInput,
  TextInput,
} from '@taskscape/common-ui/components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { suggestListName, suggestProjectName } from '../lib/nameSuggest';
import type { SheetResult, SheetSpec } from '../lib/sheet';
import { useSheetStore } from '../stores/sheetStore';

// The sheet's field is the one thing being acted on, so it stands taller than an
// inline field and carries a resting edge. Focus moves that edge to the accent
// and leaves the ring at a hairline: on a panel this small, a 2px glow around a
// full-width field is the loudest thing on screen, which the field is not.
const FIELD =
  'h-10 text-[14px] border border-edge-2l dark:border-edge-2d bg-surface-1l dark:bg-surface-1d focus-within:ring-0 focus-within:border-accent-500l dark:focus-within:border-accent-500d';

/** The default name the dice fills in, by pool. Empty when the dice is off. */
function rollName(kind: 'project' | 'list' | undefined): string {
  if (kind === 'project') return suggestProjectName();
  if (kind === 'list') return suggestListName();
  return '';
}

/** Renders the one sheet currently on screen, if any (see sheetStore). `<Overlay>`
 *  portals it out and puts it on the modal layer, so this can be mounted anywhere
 *  in the tree. */
export function SheetHost() {
  const current = useSheetStore((s) => s.current);
  if (!current) return null;
  return (
    <SheetView
      key={current.id}
      spec={current.spec}
      onAnswer={(result) =>
        useSheetStore.getState().answer(current.id, result)
      }
    />
  );
}

function SheetView({
  spec,
  onAnswer,
}: {
  spec: SheetSpec;
  onAnswer: (result: SheetResult) => void;
}) {
  const { ask } = spec;
  const inputRef = useRef<HTMLInputElement>(null);
  const answeredRef = useRef(false);

  const [text, setText] = useState(() =>
    ask ? (ask.value ?? rollName(ask.dice)) : ''
  );
  // Mirror the committed initial state. Never assign this ref inside the
  // useState initializer: StrictMode double-invokes initializers, so a second
  // (unshown) rollName() would leak in and the applied name wouldn't match the
  // field.
  const textRef = useRef(text);

  const answer = useCallback(
    (result: SheetResult) => {
      if (answeredRef.current) return;
      answeredRef.current = true;
      onAnswer(result);
    },
    [onAnswer]
  );

  const dismiss = useCallback(() => answer({ action: 'dismiss' }), [answer]);

  // A prompt with an empty field has nothing to accept — the button disables and
  // ⏎ nudges the field instead of resolving.
  const accept = useCallback(() => {
    const trimmed = textRef.current.trim();
    if (ask && !trimmed) {
      inputRef.current?.focus();
      return;
    }
    answer({
      action: 'accept',
      text: trimmed ? trimmed + (ask?.tail ?? '') : '',
    });
  }, [answer, ask]);

  function edit(next: string) {
    textRef.current = next;
    setText(next);
  }

  function roll() {
    edit(rollName(ask?.dice));
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    requestAnimationFrame(() => el.select());
  }

  useEffect(() => {
    if (!ask) return;
    const el = inputRef.current;
    el?.focus();
    if (textRef.current) el?.select();
  }, [ask]);

  // Only ⏎ is wired here — Escape, focus containment and the overlay-depth slot
  // all come from <Overlay>, under <Sheet>.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      accept();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accept]);

  const tone = spec.tone ?? 'accent';
  const alt = spec.instead;

  return (
    <Sheet
      glyph={spec.glyph}
      tone={tone}
      headline={spec.headline}
      detail={spec.detail}
      onDismiss={dismiss}
      instead={
        alt && (
          <KeyAction
            label={alt.label}
            onClick={() => answer({ action: 'instead', id: alt.id })}
          />
        )
      }
      accept={
        <KeyAction
          label={spec.accept}
          variant={tone === 'danger' ? 'danger' : 'accept'}
          disabled={!!ask && !text.trim()}
          onClick={accept}
        />
      }
    >
      {ask &&
        (ask.tail ? (
          <SuffixInput
            ref={inputRef}
            autoFocus
            value={text}
            suffix={ask.tail}
            placeholder={ask.placeholder}
            onValueChange={edit}
            onFocus={(e) => ask.value && e.currentTarget.select()}
            className={FIELD}
            aria-label={spec.headline}
          />
        ) : (
          <InputWell
            className={FIELD}
            trailing={
              ask.dice && (
                <IconButton
                  icon="casino"
                  size="lg"
                  iconSize={16}
                  variant="ghostStrong"
                  tabIndex={-1}
                  aria-label="Roll another name"
                  title="Roll another name"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={roll}
                />
              )
            }
          >
            <TextInput
              bare
              ref={inputRef}
              autoFocus
              value={text}
              spellCheck={false}
              placeholder={ask.placeholder}
              onChange={(e) => edit(e.target.value)}
              onFocus={(e) => ask.value && e.currentTarget.select()}
              className="text-[14px]"
              aria-label={spec.headline}
            />
          </InputWell>
        ))}
    </Sheet>
  );
}
