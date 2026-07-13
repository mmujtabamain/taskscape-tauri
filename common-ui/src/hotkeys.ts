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

const isMac = navigator.userAgent.includes('Mac');

interface Parsed {
  cmd: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
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

function parseAccel(accel: string): Parsed | null {
  const p: Parsed = { cmd: false, ctrl: false, alt: false, shift: false, key: '' };
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

const MOD_GLYPHS: [keyof Omit<Parsed, 'key'>, string, string][] = [
  ['cmd', '⌘', 'Ctrl+'],
  ['ctrl', '⌃', 'Ctrl+'],
  ['alt', '⌥', 'Alt+'],
  ['shift', '⇧', 'Shift+'],
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

/** Display form: "Cmd+Shift+Enter" → "⌘⇧↩" (macOS glyphs). */
export function formatAccel(accel: string): string {
  if (!accel) return '';
  const p = parseAccel(accel);
  if (!p) return accel;
  let out = '';
  for (const [mod, mac, other] of MOD_GLYPHS) {
    if (p[mod]) out += isMac ? mac : other;
  }
  return out + (KEY_GLYPHS[p.key] ?? p.key);
}
