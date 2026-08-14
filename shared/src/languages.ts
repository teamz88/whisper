/**
 * Spoken languages offered in Settings. Codes are ISO-639-1 because that is what
 * the Whisper `language` parameter expects on both Groq and OpenAI.
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
  { code: 'uz', label: 'Uzbek', native: "O'zbek" },
  { code: 'tg', label: 'Tajik', native: 'Тоҷикӣ' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'nl', label: 'Dutch', native: 'Nederlands' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'zh', label: 'Chinese', native: '中文' },
  { code: 'ko', label: 'Korean', native: '한국어' },
  { code: 'ar', label: 'Arabic', native: 'العربية' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
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
 * extra latency of large-v3. The server also switches on the user's
 * `highAccuracy` setting.
 */
export const HIGH_ACCURACY_LANGUAGES: readonly LanguageCode[] = ['ru', 'uz', 'tg'];

export function needsHighAccuracyModel(code: LanguageCode): boolean {
  return HIGH_ACCURACY_LANGUAGES.includes(code);
}
