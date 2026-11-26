/**
 * Spoken languages offered in Settings: English and Russian only. A stored
 * code outside this list (an old Uzbek setting) reads back as English. Codes
 * are ISO-639-1 because that is what the Whisper `language` parameter expects.
 */

export interface LanguageOption {
  readonly code: string;
  readonly label: string;
  /** Endonym, shown dimmed next to the English label. */
  readonly native: string;
}

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
] as const satisfies readonly LanguageOption[];

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

const LANGUAGE_CODES: readonly string[] = LANGUAGES.map((l) => l.code);

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && LANGUAGE_CODES.includes(value);
}

export function coerceLanguageCode(value: unknown): LanguageCode {
  return isLanguageCode(value) ? value : DEFAULT_LANGUAGE;
}

export function languageLabel(code: LanguageCode): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/**
 * Languages where the turbo model's accuracy drops off enough to be worth the
 * extra latency of large-v3.
 */
export const HIGH_ACCURACY_LANGUAGES: readonly LanguageCode[] = ['ru'];

export function needsHighAccuracyModel(code: LanguageCode): boolean {
  return HIGH_ACCURACY_LANGUAGES.includes(code);
}
