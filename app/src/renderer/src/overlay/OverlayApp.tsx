import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { OverlayState } from '../../../shared/overlay.js';
import { OVERLAY_ESC_HINT_AFTER_MS, UNKNOWN_GENERATION } from '../../../shared/overlay.js';
import { bridge } from '../lib/bridge.js';
import { cn } from '../lib/cn.js';
import { OverlayRecorder } from './recorder.js';

/**
 * The floating pill. Renders whatever state main last sent, and runs the
 * microphone whenever that state is 'listening'. The window is never
 * focusable; the only interaction is the Copy button, which a click reaches
 * without taking focus from the app being dictated into.
 */
export function OverlayApp(): ReactNode {
  const [state, setState] = useState<OverlayState>({ kind: 'idle' });
  const recorderRef = useRef<OverlayRecorder | null>(null);

  if (recorderRef.current === null) {
    recorderRef.current = new OverlayRecorder(() => {
      // 10-minute cap: the mic stream lives here, so the timer does too. Main
      // flips the state machine to processing and we flush what we captured.
      bridge.send('overlay:stop-requested', { reason: 'max-duration' });
    });
  }

  useEffect(() => bridge.on('overlay:state', setState), []);

  /**
   * Mic operations are SERIALIZED through this promise chain. Without it, a
   * quick release-and-repress while getUserMedia is still pending (first-use
   * permission prompt, slow device) leaves the recorder's guards believing a
   * capture exists when none does — the overlay says "Listening" and the whole
   * dictation is silently lost. With the chain, stop always waits for its
   * start, and the next start waits for that stop.
   */
  const opsRef = useRef<Promise<void>>(Promise.resolve());
  const wasListening = useRef(false);
  const firstNonIdleState = useRef(true);

  // The generation of the most recent 'listening' state, stamped onto the
  // audio events of the stop that follows it. Assigned during render so it is
  // already correct when the transition effect below runs.
  const lastGenerationRef = useRef<number>(UNKNOWN_GENERATION);
  if (state.kind === 'listening') lastGenerationRef.current = state.generation;

  useEffect(() => {
    const recorder = recorderRef.current;
    if (recorder === null) return;

    if (state.kind === 'idle') {
      // Straight from listening to idle is a cancel: close the mic and throw
      // the capture away — main already considers this dictation over.
      if (wasListening.current) {
        wasListening.current = false;
        opsRef.current = opsRef.current.then(async () => {
          await recorder.stop();
        });
      }
      return;
    }

    const isFirst = firstNonIdleState.current;
    firstNonIdleState.current = false;

    if (state.kind === 'listening' && !wasListening.current) {
      wasListening.current = true;
      const { micDeviceId, generation } = state;
      opsRef.current = opsRef.current.then(async () => {
        const result = await recorder.start(micDeviceId);
        if (result?.kind === 'denied') {
          wasListening.current = false;
          bridge.send('overlay:mic-denied', { message: result.message, generation });
        }
      });
    } else if (state.kind !== 'listening' && wasListening.current) {
      wasListening.current = false;
      const generation = lastGenerationRef.current;
      opsRef.current = opsRef.current.then(async () => {
        const result = await recorder.stop();
        if (result.kind === 'audio') {
          bridge.send('overlay:audio-ready', { ...result.payload, generation });
        } else if (result.kind === 'empty') {
          bridge.send('overlay:audio-empty', { generation });
        }
      });
    } else if (isFirst && state.kind === 'processing' && !recorder.isCapturing) {
      // A replayed 'processing' handed to a FRESH renderer (crash recovery, or
      // a dictation that started and stopped before this page finished
      // loading). Nothing was ever captured here — say so, or main waits on
      // this window forever.
      bridge.send('overlay:audio-empty', { generation: UNKNOWN_GENERATION });
    }
  }, [state]);

  if (state.kind === 'idle') return null;

  // Main holds its timers while the mouse is over the overlay, so it never
  // disappears from under a cursor on its way to the Copy button.
  const hover = {
    onMouseEnter: () => bridge.send('overlay:hover', { hovering: true }),
    onMouseLeave: () => bridge.send('overlay:hover', { hovering: false }),
  };

  // Content is centred in the window: main resizes the window for the chip,
  // and centred content looks right on both sides of that resize.
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      {state.kind === 'copy' ? (
        <CopyChip copied={state.copied} {...hover} />
      ) : (
        <div
          {...hover}
          className="flex h-[52px] w-[280px] items-center overflow-hidden rounded-full border border-line bg-raised/95 px-4 shadow-lg backdrop-blur animate-fade-in"
        >
          {state.kind === 'listening' ? <Listening startedAt={state.startedAt} /> : null}
          {state.kind === 'processing' ? <Processing /> : null}
          {state.kind === 'done' ? (
            <Done text={state.text} wordCount={state.wordCount} pasted={state.pasted} />
          ) : null}
          {state.kind === 'error' ? <ErrorView message={state.message} /> : null}
        </div>
      )}
    </div>
  );
}

