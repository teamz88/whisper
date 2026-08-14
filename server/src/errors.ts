import type { ApiErrorCode } from '@whisper/shared';

/**
 * Every deliberate failure the API produces. Anything else that escapes a route
 * handler becomes a 500 with a generic message — internal details never reach a
 * client.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, 'bad_request', message);

export const invalidCredentials = (): HttpError =>
  new HttpError(401, 'invalid_credentials', 'That email and password combination is not correct.');

export const accountDisabled = (): HttpError =>
  new HttpError(403, 'account_disabled', 'This account has been deactivated. Contact your admin.');

export const unauthorized = (message = 'Sign in to continue.'): HttpError =>
  new HttpError(401, 'unauthorized', message);

export const tokenExpired = (): HttpError =>
  new HttpError(401, 'token_expired', 'Your session expired. Refreshing.');

export const invalidRefreshToken = (): HttpError =>
  new HttpError(401, 'invalid_refresh_token', 'Your session is no longer valid. Please sign in again.');

export const forbidden = (message = 'You do not have access to that.'): HttpError =>
  new HttpError(403, 'forbidden', message);

export const notFound = (message = 'Not found.'): HttpError =>
  new HttpError(404, 'not_found', message);

export const conflict = (message: string): HttpError => new HttpError(409, 'conflict', message);

export const payloadTooLarge = (message: string): HttpError =>
  new HttpError(413, 'payload_too_large', message);

export const transcriptionFailed = (message: string): HttpError =>
  new HttpError(502, 'transcription_failed', message);

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
