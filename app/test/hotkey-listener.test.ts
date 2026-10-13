import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';

// Real key codes, fake hook: nothing here may post keys to the actual OS
// (the bare-Alt menu guard taps Ctrl through uIOhook.keyTap).
const { UiohookKey: K } = createRequire(import.meta.url)('uiohook-napi') as typeof import('uiohook-napi');
const posted: number[] = [];
mock.module('uiohook-napi', {
  namedExports: {
    UiohookKey: K,
    uIOhook: {
      on: () => undefined,
      start: () => undefined,
      stop: () => undefined,
      keyTap: (key: number) => posted.push(key),
      keyToggle: () => undefined,
    },
  },
});
// log.ts reads app.isReady(); outside Electron there is no app to ask.
mock.module('electron', { namedExports: { app: { isReady: () => false } } });

const { HotkeyListener } = await import('../src/main/hotkey/listener.ts');
const { suppressHotkeyFor } = await import('../src/main/hotkey/suppress.ts');

// The listener reads Date.now() for its timing windows; the tests drive it.
let now = 1_000_000;
Date.now = (): number => now;

interface Mods {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

interface Driven {
  handleKeydown(event: unknown): void;
  handleKeyup(event: unknown): void;
  waitForModifiersReleased(timeoutMs: number): Promise<boolean>;
  getInputActivity(): number;
}

/** A listener fed synthetic hook events, recording the callbacks it fires. */
function make(hotkey = 'HoldCtrlMeta') {
  const calls: string[] = [];
  let listening = false;
  const listener = new HotkeyListener(hotkey, {
    onStart: () => {
      listening = true;
      calls.push('start');
    },
    onStop: (source) => {
      listening = false;
      calls.push(`stop:${source}`);
    },
    onCancel: () => {
      listening = false;
      calls.push('cancel');
    },
    isListening: () => listening,
  }) as unknown as Driven;

  const event = (keycode: number, m: Mods) => ({
    keycode,
    ctrlKey: m.ctrl === true,
    shiftKey: m.shift === true,
    altKey: m.alt === true,
    metaKey: m.meta === true,
  });
  const down = (keycode: number, m: Mods, dt = 50): void => {
    now += dt;
    listener.handleKeydown(event(keycode, m));
  };
  const up = (keycode: number, m: Mods, dt = 50): void => {
    now += dt;
    listener.handleKeyup(event(keycode, m));
  };
  return { calls, down, up, listener };
}

test('a plain Ctrl+Cmd hold starts and stops', () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  t.down(K.Meta, { ctrl: true, meta: true });
  t.up(K.Meta, { ctrl: true }, 3000);
  t.up(K.Ctrl, {});
  assert.deepEqual(t.calls, ['start', 'stop:hold']);
});

test('Ctrl+Cmd followed by Shift (screenshot chord) cancels', () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  t.down(K.Meta, { ctrl: true, meta: true });
  t.down(K.Shift, { ctrl: true, meta: true, shift: true }, 120);
  t.down(K.Num4, { ctrl: true, meta: true, shift: true }, 100);
  t.up(K.Num4, { ctrl: true, meta: true, shift: true });
  t.up(K.Shift, { ctrl: true, meta: true });
  t.up(K.Meta, { ctrl: true });
  t.up(K.Ctrl, {});
  assert.deepEqual(t.calls, ['start', 'cancel']);
});

test('Ctrl+Cmd+Q cancels', () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  t.down(K.Meta, { ctrl: true, meta: true });
  t.down(K.Q, { ctrl: true, meta: true }, 300);
  assert.deepEqual(t.calls, ['start', 'cancel']);
});

test('a stray key after the cancel window keeps the dictation', () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  t.down(K.Meta, { ctrl: true, meta: true });
  t.down(K.Shift, { ctrl: true, meta: true, shift: true }, 3000);
  t.up(K.Shift, { ctrl: true, meta: true });
  t.up(K.Meta, { ctrl: true });
  assert.deepEqual(t.calls, ['start', 'stop:hold']);
});

test('auto-repeat after a cancel does not restart the recording', () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  t.down(K.Meta, { ctrl: true, meta: true });
  t.down(K.Shift, { ctrl: true, meta: true, shift: true }, 100);
  t.up(K.Shift, { ctrl: true, meta: true }, 100);
  t.down(K.Meta, { ctrl: true, meta: true }, 30);
  t.down(K.Meta, { ctrl: true, meta: true }, 30);
  assert.deepEqual(t.calls, ['start', 'cancel']);
});

