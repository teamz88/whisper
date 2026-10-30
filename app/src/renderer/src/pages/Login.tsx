import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import type { ServerInfo } from '../../../shared/ipc.js';
import { Button, TextField } from '../components/ui.js';
import { bridge } from '../lib/bridge.js';
import { useAppState } from '../state/AppState.js';

/** The white waveform mark, matching the Sidebar logo tile. */
function WaveMark(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="size-6 text-white" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="9" width="2.5" height="6" rx="1.25" />
      <rect x="6" y="5.5" width="2.5" height="13" rx="1.25" />
      <rect x="10.5" y="2.5" width="2.5" height="19" rx="1.25" />
      <rect x="15" y="6.5" width="2.5" height="11" rx="1.25" />
      <rect x="19.5" y="9.5" width="2.5" height="5" rx="1.25" />
    </svg>
  );
}

/** "whisper.example.com" out of a full address, for the one-line summary. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Which server this app signs in to. Quiet by default (one line); people who
 * run their own Whisper server open it and type their address. It lives on the
 * sign-in screen because tokens belong to one server, so it can only change
 * while nobody is signed in.
 */
function ServerPicker(): ReactNode {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void bridge.invoke('server:get').then(setServer);
  }, []);

  const apply = async (url: string | null): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.invoke('server:set', { url });
      if (!result.ok || result.server === undefined) {
        setError(result.error ?? 'Could not change the server.');
        return;
      }
      setServer(result.server);
      setEditing(false);
      setInput('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (server === null) return null;

  if (!editing) {
    return (
      <p className="text-[12px] text-ink-faint">
        Server: {hostOf(server.url)}{' '}
        <button
          type="button"
          className="no-drag text-accent-strong underline-offset-2 hover:underline"
          onClick={() => {
            setInput(server.custom ? server.url : '');
            setError(null);
            setEditing(true);
          }}
        >
          Change
        </button>
      </p>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-3 border-t border-line-soft pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (input.trim() !== '' && !busy) void apply(input);
      }}
    >
      <TextField
        label="Server address"
        placeholder="whisper.yourcompany.com"
        autoComplete="off"
        spellCheck={false}
        value={input}
        error={error}
        onChange={(event) => setInput(event.target.value)}
      />
      <p className="text-[12px] text-ink-faint">
        Only if your team runs its own Whisper server. Leave this alone otherwise.
      </p>
      <div className="flex items-center justify-between gap-2">
        {server.custom ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void apply(null)}>
            Use the default server
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={busy}
            disabled={input.trim() === ''}
          >
            Connect
          </Button>
        </div>
      </div>
    </form>
  );
}

export function Login(): ReactNode {
  const { signIn } = useAppState();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.trim() !== '' && password !== '';

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const message = await signIn(email.trim(), password);
      if (message !== null) setError(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-cream p-8">
      <div className="animate-fade-in flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-line bg-card p-8">
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-accent">
            <WaveMark />
          </div>
          <div className="text-lg font-semibold tracking-tight text-ink">[whisper]</div>
          <p className="text-[13px] text-ink-faint">Sign in to start dictating.</p>
        </div>

        <form
          className="flex w-full flex-col gap-4"
          onSubmit={(event) => {
            void onSubmit(event);
          }}
        >
          <TextField
            label="Email"
            type="email"
            autoFocus
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error === null ? null : (
            <div className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={submitting}
            disabled={!canSubmit}
          >
            Sign in
          </Button>
        </form>

        <p className="text-[12px] text-ink-faint">Accounts are created by your admin.</p>

        <ServerPicker />
      </div>
    </div>
  );
}
