import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { twMerge } from 'tailwind-merge';
import { fileKindFor } from './fileKind';
import { Icon } from './Icon';
import { sanitizeNoteHtml } from './sanitizeHtml';
import type { Attachment } from './types';

/** Drag payload used to drop an attachment into a note as a mention chip. */
export const ATTACHMENT_MIME = 'application/x-attachment';

export interface RichTextHandle {
  getHtml: () => string;
  clear: () => void;
  focus: () => void;
  isEmpty: () => boolean;
}

interface Props {
  initialHtml?: string;
  placeholder?: string;
  minHeightClass?: string;
  maxLength?: number;
  attachments: Attachment[];
  onOpenMention?: (name: string) => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
  /** Resolve a URL for the toolbar's link button; return null to cancel. When
   *  omitted the link button is hidden (e.g. the tray has no modal window). */
  onRequestLink?: () => Promise<string | null>;
  /** Escape pressed with no mention popup open (used by the tray to dismiss). */
  onEscape?: () => void;
  /** When true (default) the toolbar is a fixed popover above the editor (needed
   *  inside scroll containers). When false it docks in the editor's flow — no
   *  popup — for surfaces like the tray mini bar. */
  floatingToolbar?: boolean;
  /** Extra classes for the docked toolbar (twMerge'd) so each caller styles it. */
  toolbarClassName?: string;
  /** Overrides the wrapper's box chrome (border, rounding, background, focus
   *  ring). Pass '' for a flat, chromeless surface like the tray mini bar; omit
   *  to keep the default inset-field look. */
  wrapperClassName?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

function placeCaretEnd(el: HTMLElement) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}

/** The `.att-chip` mention that `node` sits inside, if any. */
const chipOf = (node: Node | null): HTMLElement | null => {
  const el =
    node &&
    (node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement);
  return (el?.closest?.('.att-chip') as HTMLElement | null) ?? null;
};

const isChip = (n: Node | null): n is HTMLElement =>
  !!n &&
  n.nodeType === Node.ELEMENT_NODE &&
  (n as HTMLElement).classList.contains('att-chip');

/** Node immediately before a collapsed caret, or null when a character precedes it. */
const nodeBeforeCaret = (range: Range): Node | null => {
  const { startContainer: c, startOffset: o } = range;
  if (c.nodeType === Node.TEXT_NODE) return o > 0 ? null : c.previousSibling;
  return o > 0 ? (c.childNodes[o - 1] ?? null) : null;
};

/** Node immediately after a collapsed caret, or null when a character follows it. */
const nodeAfterCaret = (range: Range): Node | null => {
  const { startContainer: c, startOffset: o } = range;
  if (c.nodeType === Node.TEXT_NODE)
    return o < (c.textContent?.length ?? 0) ? null : c.nextSibling;
  return c.childNodes[o] ?? null;
};

const anchorOf = (node: Node | null): HTMLElement | null => {
  const el =
    node &&
    (node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement);
  return (el?.closest?.('a') as HTMLElement | null) ?? null;
};

// Bare domains are linkified only for these TLDs so filenames typed into a note
// (notes.md, app.py, report.pdf) are never mistaken for links.
const COMMON_TLD =
  /\.(com|org|net|io|dev|app|co|ai|edu|gov|me|xyz|gg|so|sh|tech|info|design)$/i;

/** Resolve a just-typed word to an href if it reads as a URL, else null. */
const urlHref = (token: string): string | null => {
  if (/^https?:\/\/\S{3,}$/i.test(token)) return token;
  if (/^www\.[^\s.]+\.\S{2,}$/i.test(token)) return `https://${token}`;
  const host = token.split(/[/?#]/)[0];
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) && COMMON_TLD.test(host))
    return `https://${token}`;
  return null;
};

