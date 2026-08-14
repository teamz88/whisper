import { createHash, randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
  REFRESH_TOKEN_TTL_SECONDS,
  type AccessTokenClaims,
  type RefreshTokenClaims,
  type Role,
} from '@whisper/shared';

import { withTransaction, queryOne, query, type Pool, type PoolClient } from '../db.js';
import type { Env } from '../env.js';
import { invalidRefreshToken } from '../errors.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenSubject {
  id: string;
  email: string;
  role: Role;
}

export function signAccessToken(env: Env, subject: AccessTokenSubject): string {
  const payload: Omit<AccessTokenClaims, 'iat' | 'exp'> = {
    sub: subject.id,
    email: subject.email,
    role: subject.role,
    type: 'access',
  };
  // Seconds, not "1h": see the note on ACCESS_TOKEN_TTL_SECONDS.
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

export function verifyAccessToken(env: Env, token: string): AccessTokenClaims {
  const claims = jwt.verify(token, env.jwtAccessSecret) as AccessTokenClaims;
  if (claims.type !== 'access') {
    // A refresh token presented as a bearer credential.
    throw new jwt.JsonWebTokenError('wrong token type');
  }
  return claims;
}

/**
 * Only a SHA-256 digest of the refresh token is stored. The token itself is a
 * signed JWT, so it already carries integrity; hashing means a leaked database
 * dump cannot be replayed. Plain SHA-256 (not argon2) is correct here — the
 * input is 200+ bits of signed entropy, not a guessable password, and this runs
 * on every refresh.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function signRefreshToken(env: Env, userId: string, jti: string): string {
  const payload: Omit<RefreshTokenClaims, 'iat' | 'exp'> = { sub: userId, jti, type: 'refresh' };
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: REFRESH_TOKEN_TTL_SECONDS });
}

/** Mints a pair and records the refresh token's hash. */
export async function issueTokens(
  db: Pool | PoolClient,
  env: Env,
  subject: AccessTokenSubject,
): Promise<IssuedTokens> {
  const jti = randomUUID();
  const refreshToken = signRefreshToken(env, subject.id, jti);

  await query(
    db,
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [jti, subject.id, hashRefreshToken(refreshToken), refreshExpiry()],
  );

  return { accessToken: signAccessToken(env, subject), refreshToken };
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  expires_at: Date;
}

/**
 * Consume a refresh token: verify the signature, confirm the stored hash still
 * exists, and delete it. Returns the owning user id.
 *
 * The delete and the lookup share one transaction with the caller's insert, so
 * two concurrent refreshes cannot both succeed — the second finds no row.
 */
export async function consumeRefreshToken(
  client: PoolClient,
  env: Env,
  token: string,
): Promise<string> {
  let claims: RefreshTokenClaims;
  try {
    claims = jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenClaims;
  } catch {
    throw invalidRefreshToken();
  }

  if (claims.type !== 'refresh' || typeof claims.jti !== 'string') {
    throw invalidRefreshToken();
  }

  const row = await queryOne<RefreshTokenRow>(
    client,
    `DELETE FROM refresh_tokens
      WHERE id = $1 AND token_hash = $2
      RETURNING id, user_id, expires_at`,
    [claims.jti, hashRefreshToken(token)],
  );

  if (row === null) {
    // Already rotated, revoked, or never ours.
    throw invalidRefreshToken();
  }

  if (row.expires_at.getTime() <= Date.now()) {
    throw invalidRefreshToken();
  }

  return row.user_id;
}

/** POST /auth/logout — best effort, so a token that is already gone is not an error. */
export async function revokeRefreshToken(db: Pool, env: Env, token: string): Promise<void> {
  let jti: string | null = null;
  try {
    const claims = jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenClaims;
    jti = claims.jti;
  } catch {
    jti = null;
  }

  if (jti !== null) {
    await query(db, 'DELETE FROM refresh_tokens WHERE id = $1', [jti]);
  } else {
    await query(db, 'DELETE FROM refresh_tokens WHERE token_hash = $1', [hashRefreshToken(token)]);
  }
}

export async function revokeAllForUser(db: Pool, userId: string): Promise<void> {
  await query(db, 'DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

/** Housekeeping, run on an interval from the server boot. */
export async function deleteExpiredRefreshTokens(db: Pool): Promise<number> {
  const result = await query(db, 'DELETE FROM refresh_tokens WHERE expires_at < now()');
  return result.rowCount ?? 0;
}

export { withTransaction };