const copyLast = (): void => bridge.send('overlay:copy');

/** The small pill the done state shrinks into: one click copies the transcript. */
function CopyChip({
  copied,
  onMouseEnter,
  onMouseLeave,
}: {
  copied: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={copyLast}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      disabled={copied}
      aria-label="Copy last transcript"
      className={cn(
        'flex h-9 w-[92px] items-center justify-center gap-1.5 rounded-full border border-line bg-raised/95 text-[13px] font-medium shadow-lg backdrop-blur animate-chip-in',
        copied ? 'text-success' : 'text-ink hover:bg-accent-soft hover:text-accent-ink',
      )}
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Listening({ startedAt }: { startedAt: number }): ReactNode {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedMs = Math.max(0, now - startedAt);
  const seconds = Math.floor(elapsedMs / 1000);
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <>
      <span className="animate-pulse-dot size-2.5 shrink-0 rounded-full bg-danger" />
      <div className="ml-3 flex h-5 items-center gap-[3px]" aria-hidden="true">
        {[0, 90, 180, 270, 360].map((delay) => (
          <span
            key={delay}
            className="animate-bar h-full w-[3px] rounded-full bg-accent"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
      <span className="ml-3 truncate text-[13px] font-medium text-ink">Listening</span>
      <span className="ml-auto pl-2 text-[12px] tabular-nums text-ink-faint">
        {elapsedMs >= OVERLAY_ESC_HINT_AFTER_MS ? (
          <kbd className="rounded border border-line bg-card px-1 py-px text-[10px] font-medium">
            Esc
          </kbd>
        ) : (
          label
        )}
      </span>
    </>
  );
}

function Processing(): ReactNode {
  return (
    <>
      <span className="animate-spin-arc size-4 shrink-0 rounded-full border-2 border-accent border-t-transparent" />
      <span className="ml-3 text-[13px] font-medium text-ink">Processing…</span>
    </>
  );
}

function Done({
  text,
  wordCount,
  pasted,
}: {
  text: string;
  wordCount: number;
  pasted: boolean;
}): ReactNode {
  return (
    <>
      <CheckIcon className={cn('size-4 shrink-0', pasted ? 'text-success' : 'text-accent')} />
      {pasted ? (
        <>
          <span className="ml-2.5 min-w-0 truncate text-[13px] text-ink">{text}</span>
          <span className="ml-auto shrink-0 pl-2 text-[12px] tabular-nums text-ink-faint">
            {wordCount}w
          </span>
        </>
      ) : (
        <span className="ml-2.5 min-w-0 truncate text-[13px] text-ink">
          On clipboard — paste with {navigator.platform.startsWith('Mac') ? '⌘V' : 'Ctrl+V'}
        </span>
      )}
      <button
        type="button"
        onClick={copyLast}
        aria-label="Copy transcript"
        className={cn(
          'ml-2 -mr-2 flex size-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-accent-soft hover:text-accent-ink',
          !pasted && 'ml-auto',
        )}
      >
        <CopyIcon className="size-4" />
      </button>
    </>
  );
}

function CopyIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10.75 3.25v-.5a1.5 1.5 0 0 0-1.5-1.5h-5.5a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5h.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ErrorView({ message }: { message: string }): ReactNode {
  return (
    <>
      <XIcon className="size-4 shrink-0 text-danger" />
      <span className="ml-2.5 truncate text-[13px] text-ink">{message}</span>
    </>
  );
}

function CheckIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8.2 7.2 10.4 11 5.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 5.5 10.5 10.5 M10.5 5.5 5.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
