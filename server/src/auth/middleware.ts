import jwt from 'jsonwebtoken';
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';

import type { Env } from '../env.js';
import { forbidden, tokenExpired, unauthorized } from '../errors.js';
import { verifyAccessToken } from './tokens.js';

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export interface AuthGuards {
  /** Validates the access token and attaches userId + role. */
  requireAuth: onRequestAsyncHookHandler;
  /** requireAuth, then a role check. */
  requireAdmin: onRequestAsyncHookHandler;
}

/**
 * Auth runs in onRequest rather than preHandler so an unauthenticated caller is
 * rejected before Fastify parses the body — which matters most on /dictate,
 * where the body is a multi-megabyte upload.
 */
export function createAuthGuards(env: Env): AuthGuards {
  const requireAuth: onRequestAsyncHookHandler = async (request) => {
    const token = bearerToken(request);
    if (token === null) throw unauthorized();

    try {
      const claims = verifyAccessToken(env, token);
      request.userId = claims.sub;
      request.role = claims.role;
    } catch (error) {
      // A distinct code lets the client tell "refresh me" from "sign in again".
      if (error instanceof jwt.TokenExpiredError) throw tokenExpired();
      throw unauthorized('Your session is not valid.');
    }
  };

  const requireAdmin: onRequestAsyncHookHandler = async (request, reply) => {
    await requireAuth.call(request.server, request, reply);
    if (request.role !== 'admin') {
      throw forbidden('This action requires an admin account.');
    }
  };

  return { requireAuth, requireAdmin };
}
