import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

/** electron-store stand-in: a plain object seeded with the defaults. */
class FakeStore {
  data: Record<string, unknown>;
  constructor(options: { defaults: Record<string, unknown> }) {
    this.data = structuredClone(options.defaults);
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

const { getServerUrl, retireServerUrl, setServerUrl } = await import('../src/main/store.ts');
const OLD = 'https://whisper.agent.omadligrouphq.com';

const reset = (): void => {
  stores[0]!.data['serverUrl'] = null;
  stores[0]!.data['retiredServerUrls'] = [];
};

test('a saved old address is cleared, so the built-in new server takes over', () => {
  reset();
  setServerUrl(`${OLD}/`);
  assert.equal(retireServerUrl(OLD), true);
  assert.equal(getServerUrl(), null);
});

test('only once: typing the old address back afterwards sticks', () => {
  reset();
  setServerUrl(OLD);
  retireServerUrl(OLD);
  setServerUrl(OLD);
  assert.equal(retireServerUrl(OLD), false);
  assert.equal(getServerUrl(), OLD);
});

test('any other saved server (self-hosted, local) is left alone', () => {
  reset();
  setServerUrl('http://localhost:8080');
  assert.equal(retireServerUrl(OLD), false);
  assert.equal(getServerUrl(), 'http://localhost:8080');
});
