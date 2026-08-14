import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type OpenAI from 'openai';

import type { ApiErrorBody } from '@whisper/shared';

import { createAuthGuards } from './auth/middleware.js';
import type { Pool } from './db.js';
import type { Env } from './env.js';
import { isHttpError } from './errors.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDictateRoute } from './routes/dictate.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMeRoutes } from './routes/me.js';

export interface AppDeps {
  env: Env;
  pool: Pool;
  ai: OpenAI;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;

  const app = Fastify({
    // Plain pino JSON on stdout. No pino-pretty transport: it would be another
    // dependency, and Coolify captures stdout as-is anyway.
    logger: { level: env.logLevel },
    // The audio arrives as multipart, but a generous JSON limit keeps a long
    // custom-vocabulary PUT from being rejected.
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: env.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: {
      // Default is 1 MB, which would silently truncate every dictation. Set a
      // little ABOVE the app-level limit so the dictate route's own size check
      // — the one that reports actual megabytes — fires before busboy's
      // generic FST_REQ_FILE_TOO_LARGE; this here is only the hard backstop.
      fileSize: env.maxAudioBytes + 1024 * 1024,
      files: 1,
      fields: 12,
    },
  });

  await app.register(rateLimit, {
    // Opt in per route rather than globally: /dictate is naturally slow and
    // self-limiting, and a shared bucket would let one chatty client throttle
    // the whole team.
    global: false,
    max: 60,
    timeWindow: '1 minute',
  });

  // Primitive decorators only. Fastify 5 rejects reference types here, because
  // one object would be shared across every request.
  app.decorateRequest('userId', '');
  app.decorateRequest('role', 'member');

  const guards = createAuthGuards(env);

  app.setErrorHandler((error, request, reply) => {
    if (isHttpError(error)) {
      const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
      reply.code(error.statusCode).send(body);
      return;
    }

    // Fastify types the error handler's first argument as `unknown` so that a
    // route can throw anything at all; narrow it once here.
    const fastifyError = error as Partial<FastifyError> & { message?: string };

    // Multipart limit breaches surface while the stream is consumed, not from
    // request.file(), so they land here rather than in the route.
    if (
      fastifyError.code === 'FST_REQ_FILE_TOO_LARGE' ||
      fastifyError.code === 'FST_FILES_LIMIT' ||
      fastifyError.code === 'FST_PARTS_LIMIT' ||
      fastifyError.code === 'FST_FIELDS_LIMIT'
    ) {
      const body: ApiErrorBody = {
        error: {
          code: 'payload_too_large',
          message: 'That recording is too long to upload. Try a shorter dictation.',
        },
      };
      reply.code(413).send(body);
      return;
    }

    // @fastify/rate-limit throws a plain Error carrying statusCode 429 — it is
    // neither an HttpError nor a validation error, so without this branch it
    // would fall through and surface as a 500.
    if (fastifyError.statusCode === 429) {
      const body: ApiErrorBody = {
        error: {
          code: 'rate_limited',
          message: fastifyError.message ?? 'Too many requests. Try again in a moment.',
        },
      };
      reply.code(429).send(body);
      return;
    }

    if (fastifyError.validation !== undefined) {
      const body: ApiErrorBody = {
        error: { code: 'bad_request', message: fastifyError.message ?? 'Invalid request.' },
      };
      reply.code(400).send(body);
      return;
    }

    request.log.error({ err: error }, 'unhandled error');
    const body: ApiErrorBody = {
      error: { code: 'internal_error', message: 'Something went wrong on our end.' },
    };
    reply.code(500).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorBody = {
      error: { code: 'not_found', message: `No route for ${request.method} ${request.url}` },
    };
    reply.code(404).send(body);
  });

  registerHealthRoute(app, deps);
  registerAuthRoutes(app, deps);
  registerMeRoutes(app, deps, guards);
  registerAdminRoutes(app, deps, guards);
  registerDictateRoute(app, deps, guards);

  return app;
}
