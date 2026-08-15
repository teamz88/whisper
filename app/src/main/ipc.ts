import { BrowserWindow, app, clipboard, ipcMain, shell } from 'electron';

import {
  hotkeyLabel,
  parseHotkey,
  type AdminStats,
  type AdminUser,
  type CreateUserRequest,
  type DeleteAllSessionsResponse,
  type Profile,
  type SessionPage,
  type Settings,
  type UpdateProfileRequest,
  type UpdateSettingsRequest,
  type UserStats,
} from '@whisper/shared';

import type {
  AppInfo,
  AppPlatform,
  AudioReadyPayload,
  IpcInvokeChannel,
  IpcInvokeMap,
  LoginPayload,
  LoginResult,
} from '../shared/ipc.js';
import type { ApiClient } from './api/client.js';
import type { HotkeyListener } from './hotkey/listener.js';
import { log } from './log.js';
import type { RecordingController } from './recording/controller.js';
import {
  getMicDeviceId,
  getOnboarded,
  getStoredSettings,
  setMicDeviceId,
  setOnboarded,
  setStoredSettings,
} from './store.js';
import type { Updates } from './updates.js';
import type { DashboardWindow } from './windows/dashboard.js';
import type { OverlayWindow } from './windows/overlay.js';
import type { AppTray } from './windows/tray.js';

export interface AppContext {
  api: ApiClient;
  controller: RecordingController;
  overlay: OverlayWindow;
  dashboard: DashboardWindow;
  tray: AppTray;
  listener: HotkeyListener;
  updates: Updates;
  apiUrl: string;
  apiUrlMissing: boolean;
  broadcast: <T>(channel: string, payload: T) => void;
  getProfile: () => Profile | null;
  setProfile: (profile: Profile | null) => void;
}

/**
 * Server settings are the source of truth; this mirrors them into everything
 * that acts on them locally: the store (so the hotkey works before the first
 * fetch after a restart), the listener, the overlay position and the tray.
 */
export function applySettings(context: AppContext, settings: Settings): void {
  setStoredSettings(settings);
  context.listener.setHotkey(settings.hotkey);
  context.overlay.setPosition(settings.overlayPosition);
  context.tray.setHotkey(
    hotkeyLabel(settings.hotkey, { mac: process.platform === 'darwin' }),
    parseHotkey(settings.hotkey).mode,
  );
  context.broadcast('settings:changed', settings);
}

type Handler<K extends IpcInvokeChannel> = (
  payload: IpcInvokeMap[K]['req'],
  window: BrowserWindow | null,
) => Promise<IpcInvokeMap[K]['res']> | IpcInvokeMap[K]['res'];

