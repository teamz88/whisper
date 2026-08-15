import { uIOhook, type UiohookKeyboardEvent } from 'uiohook-napi';

import { parseHotkey, type ParsedHotkey } from '@whisper/shared';

import { log } from '../log.js';
import {
  ESCAPE_KEYCODE,
  MODIFIER_KEYCODES,
  keycodeForKey,
  modifiersSatisfied,
  readModifierState,
} from './keymap.js';
import { fireMenuGuard, needsMenuGuard } from './menu-guard.js';
import { isHotkeySuppressed } from './suppress.js';

/**
 * OS-level hotkey detection via uiohook-napi rather than Electron's
 * globalShortcut: globalShortcut cannot see key RELEASES, and hold-to-talk is
 * defined by the release.
 *
 * Two rules keep this handler safe:
 *  - It must be fast. Windows silently unregisters a low-level keyboard hook
 *    whose callback exceeds LowLevelHooksTimeout (~300 ms) — no error, the
 *    hotkey just dies. Nothing in here does I/O; the callbacks only forward.
 *  - Modifier state is read from each event's ctrlKey/shiftKey/altKey/metaKey
 *    booleans, never latched from our own keydown/keyup pairs. The Windows
 *    shell eats some Win-key chords entirely, so a latch would stick.
 */

export type TriggerSource = 'hold' | 'toggle' | 'escape' | 'repress';

export interface HotkeyCallbacks {
  /** Must return immediately; heavy work happens after the handler returns. */
  onStart: (source: TriggerSource) => void;
  onStop: (source: TriggerSource) => void;
  /** True while the mic is actually open (overlay in 'listening'). */
  isListening: () => boolean;
}

/** Ignore a hold trigger's own keydown-repeats for this long after triggering. */
const REPRESS_MIN_AGE_MS = 250;

/**
 * Windows auto-repeats held modifier keys, so "a combo keydown while already
 * recording" is NOT enough to mean the user pressed the key again — during a
 * hold, repeats arrive forever. A genuine re-press (the recovery for an eaten
 * Win-key release) is preceded by silence: the key was physically up, so the
 * repeats stopped. The longest configurable initial repeat delay on Windows is
 * ~1 s, so a gap comfortably above that means a real re-press.
 */
const REPRESS_GAP_MS = 1400;

export class HotkeyListener {
  private readonly callbacks: HotkeyCallbacks;

  private parsed: ParsedHotkey;
  private keyKeycode: number | null = null;
  private requiredKeycodes: Set<number> = new Set();

  private capturing = false;
  private started = false;

  /** Set when this listener started the current hold; cleared on stop. */
  private holdActive = false;
  private holdTriggeredAt = 0;

  /** Last keydown per keycode, for the auto-repeat vs re-press distinction. */
  private lastKeydownAt = new Map<number, number>();

  /** Toggle-mode edge detection: only fire on a fresh press, not on repeat. */
  private toggleKeyDown = false;
  private lastToggleAt = 0;

  constructor(hotkey: string, callbacks: HotkeyCallbacks) {
    this.callbacks = callbacks;
    this.parsed = parseHotkey(hotkey);
    this.compile();
  }

  /** Swap the active hotkey without restarting the hook. */
  setHotkey(hotkey: string): void {
    this.parsed = parseHotkey(hotkey);
    this.compile();
    this.holdActive = false;
    this.toggleKeyDown = false;
    log.info(`[hotkey] armed: ${this.parsed.combo} (${this.parsed.mode} mode)`);
  }

  /** While Settings is capturing a new combo, the global listener goes quiet. */
  setCapturing(capturing: boolean): void {
    this.capturing = capturing;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    uIOhook.on('keydown', (event) => this.handleKeydown(event));
    uIOhook.on('keyup', (event) => this.handleKeyup(event));
    uIOhook.start();

    log.info(`[hotkey] listener started: ${this.parsed.combo} (${this.parsed.mode} mode)`);
  }

  /**
   * Must run before app quit: the hook delivers events from a native thread,
   * and tearing down the JS environment while it is live has crashed Electron
   * (uiohook-napi #37). stop() is synchronous, so it is safe in will-quit.
   */
  shutdown(): void {
    if (!this.started) return;
    this.started = false;
    try {
      uIOhook.stop();
    } catch (error) {
      log.warn(`[hotkey] stop failed: ${String(error)}`);
    }
  }

