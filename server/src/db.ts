import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

import type { Env } from './env.js';

// Named imports work natively here: pg has shipped a real ESM wrapper
// (esm/index.mjs) since 8.15, so the old `import pkg from 'pg'` destructuring
// workaround is obsolete.

export type { Pool, PoolClient };

export function createPool(env: Env): Pool {
  return new Pool({
    connectionString: env.databaseUrl,
    // Managed Postgres (including Coolify behind a proxy) terminates TLS with a
    // certificate we have no CA for locally.
    ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export async function query<T extends QueryResultRow>(
  db: Pool | PoolClient,
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return db.query<T>(text, params as unknown[]);
}

/** First row, or null. */
export async function queryOne<T extends QueryResultRow>(
  db: Pool | PoolClient,
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const result = await query<T>(db, text, params);
  return result.rows[0] ?? null;
}

/**
 * Runs `fn` inside BEGIN/COMMIT, rolling back on any throw. Used wherever two
 * writes must land together — creating a user and its settings row, or rotating
 * a refresh token.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; the pool will discard it.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Postgres returns bigint columns (COUNT, SUM) as strings to avoid precision loss. */
export function toInt(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toIso(value: Date | string | null): string {
  if (value === null) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

/** Postgres unique-violation. Used to turn a duplicate email into a 409. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
