import { useEffect, useState, type ReactNode } from 'react';

import { bridge } from '../lib/bridge.js';
import { cn } from '../lib/cn.js';
import { useAppState } from '../state/AppState.js';

/**
 * Frameless-window chrome. The whole 40px strip is draggable; on Windows we
 * draw the caption buttons ourselves, on macOS the native traffic lights sit
 * on top so we only leave room for them.
 */
export function TitleBar(): ReactNode {
  const { appInfo } = useAppState();
  const isMac = appInfo?.platform === 'darwin';

  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void bridge.invoke('window:is-maximized').then((value) => {
      if (!cancelled) setMaximized(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggleMaximize = (): void => {
    void bridge.invoke('window:toggle-maximize').then(setMaximized);
  };

  return (
    <header
      className={cn(
        'drag flex h-10 shrink-0 items-center justify-end border-b border-line-soft bg-cream',
        isMac && 'pl-20',
      )}
    >
      {isMac ? null : (
        <div className="flex h-full items-stretch">
          <button
            type="button"
            aria-label="Minimize"
            onClick={() => void bridge.invoke('window:minimize')}
            className="no-drag flex h-8 w-[46px] items-center justify-center text-ink-soft transition-colors hover:bg-line-soft hover:text-ink"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="0.5" y1="5" x2="9.5" y2="5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={onToggleMaximize}
            className="no-drag flex h-8 w-[46px] items-center justify-center text-ink-soft transition-colors hover:bg-line-soft hover:text-ink"
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M2.5 2.5 v-2 h7 v7 h-2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
                <rect
                  x="0.5"
                  y="2.5"
                  width="7"
                  height="7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect
                  x="0.5"
                  y="0.5"
                  width="9"
                  height="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={() => void bridge.invoke('window:close')}
            className="no-drag flex h-8 w-[46px] items-center justify-center text-ink-soft transition-colors hover:bg-danger hover:text-white"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
              <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}
