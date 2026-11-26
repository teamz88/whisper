import OpenAI, { toFile } from 'openai';
import type { FastifyBaseLogger } from 'fastify';

import type { LanguageCode } from '@whisper/shared';

import { transcriptionFailed } from '../../errors.js';
import { describeApiError, isTransientError } from './client.js';

export interface TranscribeInput {
  audio: Buffer;
  filename: string;
  mimetype: string;
  language: LanguageCode;
  model: string;
  /** The user's custom vocabulary, already trimmed to the prompt window. */
  prompt?: string | undefined;
}

/**
 * One transcription call, with a single retry on transient failures.
 *
 * The Buffer has to be wrapped with toFile() — the SDK's `file` parameter takes
 * an `Uploadable` (a web File, a ReadStream, a Response), never a bare Buffer.
 * The filename matters too: both providers sniff the audio format from the
 * filename and content type, so ".wav" is load-bearing.
 */
export async function transcribe(
  client: OpenAI,
  input: TranscribeInput,
  logger: FastifyBaseLogger,
): Promise<string> {
  const attempt = async (): Promise<string> => {
    const file = await toFile(input.audio, input.filename, { type: input.mimetype });

    const result = await client.audio.transcriptions.create({
      file,
      model: input.model,
      language: input.language,
      // Literal, not a variable: the SDK picks the return type from this by
      // overload, and a `string` collapses it to the widest one.
      response_format: 'json',
      temperature: 0,
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    });

    return result.text ?? '';
  };

  try {
    return await attempt();
  } catch (error) {
    if (!isTransientError(error)) {
      logger.error(`[dictate] transcription failed: ${describeApiError(error)}`);
      throw transcriptionFailed('Transcription failed. Please try again.');
    }

    logger.warn(`[dictate] transcription transient failure, retrying once: ${describeApiError(error)}`);

    try {
      return await attempt();
    } catch (retryError) {
      logger.error(`[dictate] transcription failed after retry: ${describeApiError(retryError)}`);
      throw transcriptionFailed(
        'The transcription service is not responding. Your audio was not saved — try again in a moment.',
      );
    }
  }
}
