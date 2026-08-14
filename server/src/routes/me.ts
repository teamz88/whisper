import type { FastifyInstance } from 'fastify';

import type {
  CreateSessionRequest,
  DeleteAllSessionsResponse,
  Profile,
  Session,
  SessionPage,
  Settings,
  UpdateProfileRequest,
  UpdateSettingsRequest,
  UserStats,
} from '@whisper/shared';

import type { AppDeps } from '../app.js';
import type { AuthGuards } from '../auth/middleware.js';
import { getProfile, updateProfile } from '../services/users.js';
import { getSettings, updateSettings } from '../services/settings.js';
import {
  createSession,
  deleteAllSessions,
  deleteSession,
  listSessions,
} from '../services/sessions.js';
import { getUserStats } from '../services/stats.js';

/**
 * Every route here scopes to request.userId, which comes from the verified
 * access token. That is the authorization boundary — the equivalent of a
 * row-level-security policy, enforced here because the database is never
 * exposed to a client. An id in the URL is only ever used together with the
 * caller's own user id.
 */
export function registerMeRoutes(
  app: FastifyInstance,
  { pool }: AppDeps,
  guards: AuthGuards,
): void {
  const auth = { onRequest: guards.requireAuth };

  app.get('/me/profile', auth, async (request): Promise<Profile> => {
    return getProfile(pool, request.userId);
  });

  app.patch<{ Body: UpdateProfileRequest }>(
    '/me/profile',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            fullName: { type: 'string', maxLength: 120 },
            onboarded: { type: 'boolean' },
          },
        },
      },
    },
    async (request): Promise<Profile> => updateProfile(pool, request.userId, request.body),
  );

  app.get('/me/settings', auth, async (request): Promise<Settings> => {
    return getSettings(pool, request.userId);
  });

  app.put<{ Body: UpdateSettingsRequest }>(
    '/me/settings',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hotkey: { type: 'string', maxLength: 64 },
            defaultStyle: { type: 'string', maxLength: 32 },
            language: { type: 'string', maxLength: 8 },
            aiCleanup: { type: 'boolean' },
            historyStorage: { type: 'boolean' },
            overlayPosition: { type: 'string', maxLength: 32 },
            customVocabulary: { type: 'string', maxLength: 4000 },
            highAccuracy: { type: 'boolean' },
          },
        },
      },
    },
    async (request): Promise<Settings> => updateSettings(pool, request.userId, request.body),
  );

  app.get<{ Querystring: { page?: number; pageSize?: number; search?: string } }>(
    '/me/sessions',
    {
      ...auth,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            search: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request): Promise<SessionPage> => {
      const { page, pageSize, search } = request.query;
      return listSessions(pool, request.userId, { page, pageSize, search });
    },
  );

  app.post<{ Body: CreateSessionRequest }>(
    '/me/sessions',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          required: ['rawTranscript', 'cleanedTranscript', 'durationMs', 'style', 'language'],
          additionalProperties: false,
          properties: {
            rawTranscript: { type: 'string', maxLength: 100_000 },
            cleanedTranscript: { type: 'string', maxLength: 100_000 },
            durationMs: { type: 'integer', minimum: 0 },
            style: { type: 'string', maxLength: 32 },
            language: { type: 'string', maxLength: 8 },
            wordCount: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request, reply): Promise<Session> => {
      const session = await createSession(pool, { userId: request.userId, ...request.body });
      reply.code(201);
      return session;
    },
  );

  // Declared before the ':id' variant so "delete all" is never parsed as an id.
  app.delete('/me/sessions', auth, async (request): Promise<DeleteAllSessionsResponse> => {
    const deleted = await deleteAllSessions(pool, request.userId);
    request.log.info(`[privacy] user=${request.userId} deleted all history (${deleted} sessions)`);
    return { deleted };
  });

  app.delete<{ Params: { id: string } }>(
    '/me/sessions/:id',
    {
      ...auth,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply): Promise<void> => {
      await deleteSession(pool, request.userId, request.params.id);
      reply.code(204);
    },
  );

  app.get<{ Querystring: { tzOffset?: number } }>(
    '/me/stats',
    {
      ...auth,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            // Date.getTimezoneOffset() from the client, so "today" and the
            // streak are computed in the user's own day boundaries.
            tzOffset: { type: 'integer', minimum: -840, maximum: 840, default: 0 },
          },
        },
      },
    },
    async (request): Promise<UserStats> => getUserStats(pool, request.userId, request.query.tzOffset),
  );
}
