import assert from 'node:assert/strict';
import { test } from 'node:test';

import { trimSilence } from '../src/main/audio/trim.ts';

const RATE = 16_000;

/** Deterministic noise, so a failing case reproduces exactly. */
function noiseSource(seed = 42): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648 - 0.5;
  };
}

/**
 * `seconds` of background noise with speech-like tone bursts, each given as
 * [from s, to s, amplitude].
 */
function clip(seconds: number, noise: number, bursts: Array<[number, number, number]>): Float32Array {
  const random = noiseSource();
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i += 1) samples[i] = random() * 2 * noise;
  for (const [from, to, amplitude] of bursts) {
    for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i += 1) {
      const t = i / RATE;
      samples[i]! += amplitude * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t));
    }
  }
  return samples;
}

const ms = (samples: Float32Array): number => Math.round((samples.length * 1000) / RATE);

function speech(result: ReturnType<typeof trimSilence>): Float32Array {
  assert.equal(result.kind, 'speech');
  return (result as Extract<typeof result, { kind: 'speech' }>).samples;
}

test('cuts silence at both ends and keeps the margins', () => {
  // Speech 0.8–2.6 s of 5 s: 300 ms before and 600 ms after are kept.
  const length = ms(speech(trimSilence(clip(5, 0.003, [[0.8, 2.6, 0.2]]), RATE)));
  assert.ok(length >= 2600 && length <= 2800, `${length} ms`);
});

test('finds speech from a quiet mic', () => {
  const length = ms(speech(trimSilence(clip(4, 0.0004, [[1, 2.5, 0.01]]), RATE)));
  assert.ok(length >= 2300, `${length} ms`);
});

test('leaves steady noise untouched for the server to judge', () => {
  const input = clip(3, 0.01, []);
  const result = trimSilence(input, RATE);
  assert.equal(speech(result).length, input.length);
});

test('a lone click in silence is not speech', () => {
  assert.equal(trimSilence(clip(3, 0.002, [[1, 1.04, 0.3]]), RATE).kind, 'no-speech');
});

test('a loud key click does not hide quieter speech', () => {
  const length = ms(speech(trimSilence(clip(4, 0.002, [[0.05, 0.1, 0.9], [1, 3, 0.05]]), RATE)));
  assert.ok(length >= 2900, `${length} ms`);
});

test('continuous speech loses almost nothing', () => {
  const result = trimSilence(clip(2, 0.003, [[0, 2, 0.2]]), RATE);
  speech(result);
  assert.ok((result as { trimmedMs: number }).trimmedMs <= 60);
});

test('one short word in a long silence is kept and trimmed around', () => {
  const length = ms(speech(trimSilence(clip(3, 0.002, [[1.2, 1.5, 0.15]]), RATE)));
  assert.ok(length >= 1100 && length <= 1300, `${length} ms`);
});

test('a clip too short to measure is left alone', () => {
  assert.equal(speech(trimSilence(new Float32Array(800), RATE)).length, 800);
});
