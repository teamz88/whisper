import type { FastifyInstance } from 'fastify';
import type { MultipartFile, MultipartValue } from '@fastify/multipart';

import {
  DICTATE_AUDIO_FIELD,
  MAX_RECORDING_MS,
  coerceLanguageCode,
  coerceWritingStyle,
  countWords,
  type DictateResponse,
  type Session,
} from '@whisper/shared';

import type { AppDeps } from '../app.js';
import type { AuthGuards } from '../auth/middleware.js';
import { badRequest, payloadTooLarge } from '../errors.js';
import { cleanupTranscript } from '../services/ai/cleanup.js';
import { classifyTranscript } from '../services/ai/hallucination.js';
import { buildVocabularyPrompt, pickTranscriptionModel } from '../services/ai/models.js';
import { transcribe } from '../services/ai/transcribe.js';
import { createSession } from '../services/sessions.js';

/**
 * A NO_SPEECH verdict from the cleanup model is honoured only for raw transcripts
 * shorter than this many words; longer ones are real speech by construction.
 */
const NO_SPEECH_TRUST_MAX_WORDS = 5;
import { getSettings } from '../services/settings.js';

/**
 * Multipart text fields only land in `data.fields` if the client wrote them
 * BEFORE the file part — parts after the file have not been parsed yet when
 * request.file() resolves. The desktop client appends every text field first
 * for exactly this reason.
 *
 * The index signature is `Multipart | Multipart[] | undefined`, so all three
 * cases have to be narrowed before the value is readable.
 */
function readField(file: MultipartFile, name: string): string | undefined {
  const raw = file.fields[name];
  const part = Array.isArray(raw) ? raw[0] : raw;
  if (part === undefined || part.type !== 'field') return undefined;
  const { value } = part as MultipartValue<unknown>;
  return value === undefined || value === null ? undefined : String(value);
}

function readBoolField(file: MultipartFile, name: string): boolean | undefined {
  const raw = readField(file, name);
  if (raw === undefined) return undefined;
  return raw === 'true' || raw === '1';
}

