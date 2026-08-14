import type { FastifyInstance } from 'fastify';

import type {
  AuthResponse,
  LoginRequest,
  LogoutRequest,
  LogoutResponse,
  RefreshRequest,
} from '@whisper/shared';

import type { AppDeps } from '../app.js';
import { verifyPassword } from '../auth/password.js';
import {
  consumeRefreshToken,
  issueTokens,
  revokeRefreshToken,
} from '../auth/tokens.js';
import { withTransaction } from '../db.js';
import { accountDisabled, invalidCredentials, invalidRefreshToken } from '../errors.js';
import { findByEmail, findById, toProfile } from '../services/users.js';

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 320 },
      password: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
} as const;

const refreshTokenSchema = {
  body: {
    type: 'object',
    required: ['refreshToken'],
    additionalProperties: false,
    properties: {
      refreshToken: { type: 'string', minLength: 10, maxLength: 4096 },
    },
  },
} as const;

export function registerAuthRoutes(app: FastifyInstance, { pool, env }: AppDeps): void {
  /**
   * There is no sign-up route by design: accounts are created by an admin,
   * either through POST /admin/users or the create-user CLI.
   */
  app.post<{ Body: LoginRequest }>(
    '/auth/login',
    {
      schema: loginSchema,
      // Password guessing is the one thing worth throttling hard here.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request): Promise<AuthResponse> => {
      const { email, password } = request.body;

      const user = await findByEmail(pool, email);

      if (user === null) {
        // Spend comparable time on a missing user so response timing does not
        // reveal which emails have accounts.
        await verifyPassword(
          '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG',
          password,
        );
        throw invalidCredentials();
      }

      if (!(await verifyPassword(user.password_hash, password))) {
        throw invalidCredentials();
      }

      if (!user.is_active) throw accountDisabled();

      const tokens = await issueTokens(pool, env, {
        id: user.id,
        email: user.email,
        role: user.role,
      });

      request.log.info(`[auth] login user=${user.id}`);

      return { ...tokens, user: toProfile(user) };
    },
  );

  /**
   * Rotating: the presented token is deleted and a new pair issued, both inside
   * one transaction so two concurrent refreshes cannot both succeed. This is
   * exactly why the client must persist the new pair on every refresh — the old
   * refresh token is dead the moment this returns.
   */
  app.post<{ Body: RefreshRequest }>(
    '/auth/refresh',
    { schema: refreshTokenSchema, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request): Promise<AuthResponse> => {
      return withTransaction(pool, async (client) => {
        const userId = await consumeRefreshToken(client, env, request.body.refreshToken);

        const user = await findById(client, userId);
        if (user === null) throw invalidRefreshToken();
        if (!user.is_active) throw accountDisabled();

        const tokens = await issueTokens(client, env, {
          id: user.id,
          email: user.email,
          role: user.role,
        });

        return { ...tokens, user: toProfile(user) };
      });
    },
  );

  app.post<{ Body: LogoutRequest }>(
    '/auth/logout',
    { schema: refreshTokenSchema },
    async (request): Promise<LogoutResponse> => {
      // Deliberately never fails: signing out must succeed even if the token is
      // already gone, or the client is stuck holding a session it cannot clear.
      await revokeRefreshToken(pool, env, request.body.refreshToken);
      return { ok: true };
    },
  );
}
