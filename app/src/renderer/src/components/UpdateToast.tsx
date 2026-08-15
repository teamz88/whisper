import { useEffect, useState, type ReactNode } from 'react';

import { bridge } from '../lib/bridge.js';
import { useAppState } from '../state/AppState.js';
import { Button } from './ui.js';

/**
 * Bottom-right auto-update toast. Only download progress and a
 * ready-to-install build are worth interrupting for. Check FAILURES are
 * deliberately not toasted: the app auto-checks hourly, and until a first
 * release is published (or when someone is simply offline) every check fails —
 * a recurring error popup for that is noise. Failures still show, quietly, in
 * Settings → Updates, which also has the retry button.
 */
export function UpdateToast(): ReactNode {
  const { updateStatus } = useAppState();
  const [dismissed, setDismissed] = useState(false);

  // A new kind of status means a new conversation: un-dismiss.
  useEffect(() => {
    setDismissed(false);
  }, [updateStatus.kind]);

  if (dismissed) return null;

  if (updateStatus.kind !== 'progress' && updateStatus.kind !== 'downloaded') {
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

    </div>
  );
}
