import { buildApp } from './app.js';
import { deleteExpiredRefreshTokens } from './auth/tokens.js';
import { createPool } from './db.js';
import { loadEnv } from './env.js';
import { createAiClient, warmAiClient } from './services/ai/client.js';

/** Expired refresh-token rows are dead weight; sweep them once an hour. */
const TOKEN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env);
  const ai = createAiClient(env);

  const app = await buildApp({ env, pool, ai });

  // Warm the provider connection before the first user hits it, so nobody's
  // first dictation of the day pays for the TLS handshake.
  void warmAiClient(ai, env, app.log);

  const sweep = setInterval(() => {
    deleteExpiredRefreshTokens(pool)
      .then((count) => {
        if (count > 0) app.log.info(`[auth] swept ${count} expired refresh tokens`);
      })
      .catch((error: unknown) => app.log.warn({ err: error }, 'refresh token sweep failed'));
  }, TOKEN_SWEEP_INTERVAL_MS);
  sweep.unref();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`[server] ${signal} received, shutting down`);
    clearInterval(sweep);
    try {
      await app.close();
      await pool.end();
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.port, host: env.host });
  app.log.info(`[server] listening on ${env.host}:${env.port} · provider=${env.provider}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
