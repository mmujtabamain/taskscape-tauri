import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { twMerge } from 'tailwind-merge';
import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount } from '@tiptap/extension-character-count';
import { Placeholder } from '@tiptap/extensions';
import { fileKindFor } from './fileKind';
import { Icon } from './Icon';
import { sanitizeNoteHtml } from './sanitizeHtml';
import type { Attachment } from './types';
import { ATTACHMENT_MIME } from './attachmentMime';

export { ATTACHMENT_MIME };

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
  /** Caps the editor content's height (it already scrolls); the docked toolbar
   *  stays put below it. Used by the tray so a long note scrolls in place. */
  maxHeightClass?: string;
  maxLength?: number;
  attachments: Attachment[];
  onOpenMention?: (name: string) => void;
  /** Fired on every content change — the caller debounces this into autosave. */
  onChange?: () => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  /** When set, only Cmd/Ctrl+Enter fires `onSubmit`; plain Enter inserts a line
   *  so the editor stays multi-line (the tray's notes). Default: plain Enter
   *  submits (the main app's add-note field). */
  submitOnModEnter?: boolean;
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

export type RichTextEditorProps = Props;

// Bare domains are auto-linked only for these TLDs so filenames typed into a note
// (notes.md, app.py, report.pdf) are never mistaken for links. Explicit links go
// through the toolbar's link button, which accepts any URL.
const COMMON_TLD =
  /\.(com|org|net|io|dev|app|co|ai|edu|gov|me|xyz|gg|so|sh|tech|info|design)$/i;

/** Gate Tiptap's autolink to the curated TLD set (linkify always hands us a URL
 *  carrying a protocol, so we test the host). */
const shouldAutoLinkUrl = (url: string): boolean => {
  try {
    return COMMON_TLD.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** An attachment mention — an atomic inline chip that serializes to the exact
 *  shape the sanitizer/store expect: `<span data-att="name" class="att-chip"
 *  contenteditable="false">@name</span>`. As a ProseMirror atom it can't be typed
 *  into and deletes as a single unit, which is why the old manual caret-nudging
 *  and chip-deletion code is gone. */
const AttachmentMention = Node.create({
  name: 'attachmentMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-att') ?? '',
        renderHTML: (attrs) => ({ 'data-att': attrs.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-att]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'att-chip',
        contenteditable: 'false',
      }),
      `@${node.attrs.name}`,
    ];
  },
});

/** Empty means: no mention chips and no non-whitespace text. Mirrors the old
 *  contenteditable notion of empty (trailing <br>s / spaces don't count). */
const isEditorEmpty = (ed: Editor): boolean => {
  let hasChip = false;
  ed.state.doc.descendants((node) => {
    if (node.type.name === AttachmentMention.name) {
      hasChip = true;
      return false;
    }
    return !hasChip;
  });
  return !hasChip && ed.getText().trim() === '';
};