export const RichTextEditor = forwardRef<RichTextHandle, Props>(
  function RichTextEditor(
    {
      initialHtml = '',
      placeholder,
      minHeightClass = 'min-h-24',
      maxLength = 2000,
      attachments,
      onOpenMention,
      onBlur,
      onSubmit,
      autoFocus,
      onRequestLink,
      onEscape,
      floatingToolbar = true,
      toolbarClassName,
      wrapperClassName,
    },
    ref
  ) {
    const edRef = useRef<HTMLDivElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const lastHtml = useRef('');
    const savedRange = useRef<Range | null>(null);
    const [showPlaceholder, setShowPlaceholder] = useState(true);
    const [len, setLen] = useState(0);
    const [toolbarShown, setToolbarShown] = useState(false);
    const [toolbarPos, setToolbarPos] = useState({ left: 0, bottom: 0 });
    const [mention, setMention] = useState<{
      query: string;
      top: number;
      left: number;
      index: number;
    } | null>(null);

    const names = attachments.map((a) => a.name);
    const mentionMatches = mention
      ? attachments
          .filter((a) =>
            a.name.toLowerCase().includes(mention.query.toLowerCase())
          )
          .slice(0, 6)
      : [];
    const mentionOpen = mention !== null && mentionMatches.length > 0;
    const mentionIdx = mention
      ? Math.min(mention.index, Math.max(0, mentionMatches.length - 1))
      : 0;

    // Zero-width spaces are never meaningful note content (WebKit editing artifacts
    // or pasted text) — ignore them when measuring the editor.
    const plainText = (el: HTMLElement) =>
      (el.textContent ?? '').replace(/\u200B/g, '');

    // Bare line breaks are never content: the sanitizer strips trailing <br>s on
    // save, so any number of them (with no text and no chips) is empty — matching
    // that keeps the editor clearable no matter how many Shift+Enters are left.
    const isEmpty = (el: HTMLElement): boolean =>
      !el.querySelector('.att-chip') && plainText(el).trim() === '';

    // Placeholder visibility is stricter than isEmpty: it hides the moment the
    // editor shows a blank line. A single <br> is WebKit's bogus break (left in
    // an emptied contenteditable) and renders nothing; two or more are a real,
    // visible blank line — so a Shift+Enter steps the placeholder aside even
    // though the note is still "empty" and clearable. An empty list still paints
    // a bullet/number, so a present <ul>/<ol> hides the placeholder as well.
    const placeholderVisible = (el: HTMLElement): boolean =>
      isEmpty(el) &&
      el.querySelectorAll('br').length <= 1 &&
      !el.querySelector('ul, ol');

    const sync = () => {
      const el = edRef.current;
      if (!el) return;
      setShowPlaceholder(placeholderVisible(el));
      setLen(plainText(el).length);
    };

    // Seed the editable region exactly once — re-rendering its HTML would jump the
    // caret. The parent remounts (via key) when it wants fresh content shown.
    useEffect(() => {
      const el = edRef.current;
      if (!el) return;
      el.innerHTML = sanitizeNoteHtml(initialHtml, names);
      lastHtml.current = el.innerHTML;
      sync();
      if (autoFocus) el.focus();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Mention chips are atomic: never let a collapsed caret rest *inside* one
    // (WebKit otherwise lets you type into a `contenteditable="false"` span).
    // Nudge it to whichever edge is nearer so the chip text can't be edited.
    useEffect(() => {
      const onSelectionChange = () => {
        const el = edRef.current;
        const sel = window.getSelection();
        if (!el || !sel || !sel.isCollapsed || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return;
        const chip = chipOf(range.startContainer);
        if (!chip) return;
        let before = true;
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          const len = range.startContainer.textContent?.length ?? 0;
          before = range.startOffset * 2 <= len;
        }
        const r = document.createRange();
        if (before) r.setStartBefore(chip);
        else r.setStartAfter(chip);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      };
      document.addEventListener('selectionchange', onSelectionChange);
      return () =>
        document.removeEventListener('selectionchange', onSelectionChange);
    }, []);

    // The toolbar is position:fixed so the inspector's scroll container can't clip
    // it above the editor. Fixed coords are viewport-relative, so recompute them
    // from the wrapper on every scroll/resize while the editor is focused.
    useEffect(() => {
      if (!floatingToolbar || !toolbarShown) return;
      const place = () => {
        const el = wrapRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setToolbarPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
      };
      place();
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      return () => {
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
      };
    }, [floatingToolbar, toolbarShown]);

    useImperativeHandle(ref, () => ({
      getHtml: () => sanitizeNoteHtml(edRef.current?.innerHTML ?? '', names),
      clear: () => {
        const el = edRef.current;
        if (!el) return;
        el.innerHTML = '';
        lastHtml.current = '';
        sync();
      },
      focus: () => edRef.current?.focus(),
      isEmpty: () => !edRef.current || isEmpty(edRef.current),
    }));

    const handleInput = () => {
      const el = edRef.current;
      if (!el) return;
      if (plainText(el).length > maxLength) {
        el.innerHTML = lastHtml.current; // revert the edit that broke the cap
        placeCaretEnd(el);
      } else {
        lastHtml.current = el.innerHTML;
      }
      sync();
    };

    const exec = (cmd: string) => {
      edRef.current?.focus();
      document.execCommand(cmd);
      handleInput();
    };

    // Insert a line break at the caret by hand rather than let WebKit handle Enter:
    // its native break is a bogus/block node the sanitizer unwraps (only <br> is
    // whitelisted), and a lone trailing <br> won't render its empty line — so at
    // the end of the content we insert <br><br> with the caret between the pair, and
    // strip the extra trailing <br> on save.
    const insertLineBreak = () => {
      const el = edRef.current;
      const sel = window.getSelection();
      if (!el || !sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return;
      range.deleteContents();
      const br = document.createElement('br');
      range.insertNode(br);

      // insertNode at the end of a text node leaves an empty text node after the
      // <br>. That stray node broke the first Enter: it read as "content follows",
      // so no trailing <br> was added and the caret stayed on the old line. Drop it.
      while (
        br.nextSibling &&
        br.nextSibling.nodeType === Node.TEXT_NODE &&
        (br.nextSibling.textContent ?? '').length === 0
      ) {
        br.nextSibling.remove();
      }

      // Nothing after the break: add a trailing <br> so the new (empty) line
      // renders; the caret sits between the pair.
      if (!br.nextSibling) br.after(document.createElement('br'));

      const caret = document.createRange();
      caret.setStartAfter(br);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
      handleInput();
    };

    const addLink = async () => {
      const el = edRef.current;
      if (!el || !onRequestLink) return;
      const sel = window.getSelection();
      savedRange.current =
        sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      // The host resolves the URL (a native modal in the main app); either that
      // flow or an app switch drops focus, so the caret range is restored below.
      const url = (await onRequestLink())?.trim();
      if (!url) return;
      el.focus();
      const s = window.getSelection();
      if (savedRange.current && s) {
        s.removeAllRanges();
        s.addRange(savedRange.current);
      }
      if (!s || s.isCollapsed) {
        document.execCommand(
          'insertHTML',
          false,
          `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>&nbsp;`
        );
      } else {
        document.execCommand('createLink', false, url);
      }
      handleInput();
    };

    const insertChip = (name: string) => {
      const el = edRef.current;
      if (!el) return;
      el.focus();
      document.execCommand(
        'insertHTML',
        false,
        `<span data-att="${escapeAttr(name)}" class="att-chip" contenteditable="false">@${escapeHtml(name)}</span>&nbsp;`
      );
      handleInput();
    };

    // If the word just before the caret reads as a URL, wrap it in a link (via
    // execCommand so it stays undoable) and park the caret past the anchor.
    // Returns true when a link was created.
    const linkifyBeforeCaret = (): boolean => {
      const el = edRef.current;
      const sel = window.getSelection();
      if (!el || !sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return false;
      const parent = node.parentElement;
      if (!parent || parent.closest('a') || parent.closest('.att-chip'))
        return false;
      const offset = range.startOffset;
      const m = (node.textContent ?? '').slice(0, offset).match(/(\S+)$/);
      if (!m) return false;
      const href = urlHref(m[1]);
      if (!href) return false;

      const tokenRange = document.createRange();
      tokenRange.setStart(node, offset - m[1].length);
      tokenRange.setEnd(node, offset);
      sel.removeAllRanges();
      sel.addRange(tokenRange);
      document.execCommand('createLink', false, href);

      const after = window.getSelection();
      const anchor =
        after && after.anchorNode ? anchorOf(after.anchorNode) : null;
      if (after && anchor) {
        const r = document.createRange();
        r.setStartAfter(anchor);
        r.collapse(true);
        after.removeAllRanges();
        after.addRange(r);
      } else if (after && after.rangeCount) {
        const r = after.getRangeAt(0);
        r.collapse(false);
        after.removeAllRanges();
        after.addRange(r);
      }
      return true;
    };

    // Markdown-style list shortcut: a lone `-`/`*` (unordered) or `N.` (ordered)
    // marker at the very start of a line, followed by the space that triggers
    // this, is dropped and the matching list toggled on. execCommand keeps both
    // steps on the native undo stack. Returns true when it fired.
    const listifyBeforeCaret = (): boolean => {
      const el = edRef.current;
      const sel = window.getSelection();
      if (!el || !sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return false;
      const parent = node.parentElement;
      if (!parent || parent.closest('ul, ol, a, .att-chip')) return false;
      // Only at a line's start: nothing precedes this text node on the line
      // (start of the editor, or immediately after a <br>).
      const prev = node.previousSibling;
      if (
        prev &&
        !(prev.nodeType === Node.ELEMENT_NODE && (prev as Element).tagName === 'BR')
      )
        return false;
      const before = (node.textContent ?? '').slice(0, range.startOffset);
      const ordered = /^\d+\.$/.test(before);
      if (!ordered && before !== '-' && before !== '*') return false;

      const marker = document.createRange();
      marker.setStart(node, 0);
      marker.setEnd(node, range.startOffset);
      sel.removeAllRanges();
      sel.addRange(marker);
      document.execCommand('delete');
      document.execCommand(
        ordered ? 'insertOrderedList' : 'insertUnorderedList'
      );
      return true;
    };

    // Detect an `@query` immediately before the caret and, if present, open the
    // attachment autocomplete anchored at the caret.
    const detectMention = () => {
      const el = edRef.current;
      const sel = window.getSelection();
      if (!el || !sel || !sel.isCollapsed || sel.rangeCount === 0)
        return setMention(null);
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE || !el.contains(node))
        return setMention(null);
      if ((node.parentElement as HTMLElement | null)?.closest('.att-chip'))
        return setMention(null);
      const before = (node.textContent ?? '').slice(0, range.startOffset);
      const m = before.match(/@([^@\s]*)$/);
      if (!m) return setMention(null);
      let rect = range.getBoundingClientRect();
      if (rect.top === 0 && rect.left === 0) rect = el.getBoundingClientRect();
      const query = m[1];
      setMention((prev) => ({
        query,
        top: rect.bottom,
        left: rect.left,
        index: prev && prev.query === query ? prev.index : 0,
      }));
    };

    const pickMention = (att: Attachment) => {
      const sel = window.getSelection();
      if (att && sel && sel.rangeCount && mention) {
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) {
          const del = document.createRange();
          del.setStart(
            node,
            Math.max(0, range.startOffset - (mention.query.length + 1))
          );
          del.setEnd(node, range.startOffset);
          del.deleteContents();
          sel.removeAllRanges();
          sel.addRange(del);
        }
      }
      setMention(null);
      if (att) insertChip(att.name);
    };

    // Shared toolbar content; the wrapper differs by `toolbar` mode.
    const toolbarInner = (
      <>
        <ToolButton
          cmd="bold"
          icon="format_bold"
          title="Bold  ⌘B"
          onExec={exec}
        />
        <ToolButton
          cmd="italic"
          icon="format_italic"
          title="Italic  ⌘I"
          onExec={exec}
        />
        <ToolButton
          cmd="underline"
          icon="format_underlined"
          title="Underline  ⌘U"
          onExec={exec}
        />
        <ToolButton
          cmd="strikeThrough"
          icon="strikethrough_s"
          title="Strikethrough  ⌘⇧S"
          onExec={exec}
        />
        <span className="bg-edge-1l dark:bg-edge-1d mx-1 h-4 w-px" />
        <ToolButton
          cmd="insertUnorderedList"
          icon="format_list_bulleted"
          title="Bulleted list"
          onExec={exec}
        />
        <ToolButton
          cmd="insertOrderedList"
          icon="format_list_numbered"
          title="Numbered list"
          onExec={exec}
        />
        {onRequestLink && (
          <>
            <span className="bg-edge-1l dark:bg-edge-1d mx-1 h-4 w-px" />
            <button
              type="button"
              title="Add link"
              onMouseDown={(e) => {
                e.preventDefault();
                addLink();
              }}
              className="rounded-field text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 place-items-center transition-colors"
            >
              <Icon name="link" size={16} weight={400} />
            </button>
          </>
        )}
        <span
          className={
            floatingToolbar
              ? 'bg-edge-1l dark:bg-edge-1d mx-1 h-4 w-px'
              : 'bg-edge-1l dark:bg-edge-1d ml-auto mr-1 h-4 w-px'
          }
        />
        <span
          className={`px-0.5 text-[10.5px] tabular-nums ${
            len > maxLength * 0.9
              ? 'text-danger-500l dark:text-danger-500d'
              : 'text-content-3l dark:text-content-3d'
          }`}
        >
          {len}/{maxLength}
        </span>
      </>
    );

    return (
      <div
        ref={wrapRef}
        className={
          wrapperClassName === undefined
            ? 'group rounded-control border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d focus-within:border-accent-500l dark:focus-within:border-accent-500d focus-within:ring-accent-500l dark:focus-within:ring-accent-500d relative border transition-colors focus-within:ring'
            : twMerge('group relative', wrapperClassName)
        }
      >
        {/* Floating controls: position:fixed (coords from the wrapper) so a
          scroll container can't clip them above the box, and showing/hiding them
          never relayouts the note content. */}
        {floatingToolbar && (
          <div
            style={{ left: toolbarPos.left, bottom: toolbarPos.bottom }}
            className={`z-popover rounded-control border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d shadow-menu fixed flex origin-bottom items-center gap-0.5 border px-1.5 py-1 transition-[opacity,transform] duration-75 ${
              toolbarShown
                ? 'pointer-events-auto scale-100 opacity-100'
                : 'pointer-events-none scale-95 opacity-0'
            }`}
          >
            {toolbarInner}
          </div>
        )}

        {showPlaceholder && placeholder && (
          <span className="text-content-3l dark:text-content-3d pointer-events-none absolute py-2.5 px-3 text-[13.5px]">
            {placeholder}
          </span>
        )}
        <div
          ref={edRef}
          contentEditable
          suppressContentEditableWarning
          onInput={() => {
            handleInput();
            detectMention();
          }}
          onFocus={() => setToolbarShown(true)}
          onBlur={() => {
            setToolbarShown(false);
            setMention(null);
            onBlur?.();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Formatting shortcuts. preventDefault stops WebKit's own bold/italic/
            // underline so the command isn't applied twice.
            if (e.metaKey || e.ctrlKey) {
              const key = e.key.toLowerCase();
              if (!e.shiftKey && (key === 'b' || key === 'i' || key === 'u')) {
                e.preventDefault();
                exec(
                  key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline'
                );
                return;
              }
              if (e.shiftKey && key === 's') {
                e.preventDefault();
                exec('strikeThrough');
                return;
              }
            }
            if (mentionOpen) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMention((m) =>
                  m
                    ? { ...m, index: (mentionIdx + 1) % mentionMatches.length }
                    : m
                );
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMention((m) =>
                  m
                    ? {
                        ...m,
                        index:
                          (mentionIdx - 1 + mentionMatches.length) %
                          mentionMatches.length,
                      }
                    : m
                );
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pickMention(mentionMatches[mentionIdx]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
            if (e.key === 'Escape' && onEscape) {
              e.preventDefault();
              onEscape();
              return;
            }
            if (e.key === 'Enter') {
              // Plain Enter submits when the parent wants a submit action (the
              // add-note editor). Every other Enter — Shift+Enter, or plain Enter
              // in a saved note — inserts a line break.
              if (!e.shiftKey && onSubmit) {
                e.preventDefault();
                onSubmit();
                return;
              }
              e.preventDefault();
              insertLineBreak();
              return;
            }
            if (e.key === 'Backspace' || e.key === 'Delete') {
              const el = edRef.current;
              const sel = window.getSelection();
              if (el && sel && sel.isCollapsed && sel.rangeCount) {
                const range = sel.getRangeAt(0);
                let chip = chipOf(range.startContainer);
                if (!chip) {
                  const adj =
                    e.key === 'Backspace'
                      ? nodeBeforeCaret(range)
                      : nodeAfterCaret(range);
                  if (isChip(adj)) chip = adj;
                }
                if (chip && el.contains(chip) && chip.parentNode) {
                  e.preventDefault();
                  const parent = chip.parentNode;
                  const idx = Array.prototype.indexOf.call(
                    parent.childNodes,
                    chip
                  );
                  chip.remove();
                  const r = document.createRange();
                  r.setStart(parent, idx);
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                  handleInput();
                  return;
                }
              }
            }
            if (e.key === ' ' && !e.shiftKey && !mentionOpen) {
              // The marker becomes a list, so the triggering space is consumed.
              if (listifyBeforeCaret()) {
                e.preventDefault();
                handleInput();
                return;
              }
              // A linkified word keeps its trailing space.
              if (linkifyBeforeCaret()) {
                e.preventDefault();
                document.execCommand('insertText', false, ' ');
                handleInput();
              }
            }
          }}
          onKeyUp={detectMention}
          onMouseUp={detectMention}
          onClick={(e) => {
            const chip = (e.target as HTMLElement).closest('.att-chip');
            if (chip) {
              e.preventDefault();
              onOpenMention?.(chip.getAttribute('data-att') ?? '');
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(ATTACHMENT_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            const name = e.dataTransfer.getData(ATTACHMENT_MIME);
            if (!name) return;
            e.preventDefault();
            const r = (
              document as {
                caretRangeFromPoint?: (x: number, y: number) => Range | null;
              }
            ).caretRangeFromPoint?.(e.clientX, e.clientY);
            const s = window.getSelection();
            if (r && s) {
              s.removeAllRanges();
              s.addRange(r);
            }
            insertChip(name);
          }}
          className={`note-rt ${minHeightClass} text-content-1l dark:text-content-1d w-full overflow-x-hidden overflow-y-auto px-3 py-2.5 text-[13.5px] leading-5 wrap-anywhere outline-none`}
        />

        {/* Docked controls for surfaces without a scroll container; the caller
          supplies the appearance via toolbarClassName. */}
        {!floatingToolbar && (
          <div
            className={twMerge(
              'flex flex-wrap items-center gap-0.5',
              toolbarClassName
            )}
          >
            {toolbarInner}
          </div>
        )}

        {mentionOpen && (
          <div
            className="z-tooltip rounded-control border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d shadow-menu fixed max-h-56 w-60 overflow-y-auto border py-1"
            style={{ top: mention!.top + 4, left: mention!.left }}
          >
            {mentionMatches.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(a);
                }}
                onMouseEnter={() =>
                  setMention((m) => (m ? { ...m, index: i } : m))
                }
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] ${
                  i === mentionIdx
                    ? 'bg-selection-1l dark:bg-selection-1d text-content-1l dark:text-content-1d'
                    : 'text-content-2l dark:text-content-2d'
                }`}
              >
                <Icon
                  name={fileKindFor(a.name, a.location).icon}
                  size={15}
                  weight={300}
                  className="text-content-3l dark:text-content-3d shrink-0"
                />
                <span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);

function ToolButton({
  cmd,
  icon,
  title,
  onExec,
}: {
  cmd: string;
  icon: string;
  title: string;
  onExec: (cmd: string) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onExec(cmd);
      }}
      className="rounded-field text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 place-items-center transition-colors"
    >
      <Icon name={icon} size={16} weight={400} />
    </button>
  );
}
