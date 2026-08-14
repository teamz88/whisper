import {
  ApiError,
  isApiErrorBody,
  type AuthResponse,
  type Profile,
} from '@whisper/shared';

import { log } from '../log.js';
import { clearAuth, getStoredAuth, setStoredAuth } from '../store.js';

/**
 * The app's only network client. Plain fetch against our backend — no provider
 * SDKs, no keys, nothing but the user's own tokens.
 */

export type SignOutReason = 'user' | 'expired' | 'disabled';

export interface ApiClientOptions {
  baseUrl: string;
  /** Fired when the session dies for a reason the UI must react to. */
  onSignedOut: (reason: SignOutReason) => void;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Pre-built body (multipart). Wins over `body`. */
  formData?: FormData;
  query?: Record<string, string | number | undefined>;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly onSignedOut: (reason: SignOutReason) => void;

  /**
   * All concurrent 401s funnel into one refresh. Without this, two parallel
   * requests would both try to spend the same one-time refresh token; the
   * second spend fails and signs the user out for no reason.
   */
  private refreshing: Promise<boolean> | null = null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.onSignedOut = options.onSignedOut;
  }

  get hasSession(): boolean {
    return getStoredAuth() !== null;
  }

  // -------------------------------------------------------------------------
  // Auth lifecycle
  // -------------------------------------------------------------------------

  async login(email: string, password: string): Promise<Profile> {
    const response = await this.rawRequest('/auth/login', {
      method: 'POST',
      body: { email, password },
    });

    const auth = (await response.json()) as AuthResponse;
    setStoredAuth({ accessToken: auth.accessToken, refreshToken: auth.refreshToken });
    return auth.user;
  }

  async logout(): Promise<void> {
    const stored = getStoredAuth();
    if (stored !== null) {
      try {
        await this.rawRequest('/auth/logout', {
          method: 'POST',
          body: { refreshToken: stored.refreshToken },
        });
      } catch {
        // The token might already be dead; local sign-out proceeds regardless.
      }
    }
    clearAuth();
    this.onSignedOut('user');
  }

  /**
   * Restore the saved session at launch. Uses the refresh endpoint directly:
   * it validates the session, rotates the token AND returns the profile in one
   * round-trip — and the profile carries isActive, so a deactivated user is
   * signed out cleanly here.
   */
  async restoreSession(): Promise<Profile | null> {
    const stored = getStoredAuth();
    if (stored === null) return null;

    try {
      const response = await this.rawRequest('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: stored.refreshToken },
      });

      const auth = (await response.json()) as AuthResponse;
      setStoredAuth({ accessToken: auth.accessToken, refreshToken: auth.refreshToken });
      return auth.user;
    } catch (error) {
      if (error instanceof ApiError && error.isTerminalAuthFailure) {
        clearAuth();
        this.onSignedOut(error.code === 'account_disabled' ? 'disabled' : 'expired');
        return null;
      }
      // Network failure at boot: keep the tokens, run degraded. The next
      // authenticated call will retry the refresh dance.
      log.warn(`[api] session restore failed (keeping tokens): ${String(error)}`);
      return null;
    }
  }

  private async refreshTokens(): Promise<boolean> {
    if (this.refreshing !== null) return this.refreshing;

    this.refreshing = (async (): Promise<boolean> => {
      const stored = getStoredAuth();
      if (stored === null) return false;

      try {
        const response = await this.rawRequest('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: stored.refreshToken },
        });

        const auth = (await response.json()) as AuthResponse;
        // Persist immediately — the old refresh token is already invalid.
        setStoredAuth({ accessToken: auth.accessToken, refreshToken: auth.refreshToken });
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.isTerminalAuthFailure) {
          clearAuth();
          this.onSignedOut(error.code === 'account_disabled' ? 'disabled' : 'expired');
        }
        return false;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  /** JSON request against a protected route, refreshing once on 401. */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.authedRequest(path, options);

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async authedRequest(path: string, options: RequestOptions): Promise<Response> {
    const stored = getStoredAuth();
    if (stored === null) throw new ApiError(401, 'unauthorized', 'Not signed in.');

    try {
      return await this.rawRequest(path, options, stored.accessToken);
    } catch (error) {
      const expired =
        error instanceof ApiError &&
        (error.code === 'token_expired' || error.code === 'unauthorized') &&
        error.status === 401;

      if (!expired) throw error;

      const refreshed = await this.refreshTokens();
      if (!refreshed) throw error;

      const fresh = getStoredAuth();
      if (fresh === null) throw error;
      return this.rawRequest(path, options, fresh.accessToken);
    }
  }

  private async rawRequest(
    path: string,
    options: RequestOptions,
    accessToken?: string,
  ): Promise<Response> {
    const url = new URL(this.baseUrl + path);
    if (options.query !== undefined) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {};
    if (accessToken !== undefined) headers['authorization'] = `Bearer ${accessToken}`;

    let body: string | FormData | undefined;
    if (options.formData !== undefined) {
      body = options.formData; // fetch sets the multipart boundary itself
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetch(url, { method: options.method ?? 'GET', headers, body });
    } catch (error) {
      throw new ApiError(
        0,
        'internal_error',
        'Could not reach the Whisper server. Check your connection.',
      );
    }

    if (response.ok) return response;

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Non-JSON error body (proxy page, etc.) — fall through to the generic.
    }

    if (isApiErrorBody(parsed)) {
      throw new ApiError(response.status, parsed.error.code, parsed.error.message);
    }

    throw new ApiError(
      response.status,
      'internal_error',
      `The server responded with ${response.status}.`,
    );
  }
}