export const RichTextEditor = forwardRef<RichTextHandle, Props>(
  function RichTextEditor(
    {
      initialHtml = '',
      placeholder,
      minHeightClass = 'min-h-24',
      maxHeightClass,
      maxLength = 2000,
      attachments,
      onOpenMention,
      onChange,
      onBlur,
      onSubmit,
      submitOnModEnter = false,
      autoFocus,
      onRequestLink,
      onEscape,
      floatingToolbar = true,
      toolbarClassName,
      wrapperClassName,
    },
    ref
  ) {
    const wrapRef = useRef<HTMLDivElement>(null);
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

    // Latest closures for the ProseMirror-level handlers, which are bound once at
    // editor creation and would otherwise capture stale state/props.
    const cb = useRef({
      onSubmit,
      submitOnModEnter,
      onEscape,
      onOpenMention,
      onChange,
      mentionOpen,
      refresh: (_ed: Editor) => {},
      moveMention: (_d: number) => {},
      pickCurrent: () => {},
      closeMention: () => {},
    });

    // Detect an `@query` immediately before the caret and, if present, open the
    // attachment autocomplete anchored at the caret.
    const refreshMention = (ed: Editor) => {
      const { selection } = ed.state;
      if (!selection.empty || attachments.length === 0)
        return setMention(null);
      const $from = selection.$from;
      // Represent inline atoms (mention chips) as a space so they act as a token
      // boundary — an `@…` run never spans across a chip.
      const before = $from.parent.textBetween(
        0,
        $from.parentOffset,
        undefined,
        ' '
      );
      const m = before.match(/@([^@\s]*)$/);
      if (!m) return setMention(null);
      const coords = ed.view.coordsAtPos(selection.from);
      const query = m[1];
      setMention((prev) => ({
        query,
        top: coords.bottom,
        left: coords.left,
        index: prev && prev.query === query ? prev.index : 0,
      }));
    };

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Only the sanitizer's formatting whitelist — drop block/code nodes the
          // note store would strip on save (heading/code/quote/hr/inline-code) and
          // the trailing-paragraph helper (it would persist an empty <p>).
          heading: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
          code: false,
          trailingNode: false,
          link: {
            openOnClick: false,
            autolink: true,
            linkOnPaste: true,
            defaultProtocol: 'https',
            shouldAutoLink: shouldAutoLinkUrl,
          },
        }),
        CharacterCount.configure({ limit: maxLength }),
        // Rendered as the empty paragraph's ::before (styled in note-rt.css), so
        // the caret sits to its left instead of overlapping an absolute overlay.
        Placeholder.configure({ placeholder: placeholder ?? '' }),
        AttachmentMention,
      ],
      content: sanitizeNoteHtml(initialHtml, names),
      autofocus: autoFocus ? 'end' : false,
      // Both apps mount under React.StrictMode (React 19) — render on the next
      // tick instead of during render to avoid Tiptap's flushSync warning.
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: twMerge(
            'note-rt text-content-1l dark:text-content-1d w-full overflow-x-hidden overflow-y-auto px-3 py-2.5 text-[13.5px] leading-5 wrap-anywhere outline-none',
            minHeightClass,
            maxHeightClass
          ),
        },
        handleKeyDown: (_view, event) => {
          if (event.isComposing) return false;
          const c = cb.current;
          if (c.mentionOpen) {
            if (event.key === 'ArrowDown') {
              c.moveMention(1);
              return true;
            }
            if (event.key === 'ArrowUp') {
              c.moveMention(-1);
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              c.pickCurrent();
              return true;
            }
            if (event.key === 'Escape') {
              c.closeMention();
              return true;
            }
          }
          if (event.key === 'Escape' && c.onEscape) {
            c.onEscape();
            return true;
          }
          // Enter submits when the parent wants it: plain Enter by default
          // (add-note), or only Cmd/Ctrl+Enter when `submitOnModEnter` is set
          // (the tray, so plain Enter adds a line to a multi-line note). Anything
          // that doesn't submit falls through to ProseMirror (Shift+Enter → line
          // break, plain Enter → new paragraph / split list item).
          if (event.key === 'Enter' && c.onSubmit) {
            const mod = event.metaKey || event.ctrlKey;
            if (c.submitOnModEnter ? mod : !event.shiftKey) {
              c.onSubmit();
              return true;
            }
          }
          return false;
        },
        handleClickOn: (_view, _pos, node) => {
          if (node.type.name === AttachmentMention.name) {
            cb.current.onOpenMention?.(node.attrs.name);
            return true;
          }
          return false;
        },
        handleDrop: (view, event) => {
          const name = (event as DragEvent).dataTransfer?.getData(
            ATTACHMENT_MIME
          );
          if (!name) return false;
          event.preventDefault();
          const at = view.posAtCoords({
            left: (event as DragEvent).clientX,
            top: (event as DragEvent).clientY,
          });
          const pos = at ? at.pos : view.state.selection.from;
          editor
            ?.chain()
            .focus()
            .insertContentAt(pos, [
              { type: AttachmentMention.name, attrs: { name } },
              { type: 'text', text: ' ' },
            ])
            .run();
          return true;
        },
        handleDOMEvents: {
          dragover: (_view, event) => {
            if (
              (event as DragEvent).dataTransfer?.types.includes(ATTACHMENT_MIME)
            )
              event.preventDefault();
            return false;
          },
        },
      },
      onUpdate: ({ editor: ed }) => {
        cb.current.refresh(ed);
        cb.current.onChange?.();
      },
      onSelectionUpdate: ({ editor: ed }) => cb.current.refresh(ed),
      onFocus: () => setToolbarShown(true),
      onBlur: () => {
        setToolbarShown(false);
        setMention(null);
        onBlur?.();
      },
    });

    const pickMention = (att: Attachment | undefined) => {
      if (att && editor && mention) {
        const to = editor.state.selection.from;
        const from = to - (mention.query.length + 1); // include the '@'
        editor
          .chain()
          .focus()
          .deleteRange({ from, to })
          .insertContent([
            { type: AttachmentMention.name, attrs: { name: att.name } },
            { type: 'text', text: ' ' },
          ])
          .run();
      }
      setMention(null);
    };

    // Keep the handler ref current every render.
    useEffect(() => {
      cb.current = {
        onSubmit,
        submitOnModEnter,
        onEscape,
        onOpenMention,
        onChange,
        mentionOpen,
        refresh: refreshMention,
        moveMention: (d) =>
          setMention((m) =>
            m
              ? {
                  ...m,
                  index:
                    (mentionIdx + d + mentionMatches.length) %
                    mentionMatches.length,
                }
              : m
          ),
        pickCurrent: () => pickMention(mentionMatches[mentionIdx]),
        closeMention: () => setMention(null),
      };
    });

    // The floating toolbar is position:fixed so a scroll container can't clip it
    // above the box; recompute its coords from the wrapper on scroll/resize.
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

    useImperativeHandle(
      ref,
      () => ({
        getHtml: () =>
          !editor || isEditorEmpty(editor)
            ? ''
            : sanitizeNoteHtml(editor.getHTML(), names),
        clear: () => editor?.commands.clearContent(true),
        focus: () => editor?.commands.focus(),
        isEmpty: () => !editor || isEditorEmpty(editor),
      }),
      // `names` is captured for getHtml; recompute the handle when it changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [editor, names.join(' ')]
    );

    const st = useEditorState({
      editor,
      selector: ({ editor: ed }) => ({
        chars: ed ? ed.storage.characterCount.characters() : 0,
        bold: ed?.isActive('bold') ?? false,
        italic: ed?.isActive('italic') ?? false,
        underline: ed?.isActive('underline') ?? false,
        strike: ed?.isActive('strike') ?? false,
        bullet: ed?.isActive('bulletList') ?? false,
        ordered: ed?.isActive('orderedList') ?? false,
        link: ed?.isActive('link') ?? false,
      }),
    }) ?? {
      chars: 0,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      bullet: false,
      ordered: false,
      link: false,
    };

    const run = (fn: (chain: ReturnType<Editor['chain']>) => void) => {
      if (!editor) return;
      fn(editor.chain().focus());
    };

    const addLink = async () => {
      if (!editor || !onRequestLink) return;
      const { from, to, empty } = editor.state.selection;
      // The host resolves the URL (a native modal in the main app); that flow or
      // an app switch drops focus, so the selection is restored by position after.
      const url = (await onRequestLink())?.trim();
      if (!url) return;
      if (empty) {
        editor
          .chain()
          .focus()
          .setTextSelection(from)
          .insertContent([
            { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] },
            { type: 'text', text: ' ' },
          ])
          .run();
      } else {
        editor
          .chain()
          .focus()
          .setTextSelection({ from, to })
          .extendMarkRange('link')
          .setLink({ href: url })
          .run();
      }
    };

    // Shared toolbar content; the wrapper differs by `floatingToolbar` mode.
    const toolbarInner = (
      <>
        <ToolButton
          icon="format_bold"
          title="Bold  ⌘B"
          active={st.bold}
          onRun={() => run((c) => c.toggleBold().run())}
        />
        <ToolButton
          icon="format_italic"
          title="Italic  ⌘I"
          active={st.italic}
          onRun={() => run((c) => c.toggleItalic().run())}
        />
        <ToolButton
          icon="format_underlined"
          title="Underline  ⌘U"
          active={st.underline}
          onRun={() => run((c) => c.toggleUnderline().run())}
        />
        <ToolButton
          icon="strikethrough_s"
          title="Strikethrough"
          active={st.strike}
          onRun={() => run((c) => c.toggleStrike().run())}
        />
        <span className="bg-edge-1l dark:bg-edge-1d mx-1 h-4 w-px" />
        <ToolButton
          icon="format_list_bulleted"
          title="Bulleted list"
          active={st.bullet}
          onRun={() => run((c) => c.toggleBulletList().run())}
        />
        <ToolButton
          icon="format_list_numbered"
          title="Numbered list"
          active={st.ordered}
          onRun={() => run((c) => c.toggleOrderedList().run())}
        />
        {onRequestLink && (
          <>
            <span className="bg-edge-1l dark:bg-edge-1d mx-1 h-4 w-px" />
            <ToolButton
              icon="link"
              title="Add link"
              active={st.link}
              onRun={addLink}
            />
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
            st.chars > maxLength * 0.9
              ? 'text-danger-500l dark:text-danger-500d'
              : 'text-content-3l dark:text-content-3d'
          }`}
        >
          {st.chars}/{maxLength}
        </span>
      </>
    );

    return (
      <div
        ref={wrapRef}
        // Keep editor keystrokes from bubbling to host containers (e.g. the tray's
        // window-level Enter/Escape handler) — the editor handles them itself.
        onKeyDown={(e) => e.stopPropagation()}
        className={
          wrapperClassName === undefined
            ? 'group rounded-control border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d focus-within:border-accent-500l dark:focus-within:border-accent-500d focus-within:ring-accent-500l dark:focus-within:ring-accent-500d relative border transition-colors focus-within:ring'
            : twMerge('group relative', wrapperClassName)
        }
      >
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

        <EditorContent editor={editor} />

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
  icon,
  title,
  active,
  onRun,
}: {
  icon: string;
  title: string;
  active?: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onRun();
      }}
      className={`rounded-field grid h-6 w-6 place-items-center transition-colors ${
        active
          ? 'bg-wash-1l dark:bg-wash-1d text-content-1l dark:text-content-1d'
          : 'text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d'
      }`}
    >
      <Icon name={icon} size={16} weight={400} />
    </button>
  );
}
