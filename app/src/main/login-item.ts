import { app } from 'electron';

import { log } from './log.js';
import { getLoginItemSet, setLoginItemSet } from './store.js';

/**
 * Whisper is a tray app people dictate with all day, so it starts with the
 * system by default. This runs once, on the first launch of an installed
 * build; after that the user's own choice (Task Manager → Startup apps on
 * Windows, System Settings → Login Items on macOS) stands and is never
 * switched back on.
 */
export function enableStartAtLoginOnce(): void {
  if (!app.isPackaged || getLoginItemSet()) return;

  // Launched straight from the mounted .dmg: registering that path would
  // break once the image is ejected. Try again on a launch from Applications.
  if (process.platform === 'darwin' && !app.isInApplicationsFolder()) return;

  try {
    app.setLoginItemSettings({ openAtLogin: true });
    setLoginItemSet(true);
    log.info('[boot] start at login enabled');
  } catch (error) {
    log.warn(`[boot] could not enable start at login: ${String(error)}`);
  }
}
