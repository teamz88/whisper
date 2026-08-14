import type OpenAI from 'openai';
import type { FastifyBaseLogger } from 'fastify';

import type { LanguageCode, WritingStyle } from '@whisper/shared';

import { describeApiError, isTransientError } from './client.js';
import {
  buildCleanupSystemPrompt,
  looksLikeRefusal,
  stripPreamble,
  stripWrapping,
} from './prompts.js';

export interface CleanupInput {
  raw: string;
  style: WritingStyle;
  language: LanguageCode;
  customVocabulary: string;
  model: string;
}

export type CleanupResult =
  | { kind: 'cleaned'; text: string }
  /** The model judged the input to be silence or an artifact. */
  | { kind: 'no-speech' }
  /** Cleanup was unusable; the caller falls back to the raw transcript. */
  | { kind: 'fallback'; reason: string };

/**
 * The cleanup pass never fails a dictation. Every failure mode — provider
 * error, refusal, empty output — degrades to the raw transcript, because
 * unpolished text in the user's document beats no text at all.
 */
export async function cleanupTranscript(
  client: OpenAI,
  input: CleanupInput,
  logger: FastifyBaseLogger,
): Promise<CleanupResult> {
  const system = buildCleanupSystemPrompt({
    style: input.style,
    language: input.language,
    customVocabulary: input.customVocabulary,
  });

  const attempt = async (): Promise<{ text: string; truncated: boolean }> => {
    const completion = await client.chat.completions.create({
      model: input.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input.raw },
      ],
      temperature: 0.2,
      // Runaway guard, not a budget. The floor is deliberately high: the
      // default cleanup model (gpt-oss-120b) is a reasoning model whose
      // REASONING tokens count against max_tokens too — a tight cap starves
      // the visible answer, not the reasoning.
      max_tokens: Math.min(8192, Math.max(2048, Math.ceil(input.raw.length / 2))),
      // Cleanup needs no deliberation; don't pay reasoning latency for it.
      ...(/gpt-oss/.test(input.model) ? { reasoning_effort: 'low' as const } : {}),
    });

    const choice = completion.choices[0];
    return {
      text: choice?.message?.content ?? '',
      truncated: choice?.finish_reason === 'length',
    };
  };

  let output: { text: string; truncated: boolean };
  try {
    output = await attempt();
  } catch (error) {
    if (!isTransientError(error)) {
      logger.warn(`[dictate] cleanup failed, using raw transcript: ${describeApiError(error)}`);
      return { kind: 'fallback', reason: describeApiError(error) };
    }
    try {
      output = await attempt();
    } catch (retryError) {
      logger.warn(
        `[dictate] cleanup failed after retry, using raw transcript: ${describeApiError(retryError)}`,
      );
      return { kind: 'fallback', reason: describeApiError(retryError) };
    }
  }

  // A reply cut off by max_tokens is half a sentence — worse than the raw
  // transcript it was polishing.
  if (output.truncated) {
    logger.warn('[dictate] cleanup hit max_tokens, using raw transcript');
    return { kind: 'fallback', reason: 'truncated' };
  }

  const text = stripPreamble(stripWrapping(output.text));

  if (text === '') {
    return { kind: 'fallback', reason: 'empty cleanup output' };
  }

  // Tolerant of every sentinel drift seen in practice: "NO_SPEECH.",
  // "no_speech", "NO SPEECH" all canonicalise to the same string.
  if (text.toUpperCase().replace(/[^A-Z]/g, '') === 'NOSPEECH') {
    return { kind: 'no-speech' };
  }

  if (looksLikeRefusal(text, input.raw)) {
    logger.warn(`[dictate] cleanup returned a refusal, using raw transcript: ${text.slice(0, 80)}`);
    return { kind: 'fallback', reason: 'model refused' };
  }

  return { kind: 'cleaned', text };
}
