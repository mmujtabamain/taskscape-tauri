// DOM-event side of the hotkey system. The catalog, persistence and conflict
// rules live in Rust (`common/src/hotkeys.rs`); this module only bridges
// KeyboardEvents to the shared canonical accelerator format:
// "<Mod>+…+<Key>", modifiers in fixed order Cmd, Ctrl, Alt, Shift, keys
// normalized (letters A–Z, digits, named keys, literal punctuation, "Plus" for
// the + key so + stays an unambiguous separator).
//
// That format is a type here, not a convention: `Accel` enumerates every legal
// combo, so a mistyped literal is a build error, and `Hotkey` is its parsed
// form. `parseAccel` is the only crossing between the two.

/** Every key an accelerator may end in. Mirrors the `keys!` table in
 *  `common/src/hotkeys.rs` — the two must stay in step. */
// Spelled out rather than spread from a string: `...('AB' as const)` widens to
// `string[]`, which would collapse KeyToken — and Accel with it — to `string`.
const KEY_TOKENS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'Enter',
  'Backspace',
  'Delete',
  'Space',
  'Tab',
  'Escape',
  'Plus',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ',',
  '\\',
  '/',
  '.',
  ';',
  "'",
  '[',
  ']',
  '-',
  '=',
  '`',
] as const;

export type KeyToken = (typeof KEY_TOKENS)[number];

const KEY_SET: ReadonlySet<string> = new Set(KEY_TOKENS);

export const isKeyToken = (token: string): token is KeyToken =>
  KEY_SET.has(token);

export type HotkeyModifier = 'cmd' | 'ctrl' | 'alt' | 'shift';

// Canonical modifier order is baked into the type: each layer may only prefix
// the ones below it, so "Cmd+Shift+K" type-checks and "Shift+Cmd+K" doesn't.
type WithShift<K extends string> = K | `Shift+${K}`;
type WithAlt<K extends string> = WithShift<K> | `Alt+${WithShift<K>}`;
type WithCtrl<K extends string> = WithAlt<K> | `Ctrl+${WithAlt<K>}`;

/** Every legal accelerator, plus `''` for intentionally unbound. Literals are
 *  checked against this, so `'Cmd+Shft+K'` and `'cmd+k'` don't compile. */
export type Accel = '' | WithCtrl<KeyToken> | `Cmd+${WithCtrl<KeyToken>}`;

type Assert<T extends true> = T;
type Rejects<A extends string> = [Extract<A, Accel>] extends [never]
  ? true
  : false;
type Accepts<A extends string> = A extends Accel ? true : false;

/** Compile-time guard, erased at build time. `Accel` is only worth anything
 *  while it stays a finite union: one widened member — a string spread in
 *  `KEY_TOKENS`, say — silently collapses it to `string`, after which it
 *  rejects nothing and every check above it is theatre. These stop compiling
 *  the moment that happens. */
export type AccelGuards = [
  Assert<Rejects<'Cmd+Shft+K'>>, // a mistyped modifier
  Assert<Rejects<'Shift+Cmd+K'>>, // modifiers out of canonical order
  Assert<Rejects<'cmd+k'>>, // wrong case
  Assert<Rejects<'Cmd+Frobnicate'>>, // a key outside the vocabulary
  Assert<Rejects<'Cmd+'>>, // modifier with no key
  Assert<Accepts<'Cmd+Shift+K'>>,
  Assert<Accepts<'Cmd+Alt+ArrowLeft'>>,
  Assert<Accepts<'Cmd+,'>>,
  Assert<Accepts<'F3'>>,
  Assert<Accepts<''>>,
];

/** A catalog entry with its effective combo, as served by `list_hotkeys`.
 *  Rust emits these through `Display`, so they are canonical by construction. */
export interface HotkeyBinding {
  id: string;
  label: string;
  scope: 'global' | 'main' | 'tray';
  /** Effective accelerator; empty when intentionally unbound. */
  accel: Accel;
  default: Accel;
}

/** Collapse the catalog to an `id → accel` lookup (both apps build this). */
export const bindingsToMap = (
  bindings: HotkeyBinding[]
): Record<string, Accel> =>
  Object.fromEntries(bindings.map((b) => [b.id, b.accel]));

const isMac = navigator.userAgent.includes('Mac');

/** An accelerator split into its parts — the structure every renderer works
 *  from, so a shortcut looks the same everywhere it appears. */
export interface Hotkey {
  cmd: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: KeyToken;
}

