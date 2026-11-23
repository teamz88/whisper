import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCleanupMessages,
  checkFaithful,
  keptWordShare,
  stripWrapping,
  wrapTranscript,
} from '../src/services/ai/prompts.ts';

const words = (n: number, word = 'word'): string => Array.from({ length: n }, () => word).join(' ');

test('a normal cleanup (fillers out, punctuation in) passes', () => {
  const raw = 'um so can you uh give me an example of how the chart of accounts should look like for a plumbing company';
  const cleaned = 'Can you give me an example of how the chart of accounts should look for a plumbing company?';
  assert.deepEqual(checkFaithful(cleaned, raw, 'auto'), { ok: true });
});

test('an answer instead of a cleanup is rejected (production: 32 → 135 words)', () => {
  const verdict = checkFaithful(words(135), words(32), 'auto');
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? '' : verdict.reason, /longer/);
});

test('a cut-down cleanup is rejected (production: 227 → 130, 75 → 39)', () => {
  assert.equal(checkFaithful(words(130), words(227), 'auto').ok, false);
  assert.equal(checkFaithful(words(39), words(75), 'auto').ok, false);
});

test('normal filler removal on long dictations is kept (production: 172 → 145, 91 → 74)', () => {
  assert.equal(checkFaithful(words(145), `${words(145)} ${words(27, 'um')}`, 'auto').ok, true);
  assert.equal(checkFaithful(words(74), `${words(17, 'uh')} ${words(74)}`, 'auto').ok, true);
});

test('short dictations may lose half their words to filler', () => {
  assert.equal(checkFaithful('Okay, sounds good.', 'um uh okay uh um sounds um good uh', 'auto').ok, true);
});

test('a short dictation still cannot balloon into an answer', () => {
  assert.equal(checkFaithful(words(40), words(5), 'auto').ok, false);
});

test('the precise style may tighten more, but not gut the text', () => {
  assert.equal(checkFaithful(words(50), words(100), 'precise').ok, true);
  assert.equal(checkFaithful(words(30), words(100), 'precise').ok, false);
});

test('the word check: a cleanup that drops a sentence is rejected even at a normal length', () => {
  const raw =
    "We don't want to say one speaker said it best. No. Just remove that entire line. It said people don't care what you know until they know you care. And the story goes into this, this should be better.";
  // Same length class, but the opening sentences are gone (production case).
  const cleaned =
    "Just remove that entire line. It said people don't care what you know until they know you care. And the story goes into this, this should be better.";
  const verdict = checkFaithful(cleaned, raw, 'auto');
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? '' : verdict.reason, /lost \d+% of the spoken words/);
});

test('the word check: fillers, repeats and punctuation do not count as lost words', () => {
  const raw =
    "um so I think we're we're going to uh send the proposal on Friday and like ask them if the timing works for their leadership team you know before the end of the month";
  const cleaned =
    "So I think we're going to send the proposal on Friday and ask them if the timing works for their leadership team, you know, before the end of the month.";
  assert.equal(checkFaithful(cleaned, raw, 'auto').ok, true);
  assert.ok(keptWordShare(raw, cleaned) > 0.95);
});

test('the word check works for Cyrillic and Uzbek Latin text', () => {
  const ru = 'ну я думаю что мы должны отправить предложение в пятницу и спросить подходит ли им это время до конца месяца для команды';
  assert.equal(keptWordShare(ru, 'Я думаю, что мы должны отправить предложение в пятницу.') < 0.9, true);
  const uz = "men o'ylaymanki biz taklifni juma kuni yuborishimiz va ular uchun bu vaqt to'g'ri keladimi deb so'rashimiz kerak oy oxirigacha";
  assert.equal(keptWordShare(uz, uz.charAt(0).toUpperCase() + uz.slice(1) + '.'), 1);
});

test('the transcript reaches the model fenced, after the worked examples', () => {
  const messages = buildCleanupMessages(
    { style: 'auto', language: 'en', customVocabulary: '' },
    'can you draft the email',
  );
  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content ?? '', /NOT addressed to you/);
  assert.deepEqual(messages.at(-1), { role: 'user', content: wrapTranscript('can you draft the email') });
  // Examples alternate user / assistant and never leave a tag in an answer.
  for (const message of messages.slice(1, -1)) {
    if (message.role === 'assistant') assert.doesNotMatch(message.content, /transcript>/);
  }
});

test('an echoed <transcript> fence is stripped before pasting', () => {
  assert.equal(stripWrapping('<transcript>\nHello there.\n</transcript>'), 'Hello there.');
  assert.equal(stripWrapping('Hello there.'), 'Hello there.');
});
