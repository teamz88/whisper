import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Menu, Tray, app, nativeImage, type NativeImage } from 'electron';

import type { HotkeyMode } from '@whisper/shared';

import { log } from '../log.js';

/**
 * The tray is the app's home: Whisper launches into it with no window, and
 * closing the dashboard only hides it.
 */

export interface TrayCallbacks {
  onOpenDashboard: () => void;
  onSignOut: () => void;
  onQuit: () => void;
}

function loadTrayIcon(): NativeImage {
  // Packaged: bundled via extraResources. Dev: straight from build/.
  const candidates = [
    join(process.resourcesPath ?? '', 'tray.png'),
    join(app.getAppPath(), 'build', 'tray.png'),
    join(app.getAppPath(), '..', 'build', 'tray.png'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      const image = nativeImage.createFromPath(path);
      if (!image.isEmpty()) return image;
    }
  }

  // Placeholder so a missing icon never breaks startup: a 16x16 rounded dot in
  // the accent colour, drawn straight into a BGRA bitmap.
  log.warn('[tray] build/tray.png missing — using generated placeholder (run npm run build:icons)');

  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const radius = size / 2 - 1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - cx, y - cx);
      if (distance > radius) continue;
      const offset = (y * size + x) * 4;
      buffer[offset] = 0xc1; // B
      buffer[offset + 1] = 0xa0; // G
      buffer[offset + 2] = 0x72; // R  (#72A0C1)
      buffer[offset + 3] = 0xff; // A
    }
  }

  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

export class AppTray {
  private tray: Tray | null = null;
  private readonly callbacks: TrayCallbacks;
  private hotkeyLabel: string;
  /** Hold vs toggle changes the verb the menu uses — see setHotkey(). */
  private hotkeyMode: HotkeyMode;

  constructor(hotkeyLabel: string, hotkeyMode: HotkeyMode, callbacks: TrayCallbacks) {
    this.hotkeyLabel = hotkeyLabel;
    this.hotkeyMode = hotkeyMode;
    this.callbacks = callbacks;
  }

  create(): void {
    if (this.tray !== null) return;

    this.tray = new Tray(loadTrayIcon());
    this.tray.setToolTip(this.tooltip());

    // Left-click opens the dashboard (Windows convention). macOS treats click
    // as menu-open, which is also fine.
    this.tray.on('click', () => this.callbacks.onOpenDashboard());

    this.rebuildMenu();
  }

  /**
   * Called when the hotkey setting changes so the menu shows the truth. The
   * mode matters: telling someone to "hold F12" is actively wrong — a combo
   * with a real key is tap-to-start, tap-to-stop.
   */
  setHotkey(label: string, mode: HotkeyMode): void {
    this.hotkeyLabel = label;
    this.hotkeyMode = mode;
    this.tray?.setToolTip(this.tooltip());
    this.rebuildMenu();
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private verb(): string {
    return this.hotkeyMode === 'hold' ? 'hold' : 'tap';
  }

  private tooltip(): string {
    return `Whisper — ${this.verb()} ${this.hotkeyLabel} to dictate`;
  }

  private rebuildMenu(): void {
    if (this.tray === null) return;

    const menu = Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => this.callbacks.onOpenDashboard() },
      { label: `Dictate: ${this.verb()} ${this.hotkeyLabel}`, enabled: false },
      { type: 'separator' },
      { label: 'Sign Out', click: () => this.callbacks.onSignOut() },
      { label: 'Quit Whisper', click: () => this.callbacks.onQuit() },
    ]);

    this.tray.setContextMenu(menu);
  }
}
