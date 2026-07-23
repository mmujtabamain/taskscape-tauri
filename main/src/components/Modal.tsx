import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
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

const BTN =
  'inline-flex h-8 items-center justify-center rounded-control px-4 text-[12.5px] font-semibold tracking-[0.01em] transition-transform duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-1l dark:focus-visible:ring-focus-1d';
const BTN_VARIANT: Record<NonNullable<ModalButton['variant']>, string> = {
  ghost:
    'border border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d text-content-1l dark:text-content-1d hover:border-edge-3l dark:hover:border-edge-3d hover:bg-surface-2l dark:hover:bg-surface-2d',
  primary:
    'bg-accent-500l dark:bg-accent-500d text-on-accent shadow-lift hover:bg-accent-600l dark:hover:bg-accent-600d active:bg-accent-700l dark:active:bg-accent-700d',
  danger:
    'bg-danger-500l dark:bg-danger-500d text-on-accent shadow-lift hover:bg-danger-600l dark:hover:bg-danger-600d',
};

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
    <div
      className="z-tooltip fixed inset-0 flex items-center justify-center bg-black/30"
      onMouseDown={() => resolve(null)}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="rounded-control border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d shadow-lift w-[min(400px,92vw)] overflow-hidden border"
      >
        <div className="relative flex h-11 shrink-0 items-center pr-2 pl-4">
          <h1 className="font-display text-content-1l dark:text-content-1d min-w-0 flex-1 truncate text-[14px] leading-none font-semibold">
            {props.title}
          </h1>
          <button
            type="button"
            onClick={() => resolve(null)}
            title="Close"
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-7 w-7 shrink-0 place-items-center"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {(props.message || props.input) && (
          <div className="flex items-start gap-3.5 px-4 pt-1.5 pb-5">
            {props.icon && (
              <div
                className={cn('rounded-control grid size-9 shrink-0 place-items-center', BADGE_TONE[tone])}
              >
                <Icon name={props.icon} size={20} />
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col gap-3.5">
              {props.message && (
                <p className="text-content-2l dark:text-content-2d text-[13px] leading-5 font-[450] text-pretty">
                  {props.message}
                </p>
              )}

              {props.input && (
                <div>
                  {props.input.label && (
                    <label
                      htmlFor="modal-input"
                      className="text-content-2l dark:text-content-2d mb-1.5 block text-[12px] font-medium"
                    >
                      {props.input.label}
                    </label>
                  )}
                  <div className="relative">
                    {props.input.suffix ? (
                      // Locked-extension field: the name grows to fit and the greyed
                      // extension stays glued to its right; `.` is stripped as typed.
                      <div className="rounded-field bg-surface-0l dark:bg-surface-0d focus-within:ring-focus-1l dark:focus-within:ring-focus-1d flex h-9 w-full items-center overflow-hidden px-3 text-[13px] focus-within:ring-2">
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
                        <span className="text-content-3l dark:text-content-3d flex-none whitespace-pre select-none">
                          {props.input.suffix}
                        </span>
                      </div>
                    ) : (
                      <input
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
                          'rounded-field bg-surface-0l dark:bg-surface-0d text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d focus:ring-focus-1l dark:focus:ring-focus-1d h-9 w-full pl-3 text-[13px] focus:ring-2',
                          props.input.suggest ? 'pr-9' : 'pr-3'
                        )}
                      />
                    )}
                    {props.input.suggest && (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Suggest another name"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={rollSuggestion}
                        className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center"
                      >
                        <Icon name="casino" size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="border-edge-2l dark:border-edge-2d bg-surface-1l dark:bg-surface-1d flex items-center justify-end gap-2 border-t px-2 py-2.5">
          {props.buttons.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => press(b, i === props.buttons.length - 1)}
              className={cn(BTN, BTN_VARIANT[b.variant ?? 'ghost'])}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
