import type { FastifyInstance } from 'fastify';

import { MIN_PASSWORD_LENGTH, type AdminStats, type AdminUser, type CreateUserRequest, type UpdateUserRequest } from '@whisper/shared';

import type { AppDeps } from '../app.js';
import type { AuthGuards } from '../auth/middleware.js';
import { revokeAllForUser } from '../auth/tokens.js';
import { badRequest } from '../errors.js';
import { createUser, listUsers, setActive } from '../services/users.js';
import { getAdminStats } from '../services/stats.js';

export function registerAdminRoutes(
  app: FastifyInstance,
  { pool }: AppDeps,
  guards: AuthGuards,
): void {
  const admin = { onRequest: guards.requireAdmin };

  app.get('/admin/users', admin, async (): Promise<AdminUser[]> => listUsers(pool));

  app.post<{ Body: CreateUserRequest }>(
    '/admin/users',
    {
      ...admin,
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 512 },
            fullName: { type: 'string', maxLength: 120 },
            role: { type: 'string', enum: ['admin', 'member'] },
          },
        },
      },
    },
    async (request, reply): Promise<AdminUser> => {
      const user = await createUser(pool, request.body);
      request.log.info(`[admin] user=${request.userId} created ${user.email} (${user.role})`);
      reply.code(201);
      return user;
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateUserRequest }>(
    '/admin/users/:id',
    {
      ...admin,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['isActive'],
          additionalProperties: false,
          properties: { isActive: { type: 'boolean' } },
        },
      },
    },
    async (request): Promise<AdminUser> => {
      const { id } = request.params;
      const { isActive } = request.body;

      // Enforced here, not just greyed out in the UI: an admin who deactivates
      // themselves locks the whole team out of user management. Compared
      // case-insensitively — UUID format validation accepts uppercase hex and
      // Postgres matches it, so a raw string compare would be bypassable.
      if (id.toLowerCase() === request.userId.toLowerCase() && !isActive) {
        throw badRequest('You cannot deactivate your own account.');
      }

      const user = await setActive(pool, id, isActive);

      if (!isActive) {
        // Otherwise their desktop app keeps working until the access token
        // expires, and could refresh straight past the deactivation.
        await revokeAllForUser(pool, id);
        request.log.info(`[admin] user=${request.userId} deactivated ${user.email}`);
      }

      return user;
    },
  );

  app.get('/admin/stats', admin, async (): Promise<AdminStats> => getAdminStats(pool));
}
