import OpenAI from 'openai';
import type { FastifyBaseLogger } from 'fastify';

import type { Env } from '../../env.js';

/**
 * One shared client for both providers — Groq speaks the OpenAI wire protocol,
 * so the only differences are the baseURL, the key and the model ids.
 *
 * `maxRetries: 0` disables the SDK's own retry loop so the pipeline can own
 * retrying: one explicit attempt, logged, rather than up to two silent ones
 * that quietly triple a user's worst-case latency.
 */
export function createAiClient(env: Env): OpenAI {
  return new OpenAI({
    apiKey: env.apiKey,
    baseURL: env.baseURL,
    maxRetries: 0,
    timeout: 120_000,
  });
}

/**
 * Pre-warm at boot so the first dictation of the day is not the one that pays
 * for DNS, the TLS handshake and the connection pool.
 *
 * It doubles as a model-id check. Providers deprecate models on a schedule that
 * does not care about our release cadence — Groq's llama-3.3-70b-versatile was
 * given a four-day shutdown window — and a warning at boot is far cheaper to
 * notice than a 404 in the middle of someone's sentence.
 */
export async function warmAiClient(
  client: OpenAI,
  env: Env,
  logger: FastifyBaseLogger,
): Promise<void> {
  const started = Date.now();

  try {
    const list = await client.models.list();
    const available = new Set(list.data.map((model) => model.id));

    const configured = [
      ['transcription (fast)', env.fastModel],
      ['transcription (accurate)', env.accurateModel],
      ['cleanup', env.cleanupModel],
    ] as const;

    for (const [role, id] of configured) {
      if (!available.has(id)) {
        logger.warn(
          `[ai] configured ${role} model "${id}" is not in ${env.provider}'s model list — it may have been renamed or shut down`,
        );
      }
    }

    logger.info(
      `[ai] ${env.provider} ready in ${Date.now() - started}ms · ${available.size} models · stt=${env.fastModel}/${env.accurateModel} · cleanup=${env.cleanupModel}`,
    );
  } catch (error) {
    // A provider outage at boot must not stop the API from serving auth and
    // history; only /dictate depends on it.
    logger.warn(
      `[ai] could not reach ${env.provider} at boot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** True for failures worth one more attempt: 5xx, 408, 429 and network errors. */
export function isTransientError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    if (status === undefined) return true; // connection-level failure
    return status === 408 || status === 429 || status >= 500;
  }
  if (error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.APIConnectionTimeoutError) {
    return true;
  }
  return false;
}

export function describeApiError(error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    return `${error.status ?? 'network'} ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export { OpenAI };
