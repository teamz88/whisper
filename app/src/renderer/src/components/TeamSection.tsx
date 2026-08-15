import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import {
  MIN_PASSWORD_LENGTH,
  type AdminStats,
  type AdminUser,
  type Role,
  type UpdateUserRequest,
} from '@whisper/shared';

import { bridge } from '../lib/bridge.js';
import { formatCount } from '../lib/format.js';
import { useAppState } from '../state/AppState.js';
import { Button, Card, Chip, Modal, Select, Spinner, TextField } from './ui.js';

function displayName(fullName: string | null, email: string): string {
  const trimmed = fullName?.trim();
  if (trimmed !== undefined && trimmed !== '') return trimmed;
  return email.split('@')[0] ?? email;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }): ReactNode {
  return (
    <div className="rounded-xl border border-line bg-raised p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold text-ink">{value}</div>
      {sub === undefined ? null : <div className="text-[12px] text-ink-faint">{sub}</div>}
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const;

// ---------------------------------------------------------------------------
// Create / edit modal
//
// Module-level on purpose: defining this inside TeamSection would recreate the
// component type on every parent render and remount the form mid-typing.
// ---------------------------------------------------------------------------

interface UserFormModalProps {
  open: boolean;
  /** Null = create a new user; otherwise edit this one. */
  user: AdminUser | null;
  /** Editing yourself: role changes are blocked (server enforces it too). */
  isSelf: boolean;
  onClose: () => void;
  onDone: (user: AdminUser, mode: 'created' | 'updated') => void;
}

function UserFormModal({ open, user, isSelf, onClose, onDone }: UserFormModalProps): ReactNode {
  const editing = user !== null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the fields each time the modal opens (or opens for someone else).
  useEffect(() => {
    if (!open) return;
    setEmail(user?.email ?? '');
    setPassword('');
    setFullName(user?.fullName ?? '');
    setRole(user?.role ?? 'member');
    setEmailError(null);
    setPasswordError(null);
    setSubmitError(null);
  }, [open, user]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const nextEmailError = email.trim() === '' ? 'Enter an email address.' : null;
    // Creating requires a password; editing treats an empty field as "keep it".
    const passwordRequired = !editing || password !== '';
    const nextPasswordError =
      passwordRequired && password.length < MIN_PASSWORD_LENGTH
        ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
        : null;

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError !== null || nextPasswordError !== null) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      if (!editing) {
        const created = await bridge.invoke('admin:create-user', {
          email: email.trim(),
          password,
          ...(fullName.trim() === '' ? {} : { fullName: fullName.trim() }),
          role,
        });
        onDone(created, 'created');
        onClose();
        return;
      }

      // Send only what actually changed.
      const patch: UpdateUserRequest = {};
      if (email.trim() !== user.email) patch.email = email.trim();
      if (fullName.trim() !== (user.fullName ?? '')) patch.fullName = fullName.trim();
      if (role !== user.role) patch.role = role;
      if (password !== '') patch.password = password;

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      const updated = await bridge.invoke('admin:update-user', { id: user.id, patch });
      onDone(updated, 'updated');
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
      title={editing ? `Edit ${displayName(user.fullName, user.email)}` : 'Add a teammate'}
      description={
        editing
          ? 'Changing the password signs them out everywhere — hand them the new one directly.'
          : 'They can sign in straight away with the temporary password.'
      }
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <TextField
          label="Email"
          type="email"
          value={email}
          error={emailError}
          placeholder="teammate@omadligroup.com"
          onChange={(event) => setEmail(event.target.value)}
        />
        <div>
          <TextField
            label={editing ? 'New temporary password (optional)' : 'Temporary password'}
            type="text"
            value={password}
            error={passwordError}
            placeholder={editing ? 'Leave empty to keep the current one' : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="mt-1.5 text-[13px] text-ink-faint">
            You&apos;ll need to share this with them.
          </p>
        </div>
        <TextField
          label="Full name (optional)"
          type="text"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink-soft">Role</label>
          <Select
            options={ROLE_OPTIONS}
            value={role}
            disabled={isSelf}
            title={isSelf ? "You can't remove your own admin role." : undefined}
            onChange={(next) => setRole(next === 'admin' ? 'admin' : 'member')}
          />
        </div>

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
            {editing ? 'Save changes' : 'Create user'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The Team panel
// ---------------------------------------------------------------------------

export function TeamSection(): ReactNode {
  const { profile } = useAppState();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Modal state: closed | create | edit-this-user. */
  const [formOpen, setFormOpen] = useState(false);
  const [formUser, setFormUser] = useState<AdminUser | null>(null);

  /** Delete confirmation target. */
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [nextStats, nextUsers] = await Promise.all([
          bridge.invoke('admin:stats'),
          bridge.invoke('admin:users'),
        ]);
        if (cancelled) return;
        setStats(nextStats);
        setUsers(nextUsers);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Something went wrong.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleActive = async (user: AdminUser): Promise<void> => {
    setError(null);
    setBusyId(user.id);
    try {
      const updated = await bridge.invoke('admin:update-user', {
        id: user.id,
        patch: { isActive: !user.isActive },
      });
      setUsers((current) => current.map((u) => (u.id === updated.id ? updated : u)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === null) return;
    setDeleting(true);
    setError(null);
    try {
      await bridge.invoke('admin:delete-user', { id: deleteTarget.id });
      setUsers((current) => current.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-8 text-sm text-ink-faint">
        <Spinner /> Loading team…
      </Card>
    );
  }

  const mostActive = stats?.mostActiveUser ?? null;

  return (
    <div className="space-y-3">
      {error === null ? null : (
        <div className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-[13px] text-danger">
          {error}
        </div>
      )}

      {stats === null ? null : (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Words this team" value={formatCount(stats.totalWords)} />
          <StatTile label="Sessions this week" value={formatCount(stats.sessionsThisWeek)} />
          <StatTile
            label="Most active"
            value={mostActive === null ? '—' : displayName(mostActive.fullName, mostActive.email)}
            sub={mostActive === null ? undefined : `${formatCount(mostActive.words)} words`}
          />
        </div>
      )}

      <Card>
        {users.map((user) => {
          const isSelf = user.id === profile?.id;
          return (
            <div
              key={user.id}
              className="flex items-center justify-between gap-4 border-b border-line-soft px-5 py-3.5 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      user.isActive
                        ? 'truncate text-sm font-medium text-ink'
                        : 'truncate text-sm font-medium text-ink-faint'
                    }
                  >
                    {displayName(user.fullName, user.email)}
                    {isSelf ? <span className="ml-1 text-[12px] text-ink-faint">(you)</span> : null}
                  </span>
                  {user.isActive ? null : <Chip>Deactivated</Chip>}
                </div>
                <div className="truncate text-[13px] text-ink-faint">{user.email}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {user.role === 'admin' ? (
                  <Chip className="bg-accent-soft text-accent-strong">ADMIN</Chip>
                ) : (
                  <Chip>MEMBER</Chip>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFormUser(user);
                    setFormOpen(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isSelf}
                  loading={busyId === user.id}
                  title={isSelf ? "You can't deactivate your own account." : undefined}
                  onClick={() => {
                    void toggleActive(user);
                  }}
                >
                  {user.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={isSelf}
                  title={isSelf ? "You can't delete your own account." : undefined}
                  onClick={() => setDeleteTarget(user)}
                >
                  Delete
                </Button>
              </div>
            </div>
          );
        })}
        <div className="flex justify-end px-5 py-4">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setFormUser(null);
              setFormOpen(true);
            }}
          >
            Add user
          </Button>
        </div>
      </Card>

      <UserFormModal
        open={formOpen}
        user={formUser}
        isSelf={formUser !== null && formUser.id === profile?.id}
        onClose={() => setFormOpen(false)}
        onDone={(changed, mode) => {
          setUsers((current) =>
            mode === 'created'
              ? [changed, ...current]
              : current.map((u) => (u.id === changed.id ? changed : u)),
          );
        }}
      />

      <Modal
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget === null ? '' : displayName(deleteTarget.fullName, deleteTarget.email)}?`}
        description="This permanently removes their account, settings and entire dictation history. It cannot be undone. If you just want to block access, use Deactivate instead."
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={() => {
                void confirmDelete();
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      />
    </div>
  );
}
