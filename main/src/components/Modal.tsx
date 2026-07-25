import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import {
  Backdrop,
  Button,
  IconButton,
  Label,
  PanelHeader,
  Surface,
  TextInput,
} from '@taskscape/common-ui/components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { setOverlay } from '../lib/overlays';
import type { ModalButton, ModalProps, ModalResult } from '../lib/modal';
import { suggestProjectName, suggestListName } from '../lib/nameSuggest';
import { useModalStore } from '../stores/modalStore';

/** The default name the dice fills in, by pool. Empty when suggestion is off. */
function suggestFor(kind: 'project' | 'list' | undefined): string {
  if (kind === 'project') return suggestProjectName();
  if (kind === 'list') return suggestListName();
  return '';
}

// The tone-tinted icon badge anchors the body — a soft fill that carries the
// dialog's intent.
const BADGE_TONE = {
  default:
    'bg-selection-1l dark:bg-selection-1d text-accent-500l dark:text-accent-500d',
  danger:
    'bg-danger-100l dark:bg-danger-100d text-danger-500l dark:text-danger-500d',
};

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
      onResolve={(result) => useModalStore.getState().answer(current.id, result)}
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
        const last = props.buttons[props.buttons.length - 1];
        if (last) press(last, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, props, resolve]);

  const tone = props.tone === 'danger' ? 'danger' : 'default';

  return (
    <Backdrop
      dim="30"
      className="flex items-center justify-center"
      onMouseDown={() => resolve(null)}
    >
      <Surface
        elevation="lift"
        surface={2}
        radius="control"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[min(400px,92vw)] overflow-hidden"
      >
        <PanelHeader
          title={props.title}
          onClose={() => resolve(null)}
          border="none"
          className="pr-space-4 pl-space-7"
        />

        {(props.message || props.input) && (
          <div className="flex items-start gap-space-7 px-space-7 pt-space-4 pb-space-8">
            {props.icon && (
              <div
                className={cn('rounded-control grid size-9 shrink-0 place-items-center', BADGE_TONE[tone])}
              >
                <Icon name={props.icon} size={20} />
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col gap-space-7">
              {props.message && (
                <Label
                  as="p"
                  tone="secondary"
                  className="text-[13px] leading-5 font-[450] text-pretty"
                >
                  {props.message}
                </Label>
              )}

              {props.input && (
                <div>
                  {props.input.label && (
                    <Label
                      as="label"
                      htmlFor="modal-input"
                      tone="secondary"
                      weight="medium"
                      className="mb-space-4 block text-[12px]"
                    >
                      {props.input.label}
                    </Label>
                  )}
                  <div className="relative">
                    {props.input.suffix ? (
                      // Locked-extension field: the name grows to fit and the greyed
                      // extension stays glued to its right; `.` is stripped as typed.
                      <div className="rounded-field bg-surface-0l dark:bg-surface-0d focus-within:ring-focus-1l dark:focus-within:ring-focus-1d flex h-9 w-full items-center overflow-hidden px-space-6 text-[13px] focus-within:ring-2">
                        <span className="relative inline-flex max-w-full min-w-[1ch] flex-none">
                          <span
                            aria-hidden
                            className="invisible overflow-hidden whitespace-pre"
                          >
                            {value || props.input.placeholder || '​'}
                          </span>
                          <input
                            id="modal-input"
                            ref={inputRef}
                            autoFocus
                            value={value}
                            spellCheck={false}
                            placeholder={props.input.placeholder}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => {
                              // Block new periods so the locked extension can't be
                              // redefined; dots already in the base are left alone.
                              if (e.key === '.') e.preventDefault();
                            }}
                            onPaste={(e) => {
                              const text = e.clipboardData.getData('text');
                              if (!text.includes('.')) return;
                              e.preventDefault();
                              const el = e.currentTarget;
                              const start =
                                el.selectionStart ?? el.value.length;
                              const end = el.selectionEnd ?? el.value.length;
                              setInputValue(
                                el.value.slice(0, start) +
                                  text.replace(/\./g, '') +
                                  el.value.slice(end)
                              );
                            }}
                            onFocus={(e) => {
                              if (props.input?.initialValue)
                                e.currentTarget.select();
                            }}
                            className="text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d absolute inset-0 w-full bg-transparent text-[13px] outline-none"
                          />
                        </span>
                        <Label tone="muted" className="flex-none whitespace-pre select-none">
                          {props.input.suffix}
                        </Label>
                      </div>
                    ) : (
                      <TextInput
                        id="modal-input"
                        ref={inputRef}
                        autoFocus
                        value={value}
                        spellCheck={false}
                        placeholder={props.input.placeholder}
                        onChange={(e) => setInputValue(e.target.value)}
                        onFocus={(e) => {
                          if (props.input?.initialValue)
                            e.currentTarget.select();
                        }}
                        className={cn(
                          'h-9 w-full pl-space-6',
                          props.input.suggest ? 'pr-9' : 'pr-space-6'
                        )}
                      />
                    )}
                    {props.input.suggest && (
                      <IconButton
                        icon="casino"
                        iconSize={16}
                        variant="ghostStrong"
                        tabIndex={-1}
                        aria-label="Suggest another name"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={rollSuggestion}
                        className="absolute top-1/2 right-1.5 -translate-y-1/2"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="border-edge-2l dark:border-edge-2d bg-surface-1l dark:bg-surface-1d flex items-center justify-end gap-space-5 border-t px-space-5 py-space-6">
          {props.buttons.map((b, i) => (
            <Button
              key={b.id}
              variant={b.variant ?? 'ghost'}
              onClick={() => press(b, i === props.buttons.length - 1)}
            >
              {b.label}
            </Button>
          ))}
        </div>
      </Surface>
    </Backdrop>
  );
}
