import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

/** Stand-ins for Electron's nativeTheme and the electron-store wrapper. */
const nativeTheme = { themeSource: 'system' as string, shouldUseDarkColors: false };
let stored: unknown = 'system';

mock.module('electron', { namedExports: { nativeTheme } });
mock.module(new URL('../src/main/store.ts', import.meta.url).href, {
  namedExports: {
    getThemePreference: () => stored,
    setThemePreference: (theme: unknown) => {
      stored = theme;
    },
  },
});

const { initTheme, isThemePreference, saveThemePreference, windowBackground } = await import(
  '../src/main/theme.ts'
);

test('only the three known themes are accepted from the renderer', () => {
  for (const theme of ['system', 'light', 'dark']) assert.equal(isThemePreference(theme), true);
  for (const theme of ['Dark', 'auto', '', null, undefined, 1, {}]) {
    assert.equal(isThemePreference(theme), false, `rejects ${JSON.stringify(theme)}`);
  }
});

test('saving a theme persists it and applies it to every window via nativeTheme', () => {
  saveThemePreference('dark');
  assert.equal(stored, 'dark');
  assert.equal(nativeTheme.themeSource, 'dark');

  saveThemePreference('light');
  assert.equal(stored, 'light');
  assert.equal(nativeTheme.themeSource, 'light');
});

test('the saved theme is applied at startup', () => {
  stored = 'dark';
  nativeTheme.themeSource = 'system';
  initTheme();
  assert.equal(nativeTheme.themeSource, 'dark');
});

test('the native window background matches the active theme', () => {
  nativeTheme.shouldUseDarkColors = false;
  assert.equal(windowBackground(), '#F1ECE0');
  nativeTheme.shouldUseDarkColors = true;
  assert.equal(windowBackground(), '#1A1814');
});