function readIntField(file: MultipartFile, name: string): number | undefined {
  const raw = readField(file, name);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function registerDictateRoute(
  app: FastifyInstance,
  { pool, ai, env }: AppDeps,
  guards: AuthGuards,
): void {
  /**
   * The whole pipeline: audio in, finished text out.
   *
   * It lives on the server so the provider keys never leave our infrastructure
   * — the desktop client holds nothing but a URL and the user's own tokens.
   */
  app.post(
    '/dictate',
    {
      onRequest: guards.requireAuth,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply): Promise<DictateResponse> => {
      const startedAt = Date.now();
      const { userId } = request;

      if (!request.isMultipart()) {
        throw badRequest('Send the audio as multipart/form-data.');
      }

      const file = await request.file();
      if (file === undefined) {
        throw badRequest(`No "${DICTATE_AUDIO_FIELD}" file in the upload.`);
      }

      // Buffering is where a file-size breach surfaces, not at request.file().
      const audio = await file.toBuffer();

      if (audio.byteLength === 0) {
        throw badRequest('The recording was empty.');
      }
      if (audio.byteLength > env.maxAudioBytes) {
        throw payloadTooLarge(
          `That recording is ${(audio.byteLength / 1024 / 1024).toFixed(1)} MB, over the ${Math.floor(
            env.maxAudioBytes / 1024 / 1024,
          )} MB limit. Try a shorter dictation.`,
        );
      }

      const settings = await getSettings(pool, userId);

      const language = coerceLanguageCode(readField(file, 'language') ?? settings.language);
      const style = coerceWritingStyle(readField(file, 'style') ?? settings.defaultStyle);
      const aiCleanup = readBoolField(file, 'aiCleanup') ?? settings.aiCleanup;

      // Prefer the real audio start/stop timestamps over the client's own
      // duration figure; fall back to it when they are missing or nonsensical.
      const audioStartedAt = readIntField(file, 'audioStartedAt');
      const audioStoppedAt = readIntField(file, 'audioStoppedAt');
      const reportedDuration = readIntField(file, 'durationMs') ?? 0;
      const measuredDuration =
        audioStartedAt !== undefined && audioStoppedAt !== undefined
          ? audioStoppedAt - audioStartedAt
          : 0;
      // Clamped: these are client-supplied wall-clock values, and one NTP jump
      // (or one buggy client sending audioStartedAt=0) would otherwise write a
      // decades-long session into everyone's stats.
      const durationMs = Math.min(
        MAX_RECORDING_MS + 60_000,
        measuredDuration > 0 ? measuredDuration : Math.max(0, reportedDuration),
      );

      const { model, reason } = pickTranscriptionModel(
        {
          baseURL: env.baseURL,
          fastModel: env.fastModel,
          accurateModel: env.accurateModel,
          cleanupModel: env.cleanupModel,
        },
        language,
        settings.highAccuracy,
      );

      // The user's own vocabulary, never a client-supplied one — this is read
      // from their settings row so it cannot be used to inject a prompt.
      const prompt = buildVocabularyPrompt(settings.customVocabulary);

      const whisperStartedAt = Date.now();
      const raw = await transcribe(
        ai,
        {
          audio,
          filename: file.filename === '' ? 'dictation.wav' : file.filename,
          mimetype: file.mimetype === '' ? 'audio/wav' : file.mimetype,
          language,
          model,
          prompt,
        },
        request.log,
      );
      const whisperMs = Date.now() - whisperStartedAt;

      const verdict = classifyTranscript(raw);
      if (verdict.hallucination) {
        request.log.info(
          `[dictate] user=${userId} discarded (${verdict.reason}) whisper ${whisperMs}ms · total ${Date.now() - startedAt}ms`,
        );
        return { discarded: true, reason: verdict.reason };
      }

      let cleaned = raw.trim();
      let cleanupMs = 0;

      if (aiCleanup) {
        const cleanupStartedAt = Date.now();
        const result = await cleanupTranscript(
          ai,
          {
            raw: cleaned,
            style,
            language,
            customVocabulary: settings.customVocabulary,
            model: env.cleanupModel,
          },
          request.log,
        );
        cleanupMs = Date.now() - cleanupStartedAt;

        if (result.kind === 'no-speech') {
          // The cleanup model's NO_SPEECH is a judgment call, and it has been wrong
          // on real sentences (2026-10-16: four 10-17 s dictations of one sentence
          // discarded in a row). A raw transcript with real words is never thrown
          // away on the model's word: keep the raw text instead. Only a short raw
          // (an artifact the hallucination pass did not know) is still discarded,
          // and both branches log the raw so the next case is diagnosable.
          const rawWords = countWords(cleaned);
          const rawPreview = JSON.stringify(cleaned.slice(0, 80));
          if (rawWords >= NO_SPEECH_TRUST_MAX_WORDS) {
            request.log.warn(
              `[dictate] user=${userId} cleanup said NO_SPEECH for a ${rawWords}-word transcript; using raw transcript ${rawPreview}`,
            );
          } else {
            request.log.info(
              `[dictate] user=${userId} discarded (no-speech) raw=${rawWords}w ${rawPreview} whisper ${whisperMs}ms · cleanup ${cleanupMs}ms · total ${Date.now() - startedAt}ms`,
            );
            return { discarded: true, reason: 'no-speech' };
          }
        }

        // 'fallback' deliberately keeps the raw transcript rather than failing.
        if (result.kind === 'cleaned') cleaned = result.text;
      }

      const wordCount = countWords(cleaned);

      let session: Session | null = null;
      if (settings.historyStorage) {
        session = await createSession(pool, {
          userId,
          rawTranscript: raw.trim(),
          cleanedTranscript: cleaned,
          durationMs,
          style,
          language,
          wordCount,
        });
      }

      const totalMs = Date.now() - startedAt;
      request.log.info(
        `[dictate] user=${userId} whisper ${whisperMs}ms · cleanup ${cleanupMs}ms · total ${totalMs}ms · ${wordCount}w · model=${model}(${reason})${settings.historyStorage ? '' : ' · not stored'}`,
      );

      reply.code(200);
      return {
        raw: raw.trim(),
        cleaned,
        wordCount,
        ...(session === null ? {} : { sessionId: session.id }),
      };
    },
  );
}
