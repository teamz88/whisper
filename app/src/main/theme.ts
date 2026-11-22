import { nativeTheme } from 'electron';

import type { ThemePreference } from '../shared/ipc.js';
import { getThemePreference, setThemePreference } from './store.js';

/**
 * Light / dark / follow-the-system, as a device-local preference.
 *
 * Main owns it by setting nativeTheme.themeSource. That one switch flips the
 * `prefers-color-scheme` media query in EVERY renderer at once — dashboard and
 * overlay — so the CSS needs nothing but a media query, no class toggling and
 * no IPC per window, and it also themes native bits like form controls and
 * scrollbars. 'system' keeps tracking the OS setting live.
 */

/** Painted before the renderer's first frame; matches --color-cream per theme. */
const BACKGROUND = { light: '#F1ECE0', dark: '#1A1814' } as const;

export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light;
}

export function applyThemePreference(theme: ThemePreference): void {
  nativeTheme.themeSource = theme;
}

export function initTheme(): void {
  applyThemePreference(getThemePreference());
}

export function saveThemePreference(theme: ThemePreference): void {
  setThemePreference(theme);
  applyThemePreference(theme);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}
