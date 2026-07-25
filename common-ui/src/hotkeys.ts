// DOM-event side of the hotkey system. The catalog, persistence and conflict
// rules live in Rust (`common/src/hotkeys.rs`); this module only bridges
// KeyboardEvents to the shared canonical accelerator format:
// "<Mod>+…+<Key>", modifiers in fixed order Cmd, Ctrl, Alt, Shift, keys
// normalized (letters A–Z, digits, named keys, literal punctuation, "Plus" for
// the + key so + stays an unambiguous separator).

/** A catalog entry with its effective combo, as served by `list_hotkeys`. */
export interface HotkeyBinding {
  id: string;
  label: string;
  scope: 'global' | 'main' | 'tray';
  /** Effective accelerator; empty when intentionally unbound. */
  accel: string;
  default: string;
}

/** Collapse the catalog to an `id → accel` lookup (both apps build this). */
export const bindingsToMap = (
  bindings: HotkeyBinding[]
): Record<string, string> =>
  Object.fromEntries(bindings.map((b) => [b.id, b.accel]));

const isMac = navigator.userAgent.includes('Mac');

export type HotkeyModifier = 'cmd' | 'ctrl' | 'alt' | 'shift';

/** An accelerator split into its parts — the structure every renderer works
 *  from, so a shortcut looks the same everywhere it appears. */
export interface Hotkey {
  cmd: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Canonical key token: "K", "5", "Enter", "ArrowUp", ",", "F3", … */
  key: string;
}

// Physical-key codes → canonical key tokens. Matching on `code` (not `key`)
// keeps letter combos stable under Alt, which remaps `key` on macOS (⌥N → "˜").
const CODE_KEYS: Record<string, string> = {
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Space: 'Space',
  Tab: 'Tab',
  Escape: 'Escape',
  Comma: ',',
  Backslash: '\\',
  Slash: '/',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};

function keyFromEvent(e: KeyboardEvent): string | null {
  const mapped = CODE_KEYS[e.code];
  if (mapped) return mapped;
  let m = /^Key([A-Z])$/.exec(e.code);
  if (m) return m[1];
  m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (m) return m[1];
  if (/^F([1-9]|1[0-2])$/.test(e.code)) return e.code;
  return null;
}

/** Split a canonical accelerator into its parts; null when malformed/unbound. */
export function parseAccel(accel: string): Hotkey | null {
  const p: Hotkey = { cmd: false, ctrl: false, alt: false, shift: false, key: '' };
  for (const part of accel.split('+')) {
    if (part === 'Cmd') p.cmd = true;
    else if (part === 'Ctrl') p.ctrl = true;
    else if (part === 'Alt') p.alt = true;
    else if (part === 'Shift') p.shift = true;
    else if (!p.key) p.key = part;
    else return null;
  }
  return p.key ? p : null;
}

/** True when the event is exactly this accelerator (no extra modifiers). */
export function matchesEvent(accel: string, e: KeyboardEvent): boolean {
  if (!accel) return false;
  const p = parseAccel(accel);
  if (!p) return false;
  // "Cmd" is the platform primary modifier: ⌘ on macOS, Ctrl elsewhere (where
  // a separate "Ctrl" token can't be told apart and never matches).
  const cmd = isMac ? e.metaKey : e.ctrlKey;
  const ctrl = isMac ? e.ctrlKey : false;
  return (
    p.cmd === cmd &&
    p.ctrl === ctrl &&
    p.alt === e.altKey &&
    p.shift === e.shiftKey &&
    p.key === keyFromEvent(e)
  );
}

/** Canonical accel for a recorded keydown; null on a bare-modifier press. */
export function eventToAccel(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  const key = keyFromEvent(e);
  if (!key) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Cmd');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

interface ModifierSpec {
  flag: HotkeyModifier;
  /** macOS glyph, for the plain-string form (tooltips, `title` attributes). */
  glyph: string;
  icon: string;
  label: string;
  /** Text form used off macOS, which has no standard modifier glyphs. */
  pc: string;
}

// Fixed canonical order (Cmd, Ctrl, Alt, Shift) — every display path reads this
// one table, so the string and the rendered forms can't drift apart.
const MODIFIERS: ModifierSpec[] = [
  { flag: 'cmd', glyph: '⌘', icon: 'keyboard_command_key', label: 'Command', pc: 'Ctrl' },
  { flag: 'ctrl', glyph: '⌃', icon: 'keyboard_control_key', label: 'Control', pc: 'Ctrl' },
  { flag: 'alt', glyph: '⌥', icon: 'keyboard_option_key', label: 'Option', pc: 'Alt' },
  { flag: 'shift', glyph: '⇧', icon: 'shift', label: 'Shift', pc: 'Shift' },
];

const KEY_GLYPHS: Record<string, string> = {
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  Escape: '⎋',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Plus: '+',
};

// Keys Material Symbols draws properly. Anything absent here (Escape, forward
// Delete, letters, digits, punctuation) renders as its glyph/text instead.
const KEY_ICONS: Record<string, string> = {
  Enter: 'keyboard_return',
  Backspace: 'backspace',
  Tab: 'keyboard_tab',
  Space: 'space_bar',
  ArrowUp: 'arrow_upward',
  ArrowDown: 'arrow_downward',
  ArrowLeft: 'arrow_back',
  ArrowRight: 'arrow_forward',
};

const KEY_LABELS: Record<string, string> = {
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Forward delete',
  Tab: 'Tab',
  Escape: 'Escape',
  Space: 'Space',
  ArrowUp: 'Up arrow',
  ArrowDown: 'Down arrow',
  ArrowLeft: 'Left arrow',
  ArrowRight: 'Right arrow',
  Plus: 'Plus',
};

/** One rendered part of a hotkey — an icon glyph or a literal, plus the name
 *  assistive tech should read. */
export type HotkeyToken =
  | { kind: 'icon'; icon: string; label: string }
  | { kind: 'text'; text: string; label: string };

/** Render form: the parts of an accelerator, in canonical order. Empty when
 *  unbound or malformed. Consumed by `<HotkeyHint>`; use `formatAccel` where a
 *  plain string is required (tooltips, `title`, `aria-label`). */
export function hotkeyTokens(accel: string): HotkeyToken[] {
  const p = parseAccel(accel);
  if (!p) return [];
  const out: HotkeyToken[] = [];
  for (const m of MODIFIERS) {
    if (!p[m.flag]) continue;
    out.push(
      isMac
        ? { kind: 'icon', icon: m.icon, label: m.label }
        : { kind: 'text', text: m.pc, label: m.pc }
    );
  }
  const label = KEY_LABELS[p.key] ?? p.key;
  const icon = KEY_ICONS[p.key];
  out.push(
    icon ? { kind: 'icon', icon, label } : { kind: 'text', text: KEY_GLYPHS[p.key] ?? p.key, label }
  );
  return out;
}

/** Display form: "Cmd+Shift+Enter" → "⌘⇧↩" (macOS glyphs). */
export function formatAccel(accel: string): string {
  if (!accel) return '';
  const p = parseAccel(accel);
  if (!p) return accel;
  let out = '';
  for (const m of MODIFIERS) {
    if (p[m.flag]) out += isMac ? m.glyph : `${m.pc}+`;
  }
  return out + (KEY_GLYPHS[p.key] ?? p.key);
}
