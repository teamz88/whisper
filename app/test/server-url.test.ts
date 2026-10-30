import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeServerUrl } from '../src/main/server-url.ts';

const ok = (input: string): string | null => {
  const result = normalizeServerUrl(input);
  return result.ok ? result.url : null;
};

test('a bare domain becomes https', () => {
  assert.equal(ok('whisper.example.com'), 'https://whisper.example.com');
});

test('trailing slash, path and surrounding spaces are dropped', () => {
  assert.equal(ok('  https://whisper.example.com/health  '), 'https://whisper.example.com');
  assert.equal(ok('https://whisper.example.com/'), 'https://whisper.example.com');
});

test('a port is kept', () => {
  assert.equal(ok('https://whisper.example.com:8443'), 'https://whisper.example.com:8443');
});

test('a bare local address becomes http', () => {
  assert.equal(ok('192.168.1.5:8080'), 'http://192.168.1.5:8080');
  assert.equal(ok('localhost:8080'), 'http://localhost:8080');
  assert.equal(ok('10.0.0.7'), 'http://10.0.0.7');
  assert.equal(ok('172.20.1.1:8080'), 'http://172.20.1.1:8080');
});

test('http to a public host is refused', () => {
  assert.equal(ok('http://whisper.example.com'), null);
  assert.equal(ok('http://8.8.8.8:8080'), null);
  assert.equal(ok('http://172.32.0.1'), null);
});

test('http to a local address is allowed', () => {
  assert.equal(ok('http://192.168.0.20:8080'), 'http://192.168.0.20:8080');
});

test('empty, other schemes and credentials are refused', () => {
  assert.equal(ok(''), null);
  assert.equal(ok('   '), null);
  assert.equal(ok('ftp://whisper.example.com'), null);
  assert.equal(ok('https://user:pass@whisper.example.com'), null);
  assert.equal(ok('not a url at all'), null);
});
