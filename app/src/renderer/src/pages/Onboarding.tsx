import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  WRITING_STYLES,
  WRITING_STYLE_EXAMPLES,
  WRITING_STYLE_LABELS,
  hotkeyHint,
  hotkeyLabel,
  hotkeyVerb,
  type WritingStyle,
} from '@whisper/shared';

import { LevelMeter, useMicLevel } from '../components/LevelMeter.js';
import { Button, Card } from '../components/ui.js';
import { bridge } from '../lib/bridge.js';
import { cn } from '../lib/cn.js';
import { useAppState } from '../state/AppState.js';

const HEARD_THRESHOLD = 0.08;
const STEPS = [0, 1, 2] as const;

/**
 * Step 0 lives in its own component so the mic stream is opened only while
 * this step is on screen — unmounting it runs the hook's full teardown.
 */
function MicStep({
  heard,
  onHeard,
  onError,
}: {
  heard: boolean;
  onHeard: () => void;
  onError: (message: string) => void;
}): ReactNode {
  const { level, error } = useMicLevel();

  // Ref-backed so the rAF-driven level updates flip `heard` exactly once.
  const heardRef = useRef(heard);
  useEffect(() => {
    if (!heardRef.current && level > HEARD_THRESHOLD) {
      heardRef.current = true;
      onHeard();
    }
  }, [level, onHeard]);

  useEffect(() => {
    if (error !== null) onError(error);
  }, [error, onError]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Let&rsquo;s check your microphone</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {heard ? 'Perfect, we can hear you.' : 'Say something — anything.'}
        </p>
      </div>

      <Card className="flex items-center justify-center px-8 py-10">
        <LevelMeter level={level} />
      </Card>

      {error === null ? null : (
        <div className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">
          <p>{error}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2.5"
            onClick={() => {
              void bridge.invoke('system:open-mic-settings');
            }}
          >
            Open sound settings
          </Button>
        </div>
      )}
    </div>
  );
}

function HotkeyStep({ hotkey, mac }: { hotkey: string; mac: boolean }): ReactNode {
  const label = hotkeyLabel(hotkey, { mac });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          {hotkeyVerb(hotkey)} {label} anywhere to dictate
        </h1>
        <p className="mt-1.5 text-sm text-ink-soft">{hotkeyHint(hotkey, { mac })}</p>
      </div>

      <Card className="flex flex-col items-center gap-4 px-8 py-10">
        <div className="flex items-center gap-1.5">
          {label.split(' + ').map((part) => (
            <kbd
              key={part}
              className="rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[12px] text-ink"
            >
              {part}
            </kbd>
          ))}
        </div>
        <p className="max-w-xs text-center text-[13px] leading-relaxed text-ink-faint">
          {hotkeyVerb(hotkey) === 'Hold'
            ? 'Try it now — hold the keys and say a word.'
            : 'Try it now — tap the shortcut, say a word, then tap it again.'}{' '}
          It&rsquo;ll type wherever your cursor is.
        </p>
      </Card>
    </div>
  );
}

function StyleStep({
  selected,
  onSelect,
}: {
  selected: WritingStyle;
  onSelect: (style: WritingStyle) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">How should Whisper write?</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          You can change this any time, or per dictation.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {WRITING_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            onClick={() => onSelect(style)}
            className={cn(
              'no-drag w-full rounded-xl border p-3 text-left transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              style === selected
                ? 'border-accent bg-accent-soft'
                : 'border-line bg-raised hover:border-ink-faint',
            )}
          >
            <div className="text-sm font-medium text-ink">{WRITING_STYLE_LABELS[style]}</div>
            <div className="mt-0.5 text-[13px] italic text-ink-faint">
              {WRITING_STYLE_EXAMPLES[style]}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Onboarding(): ReactNode {
  const { settings, appInfo, saveSettings, finishOnboarding } = useAppState();
  const mac = appInfo?.platform === 'darwin';

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [heard, setHeard] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [style, setStyle] = useState<WritingStyle>(settings.defaultStyle);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const selectStyle = (next: WritingStyle): void => {
    setStyle(next);
    saveSettings({ defaultStyle: next }).catch(() => {
      // The optimistic update stays; Settings can retry later.
    });
  };

  const finish = async (): Promise<void> => {
    setFinishing(true);
    setFinishError(null);
    try {
      await finishOnboarding();
    } catch (cause) {
      setFinishError(cause instanceof Error ? cause.message : 'Something went wrong.');
      setFinishing(false);
    }
  };

  // A driver quirk must not trap the user here: an errored mic check may pass.
  const canContinue = step !== 0 || heard || micError !== null;

  return (
    <div className="flex h-full items-center justify-center bg-cream p-8">
      <div className="animate-fade-in flex w-full max-w-lg flex-col gap-8">
        <div className="flex gap-1.5">
          {STEPS.map((index) => (
            <div
              key={index}
              className={cn('h-1 flex-1 rounded-full', index <= step ? 'bg-accent' : 'bg-line')}
            />
          ))}
        </div>

        {step === 0 ? (
          <MicStep heard={heard} onHeard={() => setHeard(true)} onError={setMicError} />
        ) : step === 1 ? (
          <HotkeyStep hotkey={settings.hotkey} mac={mac} />
        ) : (
          <StyleStep selected={style} onSelect={selectStyle} />
        )}

        {finishError === null ? null : (
          <div className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">
            {finishError}
          </div>
        )}

        <div className="flex items-center justify-between">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step === 2 ? 1 : 0)}>
              Back
            </Button>
          ) : (
            <div />
          )}

          {step < 2 ? (
            <Button
              variant="primary"
              disabled={!canContinue}
              onClick={() => setStep(step === 0 ? 1 : 2)}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={finishing}
              onClick={() => {
                void finish();
              }}
            >
              Start dictating
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
