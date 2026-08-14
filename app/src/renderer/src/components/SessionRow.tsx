import { useState, type ReactNode } from 'react';

import { WRITING_STYLE_LABELS, type Session } from '@whisper/shared';

import { formatDuration, formatTime, preview } from '../lib/format.js';
import { Button, Chip, useCopyFeedback } from './ui.js';

export interface SessionRowProps {
  session: Session;
  onDelete?: (id: string) => void;
  showRaw?: boolean;
}

/** One dictation in the Home "Today" list and the History page. */
export function SessionRow({ session, onDelete, showRaw = false }: SessionRowProps): ReactNode {
  const [copied, copy] = useCopyFeedback();
  const [rawOpen, setRawOpen] = useState(false);

  return (
    <div className="group rounded-xl px-3 py-2.5 transition-colors hover:bg-line-soft">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-[12px] text-ink-faint tabular-nums">
              {formatTime(session.createdAt)}
            </span>
            <span className="selectable min-w-0 flex-1 truncate text-sm text-ink">
              {preview(session.cleanedTranscript)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <Chip>{session.wordCount}w</Chip>
            <Chip>{WRITING_STYLE_LABELS[session.style]}</Chip>
            <Chip>{formatDuration(session.durationMs)}</Chip>
            {showRaw ? (
              <button
                type="button"
                onClick={() => setRawOpen((open) => !open)}
                className="no-drag text-[12px] text-ink-faint underline-offset-2 hover:underline"
              >
                {rawOpen ? 'Hide raw' : 'Show raw'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="sm" onClick={() => copy(session.cleanedTranscript)}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {onDelete === undefined ? null : (
            <Button variant="ghost" size="sm" onClick={() => onDelete(session.id)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {showRaw && rawOpen ? (
        <div className="selectable mt-2 rounded-lg bg-line-soft p-2.5 font-mono text-[13px] text-ink-soft">
          {session.rawTranscript}
        </div>
      ) : null}
    </div>
  );
}
