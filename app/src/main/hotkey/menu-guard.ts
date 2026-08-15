import { uIOhook, UiohookKey } from 'uiohook-napi';

import type { ParsedHotkey } from '@whisper/shared';

import { log } from '../log.js';
import { suppressHotkeyFor } from './suppress.js';

/**
 * Windows treats a CLEAN tap of certain modifiers as a command in itself:
 * pressing and releasing Alt alone focuses the foreground app's menu bar, and
 * Win alone opens the Start menu — both fire on the RELEASE. For a hold-to-talk
 * hotkey that IS a bare Alt or bare Win, that means every dictation ends with
 * the target app stealing its own focus (Teams beeps and drops our paste into
 * a menu bar nobody can see).
 *
 * The OS only does this when no other key was pressed between the modifier
 * going down and coming up. So the moment such a recording starts — while the
 * user is still holding the key and talking — we inject one tap of a harmless
 * key. The tap makes the hold "unclean", the menu/Start never activates, and
 * the release does nothing but stop the recording.
 */

/** True when this hotkey needs the guard: a hold on exactly bare Alt or Win. */
export function needsMenuGuard(parsed: ParsedHotkey): boolean {
  if (parsed.mode !== 'hold' || parsed.modifiers.length !== 1) return false;
  const modifier = parsed.modifiers[0];
  return modifier === 'Alt' || modifier === 'Meta';
}

/**
 * Ctrl is the neutral key: a solo Ctrl tap is a no-op in Windows apps, and
 * pressing it mid-hold turns the combo into Ctrl+Alt / Ctrl+Win for an
 * instant, which also triggers nothing.
 */
export function fireMenuGuard(): void {
  // Our own hook sees the synthetic tap; blind it briefly. Short on purpose:
  // while suppressed the hook also cannot see the user's REAL keyup, and an
  // ultra-quick tap-and-release must still stop the recording.
  suppressHotkeyFor(80);
  try {
    uIOhook.keyTap(UiohookKey.Ctrl);
  } catch (error) {
    log.warn(`[hotkey] menu-guard tap failed: ${String(error)}`);
  }
}
