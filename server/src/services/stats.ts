import type { AdminStats, UserStats } from '@whisper/shared';

import { query, queryOne, toInt, type Pool } from '../db.js';

/**
 * "Today" and "streak" are only meaningful in the user's own timezone: at 21:00
 * in Tashkent it is still yesterday in UTC, and a user dictating every evening
 * would watch their streak reset. The client sends its
 * Date.getTimezoneOffset() and every day boundary below is computed in that
 * offset.
 */
function normaliseOffset(tzOffsetMinutes: number | undefined): number {
  if (tzOffsetMinutes === undefined || !Number.isFinite(tzOffsetMinutes)) return 0;
  // Guard against a nonsense value putting the date arithmetic somewhere silly.
  return Math.max(-14 * 60, Math.min(14 * 60, Math.round(tzOffsetMinutes)));
}

interface TotalsRow {
  total_words: string | null;
  total_sessions: string;
  avg_duration: string | null;
  sessions_today: string;
}

interface DayRow {
  day: string;
}

/**
 * Consecutive days ending today. A streak that has today missing but yesterday
 * present still counts — the day is not over yet, and zeroing someone's streak
 * at midnight for not having dictated yet would be actively hostile.
 */
function computeStreak(days: string[], todayKey: string, yesterdayKey: string): number {
  if (days.length === 0) return 0;

  const set = new Set(days);
  let cursor: string;

  if (set.has(todayKey)) cursor = todayKey;
  else if (set.has(yesterdayKey)) cursor = yesterdayKey;
  else return 0;

  let streak = 0;
  let date = new Date(`${cursor}T00:00:00Z`);

  while (set.has(date.toISOString().slice(0, 10))) {
    streak += 1;
    date = new Date(date.getTime() - 24 * 60 * 60 * 1000);
  }

  return streak;
}

export async function getUserStats(
  db: Pool,
  userId: string,
  tzOffsetMinutes?: number,
): Promise<UserStats> {
  const offset = normaliseOffset(tzOffsetMinutes);

  // `AT TIME ZONE 'UTC'` before every ::date cast: a bare timestamptz::date
  // truncates in the SESSION timezone, and the JS day keys below are UTC-based
  // — on a Postgres whose default timezone is not UTC the two would disagree
  // by hours and quietly zero people's streaks.
  const totals = await queryOne<TotalsRow>(
    db,
    `SELECT
       coalesce(sum(word_count), 0)::text AS total_words,
       count(*)::text                     AS total_sessions,
       coalesce(avg(duration_ms), 0)::text AS avg_duration,
       count(*) FILTER (
         WHERE ((created_at AT TIME ZONE 'UTC') - make_interval(mins => $2))::date
             = ((now() AT TIME ZONE 'UTC') - make_interval(mins => $2))::date
       )::text AS sessions_today
     FROM sessions
     WHERE user_id = $1`,
    [userId, offset],
  );

  // One row per day the user dictated, newest first. Two years is far more than
  // any streak worth displaying and keeps the payload bounded.
  const dayRows = await query<DayRow>(
    db,
    `SELECT DISTINCT to_char(((created_at AT TIME ZONE 'UTC') - make_interval(mins => $2))::date, 'YYYY-MM-DD') AS day
       FROM sessions
      WHERE user_id = $1
      ORDER BY day DESC
      LIMIT 800`,
    [userId, offset],
  );

  const nowLocal = new Date(Date.now() - offset * 60_000);
  const todayKey = nowLocal.toISOString().slice(0, 10);
  const yesterdayKey = new Date(nowLocal.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    totalWords: toInt(totals?.total_words),
    totalSessions: toInt(totals?.total_sessions),
    sessionsToday: toInt(totals?.sessions_today),
    averageDurationMs: Math.round(Number(totals?.avg_duration ?? 0)),
    streak: computeStreak(
      dayRows.rows.map((row) => row.day),
      todayKey,
      yesterdayKey,
    ),
  };
}

interface AdminTotalsRow {
  total_words: string | null;
  sessions_this_week: string;
}

interface UserCountsRow {
  total_users: string;
  active_users: string;
}

interface MostActiveRow {
  id: string;
  full_name: string | null;
  email: string;
  words: string;
}

export async function getAdminStats(db: Pool): Promise<AdminStats> {
  const totals = await queryOne<AdminTotalsRow>(
    db,
    `SELECT
       coalesce(sum(word_count), 0)::text AS total_words,
       count(*) FILTER (WHERE created_at >= now() - interval '7 days')::text AS sessions_this_week
     FROM sessions`,
  );

  const counts = await queryOne<UserCountsRow>(
    db,
    `SELECT count(*)::text AS total_users,
            count(*) FILTER (WHERE is_active)::text AS active_users
       FROM users`,
  );

  const mostActive = await queryOne<MostActiveRow>(
    db,
    `SELECT u.id, u.full_name, u.email, coalesce(sum(s.word_count), 0)::text AS words
       FROM users u
       JOIN sessions s ON s.user_id = u.id
      GROUP BY u.id, u.full_name, u.email
      ORDER BY sum(s.word_count) DESC NULLS LAST
      LIMIT 1`,
  );

  return {
    totalWords: toInt(totals?.total_words),
    sessionsThisWeek: toInt(totals?.sessions_this_week),
    totalUsers: toInt(counts?.total_users),
    activeUsers: toInt(counts?.active_users),
    mostActiveUser:
      mostActive === null
        ? null
        : {
            id: mostActive.id,
            fullName: mostActive.full_name,
            email: mostActive.email,
            words: toInt(mostActive.words),
          },
  };
}
