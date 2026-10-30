/**
 * The IPC contract.
 *
 * Compiled by all three bundles (main, preload, renderer), so a channel can
 * never be renamed on one side only. The preload exposes exactly `invoke`,
 * `send` and `on` over contextBridge — the renderer gets no other reach into
 * Electron, and no reach at all into Node.
 */

import type {
  AdminStats,
  AdminUser,
  CreateUserRequest,
  LanguageCode,
  Profile,
  Session,
  SessionPage,
  Settings,
  UpdateProfileRequest,
  UpdateSettingsRequest,
  UpdateUserRequest,
  UserStats,
  WritingStyle,
} from '@whisper/shared';

import type { OverlayState } from './overlay.js';

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface AuthStatus {
  /** Null when signed out. */
  profile: Profile | null;
  /** Mirrors profile.onboarded, but survives a signed-out first launch. */
  onboarded: boolean;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResult {
  ok: boolean;
  profile?: Profile;
  /** User-facing text, already mapped from the API error code. */
  error?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResult {
  ok: boolean;
  /** User-facing text, already mapped from the API error. */
  error?: string;
}

/** Which server the app talks to. `custom` = chosen on the sign-in screen. */
export interface ServerInfo {
  url: string;
  defaultUrl: string;
  custom: boolean;
}

export interface SetServerResult {
  ok: boolean;
  /** User-facing text when ok is false. */
  error?: string;
  server?: ServerInfo;
}

export interface ListSessionsPayload {
  page: number;
  search?: string;
}

/**
 * Not NodeJS.Platform: this file is also compiled by the renderer tsconfig,
 * which has no Node types. The values are the same strings process.platform
 * produces.
 */
export type AppPlatform = 'win32' | 'darwin' | 'linux';

export interface AppInfo {
  version: string;
  platform: AppPlatform;
  apiUrl: string;
  /** Set when VITE_API_URL was missing at build time. */
  apiUrlMissing: boolean;
}

/**
 * What the overlay hands back when the mic stream closes: 16 kHz mono PCM as
 * float samples, plus the timestamps taken around getUserMedia.
 */
export interface AudioReadyPayload {
  /** Transferable. Float32 samples in [-1, 1] at 16 kHz. */
  samples: ArrayBuffer;
  sampleRate: number;
  /** Epoch ms, taken right AFTER getUserMedia resolved. */
  audioStartedAt: number;
  audioStoppedAt: number;
  /** Echo of the listening state's generation — stale results are dropped. */
  generation: number;
}

export type RecordingSource = 'hotkey' | 'dashboard';

export interface RecordingState {
  active: boolean;
  source: RecordingSource | null;
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'not-available'; version: string }
  | { kind: 'progress'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

export interface MicDevice {
  deviceId: string;
  label: string;
}

// ---------------------------------------------------------------------------
// renderer -> main, request/response
// ---------------------------------------------------------------------------

export interface IpcInvokeMap {
  'app:info': { req: void; res: AppInfo };

  'auth:status': { req: void; res: AuthStatus };
  'auth:login': { req: LoginPayload; res: LoginResult };
  'auth:logout': { req: void; res: void };
  'auth:change-password': { req: ChangePasswordPayload; res: ChangePasswordResult };

  'server:get': { req: void; res: ServerInfo };
  /** url null = back to the built-in server. Refused while signed in. */
  'server:set': { req: { url: string | null }; res: SetServerResult };

  'profile:get': { req: void; res: Profile };
  'profile:update': { req: UpdateProfileRequest; res: Profile };

  'settings:get': { req: void; res: Settings };
  'settings:update': { req: UpdateSettingsRequest; res: Settings };

  'sessions:list': { req: ListSessionsPayload; res: SessionPage };
  'sessions:delete': { req: { id: string }; res: void };
  'sessions:delete-all': { req: void; res: { deleted: number } };

  'stats:get': { req: void; res: UserStats };

  'admin:users': { req: void; res: AdminUser[] };
  'admin:create-user': { req: CreateUserRequest; res: AdminUser };
  /** Any subset of UpdateUserRequest: email, password, fullName, role, isActive. */
  'admin:update-user': { req: { id: string; patch: UpdateUserRequest }; res: AdminUser };
  /** Permanent — the account and all its history cascade away. */
  'admin:delete-user': { req: { id: string }; res: void };
  'admin:stats': { req: void; res: AdminStats };

  /** Dashboard Dictation Bar. Also the universal stop for hotkey recordings. */
  'recording:toggle': { req: void; res: RecordingState };
  'recording:state': { req: void; res: RecordingState };

  'hotkey:set': { req: { hotkey: string }; res: Settings };
  /** Suspends the global listener while Settings captures a new combo. */
  'hotkey:capture': { req: { capturing: boolean }; res: void };

  'window:minimize': { req: void; res: void };
  'window:toggle-maximize': { req: void; res: boolean };
  'window:close': { req: void; res: void };
  'window:is-maximized': { req: void; res: boolean };

  'updates:status': { req: void; res: UpdateStatus };
  'updates:check': { req: void; res: void };
  'updates:restart': { req: void; res: void };

  'system:open-mic-settings': { req: void; res: void };
  'clipboard:write': { req: { text: string }; res: void };

  /**
   * The preferred input device. Device-local (electron-store, not the server):
   * a deviceId only means something on the machine that enumerated it.
   */
  'mic:get-device': { req: void; res: string | null };
  'mic:set-device': { req: { deviceId: string | null }; res: void };
}

export type IpcInvokeChannel = keyof IpcInvokeMap;

// ---------------------------------------------------------------------------
// renderer -> main, fire and forget
// ---------------------------------------------------------------------------

export interface IpcSendMap {
  /** Overlay: the mic stream closed, here is the audio. */
  'overlay:audio-ready': AudioReadyPayload;
  /** Overlay: getUserMedia rejected. */
  'overlay:mic-denied': { message: string; generation: number };
  /** Overlay: nothing was captured (silence, or a superseded recording). */
  'overlay:audio-empty': { generation: number };
  /** Overlay: Escape pressed, or the 10-minute cap hit. */
  'overlay:stop-requested': { reason: 'escape' | 'max-duration' };
  /** Dashboard: mounted and ready for broadcasts. */
  'renderer:ready': void;
}

export type IpcSendChannel = keyof IpcSendMap;

// ---------------------------------------------------------------------------
// main -> renderer broadcasts
// ---------------------------------------------------------------------------

export interface IpcEventMap {
  'overlay:state': OverlayState;
  'recording:state': RecordingState;
  /** A dictation was stored; the dashboard prepends it to the Today list. */
  'session:created': Session;
  /** A dictation completed with history storage off — stats still move. */
  'session:completed': { wordCount: number; durationMs: number };
  'settings:changed': Settings;
  'profile:changed': Profile;
  'auth:signed-out': { reason: 'user' | 'expired' | 'disabled' };
  'mic:permission-denied': { message: string };
  'update:status': UpdateStatus;
  /** Tray "Open Dashboard" while the dashboard is already open. */
  'navigate': { page: 'home' | 'history' | 'settings' };
}

export type IpcEventChannel = keyof IpcEventMap;

// ---------------------------------------------------------------------------
// The surface the preload puts on window.whisper
// ---------------------------------------------------------------------------

export interface WhisperBridge {
  invoke<K extends IpcInvokeChannel>(
    channel: K,
    ...args: IpcInvokeMap[K]['req'] extends void ? [] : [IpcInvokeMap[K]['req']]
  ): Promise<IpcInvokeMap[K]['res']>;

  send<K extends IpcSendChannel>(
    channel: K,
    ...args: IpcSendMap[K] extends void ? [] : [IpcSendMap[K]]
  ): void;

  /** Returns an unsubscribe function — call it from a useEffect cleanup. */
  on<K extends IpcEventChannel>(channel: K, listener: (payload: IpcEventMap[K]) => void): () => void;
}

export const BRIDGE_KEY = 'whisper' as const;

/** Runtime lists, used by the preload to reject any channel not declared above. */
export const INVOKE_CHANNELS: readonly IpcInvokeChannel[] = [
  'app:info',
  'auth:status',
  'auth:login',
  'auth:logout',
  'auth:change-password',
  'server:get',
  'server:set',
  'profile:get',
  'profile:update',
  'settings:get',
  'settings:update',
  'sessions:list',
  'sessions:delete',
  'sessions:delete-all',
  'stats:get',
  'admin:users',
  'admin:create-user',
  'admin:update-user',
  'admin:delete-user',
  'admin:stats',
  'recording:toggle',
  'recording:state',
  'hotkey:set',
  'hotkey:capture',
  'window:minimize',
  'window:toggle-maximize',
  'window:close',
  'window:is-maximized',
  'updates:status',
  'updates:check',
  'updates:restart',
  'system:open-mic-settings',
  'clipboard:write',
  'mic:get-device',
  'mic:set-device',
];

export const SEND_CHANNELS: readonly IpcSendChannel[] = [
  'overlay:audio-ready',
  'overlay:mic-denied',
  'overlay:audio-empty',
  'overlay:stop-requested',
  'renderer:ready',
];

export const EVENT_CHANNELS: readonly IpcEventChannel[] = [
  'overlay:state',
  'recording:state',
  'session:created',
  'session:completed',
  'settings:changed',
  'profile:changed',
  'auth:signed-out',
  'mic:permission-denied',
  'update:status',
  'navigate',
];

/** Re-exported so the renderer can `import type { OverlayState } from './ipc'`. */
export type { OverlayState, LanguageCode, WritingStyle };