export function registerIpc(context: AppContext): void {
  const handle = <K extends IpcInvokeChannel>(channel: K, handler: Handler<K>): void => {
    ipcMain.handle(channel, (event, payload) => {
      const window = event.sender.isDestroyed()
        ? null
        : BrowserWindow.fromWebContents(event.sender);
      return handler(payload as IpcInvokeMap[K]['req'], window);
    });
  };

  // -------------------------------------------------------------------------
  // App
  // -------------------------------------------------------------------------

  handle('app:info', (): AppInfo => {
    return {
      version: app.getVersion(),
      platform: process.platform as AppPlatform,
      apiUrl: context.apiUrl,
      apiUrlMissing: context.apiUrlMissing,
    };
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  handle('auth:status', () => {
    const profile = context.getProfile();
    return { profile, onboarded: profile?.onboarded ?? getOnboarded() };
  });

  handle('auth:login', async (payload: LoginPayload): Promise<LoginResult> => {
    try {
      const profile = await context.api.login(payload.email, payload.password);
      context.setProfile(profile);
      setOnboarded(profile.onboarded);

      // Pull the user's settings so the hotkey and overlay match their account
      // from the first dictation on this machine.
      try {
        const settings = await context.api.request<Settings>('/me/settings');
        applySettings(context, settings);
      } catch (error) {
        log.warn(`[ipc] settings fetch after login failed: ${String(error)}`);
      }

      return { ok: true, profile };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not sign in.',
      };
    }
  });

  handle('auth:logout', async () => {
    await context.api.logout();
  });

  // -------------------------------------------------------------------------
  // Profile & settings
  // -------------------------------------------------------------------------

  handle('profile:get', async () => {
    const profile = await context.api.request<Profile>('/me/profile');
    context.setProfile(profile);
    return profile;
  });

  handle('profile:update', async (patch: UpdateProfileRequest) => {
    const profile = await context.api.request<Profile>('/me/profile', {
      method: 'PATCH',
      body: patch,
    });
    context.setProfile(profile);
    if (patch.onboarded !== undefined) setOnboarded(patch.onboarded);
    context.broadcast('profile:changed', profile);
    return profile;
  });

  handle('settings:get', async () => {
    if (!context.api.hasSession) return getStoredSettings();
    try {
      const settings = await context.api.request<Settings>('/me/settings');
      setStoredSettings(settings);
      return settings;
    } catch (error) {
      // Offline: the local mirror keeps the app usable.
      log.warn(`[ipc] settings fetch failed, using local mirror: ${String(error)}`);
      return getStoredSettings();
    }
  });

  handle('settings:update', async (patch: UpdateSettingsRequest) => {
    const settings = await context.api.request<Settings>('/me/settings', {
      method: 'PUT',
      body: patch,
    });
    applySettings(context, settings);
    return settings;
  });

  // -------------------------------------------------------------------------
  // Sessions & stats
  // -------------------------------------------------------------------------

  handle('sessions:list', async ({ page, search }) => {
    return context.api.request<SessionPage>('/me/sessions', {
      query: { page, search },
    });
  });

  handle('sessions:delete', async ({ id }) => {
    await context.api.request<void>(`/me/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  });

  handle('sessions:delete-all', async () => {
    return context.api.request<DeleteAllSessionsResponse>('/me/sessions', { method: 'DELETE' });
  });

  handle('stats:get', async () => {
    return context.api.request<UserStats>('/me/stats', {
      query: { tzOffset: new Date().getTimezoneOffset() },
    });
  });

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  handle('admin:users', async () => context.api.request<AdminUser[]>('/admin/users'));

  handle('admin:create-user', async (payload: CreateUserRequest) => {
    return context.api.request<AdminUser>('/admin/users', { method: 'POST', body: payload });
  });

  handle('admin:update-user', async ({ id, patch }) => {
    return context.api.request<AdminUser>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    });
  });

  handle('admin:delete-user', async ({ id }) => {
    await context.api.request<{ deleted: true }>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  });

  handle('admin:stats', async () => context.api.request<AdminStats>('/admin/stats'));

  // -------------------------------------------------------------------------
  // Recording & hotkey
  // -------------------------------------------------------------------------

  handle('recording:toggle', () => context.controller.toggle());
  handle('recording:state', () => context.controller.getState());

  handle('hotkey:set', async ({ hotkey }) => {
    const settings = await context.api.request<Settings>('/me/settings', {
      method: 'PUT',
      body: { hotkey },
    });
    applySettings(context, settings);
    return settings;
  });

  handle('hotkey:capture', ({ capturing }) => {
    context.listener.setCapturing(capturing);
  });

  // -------------------------------------------------------------------------
  // Window controls (frameless titlebar)
  // -------------------------------------------------------------------------

  handle('window:minimize', (_payload, window) => {
    window?.minimize();
  });

  handle('window:toggle-maximize', (_payload, window) => {
    if (window === null) return false;
    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }
    window.maximize();
    return true;
  });

  handle('window:close', (_payload, window) => {
    window?.close(); // dashboard 'close' hides rather than quits
  });

  handle('window:is-maximized', (_payload, window) => window?.isMaximized() ?? false);

  // -------------------------------------------------------------------------
  // Updates & system
  // -------------------------------------------------------------------------

  handle('updates:status', () => context.updates.getStatus());
  handle('updates:check', () => void context.updates.check());
  handle('updates:restart', () => context.updates.restartAndInstall());

  handle('system:open-mic-settings', async () => {
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy-microphone');
    } else if (process.platform === 'darwin') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      );
    }
  });

  handle('clipboard:write', ({ text }) => {
    clipboard.writeText(text);
  });

  handle('mic:get-device', () => getMicDeviceId());

  handle('mic:set-device', ({ deviceId }) => {
    setMicDeviceId(deviceId);
  });

  // -------------------------------------------------------------------------
  // Overlay renderer -> main (fire-and-forget)
  // -------------------------------------------------------------------------

  ipcMain.on('overlay:audio-ready', (_event, payload: AudioReadyPayload) => {
    context.controller.onAudioReady(payload);
  });

  ipcMain.on('overlay:mic-denied', (_event, payload: { message: string; generation: number }) => {
    context.controller.onMicDenied(payload.message, payload.generation);
  });

  ipcMain.on('overlay:audio-empty', (_event, payload: { generation: number }) => {
    context.controller.onAudioEmpty(payload.generation);
  });

  ipcMain.on('overlay:stop-requested', (_event, payload: { reason: 'escape' | 'max-duration' }) => {
    context.controller.onOverlayStopRequested(payload.reason);
  });

  ipcMain.on('renderer:ready', () => {
    // The dashboard just mounted; give it the current update status in case a
    // download finished while the window was closed.
    context.broadcast('update:status', context.updates.getStatus());
  });
}
