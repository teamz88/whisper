import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { MIN_PASSWORD_LENGTH } from '@whisper/shared';

import { bridge } from '../lib/bridge.js';
import { Button, Modal, TextField } from './ui.js';

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Module-level like the other form modals: defined inside its parent it would
 * remount on every parent render and drop focus mid-typing.
 */
export function ChangePasswordModal({ open, onClose, onDone }: ChangePasswordModalProps): ReactNode {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [nextError, setNextError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fresh, empty fields every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setCurrent('');
    setNext('');
    setConfirm('');
    setCurrentError(null);
    setNextError(null);
    setConfirmError(null);
    setSubmitError(null);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const nextCurrentError = current === '' ? 'Enter your current password.' : null;
    const nextNextError =
      next.length < MIN_PASSWORD_LENGTH
        ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
        : next === current
          ? 'Choose a password different from your current one.'
          : null;
    const nextConfirmError = confirm !== next ? 'The passwords do not match.' : null;

    setCurrentError(nextCurrentError);
    setNextError(nextNextError);
    setConfirmError(nextConfirmError);
    if (nextCurrentError !== null || nextNextError !== null || nextConfirmError !== null) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await bridge.invoke('auth:change-password', {
        currentPassword: current,
        newPassword: next,
      });
      if (!result.ok) {
        setSubmitError(result.error ?? 'Could not change the password.');
        return;
      }
      onDone();
      onClose();
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Change password"
      description="Your other devices will be signed out. This one stays signed in."
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          error={currentError}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          error={nextError}
          onChange={(event) => setNext(event.target.value)}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          error={confirmError}
          onChange={(event) => setConfirm(event.target.value)}
        />

        {submitError === null ? null : (
          <p className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={submitting}>
            Change password
          </Button>
        </div>
      </form>
    </Modal>
  );
}
