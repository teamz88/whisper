import { createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

/**
 * Timestamped logging for the main process. Electron pipes the console to the
 * terminal in dev; the packaged app has no console anyone can read, so every
 * line also goes to main.log in the app's logs folder
 * (%APPDATA%\Whisper\logs on Windows, ~/Library/Logs/Whisper on macOS).
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minimum: Level = process.env['WHISPER_LOG_LEVEL'] === 'debug' ? 'debug' : 'info';

/** Past this size the log is rotated at the next launch; one old file is kept. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** undefined = not opened yet, null = unavailable (console only). */
let file: WriteStream | null | undefined;

function logFile(): WriteStream | null {
  if (file !== undefined) return file;
  // Paths are only settled once the app is ready; earlier lines stay console-only.
  if (!app.isReady()) return null;

  try {
    const dir = app.getPath('logs');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'main.log');
    try {
      if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, join(dir, 'main.old.log'));
    } catch {
      // No log yet.
    }
    file = createWriteStream(path, { flags: 'a' });
    file.on('error', () => {
      file = null;
    });
  } catch {
    file = null;
  }
  return file;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function emit(level: Level, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimum]) return;
  const tag = level.toUpperCase().padEnd(5);
  const line = `${stamp()} ${tag} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  // The file spans days, so it gets the full date.
  logFile()?.write(`${new Date().toISOString()} ${tag} ${message}\n`);
}

export const log = {
  debug: (message: string): void => emit('debug', message),
  info: (message: string): void => emit('info', message),
  warn: (message: string): void => emit('warn', message),
  error: (message: string, error?: unknown): void => {
    emit('error', error === undefined ? message : `${message}: ${describe(error)}`);
  },
};

export function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}
