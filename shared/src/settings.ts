import { DEFAULT_HOTKEY } from './hotkey.js';
import { DEFAULT_LANGUAGE, type LanguageCode } from './languages.js';
import { DEFAULT_WRITING_STYLE, type WritingStyle } from './styles.js';

export const OVERLAY_POSITIONS = ['bottom-center', 'bottom-left', 'bottom-right'] as const;

export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export const OVERLAY_POSITION_LABELS: Record<OverlayPosition, string> = {
  'bottom-center': 'Bottom Center',
  'bottom-left': 'Bottom Left',
  'bottom-right': 'Bottom Right',
};

export function isOverlayPosition(value: unknown): value is OverlayPosition {
  return typeof value === 'string' && (OVERLAY_POSITIONS as readonly string[]).includes(value);
}

/**
 * The user's dictation settings, as stored in `user_settings` and mirrored into
 * electron-store on the client so the hotkey works before the first API call
 * returns.
 */
export interface Settings {
  /** See ./hotkey.ts for the grammar. */
  hotkey: string;
  defaultStyle: WritingStyle;
  language: LanguageCode;
  aiCleanup: boolean;
  /** false => the server persists nothing for this user's dictations. */
  historyStorage: boolean;
  overlayPosition: OverlayPosition;
  /** Names, brands and jargon, passed to Whisper as a spelling prompt. */
  customVocabulary: string;
  /** Force the large-v3 model even for languages the turbo model handles well. */
  highAccuracy: boolean;
  /** ISO-8601 UTC, null until the row is first written. Server-owned. */
  updatedAt: string | null;
}

/** Everything the client is allowed to write. */
export type SettingsInput = Omit<Settings, 'updatedAt'>;

/** PUT /me/settings accepts a partial body and merges it over the stored row. */
export type UpdateSettingsRequest = Partial<SettingsInput>;

export const DEFAULT_SETTINGS: Settings = {
  hotkey: DEFAULT_HOTKEY,
  defaultStyle: DEFAULT_WRITING_STYLE,
  language: DEFAULT_LANGUAGE,
  aiCleanup: true,
  historyStorage: true,
  overlayPosition: 'bottom-center',
  customVocabulary: '',
  highAccuracy: false,
  updatedAt: null,
};

/** Whisper's prompt field is small; keep the vocabulary well inside it. */
export const MAX_CUSTOM_VOCABULARY_CHARS = 2000;
