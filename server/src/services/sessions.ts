import {
  SESSIONS_PAGE_SIZE,
  coerceLanguageCode,
  coerceWritingStyle,
  countWords,
  type Session,
  type SessionPage,
} from '@whisper/shared';

import { query, queryOne, toInt, toIso, type Pool, type PoolClient } from '../db.js';
import { notFound } from '../errors.js';

interface SessionRow {
  id: string;
  raw_transcript: string;
  cleaned_transcript: string;
  word_count: number;
  duration_ms: number;
  style: string;
  language: string;
  created_at: Date;
}

const COLUMNS =
  'id, raw_transcript, cleaned_transcript, word_count, duration_ms, style, language, created_at';

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    rawTranscript: row.raw_transcript,
    cleanedTranscript: row.cleaned_transcript,
    wordCount: row.word_count,
    durationMs: row.duration_ms,
    style: coerceWritingStyle(row.style),
    language: coerceLanguageCode(row.language),
    createdAt: toIso(row.created_at),
  };
}

export interface CreateSessionInput {
  userId: string;
  rawTranscript: string;
  cleanedTranscript: string;
  durationMs: number;
  style: string;
  language: string;
  wordCount?: number;
}

export async function createSession(
  db: Pool | PoolClient,
  input: CreateSessionInput,
): Promise<Session> {
  const wordCount = input.wordCount ?? countWords(input.cleanedTranscript);

  const row = await queryOne<SessionRow>(
    db,
    `INSERT INTO sessions
       (user_id, raw_transcript, cleaned_transcript, word_count, duration_ms, style, language)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      input.userId,
      input.rawTranscript,
      input.cleanedTranscript,
      wordCount,
      Math.max(0, Math.round(input.durationMs)),
      input.style,
      input.language,
    ],
  );

  if (row === null) throw new Error('session insert returned no row');
  return toSession(row);
}

export interface ListSessionsOptions {
  page?: number;
  pageSize?: number;
  /** Case-insensitive substring match across both transcripts. */
  search?: string;
}

export async function listSessions(
  db: Pool,
  userId: string,
  options: ListSessionsOptions = {},
): Promise<SessionPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? SESSIONS_PAGE_SIZE)));
  const offset = (page - 1) * pageSize;

  const search = options.search?.trim() ?? '';
  const hasSearch = search !== '';

  // Parameters are always bound, never interpolated — the search term reaches
  // Postgres as a value, so it cannot alter the statement. ILIKE's own
  // metacharacters still need escaping, or searching for "50%" matches any
  // "50…" and "C:\temp" matches nothing.
  const escaped = search.replace(/([\\%_])/g, '\\$1');
  const where = hasSearch
    ? 'user_id = $1 AND (raw_transcript ILIKE $2 OR cleaned_transcript ILIKE $2)'
    : 'user_id = $1';
  const params: unknown[] = hasSearch ? [userId, `%${escaped}%`] : [userId];

  const totalRow = await queryOne<{ count: string }>(
    db,
    `SELECT count(*)::text AS count FROM sessions WHERE ${where}`,
    params,
  );
  const total = toInt(totalRow?.count);

  const result = await query<SessionRow>(
    db,
    `SELECT ${COLUMNS} FROM sessions
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset],
  );

  const items = result.rows.map(toSession);

  return { items, page, pageSize, total, hasMore: offset + items.length < total };
}

export async function deleteSession(db: Pool, userId: string, sessionId: string): Promise<void> {
  // The user_id predicate is the authorization boundary: without it, a valid id
  // from another account would delete that account's row.
  const result = await query(db, 'DELETE FROM sessions WHERE id = $1 AND user_id = $2', [
    sessionId,
    userId,
  ]);

  if ((result.rowCount ?? 0) === 0) throw notFound('That dictation no longer exists.');
}

export async function deleteAllSessions(db: Pool, userId: string): Promise<number> {
  const result = await query(db, 'DELETE FROM sessions WHERE user_id = $1', [userId]);
  return result.rowCount ?? 0;
}
