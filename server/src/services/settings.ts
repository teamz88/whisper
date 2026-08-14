import {
  DEFAULT_SETTINGS,
  MAX_CUSTOM_VOCABULARY_CHARS,
  coerceLanguageCode,
  coerceWritingStyle,
  isOverlayPosition,
  isValidHotkey,
  type Settings,
  type UpdateSettingsRequest,
} from '@whisper/shared';

import { queryOne, toIso, type Pool } from '../db.js';
import { badRequest } from '../errors.js';

interface SettingsRow {
  user_id: string;
  hotkey: string;
  default_style: string;
  language: string;
  ai_cleanup: boolean;
  history_storage: boolean;
  overlay_position: string;
  custom_vocabulary: string;
  high_accuracy: boolean;
  updated_at: Date;
}

const COLUMNS =
  'user_id, hotkey, default_style, language, ai_cleanup, history_storage, overlay_position, custom_vocabulary, high_accuracy, updated_at';

/**
 * Coerces rather than rejects on read: a row written by an older client (or
 * hand-edited) must not lock the user out of their settings page.
 */
function toSettings(row: SettingsRow): Settings {
  return {
    hotkey: isValidHotkey(row.hotkey) ? row.hotkey : DEFAULT_SETTINGS.hotkey,
    defaultStyle: coerceWritingStyle(row.default_style),
    language: coerceLanguageCode(row.language),
    aiCleanup: row.ai_cleanup,
    historyStorage: row.history_storage,
    overlayPosition: isOverlayPosition(row.overlay_position)
      ? row.overlay_position
      : DEFAULT_SETTINGS.overlayPosition,
    customVocabulary: row.custom_vocabulary,
    highAccuracy: row.high_accuracy,
    updatedAt: toIso(row.updated_at),
  };
}

/**
 * Reads the settings row, creating it if it is somehow missing — a user whose
 * settings row was lost should still be able to dictate.
 */
export async function getSettings(db: Pool, userId: string): Promise<Settings> {
  const row = await queryOne<SettingsRow>(
    db,
    `SELECT ${COLUMNS} FROM user_settings WHERE user_id = $1`,
    [userId],
  );

  if (row !== null) return toSettings(row);

  const created = await queryOne<SettingsRow>(
    db,
    `INSERT INTO user_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING ${COLUMNS}`,
    [userId],
  );

  return created === null ? { ...DEFAULT_SETTINGS } : toSettings(created);
}

/** Validates a partial update and merges it over the stored row. */
export async function updateSettings(
  db: Pool,
  userId: string,
  patch: UpdateSettingsRequest,
): Promise<Settings> {
  const sets: string[] = [];
  const values: unknown[] = [];

  const set = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.hotkey !== undefined) {
    if (!isValidHotkey(patch.hotkey)) {
      throw badRequest('That shortcut cannot be used. Add a modifier key, or pick a function key.');
    }
    set('hotkey', patch.hotkey);
  }

  if (patch.defaultStyle !== undefined) set('default_style', coerceWritingStyle(patch.defaultStyle));
  if (patch.language !== undefined) set('language', coerceLanguageCode(patch.language));
  if (patch.aiCleanup !== undefined) set('ai_cleanup', Boolean(patch.aiCleanup));
  if (patch.historyStorage !== undefined) set('history_storage', Boolean(patch.historyStorage));
  if (patch.highAccuracy !== undefined) set('high_accuracy', Boolean(patch.highAccuracy));

  if (patch.overlayPosition !== undefined) {
    if (!isOverlayPosition(patch.overlayPosition)) throw badRequest('Unknown overlay position.');
    set('overlay_position', patch.overlayPosition);
  }

  if (patch.customVocabulary !== undefined) {
    if (patch.customVocabulary.length > MAX_CUSTOM_VOCABULARY_CHARS) {
      throw badRequest(`Custom vocabulary must be under ${MAX_CUSTOM_VOCABULARY_CHARS} characters.`);
    }
    set('custom_vocabulary', patch.customVocabulary);
  }

  if (sets.length === 0) return getSettings(db, userId);

  set('updated_at', new Date());
  values.push(userId);

  const row = await queryOne<SettingsRow>(
    db,
    `UPDATE user_settings SET ${sets.join(', ')} WHERE user_id = $${values.length} RETURNING ${COLUMNS}`,
    values,
  );

  if (row === null) {
    // No row to update — create it with the defaults, then apply the patch.
    await getSettings(db, userId);
    return updateSettings(db, userId, patch);
  }

  return toSettings(row);
}
