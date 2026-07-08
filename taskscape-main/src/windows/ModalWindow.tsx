import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import { Icon } from "../components/Icon";
import type { ModalButton, ModalProps, ModalResult } from "../lib/modal";
import { suggestName } from "../lib/nameSuggest";

const WIDTH = 340;

const BTN =
  "h-7 rounded-md px-3.5 text-[12px] font-semibold tracking-[0.02em] transition duration-150";
const BTN_VARIANT: Record<NonNullable<ModalButton["variant"]>, string> = {
  ghost: "border border-hairline text-ink hover:bg-wash-strong",
  primary: "bg-ink text-content hover:opacity-90 active:scale-[0.98]",
  danger: "bg-danger text-on-accent hover:bg-danger-hover",
};

// The global reduced-motion rule zeroes animation durations, which would make
// the drain's animationend fire instantly — skip auto-dismiss entirely instead.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One reusable panel window serves every modal (it is hidden, never
 *  destroyed): fetch the pending modal on load and again on each re-present. */
export function ModalWindow() {
  const [current, setCurrent] = useState<{ id: string; props: ModalProps } | null>(null);

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
    const un = listen("modal-refresh", fetch);
    return () => {
      stale = true;
      un.then((fn) => fn());
    };
  }, []);

  if (!current) return <div className="h-screen w-screen bg-raised" />;
  return <ModalContent key={current.id} id={current.id} props={current.props} />;
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
      ? (props.input.initialValue ?? (props.input.suggest ? suggestName() : ""))
      : "",
  );
  // Mirror the committed initial state. Never assign this ref inside the
  // useState initializer: StrictMode double-invokes initializers, so a second
  // (unshown) suggestName() would leak in and the applied name wouldn't match
  // the field.
  const valueRef = useRef(value);

  function resolve(buttonId: string | null, timedOut = false) {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    const trimmed = valueRef.current.trim();
    const value = trimmed ? trimmed + (props.input?.suffix ?? "") : undefined;
    const result: ModalResult = { buttonId, value };
    if (timedOut) result.timedOut = true;
    void api.closeModal(id, result);
  }

  function press(btn: ModalButton, isDefault: boolean) {
    if (isDefault && props.input && !valueRef.current.trim()) {
      inputRef.current?.focus();
      return;
    }
    resolve(btn.id);
  }

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
    setInputValue(suggestName());
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
      if (e.key === "Escape") {
        e.preventDefault();
        resolve(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const last = props.buttons[props.buttons.length - 1];
        if (last) press(last, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <div
      data-tauri-drag-region
      className="relative h-screen w-screen overflow-hidden border border-hairline bg-raised"
      onPointerEnter={() => setDrainPaused(true)}
      onPointerLeave={() => setDrainPaused(false)}
    >
      <style>{"@keyframes modal-in { from { opacity: 0; transform: scale(0.97); } }"}</style>
      <div
        ref={contentRef}
        data-tauri-drag-region
        className="w-full p-5"
        style={
          presented
            ? { animation: "modal-in 180ms cubic-bezier(0.2, 0, 0, 1) both" }
            : { opacity: 0 }
        }
      >
        <div data-tauri-drag-region className="flex items-center gap-2.5">
          {props.icon && (
            <Icon
              name={props.icon}
              size={20}
              className={props.tone === "danger" ? "text-danger" : "text-accent"}
            />
          )}
          <h1
            data-tauri-drag-region
            className="font-display text-[15px] leading-5 font-semibold text-ink"
          >
            {props.title}
          </h1>
        </div>

        {props.message && (
          <p className="mt-2 text-[13px] leading-4.75 font-[450] text-ink-2">{props.message}</p>
        )}

        {props.input && (
          <div className="mt-3">
            {props.input.label && (
              <label
                htmlFor="modal-input"
                className="mb-1.5 block text-[12px] font-medium text-ink-2"
              >
                {props.input.label}
              </label>
            )}
            <div className="relative">
              {props.input.suffix ? (
                // Locked-extension field: the name grows to fit and the greyed
                // extension stays glued to its right; `.` is stripped as typed.
                <div className="flex h-8 w-full items-center overflow-hidden rounded-md bg-recessed px-2.5 text-[13px] focus-within:ring-2 focus-within:ring-focus">
                  <span className="relative inline-flex min-w-[1ch] max-w-full flex-none">
                    <span aria-hidden className="invisible overflow-hidden whitespace-pre">
                      {value || props.input.placeholder || "​"}
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
                        if (e.key === ".") e.preventDefault();
                      }}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (!text.includes(".")) return;
                        e.preventDefault();
                        const el = e.currentTarget;
                        const start = el.selectionStart ?? el.value.length;
                        const end = el.selectionEnd ?? el.value.length;
                        setInputValue(
                          el.value.slice(0, start) + text.replace(/\./g, "") + el.value.slice(end),
                        );
                      }}
                      onFocus={(e) => {
                        cancelDrain();
                        if (props.input?.initialValue) e.currentTarget.select();
                      }}
                      className="absolute inset-0 w-full bg-transparent text-[13px] text-ink placeholder:text-ink-3 outline-none"
                    />
                  </span>
                  <span className="flex-none whitespace-pre text-ink-3 select-none">
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
                    if (props.input?.initialValue) e.currentTarget.select();
                  }}
                  className={`h-8 w-full rounded-md bg-recessed pl-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:ring-2 focus:ring-focus ${
                    props.input.suggest ? "pr-8" : "pr-2.5"
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
                  className="absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-ink-3 transition duration-150 hover:bg-wash-strong hover:text-ink"
                >
                  <Icon name="casino" size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {props.buttons.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => press(b, i === props.buttons.length - 1)}
              className={`${BTN} ${BTN_VARIANT[b.variant ?? "ghost"]}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {props.timeoutMs != null && !reducedMotion && (
        <div
          className="pointer-events-none absolute inset-x-5 bottom-0 h-0.5 origin-left bg-accent transition-opacity duration-200"
          style={{
            animation: presented ? `drain ${props.timeoutMs}ms linear forwards` : "none",
            animationPlayState: drainPaused || drainCancelled ? "paused" : "running",
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