// Physical-key codes → canonical key tokens. Matching on `code` (not `key`)
// keeps letter combos stable under Alt, which remaps `key` on macOS (⌥N → "˜").
const CODE_KEYS: Record<string, KeyToken> = {
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

function keyFromEvent(e: KeyboardEvent): KeyToken | null {
  const mapped = CODE_KEYS[e.code];
  if (mapped) return mapped;
  let m = /^Key([A-Z])$/.exec(e.code);
  if (m && isKeyToken(m[1])) return m[1];
  m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (m && isKeyToken(m[1])) return m[1];
  if (isKeyToken(e.code) && /^F([1-9]|1[0-2])$/.test(e.code)) return e.code;
  return null;
}

/** The one crossing from string to typed form: null when malformed, unbound, or
 *  naming a key outside the shared vocabulary. Takes a plain `string` because
 *  its whole job is vetting values that aren't typed yet. */
export function parseAccel(accel: string): Hotkey | null {
  let cmd = false;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let key: KeyToken | null = null;
  for (const part of accel.split('+')) {
    switch (part) {
      case 'Cmd':
        cmd = true;
        break;
      case 'Ctrl':
        ctrl = true;
        break;
      case 'Alt':
        alt = true;
        break;
      case 'Shift':
        shift = true;
        break;
      default:
        if (key !== null || !isKeyToken(part)) return null;
        key = part;
    }
  }
  return key === null ? null : { cmd, ctrl, alt, shift, key };
}

/** True when the event is exactly this accelerator (no extra modifiers). */
export function matchesEvent(accel: Accel, e: KeyboardEvent): boolean {
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
export function eventToAccel(e: KeyboardEvent): Accel | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  const key = keyFromEvent(e);
  if (!key) return null;
  return hotkeyToAccel({
    // "Cmd" is the platform primary modifier: ⌘ on macOS, Ctrl elsewhere.
    cmd: isMac ? e.metaKey : e.ctrlKey,
    ctrl: isMac && e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    key,
  });
}

/** The canonical string for a parsed hotkey — the form Rust and the store
 *  speak. Inverse of `parseAccel`. */
export function hotkeyToAccel(hotkey: Hotkey): Accel {
  let out = '';
  for (const m of MODIFIERS) {
    if (hotkey[m.flag]) out += `${m.token}+`;
  }
  // Assembled from the canonical table in canonical order — precisely what
  // `Accel` describes, which TS can't follow through string concatenation.
  return `${out}${hotkey.key}` as Accel;
}

interface ModifierSpec {
  flag: HotkeyModifier;
  /** The token this modifier is spelled with in an accelerator. */
  token: 'Cmd' | 'Ctrl' | 'Alt' | 'Shift';
  /** macOS glyph, for the plain-string form (tooltips, `title` attributes). */
  glyph: string;
  icon: string;
  label: string;
  /** Text form used off macOS, which has no standard modifier glyphs. */
  pc: string;
}

// Fixed canonical order (Cmd, Ctrl, Alt, Shift) — every path that writes or
// renders an accelerator reads this one table, so they can't drift apart.
const MODIFIERS: ModifierSpec[] = [
  {
    flag: 'cmd',
    token: 'Cmd',
    glyph: '⌘',
    icon: 'keyboard_command_key',
    label: 'Command',
    pc: 'Ctrl',
  },
  {
    flag: 'ctrl',
    token: 'Ctrl',
    glyph: '⌃',
    icon: 'keyboard_control_key',
    label: 'Control',
    pc: 'Ctrl',
  },
  {
    flag: 'alt',
    token: 'Alt',
    glyph: '⌥',
    icon: 'keyboard_option_key',
    label: 'Option',
    pc: 'Alt',
  },
  {
    flag: 'shift',
    token: 'Shift',
    glyph: '⇧',
    icon: 'shift',
    label: 'Shift',
    pc: 'Shift',
  },
];

// Keyed by KeyToken, so a typo in any of these tables is a build error.
const KEY_GLYPHS: Partial<Record<KeyToken, string>> = {
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
const KEY_ICONS: Partial<Record<KeyToken, string>> = {
  Enter: 'keyboard_return',
  Backspace: 'backspace',
  Tab: 'keyboard_tab',
  Space: 'space_bar',
  ArrowUp: 'arrow_upward',
  ArrowDown: 'arrow_downward',
  ArrowLeft: 'arrow_back',
  ArrowRight: 'arrow_forward',
};

const KEY_LABELS: Partial<Record<KeyToken, string>> = {
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

/** Render form: the parts of a hotkey, in canonical order. Consumed by
 *  `<HotkeyHint>`; use `formatHotkey`/`formatAccel` where a plain string is
 *  required (tooltips, `title`, `aria-label`). */
export function hotkeyTokens(hotkey: Hotkey): HotkeyToken[] {
  const out: HotkeyToken[] = [];
  for (const m of MODIFIERS) {
    if (!hotkey[m.flag]) continue;
    out.push(
      isMac
        ? { kind: 'icon', icon: m.icon, label: m.label }
        : { kind: 'text', text: m.pc, label: m.pc }
    );
  }
  const label = KEY_LABELS[hotkey.key] ?? hotkey.key;
  const icon = KEY_ICONS[hotkey.key];
  out.push(
    icon
      ? { kind: 'icon', icon, label }
      : { kind: 'text', text: KEY_GLYPHS[hotkey.key] ?? hotkey.key, label }
  );
  return out;
}

/** Display form: `{cmd, shift, key: 'Enter'}` → "⌘⇧↩" (macOS glyphs). */
export function formatHotkey(hotkey: Hotkey): string {
  let out = '';
  for (const m of MODIFIERS) {
    if (hotkey[m.flag]) out += isMac ? m.glyph : `${m.pc}+`;
  }
  return out + (KEY_GLYPHS[hotkey.key] ?? hotkey.key);
}

/** Display form straight from the wire: "Cmd+Shift+Enter" → "⌘⇧↩". Empty when
 *  unbound, and the input verbatim if it somehow isn't a valid accelerator. */
export function formatAccel(accel: Accel): string {
  const hotkey = parseAccel(accel);
  return hotkey ? formatHotkey(hotkey) : accel;
}
