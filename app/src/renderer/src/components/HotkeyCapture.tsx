import { useEffect, useRef, useState, type ReactNode } from 'react';

import { DEFAULT_HOTKEY, hotkeyLabel, isValidHotkey } from '@whisper/shared';

import { bridge } from '../lib/bridge.js';
import { useAppState } from '../state/AppState.js';
import { Button } from './ui.js';

// AltGraph included: on European layouts AltGr reports event.key 'AltGraph'
// with ctrl+alt flags set. Treating it as a main key would commit a combo like
// "Ctrl+Alt+AltGraph" that the uiohook keymap can never resolve — a hotkey
// that saves fine and then silently never fires.
const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'];

function modifiersFromEvent(event: KeyboardEvent): string[] {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  return modifiers;
}

function normaliseMainKey(key: string): string {
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * Only keys the main process' uiohook keymap can actually resolve. Anything
 * outside this set (media keys, punctuation on exotic layouts, 'Process'…)
 * would be accepted here, saved to the server, and then never fire — with the
 * only evidence a warning in main's log.
 */
const NAMED_MAIN_KEYS = new Set([
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function isMappableMainKey(key: string): boolean {
  return /^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || NAMED_MAIN_KEYS.has(key);
}

export function HotkeyCapture({
  value,
  onChange,
}: {
  value: string;
  /** Saves the shortcut; a rejection is shown under the control. */
  onChange: (hotkey: string) => Promise<unknown>;
}): ReactNode {
  const { appInfo } = useAppState();
  const mac = appInfo?.platform === 'darwin';

  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** Modifiers held during capture, from the most recent keydown. */
  const heldModifiers = useRef<string[]>([]);
  /** True once any non-modifier key has been pressed in this capture. */
  const mainKeyPressed = useRef(false);

  // Settings passes an inline arrow, whose identity changes on every render.
  // If the effect depended on it, any unrelated AppState broadcast (an update
  // download ticking, a session landing) would tear the capture down mid-hold:
  // held modifiers wiped, and the global listener re-armed while the user is
  // physically holding a combo. The ref keeps the effect keyed on `capturing`
  // alone.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The save goes to the server, which can time out. Without this the old
  // shortcut silently stayed armed while the user believed the new one was set.
  const save = (combo: string): void => {
    onChangeRef.current(combo).catch(() => {
      setError('Couldn’t save the shortcut — the server didn’t answer. Try again.');
    });
  };

  useEffect(() => {
    if (!capturing) return undefined;

    heldModifiers.current = [];
    mainKeyPressed.current = false;

    // Suspend the global hotkey listener while the user presses keys.
    void bridge.invoke('hotkey:capture', { capturing: true });

    const commit = (combo: string): void => {
      if (!isValidHotkey(combo)) {
        setError('Add a modifier key, or use a function key.');
        return;
      }
      setCapturing(false);
      save(combo);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setCapturing(false);
        return;
      }

      const modifiers = modifiersFromEvent(event);

      if (MODIFIER_KEYS.includes(event.key)) {
        heldModifiers.current = modifiers;
        setPreview(modifiers.join('+'));
        return;
      }

      const mainKey = normaliseMainKey(event.key);
      if (!isMappableMainKey(mainKey)) {
        setError('That key can’t be used — try a letter, number or function key.');
        return;
      }

      mainKeyPressed.current = true;
      const combo = [...modifiers, mainKey].join('+');
      setPreview(combo);
      commit(combo);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      // Modifier-only combos (hold-to-talk) commit on release.
      if (!mainKeyPressed.current && heldModifiers.current.length > 0) {
        commit(heldModifiers.current.join('+'));
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      void bridge.invoke('hotkey:capture', { capturing: false });
    };
  }, [capturing]);

  const chips = hotkeyLabel(value, { mac }).split(' + ');

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {capturing ? (
          <div className="rounded-xl border border-accent bg-accent-soft px-3.5 py-2 text-[13px] text-ink">
            Press the keys you want…
            {preview === '' ? null : (
              <span className="ml-2 font-mono text-[12px] text-ink-soft">{preview}</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {chips.map((chip) => (
              <kbd
                key={chip}
                className="rounded-md border border-line bg-raised px-1.5 py-0.5 text-[12px] font-mono"
              >
                {chip}
              </kbd>
            ))}
          </div>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setError(null);
            setPreview('');
            setCapturing((current) => !current);
          }}
        >
          {capturing ? 'Cancel' : 'Change'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={value === DEFAULT_HOTKEY}
          onClick={() => {
            setError(null);
            save(DEFAULT_HOTKEY);
          }}
        >
          Reset to default
        </Button>
      </div>
      {error === null ? null : <p className="text-[13px] text-danger">{error}</p>}
    </div>
  );
}
