/**
 * Hotkey grammar. Shared because three places must agree on it exactly:
 *   - the renderer's key-capture UI in Settings (produces the string),
 *   - the renderer's hint text ("hold" vs "tap"),
 *   - the main process' uiohook listener (consumes the string).
 *
 * Two accepted forms:
 *   "HoldCtrlMeta"        - the legacy/default sentinel: hold Left Ctrl + Win.
 *   "Ctrl+Shift+V", "F12" - a generic combo: zero or more modifiers, optional key.
 *
 * Semantics:
 *   hold   - combos that are ONLY modifiers. Recording starts when every part is
 *            held and stops when any of them is released.
 *   toggle - combos containing a non-modifier key (including a bare function
 *            key). Tap to start, tap to stop.
 */

export const DEFAULT_HOTKEY = 'HoldCtrlMeta';

export type HotkeyMode = 'hold' | 'toggle';

export const MODIFIERS = ['Ctrl', 'Shift', 'Alt', 'Meta'] as const;

export type Modifier = (typeof MODIFIERS)[number];

export interface ParsedHotkey {
  /** Canonical string, e.g. "Ctrl+Shift+V". Never the "HoldCtrlMeta" sentinel. */
  readonly combo: string;
  readonly modifiers: readonly Modifier[];
  /** Non-modifier key, e.g. "V" or "F12". Null for modifier-only combos. */
  readonly key: string | null;
  readonly mode: HotkeyMode;
}

const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  ctl: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  meta: 'Meta',
  win: 'Meta',
  windows: 'Meta',
  super: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  commandorcontrol: 'Meta',
};

/** Canonical modifier order, so "Shift+Ctrl+V" and "Ctrl+Shift+V" are one hotkey. */
const MODIFIER_ORDER: readonly Modifier[] = ['Ctrl', 'Alt', 'Shift', 'Meta'];

function normaliseKey(raw: string): string {
  const trimmed = raw.trim();
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  // Space, Enter, Tab, Backquote, ...
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function parseHotkey(input: string | null | undefined): ParsedHotkey {
  const raw = (input ?? '').trim();

  if (raw === '' || raw === DEFAULT_HOTKEY) {
    return { combo: 'Ctrl+Meta', modifiers: ['Ctrl', 'Meta'], key: null, mode: 'hold' };
  }

  const modifiers: Modifier[] = [];
  let key: string | null = null;

  for (const part of raw.split('+')) {
    const token = part.trim();
    if (token === '') continue;
    const modifier = MODIFIER_ALIASES[token.toLowerCase()];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
    } else {
      key = normaliseKey(token);
    }
  }

  if (modifiers.length === 0 && key === null) {
    // Unparseable — fall back to the default rather than leaving the user with
    // no way to dictate.
    return { combo: 'Ctrl+Meta', modifiers: ['Ctrl', 'Meta'], key: null, mode: 'hold' };
  }

  const ordered = MODIFIER_ORDER.filter((m) => modifiers.includes(m));
  const combo = [...ordered, ...(key ? [key] : [])].join('+');
  const mode: HotkeyMode = key === null ? 'hold' : 'toggle';

  return { combo, modifiers: ordered, key, mode };
}

/** True when the string is a usable hotkey (at least one modifier, or a key). */
export function isValidHotkey(input: string | null | undefined): boolean {
  const raw = (input ?? '').trim();
  if (raw === DEFAULT_HOTKEY) return true;
  if (raw === '') return false;
  const parsed = parseHotkey(raw);
  // A lone printable character with no modifier would swallow normal typing.
  if (parsed.modifiers.length === 0 && parsed.key !== null && !/^F\d+$/.test(parsed.key)) {
    return false;
  }
  return true;
}

export interface HotkeyLabelOptions {
  /** Renders Meta as ⌘ and Alt as ⌥. */
  readonly mac?: boolean;
}

/** Human label for the tray, Home sub-line and Settings row. */
export function hotkeyLabel(input: string | null | undefined, options: HotkeyLabelOptions = {}): string {
  const { modifiers, key } = parseHotkey(input);
  const mac = options.mac ?? false;
  const names: Record<Modifier, string> = mac
    ? { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };
  const parts = [...modifiers.map((m) => names[m]), ...(key ? [key] : [])];
  return mac ? parts.join('') : parts.join(' + ');
}

/** The hint under the Settings shortcut row. */
export function hotkeyHint(input: string | null | undefined, options: HotkeyLabelOptions = {}): string {
  const parsed = parseHotkey(input);
  const label = hotkeyLabel(input, options);
  return parsed.mode === 'hold'
    ? `Hold ${label} to record, release to insert.`
    : `Tap ${label} to start recording, tap again to stop.`;
}
