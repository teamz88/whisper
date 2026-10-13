import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, screen } from 'electron';

import type { OverlayPosition } from '@whisper/shared';

import {
  OVERLAY_BOTTOM_MARGIN,
  OVERLAY_HEIGHT,
  OVERLAY_SIDE_MARGIN,
  OVERLAY_WIDTH,
  type OverlayState,
} from '../../shared/overlay.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * The floating pill shown while recording. It must never interfere with what
 * the user is doing:
 *  - not focusable — focus stays in the app being dictated into, or the paste
 *    lands in the wrong place;
 *  - always on top at screen-saver level, above fullscreen video;
 *  - transparent and frameless, so only the pill itself is visible.
 *
 * It also owns the microphone: getUserMedia runs in this window's renderer,
 * which keeps the mic stream alive even when the dashboard is closed.
 */
export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private position: OverlayPosition;
  private state: OverlayState = { kind: 'idle' };
  private hideTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  /**
   * Fired when the overlay's renderer process dies. The recording controller
   * must abort any in-flight dictation: its 'processing' phase can only be
   * exited by events from that renderer, so without this hook one renderer
   * crash would wedge dictation until the app restarts.
   */
  onRendererGone: (() => void) | null = null;

  constructor(position: OverlayPosition) {
    this.position = position;
  }

  /** Created eagerly at app start so the first dictation does not pay for it. */
  create(): void {
    if (this.window !== null || this.disposed) return;

    this.window = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        // ESM preloads run as plain scripts under the sandbox; it must be off.
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setIgnoreMouseEvents(false);

    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl !== undefined && devUrl !== '') {
      void this.window.loadURL(`${devUrl}/overlay.html`);
    } else {
      void this.window.loadFile(join(__dirname, '../renderer/overlay.html'));
    }

    this.window.on('closed', () => {
      this.window = null;
    });

    // A dictation can start before the overlay renderer has mounted (right
    // after boot). webContents.send into an unloaded page is silently lost, so
    // replay the current state once the page is actually there. (The renderer
    // answers a replayed 'processing' it never recorded for with audio-empty,
    // so the controller can never wait forever on a restarted overlay.)
    this.window.webContents.on('did-finish-load', () => {
      if (this.state.kind !== 'idle') {
        this.window?.webContents.send('overlay:state', this.state);
      }
    });

    this.window.webContents.on('render-process-gone', (_event, details) => {
      console.warn(`[overlay] renderer gone (${details.reason}) — recreating`);
      this.window?.destroy();
      this.window = null;
      this.state = { kind: 'idle' };
      this.onRendererGone?.();
      // Recreate eagerly so the next dictation has a window waiting.
      this.create();
    });
  }

  setPosition(position: OverlayPosition): void {
    this.position = position;
    if (this.window?.isVisible() === true) this.reposition();
  }

  setState(state: OverlayState): void {
    this.state = state;
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    if (state.kind === 'idle') {
      // The renderer must see it too: idle straight from listening is a
      // cancel, and the mic it holds has to close.
      this.window?.webContents.send('overlay:state', state);
      this.hide();
      return;
    }

    this.create();
    this.window?.webContents.send('overlay:state', state);
    this.show();
  }

  getState(): OverlayState {
    return this.state;
  }

  /** Lets the fade-out animation in the renderer finish before hiding. */
  hideAfter(ms: number): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.state = { kind: 'idle' };
      this.hide();
    }, ms);
  }

  send(channel: string, payload: unknown): void {
    this.window?.webContents.send(channel, payload);
  }

  destroy(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.window?.destroy();
    this.window = null;
  }

  /** For quit: destroy and never recreate, or the new window blocks the quit again. */
  dispose(): void {
    this.disposed = true;
    this.destroy();
  }

  private show(): void {
    if (this.window === null) return;
    this.reposition();
    if (!this.window.isVisible()) {
      this.window.showInactive(); // never steal focus from the target app
    }
    // Re-assert on every show: other always-on-top windows (screen recorders,
    // volume OSDs) can climb above us between dictations.
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.moveTop();
  }

  private hide(): void {
    this.window?.hide();
  }

  private reposition(): void {
    if (this.window === null) return;

    // The display under the cursor, not the primary one — dictation happens
    // where the user is working.
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const area = display.workArea;

    const y = area.y + area.height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_MARGIN;
    let x: number;

    switch (this.position) {
      case 'bottom-left':
        x = area.x + OVERLAY_SIDE_MARGIN;
        break;
      case 'bottom-right':
        x = area.x + area.width - OVERLAY_WIDTH - OVERLAY_SIDE_MARGIN;
        break;
      case 'bottom-center':
      default:
        x = area.x + Math.round((area.width - OVERLAY_WIDTH) / 2);
        break;
    }

    this.window.setBounds({ x, y, width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT });
  }
}
