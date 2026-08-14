/**
 * Runs the SQL migrations through the pg driver rather than psql, so the only
 * tool needed on the deploy box is Node.
 *
 *   npm run migrate
 *
 * Each file is idempotent and wrapped in its own transaction, so re-running is
 * safe. Applied filenames are recorded in schema_migrations.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPool, query, withTransaction } from '../db.js';
import { loadEnv } from '../env.js';

// Works from both src/cli (tsx, dev) and dist/cli (node, production image):
// each sits two levels below server/, where migrations/ lives.
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env);

  try {
    await query(
      pool,
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const applied = await query<{ filename: string }>(pool, 'SELECT filename FROM schema_migrations');
    const done = new Set(applied.rows.map((row) => row.filename));

    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();

    if (files.length === 0) {
      console.log('  No migration files found.');
      return;
    }

    let ran = 0;
    for (const filename of files) {
      if (done.has(filename)) {
        console.log(`  = ${filename} (already applied)`);
        continue;
      }

      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');

      await withTransaction(pool, async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      });

      console.log(`  + ${filename}`);
      ran += 1;
    }

    console.log(ran === 0 ? '\n  Database already up to date.\n' : `\n  Applied ${ran} migration(s).\n`);
  } catch (error) {
    console.error(`\n  Migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
