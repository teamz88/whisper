/**
 * End-to-end smoke test against a RUNNING Whisper API.
 *
 *   npm run smoke -- --url http://localhost:8080 --email you@company.com --password temp1234
 *
 * Checks, in order:
 *   1. GET  /health          → status ok
 *   2. POST /auth/login      → tokens + profile
 *   3. GET  /me/settings     → settings row exists
 *   4. POST /auth/refresh    → rotation works (old token dies, new one lives)
 *   5. POST /dictate         → uploads a generated 1.2 s WAV (a 440 Hz tone).
 *      A tone is not speech, so BOTH outcomes prove the pipeline:
 *      { discarded: true } (hallucination filter caught it) or a transcript.
 *   6. GET  /me/stats        → responds with numbers
 *
 * Exits non-zero on the first failure.
 */

interface Args {
  url: string;
  email?: string;
  password?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { url: 'http://localhost:8080' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') args.url = argv[++i] ?? args.url;
    if (argv[i] === '--email') args.email = argv[++i];
    if (argv[i] === '--password') args.password = argv[++i];
  }
  args.url = args.url.replace(/\/+$/, '');
  return args;
}

function makeToneWav(seconds = 1.2, sampleRate = 16_000): Buffer {
  const total = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(44 + total * 2);
  data.write('RIFF', 0, 'ascii');
  data.writeUInt32LE(36 + total * 2, 4);
  data.write('WAVE', 8, 'ascii');
  data.write('fmt ', 12, 'ascii');
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36, 'ascii');
  data.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i += 1) {
    // 440 Hz sine with a fade in/out so it does not click.
    const envelope = Math.min(1, i / 800, (total - i) / 800);
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.4 * envelope;
    data.writeInt16LE(Math.round(sample * 0x7fff), 44 + i * 2);
  }
  return data;
}

let step = 0;
function pass(name: string, detail = ''): void {
  step += 1;
  console.log(`  ${step}. PASS ${name}${detail === '' ? '' : ` — ${detail}`}`);
}

function fail(name: string, detail: string): never {
  console.error(`  ${step + 1}. FAIL ${name} — ${detail}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n  Whisper smoke test → ${args.url}\n`);

  // 1. health
  let health: Response;
  try {
    health = await fetch(`${args.url}/health`);
  } catch {
    fail('GET /health', `cannot reach ${args.url} — is the API running?`);
  }
  const healthBody = (await health.json()) as { status?: string; database?: string };
  if (healthBody.status !== 'ok') fail('GET /health', JSON.stringify(healthBody));
  if (healthBody.database !== 'ok') fail('GET /health', `database is ${healthBody.database ?? 'unknown'}`);
  pass('GET /health', `database ${healthBody.database}`);

  if (args.email === undefined || args.password === undefined) {
    console.log('\n  No --email/--password given — stopping after the health check.');
    console.log('  Create a user first:  npm run create-user -- --email you@x.com --password temp1234 --admin\n');
    return;
  }

  // 2. login
  const login = await fetch(`${args.url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: args.email, password: args.password }),
  });
  if (!login.ok) fail('POST /auth/login', `${login.status} ${await login.text()}`);
  const auth = (await login.json()) as {
    accessToken: string;
    refreshToken: string;
    user: { email: string; role: string };
  };
  pass('POST /auth/login', `${auth.user.email} (${auth.user.role})`);

  const bearer = { authorization: `Bearer ${auth.accessToken}` };

  // 3. settings
  const settings = await fetch(`${args.url}/me/settings`, { headers: bearer });
  if (!settings.ok) fail('GET /me/settings', `${settings.status}`);
  pass('GET /me/settings');

  // 4. refresh rotation
  const refresh1 = await fetch(`${args.url}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  });
  if (!refresh1.ok) fail('POST /auth/refresh', `${refresh1.status}`);
  const rotated = (await refresh1.json()) as { accessToken: string; refreshToken: string };

  const replay = await fetch(`${args.url}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  });
  if (replay.ok) fail('refresh rotation', 'a spent refresh token was accepted a second time');
  pass('POST /auth/refresh', 'rotation verified: the old token is dead');

  // 5. dictate
  const form = new FormData();
  form.append('language', 'en');
  form.append('style', 'auto');
  form.append('aiCleanup', 'true');
  form.append('durationMs', '1200');
  form.append('audioStartedAt', String(Date.now() - 1200));
  form.append('audioStoppedAt', String(Date.now()));
  form.append('audio', new Blob([new Uint8Array(makeToneWav())], { type: 'audio/wav' }), 'smoke.wav');

  const dictate = await fetch(`${args.url}/dictate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${rotated.accessToken}` },
    body: form,
  });
  if (!dictate.ok) fail('POST /dictate', `${dictate.status} ${await dictate.text()}`);
  const result = (await dictate.json()) as {
    discarded?: boolean;
    raw?: string;
    cleaned?: string;
    wordCount?: number;
  };
  if (result.discarded === true) {
    pass('POST /dictate', 'tone discarded by the hallucination filter (pipeline OK)');
  } else if (typeof result.cleaned === 'string') {
    pass('POST /dictate', `transcribed ${result.wordCount ?? 0} words: "${(result.cleaned ?? '').slice(0, 60)}"`);
  } else {
    fail('POST /dictate', `unexpected response: ${JSON.stringify(result)}`);
  }

  // 6. stats
  const stats = await fetch(`${args.url}/me/stats`, {
    headers: { authorization: `Bearer ${rotated.accessToken}` },
  });
  if (!stats.ok) fail('GET /me/stats', `${stats.status}`);
  pass('GET /me/stats', JSON.stringify(await stats.json()));

  console.log('\n  All smoke checks passed.\n');
}

main().catch((error: unknown) => {
  console.error(`\n  Smoke test crashed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
