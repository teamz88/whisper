/**
 * We synthesise Ctrl+V to paste. Our own global hook sees those synthetic key
 * events, and a hotkey containing Ctrl would otherwise re-trigger from our own
 * paste. This is the smallest possible shared flag between the injector and the
 * hook, kept in its own module so neither has to import the other.
 */

let suppressedUntil = 0;

/** Ignore hook events for the next `ms`. Called around synthetic keystrokes. */
export function suppressHotkeyFor(ms: number): void {
  suppressedUntil = Math.max(suppressedUntil, Date.now() + ms);
}

export function isHotkeySuppressed(): boolean {
  return Date.now() < suppressedUntil;
}

export function clearHotkeySuppression(): void {
  suppressedUntil = 0;
}
