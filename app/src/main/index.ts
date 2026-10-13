import { app, shell } from 'electron';

import { hotkeyLabel, parseHotkey, type Profile } from '@whisper/shared';

import { ApiClient } from './api/client.js';
import { HotkeyListener } from './hotkey/listener.js';
import { recoverHotkey } from './hotkey/permission.js';
import { flushClipboardRestore, verifyPasteKeys } from './inject/paste.js';
import { applySettings, registerIpc, type AppContext } from './ipc.js';
import { log } from './log.js';
import { enableStartAtLoginOnce } from './login-item.js';
import { RecordingController } from './recording/controller.js';
import { getStoredSettings } from './store.js';
import { Updates } from './updates.js';
import { DashboardWindow } from './windows/dashboard.js';
import { OverlayWindow } from './windows/overlay.js';
import { AppTray } from './windows/tray.js';

/**
 * Whisper main process.
 *
 * Launches into the tray with no window. The dashboard opens on demand (tray
 * click, or automatically on first run); the overlay window exists from boot,
 * hidden, so the first dictation does not pay window-creation latency.
 */

const DEV = process.env['ELECTRON_RENDERER_URL'] !== undefined;

const envApiUrl = import.meta.env.VITE_API_URL;
const apiUrl = envApiUrl !== undefined && envApiUrl !== '' ? envApiUrl : 'http://localhost:8080';
const apiUrlMissing = (envApiUrl === undefined || envApiUrl === '') && !DEV;

// A tray app must be a singleton: a second launch would register a second
// keyboard hook and fight the first over the hotkey.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void main();
}

