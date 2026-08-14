import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Session } from '@whisper/shared';

import { SessionRow } from '../components/SessionRow.js';
import { Button, EmptyState, SectionTitle, Spinner, TextField } from '../components/ui.js';
import { bridge } from '../lib/bridge.js';
import { formatCount, formatDay, pluralise } from '../lib/format.js';
import { useAppState } from '../state/AppState.js';

/**
 * Every dictation the user has, searchable and paginated. Results append on
 * "Load more"; a request-sequence ref keeps fast typing from letting a stale
 * response overwrite a newer one.
 */
export function History(): ReactNode {
  const { refreshStats } = useAppState();

  const [items, setItems] = useState<Session[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  /** The search term the current results actually reflect. */
  const [debouncedSearch, setDebouncedSearch] = useState('');

  /** Monotonic request counter — responses that are not the latest are ignored. */
  const seqRef = useRef(0);

  const loadPage = useCallback(
    async (targetPage: number, term: string, append: boolean): Promise<void> => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await bridge.invoke('sessions:list', {
          page: targetPage,
          search: term === '' ? undefined : term,
        });
        if (seqRef.current !== seq) return;
        // De-duplicated on append: a dictation landing between two page loads
        // shifts pagination, so page N+1 can begin with page N's last row —
        // which would render twice and duplicate its React key.
        setItems((current) => {
          if (!append) return result.items;
          const seen = new Set(current.map((session) => session.id));
          return [...current, ...result.items.filter((session) => !seen.has(session.id))];
        });
        setPage(result.page);
        setTotal(result.total);
        setHasMore(result.hasMore);
      } catch (caught) {
        if (seqRef.current !== seq) return;
        setError(caught instanceof Error ? caught.message : 'Something went wrong.');
      } finally {
        if (seqRef.current === seq) setLoading(false);
      }
    },
    [],
  );

  // Debounce typing; the trimmed term is what actually drives fetches.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // A new term (including the initial '') always restarts from page 1.
  useEffect(() => {
    void loadPage(1, debouncedSearch, false);
  }, [debouncedSearch, loadPage]);

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      const removed = items.find((session) => session.id === id);
      if (removed === undefined) return;

      // Optimistic: drop the row immediately, restore it if the delete fails.
      setItems((current) => current.filter((session) => session.id !== id));
      setTotal((current) => Math.max(0, current - 1));

      try {
        await bridge.invoke('sessions:delete', { id });
        void refreshStats();
      } catch (caught) {
        setItems((current) =>
          [...current, removed].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          ),
        );
        setTotal((current) => current + 1);
        setError(caught instanceof Error ? caught.message : 'Something went wrong.');
      }
    },
    [items, refreshStats],
  );

  // Group by day: emit a sticky heading whenever the day label changes.
  const rows: ReactNode[] = [];
  let lastDay: string | null = null;
  for (const session of items) {
    const day = formatDay(session.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      rows.push(
        <div key={`day-${day}`} className="sticky top-0 z-10 bg-cream py-2">
          <SectionTitle>{day}</SectionTitle>
        </div>,
      );
    }
    rows.push(<SessionRow key={session.id} session={session} onDelete={handleDelete} showRaw />);
  }

  const searching = debouncedSearch !== '';
  const empty = !loading && items.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-7">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink">History</h1>
        <span className="text-[13px] text-ink-faint">
          {`${formatCount(total)} ${pluralise(total, 'dictation')}`}
        </span>
      </div>

      <div className="mt-4">
        <TextField
          type="search"
          placeholder="Search your dictations…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search your dictations"
        />
      </div>

      {error === null ? null : (
        <div className="mt-4 rounded-lg border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-14">
          <Spinner className="size-5 text-ink-faint" />
        </div>
      ) : empty ? (
        <div className="mt-4">
          {searching ? (
            <EmptyState title="Nothing matched" body={`No dictations contain "${search.trim()}".`} />
          ) : (
            <EmptyState
              title="No dictations yet"
              body="Everything you dictate shows up here — searchable, with the original transcript one click away."
            />
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">{rows}</div>
      )}

      {hasMore && items.length > 0 ? (
        <div className="mt-4">
          <Button
            variant="secondary"
            className="w-full"
            loading={loading}
            onClick={() => void loadPage(page + 1, debouncedSearch, true)}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
