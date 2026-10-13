import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeSpaces } from '@whisper/shared';

test('lookalike spaces become plain spaces', () => {
  assert.equal(normalizeSpaces('3 p.m. at 10 am'), '3 p.m. at 10 am');
});

test('the CJK ideographic space is kept', () => {
  assert.equal(normalizeSpaces('你好　世界'), '你好　世界');
});
