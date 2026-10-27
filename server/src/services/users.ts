import {
  DEFAULT_SETTINGS,
  MIN_PASSWORD_LENGTH,
  type AuthResponse,
  type Profile,
  type Role,
  type UpdateProfileRequest,
} from '@whisper/shared';

import {
  isUniqueViolation,
  query,
  queryOne,
  toIso,
  withTransaction,
  type Pool,
  type PoolClient,
} from '../db.js';
import type { Env } from '../env.js';
import { badRequest, conflict, notFound, wrongCurrentPassword } from '../errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { issueTokens } from '../auth/tokens.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  onboarded: boolean;
  created_at: Date;
}

const PROFILE_COLUMNS = 'id, email, password_hash, full_name, role, is_active, onboarded, created_at';

export function toProfile(row: UserRow): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    onboarded: row.onboarded,
    createdAt: toIso(row.created_at),
  };
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findByEmail(db: Pool, email: string): Promise<UserRow | null> {
  return queryOne<UserRow>(
    db,
    `SELECT ${PROFILE_COLUMNS} FROM users WHERE lower(email) = lower($1)`,
    [normaliseEmail(email)],
  );
}

export async function findById(db: Pool | PoolClient, id: string): Promise<UserRow | null> {
  return queryOne<UserRow>(db, `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1`, [id]);
}

export async function getProfile(db: Pool, id: string): Promise<Profile> {
  const row = await findById(db, id);
  if (row === null) throw notFound('User not found.');
  return toProfile(row);
}

export async function listUsers(db: Pool): Promise<Profile[]> {
  const result = await query<UserRow>(
    db,
    `SELECT ${PROFILE_COLUMNS} FROM users ORDER BY created_at ASC`,
  );
  return result.rows.map(toProfile);
}

export interface CreateUserInput {
  email: string;
  password: string;
  fullName?: string | null;
  role?: Role;
}

/**
 * Creates the user and its settings row in one transaction. Doing this in the
 * application rather than a database trigger keeps the defaults in
 * DEFAULT_SETTINGS, where the client reads them from too.
 */
