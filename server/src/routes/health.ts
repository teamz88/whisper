import type { FastifyInstance } from 'fastify';

import type { AppDeps } from '../app.js';
import { query } from '../db.js';

/**
 * Coolify polls this. It reports degraded rather than failing when Postgres is
 * unreachable — a health check that flaps the container on a transient DB blip
 * makes an outage worse.
 */
export function registerHealthRoute(app: FastifyInstance, { pool, env }: AppDeps): void {
  app.get('/health', async () => {
    let database: 'ok' | 'unreachable' = 'ok';

    try {
      await query(pool, 'SELECT 1');
    } catch {
      database = 'unreachable';
    }

    return {
      status: 'ok',
      database,
      provider: env.provider,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });
}
