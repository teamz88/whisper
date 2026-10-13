import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

/** What reached pasteText, and the state the controller was in at that moment. */
interface Paste {
  text: string;
  listening: boolean;
  keysHeld: boolean;
}

const pastes: Paste[] = [];
let controller: { isListening(): boolean } | null = null;
let keysHeld = false;
let inputActivity = 0;

// Nothing here may touch the real clipboard, keyboard or a shell.
mock.module(new URL('../src/main/inject/paste.ts', import.meta.url).href, {
  namedExports: {
    pasteText: async (text: string) => {
      pastes.push({ text, listening: controller?.isListening() ?? false, keysHeld });
      return { pasted: true, method: 'uiohook', focusedApp: null };
    },
  },
});
mock.module(new URL('../src/main/inject/focused-app.ts', import.meta.url).href, {
  namedExports: { getFocusedAppName: async () => 'Test' },
});
mock.module(new URL('../src/main/store.ts', import.meta.url).href, {
  namedExports: { getMicDeviceId: () => null },
});
mock.module('electron', { namedExports: { app: { isReady: () => false } } });

const { RecordingController } = await import('../src/main/recording/controller.ts');

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Reply = { resolve: (value: unknown) => void; reject: (error: unknown) => void };

/**
 * A controller wired to fakes. Each upload is keyed by its fake mic-open
 * duration, so a test can answer them in any order.
 */
function setup() {
  pastes.length = 0;
  keysHeld = false;
  const overlay: string[] = [];
  const pending = new Map<string, Reply>();
  let releaseWaiters: Array<(released: boolean) => void> = [];

  const ctrl = new RecordingController({
    overlay: { setState: (s: { kind: string }) => overlay.push(s.kind), hideAfter: () => undefined } as never,
    api: {
      request: (_path: string, options: { formData: FormData }) =>
        new Promise((resolve, reject) => {
          pending.set(String(options.formData.get('durationMs')), { resolve, reject });
        }),
    } as never,
    getSettings: () => ({ language: 'en', defaultStyle: 'default', aiCleanup: true }) as never,
    broadcast: () => undefined,
    waitForModifiersReleased: (timeoutMs: number) => {
      if (!keysHeld) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        releaseWaiters.push(resolve);
        setTimeout(() => resolve(false), timeoutMs);
      });
    },
    getInputActivity: () => inputActivity,
  });
  controller = ctrl;

  const audio = (generation: number, ms: number) => ({
    generation,
    // A steady tone: loud enough to count as speech, no silence to trim.
    samples: new Float32Array(1600).fill(0.1).buffer,
    sampleRate: 16000,
    audioStartedAt: 1000,
    audioStoppedAt: 1000 + ms,
  });
  const reply = (ms: number, text: string): void =>
    pending.get(String(ms))!.resolve({ raw: text, cleaned: text, wordCount: 2 });
  const fail = (ms: number): void =>
    pending.get(String(ms))!.reject(new Error('Could not reach the Whisper server.'));
  const discard = (ms: number): void =>
    pending.get(String(ms))!.resolve({ discarded: true, reason: 'empty' });
  const releaseKeys = (): void => {
    keysHeld = false;
    const waiters = releaseWaiters;
    releaseWaiters = [];
    for (const waiter of waiters) waiter(true);
  };
  /** Record, stop and hand over the audio in one go. */
  const dictate = (generation: number, ms: number): void => {
    ctrl.startRecording('hotkey');
    ctrl.stopRecording('hotkey');
    ctrl.onAudioReady(audio(generation, ms));
  };

  return { ctrl, overlay, audio, reply, fail, discard, releaseKeys, dictate };
}

const texts = (): string[] => pastes.map((paste) => paste.text.trim());

test('a dictation started while the last one processes: both pasted, in order, keys up', async () => {
  const t = setup();
  t.dictate(1, 1111);
  keysHeld = true;
  t.ctrl.startRecording('hotkey');
  assert.ok(t.ctrl.isListening(), 'second recording starts during processing');

  t.reply(1111, 'first');
  await tick(10);
  assert.equal(pastes.length, 0, 'no paste while the second recording is live');

  t.ctrl.stopRecording('hotkey'); // one key of the combo is still down
  await tick(10);
  assert.equal(pastes.length, 0, 'no paste while a modifier is still held');

  t.releaseKeys();
  await tick(10);
  t.ctrl.onAudioReady(t.audio(2, 2222));
  t.reply(2222, 'second');
  await tick(10);
  assert.deepEqual(texts(), ['first', 'second']);
  assert.ok(pastes.every((paste) => !paste.listening && !paste.keysHeld));
  assert.equal(t.overlay.at(-1), 'done');
});

