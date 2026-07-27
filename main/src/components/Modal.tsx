import {
  Button,
  Dialog,
  IconButton,
  InputWell,
  Label,
  SuffixInput,
  TextInput,
} from '@taskscape/common-ui/components';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
} from 'react';
import type { ModalButton, ModalProps, ModalResult } from '../lib/modal';
import { suggestListName, suggestProjectName } from '../lib/nameSuggest';
import { setOverlay } from '../lib/overlays';
import { useModalStore } from '../stores/modalStore';

/** The default name the dice fills in, by pool. Empty when suggestion is off. */
function suggestFor(kind: 'project' | 'list' | undefined): string {
  if (kind === 'project') return suggestProjectName();
  if (kind === 'list') return suggestListName();
  return '';
}

/** Renders the one modal currently on screen, if any (see modalStore). A modal
 *  sits above every in-window overlay — including the attachment lightbox it can
 *  be summoned from — so it lives on the top-most z-layer. */
export function ModalHost() {
  const current = useModalStore((s) => s.current);
  if (!current) return null;
  return (
    <Modal
      key={current.id}
      props={current.props}
      onResolve={(result) =>
        useModalStore.getState().answer(current.id, result)
      }
    />
  );
}

function Modal({
  props,
  onResolve,
}: {
  props: ModalProps;
  onResolve: (result: ModalResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedRef = useRef(false);
  const inputId = useId();

  const [value, setValue] = useState(() =>
    props.input
      ? (props.input.initialValue ?? suggestFor(props.input.suggest))
      : ''
  );
  // Mirror the committed initial state. Never assign this ref inside the
  // useState initializer: StrictMode double-invokes initializers, so a second
  // (unshown) suggestFor() would leak in and the applied name wouldn't match
  // the field.
  const valueRef = useRef(value);

  // The right-hand group is the accept/cancel pair; its last button is what
  // Enter presses, so an alternate action can sit anywhere in the array without
  // becoming the default.
  const alt = props.buttons.filter((b) => b.align === 'start');
  const main = props.buttons.filter((b) => b.align !== 'start');
  const defaultId = main[main.length - 1]?.id;

  const resolve = useCallback(
    (buttonId: string | null) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;

      const trimmed = valueRef.current.trim();
      const value = trimmed ? trimmed + (props.input?.suffix ?? '') : undefined;
      onResolve({ buttonId, value });
    },
    [onResolve, props.input?.suffix]
  );

  const press = useCallback(
    (btn: ModalButton, isDefault: boolean) => {
      if (isDefault && props.input && !valueRef.current.trim()) {
        inputRef.current?.focus();
        return;
      }
      resolve(btn.id);
    },
    [props.input, resolve]
  );

  function setInputValue(next: string) {
    valueRef.current = next;
    setValue(next);
  }

  function rollSuggestion() {
    setInputValue(suggestFor(props.input?.suggest));
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    requestAnimationFrame(() => el.select());
  }

  // Register with the overlay-depth tracker so window-level key handlers defer
  // to the modal (e.g. Escape dismisses the modal, not the task selection).
  useEffect(() => {
    setOverlay(true);
    return () => setOverlay(false);
  }, []);

  useEffect(() => {
    if (!props.input) return;
    const el = inputRef.current;
    el?.focus();
    if (valueRef.current) el?.select();
  }, [props]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolve(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const btn = props.buttons.find((b) => b.id === defaultId);
        if (btn) press(btn, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [defaultId, press, props, resolve]);

  const button = (b: ModalButton) => (
    <Button
      key={b.id}
      variant={b.variant ?? 'ghost'}
      onClick={() => press(b, b.id === defaultId)}
    >
      {b.label}
    </Button>
  );

  const selectAll = (e: FocusEvent<HTMLInputElement>) => {
    if (props.input?.initialValue) e.currentTarget.select();
  };

  return (
    <Dialog
      icon={props.icon}
      tone={props.tone === 'danger' ? 'danger' : 'default'}
      title={props.title}
      message={props.message}
      onDismiss={() => resolve(null)}
      actions={main.map(button)}
      altActions={alt.map(button)}
    >
      {props.input && (
        <div className="gap-space-4 flex flex-col">
          {props.input.label && (
            <Label
              as="label"
              htmlFor={inputId}
              tone="secondary"
              weight="medium"
              className="text-[12px]"
            >
              {props.input.label}
            </Label>
          )}

          {props.input.suffix ? (
            <SuffixInput
              id={inputId}
              ref={inputRef}
              autoFocus
              value={value}
              suffix={props.input.suffix}
              placeholder={props.input.placeholder}
              onValueChange={setInputValue}
              onFocus={selectAll}
            />
          ) : (
            <InputWell
              className="h-9"
              trailing={
                props.input.suggest && (
                  <IconButton
                    icon="casino"
                    size="lg"
                    iconSize={16}
                    variant="ghostStrong"
                    tabIndex={-1}
                    aria-label="Suggest another name"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={rollSuggestion}
                  />
                )
              }
            >
              <TextInput
                bare
                id={inputId}
                ref={inputRef}
                autoFocus
                value={value}
                spellCheck={false}
                placeholder={props.input.placeholder}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={selectAll}
              />
            </InputWell>
          )}
        </div>
      )}
    </Dialog>
  );
}
