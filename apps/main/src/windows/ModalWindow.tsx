import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '@taskscape/common-ui/Icon';
import {
  GLYPHS,
  INNER,
  OUTER,
  useWindowFocused,
} from '../components/windowChrome';
import type { ModalButton, ModalProps, ModalResult } from '../lib/modal';
import { suggestProjectName, suggestListName } from '../lib/nameSuggest';
import { isMac } from '../lib/platform';

const WIDTH = 400;

/** The default name the dice fills in, by pool. Empty when suggestion is off. */
function suggestFor(kind: 'project' | 'list' | undefined): string {
  if (kind === 'project') return suggestProjectName();
  if (kind === 'list') return suggestListName();
  return '';
}

const BTN =
  'inline-flex h-8 items-center justify-center rounded-control px-4 text-[12.5px] font-semibold tracking-[0.01em] transition duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-1l dark:focus-visible:ring-focus-1d';
const BTN_VARIANT: Record<NonNullable<ModalButton['variant']>, string> = {
  ghost:
    'border border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d text-content-1l dark:text-content-1d hover:border-edge-3l dark:hover:border-edge-3d hover:bg-surface-2l dark:hover:bg-surface-2d',
  primary:
    'bg-accent-500l dark:bg-accent-500d text-on-accent shadow-lift hover:bg-accent-600l dark:hover:bg-accent-600d active:bg-accent-700l dark:active:bg-accent-700d',
  danger:
    'bg-danger-500l dark:bg-danger-500d text-on-accent shadow-lift hover:bg-danger-600l dark:hover:bg-danger-600d',
};

// The tone-tinted icon badge anchors the body — a soft fill that carries the
// dialog's intent well clear of the red close light in the title bar.
const BADGE_TONE = {
  default:
    'bg-selection-1l dark:bg-selection-1d text-accent-500l dark:text-accent-500d',
  danger:
    'bg-danger-100l dark:bg-danger-100d text-danger-500l dark:text-danger-500d',
};

// The global reduced-motion rule zeroes animation durations, which would make
// the drain's animationend fire instantly — skip auto-dismiss entirely instead.
const reducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

/** Title-bar window controls for the modal. Only Close is live — a dialog can't
 *  be minimized or zoomed — and Close dismisses the modal (buttonId: null)
 *  rather than destroying the shared, reused panel window. */
function ModalControls({ onClose }: { onClose: () => void }) {
  const focused = useWindowFocused();

  if (!isMac)
    return (
      <button
        onClick={onClose}
        title="Close"
        data-no-drag
        className="text-content-2l dark:text-content-2d flex h-full w-11 items-center justify-center transition-colors duration-100 hover:bg-[#e81123] hover:text-white"
      >
        <Icon name="close" size={18} />
      </button>
    );

  const discs = [
    {
      live: true,
      ring: '#e24b41',
      fill: '#ed6a5f',
      glyph: '#460804',
      label: 'Close',
    },
    { live: false, label: 'Minimize' },
    { live: false, label: 'Zoom' },
  ];
  return (
    <div className="group flex items-center gap-2 pr-3 pl-5" data-no-drag>
      {discs.map((d) => (
        <button
          key={d.label}
          onClick={d.live ? onClose : undefined}
          title={d.label}
          aria-disabled={!d.live}
          className={`block size-3.25 ${d.live ? '' : 'cursor-default'}`}
        >
          <svg
            viewBox="0 0 85.4 85.4"
            className="size-full"
            clipRule="evenodd"
            fillRule="evenodd"
          >
            <path
              d={OUTER}
              fill={d.live && focused ? d.ring : 'var(--tl-inactive-ring)'}
            />
            <path
              d={INNER}
              fill={d.live && focused ? d.fill : 'var(--tl-inactive-fill)'}
            />
            {d.live && focused && (
              <g
                fill={d.glyph}
                className="opacity-0 transition-opacity duration-100 group-hover:opacity-100"
              >
                {GLYPHS.close}
              </g>
            )}
          </svg>
        </button>
      ))}
    </div>
  );
}

/** One reusable panel window serves every modal (it is hidden, never
 *  destroyed): fetch the pending modal on load and again on each re-present. */
export function ModalWindow() {
  const [current, setCurrent] = useState<{
    id: string;
    props: ModalProps;
  } | null>(null);

  useEffect(() => {
    let stale = false;
    const fetch = () =>
      void api
        .modalCurrent()
        .then((cur) => {
          if (!stale) setCurrent(cur as { id: string; props: ModalProps });
        })
        .catch(() => {});
    fetch();
    const un = listen('modal-refresh', fetch);
    return () => {
      stale = true;
      un.then((fn) => fn());
    };
  }, []);

  if (!current)
    return (
      <div className="bg-surface-2l dark:bg-surface-2d h-screen w-screen" />
    );
  return (
    <ModalContent key={current.id} id={current.id} props={current.props} />
  );
}

