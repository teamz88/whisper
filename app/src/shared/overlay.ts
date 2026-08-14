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

export const OVERLAY_DONE_FADE_MS = 3_000;
export const OVERLAY_ERROR_FADE_MS = 4_000;

/** Characters of cleaned text shown in the "done" state. */
export const OVERLAY_DONE_PREVIEW_CHARS = 40;
