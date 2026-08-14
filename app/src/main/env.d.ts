/// <reference types="electron-vite/node" />

/**
 * Build-time variables injected by electron-vite from app/.env. The VITE_
 * prefix is shared across main, preload and renderer. There are no secrets
 * here — the client's entire configuration is one public URL.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}
