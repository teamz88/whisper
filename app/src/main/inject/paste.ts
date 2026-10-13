import { Key, keyboard } from '@nut-tree-fork/nut-js';
import { uIOhook, UiohookKey } from 'uiohook-napi';

import { suppressHotkeyFor } from '../hotkey/suppress.js';
import { log } from '../log.js';
import {
  isSnapshotEmpty,
  readText,
  restoreClipboard,
  snapshotClipboard,
  writeText,
  type ClipboardSnapshot,
} from './clipboard.js';
import { getFocusedAppName } from './focused-app.js';

/**
 * Text injection.
 *
 * We paste from the clipboard rather than typing the characters, because
 * synthetic typing is defeated by Caps Lock, a held Shift, a non-QWERTY layout,
 * and dead keys — all of which are normal states for a user mid-sentence. A
 * clipboard paste is one keystroke and is layout-independent.
 */

/**
 * How long to let the clipboard settle before the paste keystroke. WebView2
 * apps (new Teams, new Outlook) sync the clipboard lazily; pasting too soon
 * after writeText occasionally delivers the PREVIOUS clipboard content.
 */
const CLIPBOARD_SETTLE_MS = 50;

/**
 * Held time between key-down and key-up of the synthetic Ctrl+V. Zero-delay
 * bursts are real keystrokes microseconds apart, and heavyweight web apps
 * (Teams especially) sometimes drop them; ~30 ms mimics a human press and
 * makes delivery reliable at no perceptible cost.
 */
const PASTE_HOLD_MS = 30;

/** How long our text stays on the clipboard before the original is put back. */
const RESTORE_DELAY_MS = 8_000;

/** Ignore our own synthetic Ctrl+V in the global hook. */
const SUPPRESS_MS = 400;

/**
 * nut-js defaults autoDelayMs to 300 and applies it inside BOTH pressKey and
 * releaseKey — about 600 ms of dead time per paste, which is the single largest
 * avoidable latency in the whole pipeline.
 */
keyboard.config.autoDelayMs = 0;

const PASTE_MODIFIER: Key =
  // Key.LeftCmd exists in the enum but throws "Invalid key code specified." on
  // Windows. LeftSuper maps to the native 'meta' key, which is Cmd on macOS.
  process.platform === 'darwin' ? Key.LeftSuper : Key.LeftControl;

interface PendingRestore {
  snapshot: ClipboardSnapshot;
  /** What we put on the clipboard; only restore if this is still there. */
  text: string;
  timer: NodeJS.Timeout | null;
}

let pending: PendingRestore | null = null;

export type PasteMethod = 'nut-js' | 'uiohook' | 'none';

export interface PasteOutcome {
  pasted: boolean;
  method: PasteMethod;
  /** Only resolved on the failure path — it costs a subprocess. */
  focusedApp: string | null;
  error?: string;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function pressPasteViaNutJs(): Promise<void> {
  // Modifiers come first: only the LAST argument is treated as the real key,
  // everything before it becomes a native modifier flag. The hold between
  // press and release is deliberate — see PASTE_HOLD_MS.
  await keyboard.pressKey(PASTE_MODIFIER, Key.V);
  await delay(PASTE_HOLD_MS);
  await keyboard.releaseKey(PASTE_MODIFIER, Key.V);
}

/**
 * uiohook can post synthetic keys too. It is the fallback rather than the
 * primary because it is fire-and-forget with no error signal at all.
 */
function pressPasteViaUiohook(): void {
  const modifier = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl;
  uIOhook.keyTap(UiohookKey.V, [modifier]);
}

function scheduleRestore(entry: PendingRestore): void {
  entry.timer = setTimeout(() => {
    // A newer dictation took over; it owns the restore now.
    if (pending !== entry) return;
    pending = null;

    // If the user copied something else in the meantime, their clipboard is
    // theirs — leave it alone.
    if (readText() !== entry.text) return;
    if (isSnapshotEmpty(entry.snapshot)) return;

    restoreClipboard(entry.snapshot);
  }, RESTORE_DELAY_MS);

  entry.timer.unref?.();
}

/**
 * Put `text` on the clipboard and paste it into whatever has focus.
 *
 * Back-to-back dictations reuse the FIRST snapshot: taking a new one would
 * capture our own previous transcript as "the user's clipboard" and restore
 * that instead of what they actually had.
 */
export async function pasteText(text: string): Promise<PasteOutcome> {
  if (text.trim() === '') {
    return { pasted: false, method: 'none', focusedApp: null, error: 'empty text' };
  }

  if (pending === null) {
    const snapshot = snapshotClipboard();
    if (snapshot.lossy) {
      log.warn(
        `[paste] clipboard holds a format we cannot restore (${snapshot.formats.join(', ')}) — it will be replaced`,
      );
    }
    pending = { snapshot, text, timer: null };
  } else {
    if (pending.timer !== null) clearTimeout(pending.timer);
    pending.timer = null;
    pending.text = text;
  }

  writeText(text);
  await delay(CLIPBOARD_SETTLE_MS);

  suppressHotkeyFor(SUPPRESS_MS);

  let method: PasteMethod = 'none';
  let error: string | undefined;

  try {
    await pressPasteViaNutJs();
    method = 'nut-js';
  } catch (nutError) {
    error = nutError instanceof Error ? nutError.message : String(nutError);
    log.warn(`[paste] nut-js failed: ${error} — trying uiohook`);
    try {
      pressPasteViaUiohook();
      method = 'uiohook';
      error = undefined;
    } catch (hookError) {
      error = hookError instanceof Error ? hookError.message : String(hookError);
      log.warn(`[paste] uiohook fallback failed: ${error}`);
    }
  }

  scheduleRestore(pending);

  if (method === 'none') {
    const focusedApp = await getFocusedAppName();
    log.warn(`[paste] could not inject — text left on clipboard. focused app: ${focusedApp ?? 'unknown'}`);
    return { pasted: false, method, focusedApp, error };
  }

  return { pasted: true, method, focusedApp: null };
}

/** Put the user's clipboard back now — called on quit so we never keep it. */
export function flushClipboardRestore(): void {
  const entry = pending;
  if (entry === null) return;
  if (entry.timer !== null) clearTimeout(entry.timer);
  pending = null;

  if (readText() !== entry.text) return;
  if (isSnapshotEmpty(entry.snapshot)) return;
  restoreClipboard(entry.snapshot);
}

/**
 * nut-js resolves successfully when a Key has no native mapping, so a broken
 * paste key cannot be detected at paste time. Checking that the enum members we
 * depend on actually exist at boot catches the version-drift case, which is the
 * one that realistically breaks.
 */
export function verifyPasteKeys(): boolean {
  const ok = typeof PASTE_MODIFIER === 'number' && typeof Key.V === 'number';
  if (!ok) {
    log.error('[paste] nut-js Key enum is missing the paste keys — pastes will silently no-op');
  }
  return ok;
}
