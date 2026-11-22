import { join } from 'node:path';

import { app } from 'electron';

/**
 * A development run (`npm run dev:app`) gets its own profile folder.
 *
 * Without this it shares %APPDATA%\@whisper\app (~/Library/Application
 * Support/@whisper/app on macOS) with an installed Whisper on the same
 * machine: signing in to a local server signed the real app out, settings
 * leaked between the two, and both fought over one single-instance lock.
 *
 * Imported FIRST in index.ts, for a side effect: store.ts opens electron-store
 * while its module is evaluated, so the path must be moved before that import.
 */
if (process.env['ELECTRON_RENDERER_URL'] !== undefined) {
  const devUserData = `${app.getPath('userData')}-dev`;
  app.setPath('userData', devUserData);
  app.setAppLogsPath(join(devUserData, 'logs'));
}