export async function createUser(pool: Pool, input: CreateUserInput): Promise<Profile> {
  const email = normaliseEmail(input.email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('That does not look like an email address.');
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const passwordHash = await hashPassword(input.password);
  const role: Role = input.role ?? 'member';
  const fullName = input.fullName?.trim() ?? null;

  try {
    return await withTransaction(pool, async (client) => {
      const user = await queryOne<UserRow>(
        client,
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING ${PROFILE_COLUMNS}`,
        [email, passwordHash, fullName === '' ? null : fullName, role],
      );

      if (user === null) throw new Error('insert returned no row');

      await query(
        client,
        `INSERT INTO user_settings
           (user_id, hotkey, default_style, language, ai_cleanup, history_storage,
            overlay_position, custom_vocabulary, high_accuracy)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.id,
          DEFAULT_SETTINGS.hotkey,
          DEFAULT_SETTINGS.defaultStyle,
          DEFAULT_SETTINGS.language,
          DEFAULT_SETTINGS.aiCleanup,
          DEFAULT_SETTINGS.historyStorage,
          DEFAULT_SETTINGS.overlayPosition,
          DEFAULT_SETTINGS.customVocabulary,
          DEFAULT_SETTINGS.highAccuracy,
        ],
      );

      return toProfile(user);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('An account with that email already exists.');
    }
    throw error;
  }
}

export async function updateProfile(
  db: Pool,
  id: string,
  patch: UpdateProfileRequest,
): Promise<Profile> {
  const setName = patch.fullName !== undefined;
  const setOnboarded = patch.onboarded !== undefined;
  if (!setName && !setOnboarded) throw badRequest('Nothing to update.');

  const trimmed = patch.fullName?.trim() ?? '';
  if (trimmed.length > 120) throw badRequest('Display name is too long.');

  // One fixed statement; each column changes only when its flag is set. A SET
  // list assembled from strings was safe (column names are constants) but read
  // as SQL injection to static analysis, which blocked every commit.
  const row = await queryOne<UserRow>(
    db,
    `UPDATE users
        SET full_name = CASE WHEN $1::boolean THEN $2::text ELSE full_name END,
            onboarded = CASE WHEN $3::boolean THEN $4::boolean ELSE onboarded END
      WHERE id = $5
  RETURNING ${PROFILE_COLUMNS}`,
    [setName, trimmed === '' ? null : trimmed, setOnboarded, patch.onboarded ?? false, id],
  );

  if (row === null) throw notFound('User not found.');
  return toProfile(row);
}

/**
 * Self-service password change. The old password must verify, every refresh
 * token of the user is deleted (other devices are signed out once their access
 * token expires), and a fresh pair is issued for the device that asked — all in
 * one transaction, so a failure cannot leave the user with no valid session.
 */
export async function changePassword(
  pool: Pool,
  env: Env,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthResponse> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (newPassword === currentPassword) {
    throw badRequest('Choose a password different from your current one.');
  }

  const user = await findById(pool, userId);
  if (user === null) throw notFound('User not found.');
  if (!(await verifyPassword(user.password_hash, currentPassword))) throw wrongCurrentPassword();

  const passwordHash = await hashPassword(newPassword);

  return withTransaction(pool, async (client) => {
    await query(client, 'UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    await query(client, 'DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);

    const tokens = await issueTokens(client, env, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return { ...tokens, user: toProfile(user) };
  });
}

export async function setActive(db: Pool, id: string, isActive: boolean): Promise<Profile> {
  const row = await queryOne<UserRow>(
    db,
    `UPDATE users SET is_active = $1 WHERE id = $2 RETURNING ${PROFILE_COLUMNS}`,
    [isActive, id],
  );
  if (row === null) throw notFound('User not found.');
  return toProfile(row);
}

export interface AdminUpdateUserInput {
  email?: string;
  password?: string;
  fullName?: string;
  role?: Role;
  isActive?: boolean;
}

/**
 * The admin edit: any subset of email / password / name / role / active.
 * Returns the updated profile plus whether credentials changed, so the route
 * can decide to revoke the user's sessions.
 */
export async function adminUpdateUser(
  db: Pool,
  id: string,
  patch: AdminUpdateUserInput,
): Promise<{ profile: Profile; passwordChanged: boolean }> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.email !== undefined) {
    const email = normaliseEmail(patch.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw badRequest('That does not look like an email address.');
    }
    set('email', email);
  }

  const passwordChanged = patch.password !== undefined;
  if (patch.password !== undefined) {
    if (patch.password.length < MIN_PASSWORD_LENGTH) {
      throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    set('password_hash', await hashPassword(patch.password));
  }

  if (patch.fullName !== undefined) {
    const trimmed = patch.fullName.trim();
    if (trimmed.length > 120) throw badRequest('Display name is too long.');
    set('full_name', trimmed === '' ? null : trimmed);
  }

  if (patch.role !== undefined) set('role', patch.role);
  if (patch.isActive !== undefined) set('is_active', patch.isActive);

  if (sets.length === 0) throw badRequest('Nothing to update.');

  values.push(id);

  try {
    const row = await queryOne<UserRow>(
      db,
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${PROFILE_COLUMNS}`,
      values,
    );
    if (row === null) throw notFound('User not found.');
    return { profile: toProfile(row), passwordChanged };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('An account with that email already exists.');
    }
    throw error;
  }
}

/**
 * Permanent removal. The schema cascades: user_settings, sessions and
 * refresh_tokens rows all go with the user.
 */
export async function deleteUser(db: Pool, id: string): Promise<void> {
  const result = await query(db, 'DELETE FROM users WHERE id = $1', [id]);
  if ((result.rowCount ?? 0) === 0) throw notFound('User not found.');
}
