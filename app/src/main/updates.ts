import electronUpdater from 'electron-updater';

import type { UpdateStatus } from '../shared/ipc.js';
import { log } from './log.js';

// electron-updater is CommonJS; destructure off the default export.
const { autoUpdater } = electronUpdater;

/**
 * Auto-update from GitHub Releases.
 *
 * Policy: check shortly after launch and then hourly, download in the
 * background, and NEVER install on quit by itself — someone mid-dictation does
 * not want an installer. The toast in the dashboard offers "Restart now",
 * which is the only path to quitAndInstall.
 */

const FIRST_CHECK_DELAY_MS = 8_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export class Updates {
  private status: UpdateStatus = { kind: 'idle' };
  private readonly broadcast: (channel: string, payload: UpdateStatus) => void;
  private timer: NodeJS.Timeout | null = null;

  constructor(broadcast: (channel: string, payload: UpdateStatus) => void) {
    this.broadcast = broadcast;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => this.setStatus({ kind: 'checking' }));
    autoUpdater.on('update-available', (info) =>
      this.setStatus({ kind: 'available', version: info.version }),
    );
    autoUpdater.on('update-not-available', (info) =>
      this.setStatus({ kind: 'not-available', version: info.version }),
    );
    autoUpdater.on('download-progress', (progress) =>
      this.setStatus({ kind: 'progress', percent: progress.percent }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      this.setStatus({ kind: 'downloaded', version: info.version }),
    );
    autoUpdater.on('error', (error) => {
      // The two everyday causes are "no release published yet" and "offline" —
      // neither is an incident, so the message says so and no toast fires (the
      // status shows only in Settings → Updates).
      log.warn(`[updates] ${error.message}`);
      this.setStatus({
        kind: 'error',
        message: "Couldn't check for updates — none published yet, or you're offline.",
      });
    });
  }

  /** No-op in dev — there is no packaged app to update. */
  start(): void {
    if (process.env['ELECTRON_RENDERER_URL'] !== undefined) {
      log.info('[updates] dev mode, updater disabled');
      return;
    }

    setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS).unref?.();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  async check(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log.warn(`[updates] check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  restartAndInstall(): void {
    if (this.status.kind !== 'downloaded') return;
    autoUpdater.quitAndInstall();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    this.broadcast('update:status', status);
    if (status.kind !== 'progress') log.info(`[updates] ${status.kind}`);
  }
}
