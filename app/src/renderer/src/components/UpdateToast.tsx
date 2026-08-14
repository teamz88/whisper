import { useEffect, useState, type ReactNode } from 'react';

import { bridge } from '../lib/bridge.js';
import { useAppState } from '../state/AppState.js';
import { Button } from './ui.js';

/**
 * Bottom-right auto-update toast. Only download progress, a ready-to-install
 * build, and errors are worth interrupting for — every other update state
 * stays silent.
 */
export function UpdateToast(): ReactNode {
  const { updateStatus } = useAppState();
  const [dismissed, setDismissed] = useState(false);

  // A new kind of status means a new conversation: un-dismiss.
  useEffect(() => {
    setDismissed(false);
  }, [updateStatus.kind]);

  if (dismissed) return null;

  if (
    updateStatus.kind !== 'progress' &&
    updateStatus.kind !== 'downloaded' &&
    updateStatus.kind !== 'error'
  ) {
    return null;
  }

  return (
    <div className="animate-fade-in fixed bottom-5 right-5 z-40 w-full max-w-xs rounded-xl border border-line bg-raised p-4 shadow-lg">
      {updateStatus.kind === 'progress' ? (
        <div>
          <p className="text-sm font-medium text-ink">Downloading update…</p>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.round(updateStatus.percent)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[12px] text-ink-faint">
            {Math.round(updateStatus.percent)}%
          </p>
        </div>
      ) : null}

      {updateStatus.kind === 'downloaded' ? (
        <div>
          <p className="text-sm font-medium text-ink">
            Whisper {updateStatus.version} is ready
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">Restart to finish installing.</p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void bridge.invoke('updates:restart')}
            >
              Restart now
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
              Later
            </Button>
          </div>
        </div>
      ) : null}

      {updateStatus.kind === 'error' ? (
        <div>
          <p className="text-[13px] leading-snug text-danger">{updateStatus.message}</p>
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void bridge.invoke('updates:check')}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
