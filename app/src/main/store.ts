import Store from 'electron-store';

import { DEFAULT_SETTINGS, type Settings } from '@whisper/shared';

/**
 * Local persistence: auth tokens, a mirror of the user's settings, and the
 * onboarding flag.
 *
 * electron-store 11 is ESM-only; this import only works because the main
 * process is built as ESM (a CJS main would make `new Store()` throw
 * "Store is not a constructor").
 *
 * The settings mirror exists so the hotkey listener can arm itself the moment
 * the app launches, before — or without — a network round-trip. The server's
 * row remains the source of truth; the mirror is refreshed after every
 * successful settings call.
 */

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
}

interface StoreSchema {
  auth: StoredAuth | null;
  settings: Settings;
  onboarded: boolean;
  /** Client-side only: preferred input device for recording. */
  micDeviceId: string | null;
  /** Start-at-login was switched on once; from then on the user's choice stands. */
  loginItemSet: boolean;
  /** Self-hosted server chosen on the sign-in screen; null = the one built in. */
  serverUrl: string | null;
}

const store = new Store<StoreSchema>({
  name: 'whisper',
  defaults: {
    auth: null,
    settings: DEFAULT_SETTINGS,
    onboarded: false,
    micDeviceId: null,
    loginItemSet: false,
    serverUrl: null,
  },
});

export function getStoredAuth(): StoredAuth | null {
  return store.get('auth');
}

/**
 * Called on login AND on every refresh. The backend rotates the refresh token
 * on each use, so failing to persist here logs the user out the next time the
 * app restarts with the stale token.
 */
export function setStoredAuth(auth: StoredAuth | null): void {
  store.set('auth', auth);
}

export function getStoredSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...store.get('settings') };
}

export function setStoredSettings(settings: Settings): void {
  store.set('settings', settings);
}

export function getOnboarded(): boolean {
  return store.get('onboarded');
}

export function setOnboarded(onboarded: boolean): void {
  store.set('onboarded', onboarded);
}

export function getMicDeviceId(): string | null {
  return store.get('micDeviceId');
}

export function setMicDeviceId(deviceId: string | null): void {
  store.set('micDeviceId', deviceId);
}

export function getLoginItemSet(): boolean {
  return store.get('loginItemSet');
}

export function setLoginItemSet(set: boolean): void {
  store.set('loginItemSet', set);
}

export function getServerUrl(): string | null {
  return store.get('serverUrl');
}

export function setServerUrl(url: string | null): void {
  store.set('serverUrl', url);
}

/** Sign-out wipes credentials but keeps device-local preferences. */
export function clearAuth(): void {
  store.set('auth', null);
}
