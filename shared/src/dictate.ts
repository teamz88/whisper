import type { LanguageCode } from './languages.js';
import type { WritingStyle } from './styles.js';

/**
 * Audio the client will not even try to upload. 16 kHz 16-bit mono PCM is
 * 32 kB/s, so 24 MB is a little over 12 minutes — comfortably past the
 * 10-minute auto-stop, and under every provider's 25 MB request cap.
 */
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

/** Recording hard stop. The renderer flushes whatever it has captured. */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

/** Sample rate we resample to before upload. */
export const TARGET_SAMPLE_RATE = 16_000;

/** Text fields sent alongside the WAV in the POST /dictate multipart body. */
export interface DictateFields {
  language: LanguageCode;
  style: WritingStyle;
  aiCleanup: boolean;
  /** Client-measured microphone time, in ms. */
  durationMs: number;
  /** Epoch ms, captured right after getUserMedia resolves. */
  audioStartedAt: number;
  /** Epoch ms, captured when the mic stream is torn down. */
  audioStoppedAt: number;
}

export interface DictateSuccess {
  discarded?: false;
  raw: string;
  cleaned: string;
  wordCount: number;
  /** Absent when the user has history storage turned off. */
  sessionId?: string;
}

/** Silence, a Whisper hallucination, or a NO_SPEECH verdict from cleanup. */
export interface DictateDiscarded {
  discarded: true;
  reason: 'empty' | 'hallucination' | 'no-speech';
}

export type DictateResponse = DictateSuccess | DictateDiscarded;

export function isDiscarded(response: DictateResponse): response is DictateDiscarded {
  return response.discarded === true;
}

/** The multipart field name the server reads the WAV from. */
export const DICTATE_AUDIO_FIELD = 'audio';
