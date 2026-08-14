/**
 * Every non-2xx response from the API has this body. The client switches on
 * `code` and shows `message` verbatim, so messages must stay user-readable.
 */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export const API_ERROR_CODES = [
  'bad_request',
  'invalid_credentials',
  'account_disabled',
  'unauthorized',
  'token_expired',
  'invalid_refresh_token',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'transcription_failed',
  'internal_error',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  return typeof (error as { code?: unknown }).code === 'string';
}

/**
 * Thrown by the client's API layer. Carries the HTTP status so callers can tell
 * "your password is wrong" from "the server is down".
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** True for the two states that must force a clean sign-out. */
  get isTerminalAuthFailure(): boolean {
    return this.code === 'invalid_refresh_token' || this.code === 'account_disabled';
  }
}
