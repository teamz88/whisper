import type { Profile, Role } from './profile.js';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Both /auth/login and /auth/refresh return this shape. Refresh returns the
 * profile too so the client notices `isActive: false` and signs out cleanly
 * without a second round-trip.
 */
export interface AuthResponse extends AuthTokens {
  user: Profile;
}

export type LoginResponse = AuthResponse;
export type RefreshResponse = AuthResponse;

export interface RefreshRequest {
  refreshToken: string;
}

/**
 * POST /me/password. Every other session of the user is revoked; the response
 * carries a fresh token pair so the device that made the change stays signed in.
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export type ChangePasswordResponse = AuthResponse;

export interface LogoutRequest {
  refreshToken: string;
}

export interface LogoutResponse {
  ok: true;
}

/** Decoded access-token payload. The server is the only thing that mints these. */
export interface AccessTokenClaims {
  sub: string;
  role: Role;
  email: string;
  type: 'access';
  iat: number;
  exp: number;
}

export interface RefreshTokenClaims {
  sub: string;
  /** Identifies the row in `refresh_tokens`, so a single token can be revoked. */
  jti: string;
  type: 'refresh';
  iat: number;
  exp: number;
}

/**
 * Expressed in seconds rather than as "1h"/"30d" strings on purpose:
 * @types/jsonwebtoken types `expiresIn` as `StringValue | number`, where
 * StringValue is a template-literal union from the `ms` package. A plain
 * `string` constant is not assignable to it, so a string TTL only compiles as
 * an inline literal. Numbers sidestep the whole problem.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
