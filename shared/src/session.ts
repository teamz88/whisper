import type { LanguageCode } from './languages.js';
import type { WritingStyle } from './styles.js';

/** One dictation, as stored in `sessions` and rendered in Home/History. */
export interface Session {
  id: string;
  /** Straight from Whisper, shown behind the "Show raw" toggle. */
  rawTranscript: string;
  /** What actually got pasted. Equals rawTranscript when AI cleanup is off. */
  cleanedTranscript: string;
  wordCount: number;
  /** Real microphone time, from audioStoppedAt - audioStartedAt. */
  durationMs: number;
  style: WritingStyle;
  language: LanguageCode;
  /** ISO-8601 UTC. */
  createdAt: string;
}

export const SESSIONS_PAGE_SIZE = 20;

export interface SessionPage {
  items: Session[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * POST /me/sessions. The dictate pipeline stores rows itself; this exists so a
 * client can back-fill a session that was pasted while the network was down.
 */
export interface CreateSessionRequest {
  rawTranscript: string;
  cleanedTranscript: string;
  durationMs: number;
  style: WritingStyle;
  language: LanguageCode;
  /** Server recomputes from cleanedTranscript when omitted. */
  wordCount?: number;
}

export interface DeleteAllSessionsResponse {
  deleted: number;
}

/** The single definition of "a word", so client and server counts always match. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/** Typing speed assumed when converting words dictated into time saved. */
export const ASSUMED_TYPING_WPM = 40;

export function timeSavedMs(totalWords: number): number {
  return Math.round((totalWords / ASSUMED_TYPING_WPM) * 60_000);
}
