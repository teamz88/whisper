import { config as loadDotenv } from 'dotenv';

import { MAX_AUDIO_BYTES } from '@whisper/shared';

import {
  PROVIDER_DEFAULTS,
  isTranscriptionProvider,
  type TranscriptionProvider,
} from './services/ai/models.js';

loadDotenv();

export interface Env {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  databaseUrl: string;
  /** Set when the Postgres host needs TLS without a local CA (managed DBs). */
  databaseSsl: boolean;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  /** '*' allows any origin. Otherwise a comma-separated allowlist. */
  corsOrigin: string[] | true;
  provider: TranscriptionProvider;
  apiKey: string;
  baseURL: string;
  fastModel: string;
  accurateModel: string;
  cleanupModel: string;
  maxAudioBytes: number;
  logLevel: string;
}

class EnvError extends Error {
  constructor(problems: string[]) {
    super(
      `Invalid environment.\n${problems.map((p) => `  - ${p}`).join('\n')}\n\n` +
        'See server/.env.example for the full list.',
    );
    this.name = 'EnvError';
  }
}

function readString(name: string, fallback?: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim();
}

function readInt(name: string, fallback: number, problems: string[]): number {
  const raw = readString(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    problems.push(`${name} must be a positive integer (got "${raw}")`);
    return fallback;
  }
  return parsed;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = readString(name);
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

/**
 * Secrets that would silently weaken auth if left at a placeholder. Anything
 * shorter than this is almost certainly a copy-paste from the example file.
 */
const MIN_SECRET_LENGTH = 32;

export function loadEnv(): Env {
  const problems: string[] = [];

  const nodeEnvRaw = readString('NODE_ENV', 'development')!;
  const nodeEnv =
    nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development';

  const databaseUrl = readString('DATABASE_URL');
  if (databaseUrl === undefined) {
    problems.push('DATABASE_URL is required (postgres://user:pass@host:5432/dbname)');
  }

  const jwtAccessSecret = readString('JWT_ACCESS_SECRET');
  const jwtRefreshSecret = readString('JWT_REFRESH_SECRET');
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', jwtAccessSecret],
    ['JWT_REFRESH_SECRET', jwtRefreshSecret],
  ] as const) {
    if (value === undefined) {
      problems.push(`${name} is required — generate one with: openssl rand -hex 32`);
    } else if (value.length < MIN_SECRET_LENGTH) {
      problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
    }
  }
  if (
    jwtAccessSecret !== undefined &&
    jwtRefreshSecret !== undefined &&
    jwtAccessSecret === jwtRefreshSecret
  ) {
    problems.push(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ, otherwise an access token can be replayed as a refresh token',
    );
  }

  const providerRaw = readString('TRANSCRIPTION_PROVIDER', 'groq')!;
  if (!isTranscriptionProvider(providerRaw)) {
    problems.push(`TRANSCRIPTION_PROVIDER must be "groq" or "openai" (got "${providerRaw}")`);
  }
  const provider: TranscriptionProvider = isTranscriptionProvider(providerRaw)
    ? providerRaw
    : 'groq';
  const defaults = PROVIDER_DEFAULTS[provider];

  const apiKey =
    provider === 'groq' ? readString('GROQ_API_KEY') : readString('OPENAI_API_KEY');
  if (apiKey === undefined) {
    problems.push(
      provider === 'groq'
        ? 'GROQ_API_KEY is required when TRANSCRIPTION_PROVIDER=groq'
        : 'OPENAI_API_KEY is required when TRANSCRIPTION_PROVIDER=openai',
    );
  }

  const corsRaw = readString('CORS_ORIGIN', '*')!;
  const corsOrigin: string[] | true =
    corsRaw === '*'
      ? true
      : corsRaw
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin !== '');
  if (Array.isArray(corsOrigin) && corsOrigin.length === 0) {
    problems.push('CORS_ORIGIN was set but contained no origins');
  }

  const maxAudioBytes = readInt('MAX_AUDIO_BYTES', MAX_AUDIO_BYTES, problems);
  const port = readInt('PORT', 8080, problems);

  if (problems.length > 0) throw new EnvError(problems);

  return {
    nodeEnv,
    host: readString('HOST', '0.0.0.0')!,
    port,
    databaseUrl: databaseUrl!,
    databaseSsl: readBool('DATABASE_SSL', false),
    jwtAccessSecret: jwtAccessSecret!,
    jwtRefreshSecret: jwtRefreshSecret!,
    corsOrigin,
    provider,
    apiKey: apiKey!,
    baseURL: readString('AI_BASE_URL', defaults.baseURL)!,
    fastModel: readString('TRANSCRIBE_FAST_MODEL', defaults.fastModel)!,
    accurateModel: readString('TRANSCRIBE_ACCURATE_MODEL', defaults.accurateModel)!,
    cleanupModel: readString('CLEANUP_MODEL', defaults.cleanupModel)!,
    maxAudioBytes,
    logLevel: readString('LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug')!,
  };
}