  private compile(): void {
    this.keyKeycode = this.parsed.key === null ? null : keycodeForKey(this.parsed.key);
    if (this.parsed.key !== null && this.keyKeycode === null) {
      log.warn(`[hotkey] key "${this.parsed.key}" has no known keycode — falling back to modifiers only`);
    }

    this.requiredKeycodes = new Set(
      this.parsed.modifiers.flatMap((modifier) => [...MODIFIER_KEYCODES[modifier]]),
    );
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  private handleKeydown(event: UiohookKeyboardEvent): void {
    if (this.capturing || isHotkeySuppressed()) return;

    const now = Date.now();
    const previousDownAt = this.lastKeydownAt.get(event.keycode) ?? 0;
    this.lastKeydownAt.set(event.keycode, now);

    // Esc is the panic key: it always stops a live recording, because Windows
    // sometimes swallows the Win-key release when chorded and the user needs a
    // way out that does not depend on the combo at all.
    if (event.keycode === ESCAPE_KEYCODE) {
      if (this.callbacks.isListening()) this.callbacks.onStop('escape');
      return;
    }

    if (this.parsed.mode === 'hold') {
      this.handleHoldKeydown(event, now, previousDownAt);
    } else {
      this.handleToggleKeydown(event, now, previousDownAt);
    }
  }

  private handleHoldKeydown(event: UiohookKeyboardEvent, now: number, previousDownAt: number): void {
    if (!this.requiredKeycodes.has(event.keycode)) return;

    const state = readModifierState(event);
    const listening = this.callbacks.isListening();

    if (!listening) {
      // Start when the combo is fully held and nothing extra is: exactness
      // keeps Ctrl+Win+Shift (someone's screenshot chord) from dictating.
      if (modifiersSatisfied(state, this.parsed.modifiers, { exact: true })) {
        this.holdActive = true;
        this.holdTriggeredAt = now;
        this.callbacks.onStart('hold');

        // Bare Alt / bare Win holds: a clean tap of these is an OS command on
        // RELEASE (menu bar / Start menu), which steals focus from the app the
        // user is dictating into. One synthetic no-op key while they hold makes
        // the tap "unclean" and Windows leaves the focus alone.
        if (needsMenuGuard(this.parsed)) fireMenuGuard();
      }
      return;
    }

    // Re-press fallback. A combo keydown during recording is usually just
    // Windows auto-repeating the held key; a long silence before it means the
    // key was physically released (and the keyup eaten) and pressed again.
    if (
      this.holdActive &&
      now - this.holdTriggeredAt >= REPRESS_MIN_AGE_MS &&
      previousDownAt !== 0 &&
      now - previousDownAt >= REPRESS_GAP_MS
    ) {
      this.holdActive = false;
      this.callbacks.onStop('repress');
    }
  }

  private handleToggleKeydown(event: UiohookKeyboardEvent, now: number, previousDownAt: number): void {
    if (this.keyKeycode === null || event.keycode !== this.keyKeycode) return;

    // Edge detection: auto-repeat keydowns arrive while held; only the first
    // press counts. toggleKeyDown is reset by the matching keyup.
    if (this.toggleKeyDown && now - previousDownAt < REPRESS_GAP_MS) return;
    this.toggleKeyDown = true;

    // Double-tap debounce so one physical press cannot start and instantly stop.
    if (now - this.lastToggleAt < 300) return;

    const state = readModifierState(event);
    const listening = this.callbacks.isListening();

    if (!listening) {
      if (modifiersSatisfied(state, this.parsed.modifiers, { exact: true })) {
        this.lastToggleAt = now;
        this.callbacks.onStart('toggle');
      }
      return;
    }

    // Stopping is lenient about extra modifiers: the user is trying to make it
    // stop, and "you held Shift too" is not a reason to keep recording.
    if (modifiersSatisfied(state, this.parsed.modifiers, { exact: false })) {
      this.lastToggleAt = now;
      this.callbacks.onStop('toggle');
    }
  }

  private handleKeyup(event: UiohookKeyboardEvent): void {
    if (this.capturing || isHotkeySuppressed()) return;

    if (this.parsed.mode === 'toggle') {
      if (this.keyKeycode !== null && event.keycode === this.keyKeycode) {
        this.toggleKeyDown = false;
      }
      return;
    }

    // Hold mode: releasing ANY key of the combo ends the recording — but only
    // a recording THIS listener started. Without the holdActive guard, tapping
    // Ctrl (say, Ctrl+C in another window) would kill a recording the user
    // started from the dashboard button.
    if (!this.callbacks.isListening()) {
      this.holdActive = false;
      return;
    }

    if (this.holdActive && this.requiredKeycodes.has(event.keycode)) {
      this.holdActive = false;
      this.callbacks.onStop('hold');
    }
  }
}
