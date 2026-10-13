import type { ReactNode } from 'react';

import { firstName, hotkeyLabel, hotkeyVerb } from '@whisper/shared';

import { DictationBar } from '../components/DictationBar.js';
import { SessionRow } from '../components/SessionRow.js';
import { StatsCard } from '../components/StatsCard.js';
import { Button, EmptyState, SectionTitle } from '../components/ui.js';
import { formatDay } from '../lib/format.js';
import { useAppState } from '../state/AppState.js';

export function Home(): ReactNode {
  const { profile, settings, recent, removeSession, setPage, appInfo } = useAppState();

  const mac = appInfo?.platform === 'darwin';
  const verb = hotkeyVerb(settings.hotkey);
  const today = recent.filter((session) => formatDay(session.createdAt) === 'Today');
  const hasOlder = recent.length > today.length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-8 py-7">
        <header>
          <h1 className="text-2xl text-ink">
            Welcome back, <span className="font-serif italic">{firstName(profile)}</span>
          </h1>
          <p className="mt-1 text-[13px] text-ink-soft">
            {verb} {hotkeyLabel(settings.hotkey, { mac })} anywhere to dictate.
          </p>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <DictationBar />

            <section className="mt-6">
              <SectionTitle>Today</SectionTitle>
              <div className="mt-2">
                {today.length === 0 ? (
                  <EmptyState
                    title="Nothing yet today"
                    body={`${verb} your shortcut anywhere and start talking. What you say lands right where your cursor is.`}
                  />
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {today.map((session) => (
                      <SessionRow key={session.id} session={session} onDelete={removeSession} />
                    ))}
                  </div>
                )}
                {hasOlder ? (
                  <div className="mt-3">
                    <Button variant="ghost" size="sm" onClick={() => setPage('history')}>
                      See all history
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <StatsCard />
        </div>
      </div>
    </div>
  );
}