function ModalContent({ id, props }: { id: string; props: ModalProps }) {
  const [presented, setPresented] = useState(false);
  const [drainPaused, setDrainPaused] = useState(false);
  const [drainCancelled, setDrainCancelled] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedRef = useRef(false);
  const presentedRef = useRef(false);
  const drainCancelledRef = useRef(false);

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
    (buttonId: string | null, timedOut = false) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;

      const trimmed = valueRef.current.trim();
      const value = trimmed
        ? trimmed + (props.input?.suffix ?? "")
        : undefined;

      const result: ModalResult = { buttonId, value };
      if (timedOut) result.timedOut = true;

      void api.closeModal(id, result);
    },
    [id, props.input?.suffix]
  );

  const press = useCallback((btn: ModalButton, isDefault: boolean) => {
    if (isDefault && props.input && !valueRef.current.trim()) {
      inputRef.current?.focus();
      return;
    }
    resolve(btn.id);
  }, [props.input, resolve]);

  function cancelDrain() {
    if (drainCancelledRef.current) return;
    drainCancelledRef.current = true;
    setDrainCancelled(true);
  }

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

  useEffect(() => {
    if (!props.input) return;
    const el = inputRef.current;
    el?.focus();
    if (valueRef.current) el?.select();
  }, [props]);

  // Measure after fonts settle (variable fonts shift metrics), then size,
  // center and reveal the hidden window exactly once (StrictMode-safe).
  useEffect(() => {
    if (presentedRef.current) return;
    presentedRef.current = true;
    void document.fonts.ready.then(() => {
      const height = (contentRef.current?.scrollHeight ?? 200) + 2; // + root hairline border
      void api.presentWindow(WIDTH, height);
      setPresented(true);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      cancelDrain();
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
      data-tauri-drag-region
      className="border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d relative h-screen w-screen overflow-hidden border"
      onPointerEnter={() => setDrainPaused(true)}
      onPointerLeave={() => setDrainPaused(false)}
    >
      <style>
        {'@keyframes modal-in { from { opacity: 0; transform: scale(0.97); } }'}
      </style>
      <div
        ref={contentRef}
        data-tauri-drag-region
        className="w-full"
        style={
          presented
            ? { animation: 'modal-in 180ms cubic-bezier(0.2, 0, 0, 1) both' }
            : { opacity: 0 }
        }
      >
        <div
          data-tauri-drag-region
          className="relative flex h-11 shrink-0 items-stretch"
        >
          {isMac && <ModalControls onClose={() => resolve(null)} />}

          <div
            data-tauri-drag-region
            className={`flex min-w-0 flex-1 items-center ${
              "isMac ? 'pr-4' : 'pr-2 pl-4'"
            }`}
          >
            <h1
              data-tauri-drag-region
              className="font-display text-content-1l dark:text-content-1d truncate text-[14px] leading-none font-semibold"
            >
              {props.title}
            </h1>
          </div>

          {!isMac && <ModalControls onClose={() => resolve(null)} />}
        </div>

        {(props.message || props.input) && (
          <div className="flex items-start gap-3.5 px-4 pt-1.5 pb-5">
            {props.icon && (
              <div
                className={`rounded-control grid size-9 shrink-0 place-items-center ${BADGE_TONE[tone]}`}
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
                              cancelDrain();
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
                          cancelDrain();
                          if (props.input?.initialValue)
                            e.currentTarget.select();
                        }}
                        className={`rounded-field bg-surface-0l dark:bg-surface-0d text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d focus:ring-focus-1l dark:focus:ring-focus-1d h-9 w-full pl-3 text-[13px] focus:ring-2 ${
                          props.input.suggest ? 'pr-9' : 'pr-3'
                        }`}
                      />
                    )}
                    {props.input.suggest && (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Suggest another name"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={rollSuggestion}
                        className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center transition duration-150"
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
              className={`${BTN} ${BTN_VARIANT[b.variant ?? 'ghost']}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {props.timeoutMs != null && !reducedMotion && (
        <div
          className="bg-accent-500l dark:bg-accent-500d pointer-events-none absolute inset-x-6 bottom-0 h-0.5 origin-left transition-opacity duration-200"
          style={{
            animation: presented
              ? `drain ${props.timeoutMs}ms linear forwards`
              : 'none',
            animationPlayState:
              drainPaused || drainCancelled ? 'paused' : 'running',
            opacity: drainCancelled ? 0 : drainPaused ? 0.25 : 0.45,
          }}
          onAnimationEnd={() => {
            if (!drainCancelledRef.current) resolve(null, true);
          }}
        />
      )}
    </div>
  );
}
