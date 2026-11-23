/** The overlay's state machine. Owned by main, rendered by the overlay window. */

export type OverlayState =
  | { kind: 'idle' }
  /**
   * Mic is open. `startedAt` is epoch ms, used for the elapsed timer.
   * `micDeviceId` is the user's preferred input device (null = OS default) —
   * carried in the state because the overlay renderer owns getUserMedia.
   * `generation` identifies THIS dictation: the renderer echoes it back on
   * every audio event, so main can drop events from a superseded recording
   * instead of letting them clear or clobber a live one.
   */
  | { kind: 'listening'; startedAt: number; micDeviceId: string | null; generation: number }
  | { kind: 'processing' }
  | { kind: 'done'; text: string; wordCount: number; pasted: boolean }
  /**
   * The small "Copy" chip the done pill shrinks into, so a dictation that
   * landed in the wrong place can still be grabbed without opening History.
   * `copied` flips it to a confirmation after a click.
   */
  | { kind: 'copy'; copied: boolean }
  | { kind: 'error'; message: string };

/**
 * The generation a fresh overlay renderer reports when it is handed a replayed
 * 'processing' state it never recorded for (it has no real generation to
 * echo). Main accepts it only while actually wedged in 'processing'.
 */
export const UNKNOWN_GENERATION = -1;

export const IDLE_OVERLAY_STATE: OverlayState = { kind: 'idle' };

/** Overlay window geometry. */
export const OVERLAY_WIDTH = 280;
export const OVERLAY_HEIGHT = 52;
/** Gap between the overlay and the bottom of the work area. */
export const OVERLAY_BOTTOM_MARGIN = 18;
/** Horizontal inset for the bottom-left / bottom-right positions. */
export const OVERLAY_SIDE_MARGIN = 24;

/** After this long listening, the timer is replaced by the "Esc" hint. */
export const OVERLAY_ESC_HINT_AFTER_MS = 5_000;

/**
 * The copy chip: a round icon button, centred on the pill's line. Hovering it
 * widens it to show the word "Copy" — main resizes the window to match, so
 * the chip stays tiny (and clicks around it reach the app below) otherwise.
 */
export const OVERLAY_CHIP_WIDTH = 32;
export const OVERLAY_CHIP_HEIGHT = 32;
export const OVERLAY_CHIP_HOVER_WIDTH = 76;

export const OVERLAY_DONE_FADE_MS = 3_000;
export const OVERLAY_ERROR_FADE_MS = 4_000;
/** How long the copy chip stays after the done pill. */
export const OVERLAY_COPY_CHIP_MS = 3_000;
/** How long "Copied" shows after a click. */
export const OVERLAY_COPIED_MS = 700;
/** Leaving the overlay with the mouse: this long before an expired step runs. */
export const OVERLAY_HOVER_GRACE_MS = 600;

/** Overlay states drawn as the small chip rather than the full pill. */
export function isChipState(state: OverlayState): boolean {
  return state.kind === 'copy';
}

/** Characters of cleaned text shown in the "done" state. */
export const OVERLAY_DONE_PREVIEW_CHARS = 40;
