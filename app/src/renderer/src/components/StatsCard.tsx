import type { ReactNode } from 'react';

import { ASSUMED_TYPING_WPM, timeSavedMs } from '@whisper/shared';

import { formatCount, formatDuration, formatSpan, pluralise } from '../lib/format.js';
import { useAppState } from '../state/AppState.js';
import { Card, SectionTitle } from './ui.js';

function StatRow({ label, value, footnote }: { label: string; value: string; footnote?: string }): ReactNode {
  return (
    <div className="border-b border-line-soft py-2 last:border-b-0">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-ink-soft">{label}</span>
        <span className="text-sm font-medium text-ink tabular-nums">{value}</span>
      </div>
      {footnote === undefined ? null : (
        <p className="text-[11px] text-ink-faint">{footnote}</p>
      )}
    </div>
  );
}

/** The right-hand column on Home: a calm read on the week's dictation. */
export function StatsCard(): ReactNode {
  const { stats } = useAppState();

  return (
    <Card className="p-5">
      <SectionTitle>Your week</SectionTitle>
      {stats.totalSessions === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
          Your first dictation will show up here.
        </p>
      ) : (
        <div className="mt-2">
          <StatRow label="Words dictated" value={formatCount(stats.totalWords)} />
          <StatRow
            label="Time saved"
            value={formatSpan(timeSavedMs(stats.totalWords))}
            footnote={`vs. typing at ${ASSUMED_TYPING_WPM} wpm`}
          />
          <StatRow
            label="Today"
            value={`${stats.sessionsToday} ${pluralise(stats.sessionsToday, 'dictation')}`}
          />
          <StatRow label="Average length" value={formatDuration(stats.averageDurationMs)} />
          <StatRow label="Streak" value={`${stats.streak} ${pluralise(stats.streak, 'day')}`} />
        </div>
      )}
    </Card>
  );
}
