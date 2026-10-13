import { dialog, shell, systemPreferences } from 'electron';

import { log } from '../log.js';
import type { HotkeyListener } from './listener.js';

/**
 * The keyboard hook could not start. On macOS that means Whisper has no
 * Accessibility permission, and before this the whole boot aborted silently:
 * no dashboard, no sign-in, just a tray icon whose shortcut did nothing.
 *
 * Now the app carries on, says what is missing once, and arms the shortcut by
 * itself the moment the permission is granted — no restart needed.
 */

const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

const RETRY_MS = 3_000;

export function recoverHotkey(listener: HotkeyListener): void {
  if (process.platform !== 'darwin') {
    void dialog.showMessageBox({
      type: 'error',
      message: "Whisper's shortcut could not start",
      detail: 'Dictation by shortcut is off until Whisper is restarted. The dashboard still works.',
    });
    return;
  }

  void dialog
    .showMessageBox({
      type: 'warning',
      message: 'Whisper needs Accessibility access',
      detail:
        'The dictation shortcut cannot work without it. Open System Settings → Privacy & Security → ' +
        'Accessibility and turn Whisper on. The shortcut starts working as soon as you do.',
      buttons: ['Open Settings', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) void shell.openExternal(ACCESSIBILITY_SETTINGS_URL);
    });

  const timer = setInterval(() => {
    // Checked first so a missing permission costs nothing and logs nothing.
    if (!systemPreferences.isTrustedAccessibilityClient(false)) return;
    if (listener.start()) {
      clearInterval(timer);
      log.info('[hotkey] accessibility granted, shortcut armed');
    }
  }, RETRY_MS);
  timer.unref();
}
