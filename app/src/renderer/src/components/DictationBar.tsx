import type { ReactNode } from 'react';

import { WRITING_STYLES, WRITING_STYLE_LABELS, hotkeyLabel } from '@whisper/shared';

import { useAppState } from '../state/AppState.js';
import { Pill } from './ui.js';

const BAR_DELAYS_MS = [0, 90, 180, 270, 360] as const;

/**
 * The big affordance on Home: start/stop dictation and pick a writing style.
 * The circle is the universal stop — it ends hotkey-driven recordings too.
 */
export function DictationBar(): ReactNode {
  const { recording, toggleRecording, settings, saveSettings, appInfo } = useAppState();

  // { mac } matters: without it a macOS user is told to hold "Ctrl + Win" —
  // a key their keyboard does not have — inches below a header that renders
  // the same combo as ⌃⌘.
  const label = hotkeyLabel(settings.hotkey, { mac: appInfo?.platform === 'darwin' });

  const message = recording.active
    ? recording.source === 'hotkey'
      ? 'Listening — release to insert'
      : 'Listening — click to stop'
    : `Hold ${label} anywhere, or click to dictate`;

  return (
    <div className="w-full rounded-2xl border border-line bg-cream p-5">
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => void toggleRecording()}
          aria-label={recording.active ? 'Stop dictation' : 'Start dictation'}
          className={`no-drag flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            recording.active ? 'bg-danger hover:bg-danger/90' : 'bg-accent hover:bg-accent-strong'
          }`}
        >
          {recording.active ? (
            <span className="size-3 rounded-[2px] bg-white" aria-hidden="true" />
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="size-4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="17" x2="12" y2="21" />
              <line x1="8" y1="21" x2="16" y2="21" />
            </svg>
          )}
        </button>

        {recording.active ? (
          <div className="flex items-end gap-1" aria-hidden="true">
            {BAR_DELAYS_MS.map((delay) => (
              <span
                key={delay}
                className="animate-bar h-4 w-1 rounded-full bg-danger"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        ) : null}

        <p className="text-[13px] text-ink-soft">{message}</p>
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {WRITING_STYLES.map((style) => (
          <Pill
            key={style}
            active={settings.defaultStyle === style}
            onClick={() => void saveSettings({ defaultStyle: style })}
          >
            {WRITING_STYLE_LABELS[style]}
          </Pill>
        ))}
      </div>
    </div>
  );
}