test('the shortcut re-arms once released after a cancel', () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  t.down(K.Meta, { ctrl: true, meta: true });
  t.down(K.Shift, { ctrl: true, meta: true, shift: true }, 100);
  t.up(K.Shift, { ctrl: true, meta: true });
  t.up(K.Meta, { ctrl: true });
  t.up(K.Ctrl, {});
  t.down(K.Ctrl, { ctrl: true }, 500);
  t.down(K.Meta, { ctrl: true, meta: true });
  t.up(K.Meta, { ctrl: true }, 2000);
  assert.deepEqual(t.calls, ['start', 'cancel', 'start', 'stop:hold']);
});

test('a lost keyup does not block the shortcut forever', () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  t.down(K.Meta, { ctrl: true, meta: true });
  t.down(K.Shift, { ctrl: true, meta: true, shift: true }, 100);
  t.down(K.A, {}, 2000); // keyups never arrived; the next event shows no modifiers
  t.down(K.Ctrl, { ctrl: true }, 500);
  t.down(K.Meta, { ctrl: true, meta: true });
  assert.deepEqual(t.calls, ['start', 'cancel', 'start']);
});

test('Shift pressed first never starts', () => {
  const t = make();
  t.down(K.Shift, { shift: true });
  t.down(K.Ctrl, { ctrl: true, shift: true });
  t.down(K.Meta, { ctrl: true, meta: true, shift: true });
  assert.deepEqual(t.calls, []);
});

test("the menu guard's synthetic Ctrl does not cancel a bare Alt hold", () => {
  const t = make('Alt');
  t.down(K.Alt, { alt: true });
  t.down(K.Ctrl, { alt: true, ctrl: true }, 120);
  t.up(K.Alt, {}, 2000);
  assert.deepEqual(posted, [K.Ctrl]); // the guard's tap went out (to the fake hook)
  assert.deepEqual(t.calls, ['start', 'stop:hold']);
});

test('Esc stops a recording', () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  t.down(K.Meta, { ctrl: true, meta: true });
  t.down(K.Escape, { ctrl: true, meta: true }, 200);
  assert.deepEqual(t.calls, ['start', 'stop:escape']);
});

test('waitForModifiersReleased resolves once the last modifier is up', async () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  t.down(K.Meta, { ctrl: true, meta: true });
  t.up(K.Ctrl, { meta: true });
  let resolved: boolean | null = null;
  void t.listener.waitForModifiersReleased(1000).then((value) => {
    resolved = value;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resolved, null);
  t.up(K.Meta, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolved, true);
});

test('waitForModifiersReleased is immediate with nothing held', async () => {
  assert.equal(await make().listener.waitForModifiersReleased(10), true);
});

test('event flags prune a modifier whose keyup was lost', async () => {
  const t = make();
  t.down(K.Meta, { meta: true });
  const released = t.listener.waitForModifiersReleased(1000);
  t.down(K.A, {});
  assert.equal(await released, true);
});

test('waitForModifiersReleased gives up while a modifier is held', async () => {
  const t = make();
  t.down(K.Ctrl, { ctrl: true });
  assert.equal(await t.listener.waitForModifiersReleased(50), false);
});

test('a keyup is tracked even while the hook is suppressed', async () => {
  const t = make();
  t.down(K.Meta, { meta: true });
  suppressHotkeyFor(500);
  t.up(K.Meta, {});
  assert.equal(await t.listener.waitForModifiersReleased(10), true);
});

test('input activity counts letters, not modifiers, the shortcut, Esc or our paste', () => {
  const t = make('F9');
  const base = t.listener.getInputActivity();
  t.down(K.Ctrl, { ctrl: true });
  t.up(K.Ctrl, {});
  t.down(K.Meta, { meta: true });
  t.up(K.Meta, {});
  t.down(K.F9, {});
  t.up(K.F9, {});
  t.down(K.Escape, {});
  t.up(K.Escape, {});
  assert.equal(t.listener.getInputActivity() - base, 0);
  t.down(K.A, {});
  t.up(K.A, {});
  assert.equal(t.listener.getInputActivity() - base, 1);
  suppressHotkeyFor(300);
  t.down(K.V, { ctrl: true });
  assert.equal(t.listener.getInputActivity() - base, 1);
});
