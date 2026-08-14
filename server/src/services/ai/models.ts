import { needsHighAccuracyModel, type LanguageCode } from '@whisper/shared';

/**
 * Provider + model registry.
 *
 * Groq is OpenAI-API-compatible, so both providers are driven through the same
 * `openai` SDK class — switching is a different baseURL, key and model id.
 *
 * Model ids verified against the provider docs on 2026-08-12. They churn; every
 * id here is overridable by env, and boot-time validation (see client.ts) lists
 * the provider's live models and warns when a configured id has disappeared.
 */

export const TRANSCRIPTION_PROVIDERS = ['groq', 'openai'] as const;

export type TranscriptionProvider = (typeof TRANSCRIPTION_PROVIDERS)[number];

export function isTranscriptionProvider(value: unknown): value is TranscriptionProvider {
  return typeof value === 'string' && (TRANSCRIPTION_PROVIDERS as readonly string[]).includes(value);
}

export interface ProviderDefaults {
  readonly baseURL: string;
  /** Fast path. Used for most languages. */
  readonly fastModel: string;
  /** Slower, more accurate. Used for ru/uz/tg and when highAccuracy is on. */
  readonly accurateModel: string;
  /** Instruct model used for the cleanup pass. */
  readonly cleanupModel: string;
}

export const PROVIDER_DEFAULTS: Record<TranscriptionProvider, ProviderDefaults> = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    fastModel: 'whisper-large-v3-turbo',
    accurateModel: 'whisper-large-v3',
    /**
     * NOT llama-3.3-70b-versatile: Groq scheduled it for hard shutdown on
     * 2026-08-16 and lists this as the replacement. The "openai/" prefix is part
     * of Groq's model id — it does not route the request to OpenAI.
     */
    cleanupModel: 'openai/gpt-oss-120b',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    /**
     * whisper-1 rather than gpt-4o-transcribe: it is the only OpenAI model with
     * the same parameter surface as Groq's whisper models (singular `language`,
     * `prompt`, verbose_json), which is what makes the provider swap a one-line
     * change.
     */
    fastModel: 'whisper-1',
    accurateModel: 'whisper-1',
    cleanupModel: 'gpt-4o-mini',
  },
};

export interface TranscriptionModelChoice {
  readonly model: string;
  readonly reason: 'high-accuracy-setting' | 'language' | 'default';
}

/**
 * Turbo is ~2.5x cheaper and noticeably faster; large-v3 earns its latency on
 * the languages where turbo's word error rate climbs.
 */
export function pickTranscriptionModel(
  defaults: ProviderDefaults,
  language: LanguageCode,
  highAccuracy: boolean,
): TranscriptionModelChoice {
  if (highAccuracy) {
    return { model: defaults.accurateModel, reason: 'high-accuracy-setting' };
  }
  if (needsHighAccuracyModel(language)) {
    return { model: defaults.accurateModel, reason: 'language' };
  }
  return { model: defaults.fastModel, reason: 'default' };
}

/**
 * Whisper's decoder prompt window is 224 tokens on both providers; anything
 * past it is dropped silently. Budgeting ~3 characters per token is pessimistic
 * enough to hold for Cyrillic, which tokenises far worse than English.
 */
export const PROMPT_TOKEN_BUDGET = 224;
const CHARS_PER_TOKEN = 3;
export const MAX_PROMPT_CHARS = PROMPT_TOKEN_BUDGET * CHARS_PER_TOKEN;

/**
 * Trim the user's custom vocabulary to fit the prompt window, cutting at a term
 * boundary so a name never arrives half-spelled.
 */
export function buildVocabularyPrompt(customVocabulary: string): string | undefined {
  const vocabulary = customVocabulary.trim().replace(/\s+/g, ' ');
  if (vocabulary === '') return undefined;
  if (vocabulary.length <= MAX_PROMPT_CHARS) return vocabulary;

  const clipped = vocabulary.slice(0, MAX_PROMPT_CHARS);
  const lastBoundary = Math.max(clipped.lastIndexOf(','), clipped.lastIndexOf(' '));
  return (lastBoundary > MAX_PROMPT_CHARS / 2 ? clipped.slice(0, lastBoundary) : clipped).trim();
}
