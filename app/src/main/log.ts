/**
 * Timestamped console logging for the main process. Electron pipes this to the
 * terminal in dev and to the packaged app's stdout in production, which is
 * where the `[dictate]` timing lines and the paste-fallback diagnostics land.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minimum: Level = process.env['WHISPER_LOG_LEVEL'] === 'debug' ? 'debug' : 'info';

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function emit(level: Level, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimum]) return;
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
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