test('pastes keep recording order when the later upload answers first', async () => {
  const t = setup();
  t.dictate(1, 1001);
  t.dictate(2, 2002);
  t.reply(2002, 'B');
  await tick(10);
  assert.equal(pastes.length, 0, 'B waits for A');
  t.reply(1001, 'A');
  await tick(10);
  assert.deepEqual(texts(), ['A', 'B']);
});

test('a key tracker stuck after a lost keyup does not delay a late result', async () => {
  const t = setup();
  t.dictate(1, 1003);
  await tick(700); // well past the key-release grace
  keysHeld = true;
  const answeredAt = Date.now();
  t.reply(1003, 'late');
  await tick(20);
  assert.deepEqual(texts(), ['late']);
  assert.ok(Date.now() - answeredAt < 100);
  keysHeld = false;
});

test('right after a stop, a stuck key tracker delays the paste by at most the grace', async () => {
  const t = setup();
  t.dictate(1, 1013);
  t.ctrl.startRecording('hotkey');
  t.reply(1013, 'held');
  await tick(10);
  keysHeld = true;
  const stoppedAt = Date.now();
  t.ctrl.stopRecording('hotkey');
  await tick(300);
  assert.equal(pastes.length, 0);
  await tick(400);
  assert.deepEqual(texts(), ['held']);
  assert.ok(Date.now() - stoppedAt >= 590);
  keysHeld = false;
});

test('a failed upload shows an error and the next dictation still pastes', async () => {
  const t = setup();
  t.dictate(1, 1004);
  t.dictate(2, 2004);
  t.fail(1004);
  t.reply(2004, 'ok');
  await tick(10);
  assert.deepEqual(texts(), ['ok']);
  assert.ok(t.overlay.includes('error'));
});

test('a result the server discards leaves the overlay idle', async () => {
  const t = setup();
  t.dictate(1, 3004);
  t.discard(3004);
  await tick(10);
  assert.equal(pastes.length, 0);
  assert.equal(t.overlay.at(-1), 'idle');
});

test('audio from a cancelled recording is dropped', async () => {
  const t = setup();
  t.ctrl.startRecording('hotkey');
  t.ctrl.cancelRecording('chord');
  t.ctrl.onAudioReady(t.audio(1, 1005));
  await tick(10);
  assert.equal(pastes.length, 0);
  assert.equal(t.overlay.at(-1), 'idle');
});

test('an empty capture leaves the overlay idle', () => {
  const t = setup();
  t.ctrl.startRecording('hotkey');
  t.ctrl.stopRecording('hotkey');
  t.ctrl.onAudioEmpty(1);
  assert.equal(t.overlay.at(-1), 'idle');
});

test('a recording started from the dashboard also holds back the paste', async () => {
  const t = setup();
  t.dictate(1, 1006);
  t.ctrl.toggle();
  t.reply(1006, 'later');
  await tick(10);
  assert.equal(pastes.length, 0);
  assert.equal(t.overlay.at(-1), 'listening');
  t.ctrl.toggle();
  await tick(10);
  assert.equal(pastes.length, 1);
});

/** Two dictations a second apart, with `between` run in the gap. */
async function backToBack(first: string, second: string, between: () => void = () => undefined) {
  const t = setup();
  t.dictate(1, 1701);
  t.reply(1701, first);
  await tick(700);
  between();
  t.dictate(2, 1702);
  t.reply(1702, second);
  await tick(700);
  return pastes.map((paste) => paste.text);
}

test('back-to-back dictations get a joining space', async () => {
  assert.deepEqual(await backToBack('On paper.', 'Second one.'), ['On paper.', ' Second one.']);
});

test('no joining space once the user typed or clicked in between', async () => {
  const result = await backToBack('On paper.', 'Second one.', () => {
    inputActivity += 1;
  });
  assert.deepEqual(result, ['On paper.', 'Second one.']);
});

test('no extra space after text that already ends with one', async () => {
  assert.equal((await backToBack('Ends with space. ', 'Next.'))[1], 'Next.');
});

test('no joining space before punctuation', async () => {
  assert.equal((await backToBack('Hello', ', world.'))[1], ', world.');
});

test('no joining space between CJK sentences', async () => {
  assert.equal((await backToBack('你好。', '世界。'))[1], '世界。');
});
