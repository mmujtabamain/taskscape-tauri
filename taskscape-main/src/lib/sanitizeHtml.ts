// Sanitizer for rich-text note content. Notes are authored in a contenteditable
// and stored as HTML, so every value is scrubbed before it is saved or rendered:
// only a small formatting whitelist survives, links are href-checked, images and
// scripts are dropped entirely, and attachment mentions are normalized to a
// single safe shape (`<span data-att="name">@name</span>`).

const ALLOWED = new Set([
  "P", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "A", "UL", "OL", "LI", "SPAN",
]);
// Whole subtree removed (never just unwrapped) — no images/media/scripts in notes.
const DROP = new Set([
  "SCRIPT", "STYLE", "IMG", "SVG", "IFRAME", "OBJECT", "EMBED", "VIDEO", "AUDIO", "LINK", "META",
  "PICTURE", "SOURCE", "CANVAS", "INPUT", "BUTTON", "FORM",
]);

function stripAttrs(el: Element, keep: string[]) {
  for (const a of Array.from(el.attributes)) {
    if (!keep.includes(a.name)) el.removeAttribute(a.name);
  }
}

function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) {
    el.remove();
    return;
  }
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function isSafeHref(href: string): boolean {
  const h = href.trim().toLowerCase();
  return !(h.startsWith("javascript:") || h.startsWith("data:") || h.startsWith("vbscript:"));
}

function cleanElement(el: Element) {
  // Recurse first (snapshot children — the list mutates as we unwrap/remove).
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) cleanElement(child as Element);
    else if (child.nodeType === Node.COMMENT_NODE) child.parentNode?.removeChild(child);
  }

  const tag = el.tagName;
  if (DROP.has(tag)) {
    el.remove();
    return;
  }
  if (!ALLOWED.has(tag)) {
    unwrap(el);
    return;
  }

  if (tag === "SPAN") {
    const att = el.getAttribute("data-att");
    if (!att) {
      unwrap(el);
      return;
    }
    stripAttrs(el, []);
    el.setAttribute("data-att", att);
    el.setAttribute("class", "att-chip");
    el.setAttribute("contenteditable", "false");
    return;
  }

  if (tag === "A") {
    const href = el.getAttribute("href") ?? "";
    stripAttrs(el, []);
    if (!isSafeHref(href)) {
      unwrap(el);
      return;
    }
    el.setAttribute("href", href);
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noreferrer noopener");
    return;
  }

  stripAttrs(el, []);
}

/** Replace typed `@attachment-name` text with a mention chip, matching against
 *  the task's real attachment names (longest first, so `a.b.png` wins over `a`). */
function linkifyMentions(root: ParentNode, names: string[]) {
  if (names.length === 0) return;
  const ordered = [...names].sort((a, b) => b.length - a.length);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    texts.push(n as Text);
    n = walker.nextNode();
  }
  for (const text of texts) {
    if (!text.parentElement || text.parentElement.closest(".att-chip")) continue;
    let value = text.textContent ?? "";
    const at = value.indexOf("@");
    if (at < 0) continue;
    const name = ordered.find((nm) => value.slice(at + 1).startsWith(nm));
    if (!name) continue;
    const frag = document.createDocumentFragment();
    if (at > 0) frag.append(document.createTextNode(value.slice(0, at)));
    const chip = document.createElement("span");
    chip.setAttribute("data-att", name);
    chip.setAttribute("class", "att-chip");
    chip.setAttribute("contenteditable", "false");
    chip.textContent = `@${name}`;
    frag.append(chip);
    const rest = value.slice(at + 1 + name.length);
    if (rest) frag.append(document.createTextNode(rest));
    text.replaceWith(frag);
  }
}

/** Scrub note HTML to the formatting whitelist and normalize mention chips.
 *  Pass `mentionNames` to also linkify freshly typed `@name` text. */
export function sanitizeNoteHtml(html: string, mentionNames: string[] = []): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const child of Array.from(tpl.content.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) cleanElement(child as Element);
    else if (child.nodeType === Node.COMMENT_NODE) child.parentNode?.removeChild(child);
  }
  if (mentionNames.length) linkifyMentions(tpl.content, mentionNames);
  // Drop trailing line breaks and the zero-width spaces the editor parks the
  // caret in on a fresh line — neither should persist as real content.
  let tail = tpl.content.lastChild;
  while (
    tail &&
    ((tail.nodeType === Node.ELEMENT_NODE && (tail as Element).tagName === "BR") ||
      (tail.nodeType === Node.TEXT_NODE && (tail.textContent ?? "").replace(/\u200B/g, "").trim() === ""))
  ) {
    const prev = tail.previousSibling;
    tail.remove();
    tail = prev;
  }
  return tpl.innerHTML.replace(/\u200B/g, "").trim();
}

/** Rewrite every mention chip pointing at `oldName` to `newName` in note HTML.
 *  Returns the updated HTML, or null when no chip referenced `oldName`. */
export function renameMentionInHtml(html: string, oldName: string, newName: string): string | null {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  let changed = false;
  for (const chip of Array.from(tpl.content.querySelectorAll<HTMLElement>("span.att-chip"))) {
    if (chip.getAttribute("data-att") !== oldName) continue;
    chip.setAttribute("data-att", newName);
    chip.textContent = `@${newName}`;
    changed = true;
  }
  return changed ? tpl.innerHTML.trim() : null;
}

/** Plaintext length of note HTML, for the character-count cap. */
export function noteTextLength(html: string): number {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return (tpl.content.textContent ?? "").length;
}
