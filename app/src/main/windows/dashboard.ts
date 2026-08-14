import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, shell } from 'electron';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * The one dashboard window. Closing it hides it (the app lives in the tray);
 * only Quit actually exits.
 */
export class DashboardWindow {
  private window: BrowserWindow | null = null;
  /** True while the app is really quitting, so 'close' stops hiding. */
  quitting = false;

  /**
   * Fired when the window hides or its renderer dies. Main uses it to reset
   * transient renderer-driven modes — chiefly hotkey capture, which suspends
   * the global listener and would otherwise stay suspended forever if the
   * window closed mid-capture.
   */
  onHidden: (() => void) | null = null;

  get current(): BrowserWindow | null {
    return this.window;
  }

  show(): void {
    if (this.window !== null) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show();
      this.window.focus();
      return;
    }

    this.window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 800,
      minHeight: 560,
      show: false,
      frame: false,
      // macOS keeps its traffic lights over our React titlebar.
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      backgroundColor: '#F1ECE0',
      title: 'Whisper',
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        // Required for the ESM (.mjs) preload.
        sandbox: false,
        spellcheck: false,
      },
    });

    this.window.once('ready-to-show', () => {
      this.window?.show();
    });

    this.window.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        this.window?.hide();
        this.onHidden?.();
      }
    });

    this.window.on('closed', () => {
      this.window = null;
      this.onHidden?.();
    });

    this.window.webContents.on('render-process-gone', () => {
      this.onHidden?.();
    });

    // Any external link opens in the default browser, never inside Electron.
    this.window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url);
      return { action: 'deny' };
    });

    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl !== undefined && devUrl !== '') {
      void this.window.loadURL(devUrl);
    } else {
      void this.window.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  send(channel: string, payload: unknown): void {
    this.window?.webContents.send(channel, payload);
  }

  destroy(): void {
    this.quitting = true;
    this.window?.destroy();
    this.window = null;
  }
}
