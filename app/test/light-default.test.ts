import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

/** electron-store stand-in: defaults first, then whatever an older install saved. */
const saved: Record<string, unknown> = {};
class FakeStore {
  data: Record<string, unknown>;
  constructor(options: { defaults: Record<string, unknown> }) {
    this.data = { ...structuredClone(options.defaults), ...saved };
    stores.push(this);
  }
  get(key: string): unknown {
    return this.data[key];
  }
  set(key: string, value: unknown): void {
    this.data[key] = value;
  }
}
const stores: FakeStore[] = [];
mock.module('electron-store', { defaultExport: FakeStore });

const { applyLightDefaultOnce, getThemePreference, setThemePreference } = await import(
  '../src/main/store.ts'
);
const data = (): Record<string, unknown> => stores[0]!.data;

test('a fresh install starts light', () => {
  assert.equal(getThemePreference(), 'light');
});

test('an older install on the old System default moves to light, once', () => {
  data()['theme'] = 'system';
  data()['lightDefaultApplied'] = false;
  applyLightDefaultOnce();
  assert.equal(getThemePreference(), 'light');

  // Choosing System again afterwards sticks.
  setThemePreference('system');
  applyLightDefaultOnce();
  assert.equal(getThemePreference(), 'system');
});

test('someone who chose Dark keeps it', () => {
  data()['theme'] = 'dark';
  data()['lightDefaultApplied'] = false;
  applyLightDefaultOnce();
  assert.equal(getThemePreference(), 'dark');
});
