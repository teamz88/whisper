import type { FastifyInstance } from 'fastify';

import {
  MIN_PASSWORD_LENGTH,
  type AdminStats,
  type AdminUser,
  type CreateUserRequest,
  type DeleteUserResponse,
  type UpdateUserRequest,
} from '@whisper/shared';

import type { AppDeps } from '../app.js';
import type { AuthGuards } from '../auth/middleware.js';
import { revokeAllForUser } from '../auth/tokens.js';
import { badRequest } from '../errors.js';
import { adminUpdateUser, createUser, deleteUser, listUsers } from '../services/users.js';
import { getAdminStats } from '../services/stats.js';

/** UUID format validation accepts uppercase hex and Postgres matches it. */
function isSelf(id: string, callerId: string): boolean {
  return id.toLowerCase() === callerId.toLowerCase();
}

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

  /**
   * Full admin edit: email, temporary password, name, role, active flag — any
   * subset. Doubles as the password-reset path: there is no email-based reset,
   * an admin hands out a new temporary password instead.
   */
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
          additionalProperties: false,
          minProperties: 1,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 512 },
            fullName: { type: 'string', maxLength: 120 },
            role: { type: 'string', enum: ['admin', 'member'] },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    async (request): Promise<AdminUser> => {
      const { id } = request.params;
      const patch = request.body;

      // Self-protection, enforced server-side and not just greyed out in the
      // UI: an admin who deactivates or demotes themselves locks the team out
      // of user management.
      if (isSelf(id, request.userId)) {
        if (patch.isActive === false) {
          throw badRequest('You cannot deactivate your own account.');
        }
        if (patch.role === 'member') {
          throw badRequest('You cannot remove your own admin role.');
        }
      }

      const { profile, passwordChanged } = await adminUpdateUser(pool, id, patch);

      // A new password or a deactivation must end the user's existing
      // sessions; otherwise their app keeps working on the old credentials
      // until the tokens expire naturally.
      if (passwordChanged || patch.isActive === false) {
        await revokeAllForUser(pool, id);
      }

      request.log.info(
        `[admin] user=${request.userId} updated ${profile.email} (${Object.keys(patch).join(',')})`,
      );

      return profile;
    },
  );

  /** Permanent delete — account, settings, history and sessions all cascade. */
  app.delete<{ Params: { id: string } }>(
    '/admin/users/:id',
    {
      ...admin,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request): Promise<DeleteUserResponse> => {
      const { id } = request.params;

      if (isSelf(id, request.userId)) {
        throw badRequest('You cannot delete your own account.');
      }

      // Refresh tokens cascade with the row, so no separate revocation needed.
      await deleteUser(pool, id);
      request.log.info(`[admin] user=${request.userId} deleted user ${id}`);

      return { deleted: true };
    },
  );

  app.get('/admin/stats', admin, async (): Promise<AdminStats> => getAdminStats(pool));
}
