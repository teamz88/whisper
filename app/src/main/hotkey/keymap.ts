import { UiohookKey } from 'uiohook-napi';

import type { Modifier } from '@whisper/shared';

/**
 * Translation between our hotkey strings and uiohook's raw scancodes.
 *
 * NAMING FOOTGUN, worth stating plainly: uiohook has no `CtrlLeft`,
 * `ShiftLeft`, `AltLeft` or `MetaLeft`. The UNSUFFIXED name is the left-hand
 * key; only the right-hand keys carry a suffix. `UiohookKey.MetaLeft` is
 * `undefined`, and comparing a keycode against `undefined` is silently false
 * forever — the hotkey would simply never fire, with no error anywhere.
 */

/** Both physical keys for each logical modifier. Left first. */
export const MODIFIER_KEYCODES: Record<Modifier, readonly number[]> = {
  Ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  Shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  Alt: [UiohookKey.Alt, UiohookKey.AltRight],
  Meta: [UiohookKey.Meta, UiohookKey.MetaRight],
};

export const ESCAPE_KEYCODE: number = UiohookKey.Escape;

/**
 * uiohook's keycodes are physical scancodes, so they are neither alphabetical
 * nor contiguous: the F-keys jump 68 -> 87 after F10, and digit 0 sits after
 * digit 9. Always look a name up; never compute one.
 */
const KEY_TABLE = UiohookKey as unknown as Record<string, number | undefined>;

/** Extra names the Settings capture UI can produce. */
const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  Return: 'Enter',
  Del: 'Delete',
  Ins: 'Insert',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backquote: 'Backquote',
};

/**
 * Resolve a non-modifier key name ("V", "F12", "Space") to its scancode.
 * Returns null for anything uiohook does not know, which the caller surfaces as
 * "that key can't be used" rather than a hotkey that silently never fires.
 */
export function keycodeForKey(key: string): number | null {
  const name = KEY_ALIASES[key] ?? key;

  const direct = KEY_TABLE[name];
  if (typeof direct === 'number') return direct;

  // Single letters arrive lowercased from some capture paths.
  const upper = name.toUpperCase();
  const upperMatch = KEY_TABLE[upper];
  if (typeof upperMatch === 'number') return upperMatch;

  return null;
}

/** True when the keycode is any modifier — used to ignore modifier noise in toggle mode. */
export function isModifierKeycode(keycode: number): boolean {
  for (const codes of Object.values(MODIFIER_KEYCODES)) {
    if (codes.includes(keycode)) return true;
  }
  return false;
}

/**
 * uiohook reports modifier state on every event as four booleans. Those are the
 * source of truth, NOT a set of pressed keycodes we maintain ourselves: the
 * Windows shell eats some Win-key chords (Win+L, Win+D, Ctrl+Alt+Del), so a
 * keydown can arrive with no matching keyup and a hand-rolled latch gets stuck
 * down permanently.
 */
export interface ModifierState {
  Ctrl: boolean;
  Shift: boolean;
  Alt: boolean;
  Meta: boolean;
}

export interface UiohookModifierFlags {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export function readModifierState(event: UiohookModifierFlags): ModifierState {
  return {
    Ctrl: event.ctrlKey,
    Shift: event.shiftKey,
    Alt: event.altKey,
    Meta: event.metaKey,
  };
}

/** Are exactly the required modifiers held? Extra modifiers block the trigger. */
export function modifiersSatisfied(
  state: ModifierState,
  required: readonly Modifier[],
  { exact }: { exact: boolean } = { exact: true },
): boolean {
  const all: Modifier[] = ['Ctrl', 'Shift', 'Alt', 'Meta'];
  for (const modifier of all) {
    const isRequired = required.includes(modifier);
    if (isRequired && !state[modifier]) return false;
    if (exact && !isRequired && state[modifier]) return false;
  }
  return true;
}

/** Any required modifier no longer held — the stop condition for hold mode. */
export function anyModifierReleased(state: ModifierState, required: readonly Modifier[]): boolean {
  return required.some((modifier) => !state[modifier]);
}