async function main(): Promise<void> {
  let profile: Profile | null = null;

  const dashboard = new DashboardWindow();
  const overlay = new OverlayWindow(getStoredSettings().overlayPosition);

  const broadcast = <T>(channel: string, payload: T): void => {
    dashboard.send(channel, payload);
    overlay.send(channel, payload);
  };

  const api = new ApiClient({
    baseUrl: apiUrl,
    onSignedOut: (reason) => {
      profile = null;
      broadcast('auth:signed-out', { reason });
      if (reason !== 'user') dashboard.show(); // surface the login screen
    },
  });

  const controller = new RecordingController({
    overlay,
    api,
    getSettings: getStoredSettings,
    broadcast,
    waitForModifiersReleased: (timeoutMs): Promise<boolean> =>
      listener.waitForModifiersReleased(timeoutMs),
    getInputActivity: (): number => listener.getInputActivity(),
  });

  // A dead overlay renderer means no audio-ready/audio-empty will ever arrive;
  // the in-flight dictation must be abandoned or the state machine wedges.
  overlay.onRendererGone = () => controller.abort('overlay renderer crashed');

  // Closing (or crashing) the dashboard mid hotkey-capture must re-arm the
  // global listener — the capture UI's own cleanup can no longer run.
  dashboard.onHidden = () => listener.setCapturing(false);

  const listener = new HotkeyListener(getStoredSettings().hotkey, {
    onStart: (source) => {
      // Only dictate for a signed-in user; otherwise pressing the combo while
      // signed out would open a mic and upload to a 401.
      if (profile === null) {
        log.info(`[hotkey] ignored (${source}) — signed out`);
        return;
      }
      controller.startRecording('hotkey');
    },
    onStop: () => controller.stopRecording('hotkey'),
    onCancel: () => controller.cancelRecording('hotkey was part of another shortcut'),
    isListening: () => controller.isListening(),
  });

  const openDashboard = (): void => {
    const alreadyOpen = dashboard.current !== null;
    dashboard.show();
    // With the window already open, "Open Dashboard" should land somewhere
    // predictable rather than wherever the user left off.
    if (alreadyOpen) broadcast('navigate', { page: 'home' });
  };

  const bootHotkey = parseHotkey(getStoredSettings().hotkey);
  const tray = new AppTray(
    hotkeyLabel(getStoredSettings().hotkey, { mac: process.platform === 'darwin' }),
    bootHotkey.mode,
    {
      onOpenDashboard: openDashboard,
      onSignOut: () => void api.logout(),
      onOpenLogs: () => void shell.openPath(app.getPath('logs')),
      onQuit: () => {
        dashboard.quitting = true;
        app.quit();
      },
    },
  );

  const updates = new Updates((channel, payload) => broadcast(channel, payload));

  const context: AppContext = {
    api,
    controller,
    overlay,
    dashboard,
    tray,
    listener,
    updates,
    apiUrl,
    apiUrlMissing,
    broadcast,
    getProfile: () => profile,
    setProfile: (next) => {
      profile = next;
    },
  };

  registerIpc(context);

  app.on('second-instance', () => openDashboard());

  app.on('window-all-closed', () => {
    // Tray app: closing every window is normal, not a reason to quit.
  });

  app.on('activate', () => dashboard.show());

  app.on('before-quit', () => {
    // Every quit path must disarm the close-to-tray handler, not just the tray
    // menu: electron-updater's quitAndInstall() calls app.quit(), and if the
    // dashboard's 'close' handler preventDefault()s it, the quit is silently
    // aborted while the installer is already launching. Same for macOS Cmd+Q.
    dashboard.quitting = true;

    // The overlay is created with closable: false, and on macOS app.quit()
    // asks every window to close — a non-closable one cancels the whole quit
    // (tray Quit, Cmd+Q, AppleScript quit and SIGTERM all just do nothing).
    // destroy() skips the close request.
    overlay.dispose();
  });

  app.on('will-quit', () => {
    // Synchronous by requirement: the uiohook native thread must stop before
    // the JS environment is torn down, and the user's clipboard goes back if a
    // restore was still pending.
    listener.shutdown();
    flushClipboardRestore();
  });

  await app.whenReady();

  if (process.platform === 'darwin') {
    app.dock?.hide(); // menu-bar app: no Dock icon (pairs with LSUIElement)
  }

  if (apiUrlMissing) {
    log.warn('[boot] VITE_API_URL was not set at build time — using http://localhost:8080');
  }

  tray.create();
  enableStartAtLoginOnce();
  overlay.create();
  verifyPasteKeys();
  if (!listener.start()) recoverHotkey(listener);
  updates.start();

  // Restore the saved session off the critical path.
  const applyRestored = (restoredProfile: Profile): void => {
    profile = restoredProfile;
    broadcast('profile:changed', restoredProfile);
    log.info(`[boot] session restored for ${restoredProfile.email}`);

    // Sync settings from the server in the background; until it lands, the
    // local mirror keeps the hotkey armed with the last known combo.
    void api
      .request<Parameters<typeof applySettings>[1]>('/me/settings')
      .then((settings) => applySettings(context, settings))
      .catch(() => undefined);
  };

  const restored = await api.restoreSession();
  if (restored !== null) {
    applyRestored(restored);
  } else if (api.hasSession) {
    // Offline at boot with valid tokens: keep retrying quietly. Without this,
    // launching before Wi-Fi connects would strand the user at a login screen
    // (and a dead hotkey) for the whole session despite a 30-day token.
    const retry = setInterval(() => {
      if (profile !== null || !api.hasSession) {
        clearInterval(retry);
        return;
      }
      void api.restoreSession().then((late) => {
        if (late !== null) {
          clearInterval(retry);
          applyRestored(late);
        }
      });
    }, 30_000);
    retry.unref();
  }

  // First launch (or signed out): the dashboard is the entry point. Otherwise
  // stay in the tray — the user opens it when they want it.
  const firstRun = restored === null || !restored.onboarded;
  if (firstRun) {
    dashboard.show();
  }

  log.info(`[boot] ready · api=${apiUrl} · signed-in=${restored !== null}`);
}
