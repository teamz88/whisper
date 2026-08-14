import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * electron-vite 5.
 *
 * `build.externalizeDeps` defaults to true in v5, so everything in
 * `dependencies` is already external for main/preload — the deprecated
 * externalizeDepsPlugin() is gone. The native modules are listed explicitly
 * anyway: they must never be bundled, because node-gyp-build and `bindings`
 * both resolve their .node binaries from disk at require time.
 *
 * Both main and preload emit ESM ('es'). That is not cosmetic:
 *  - electron-store 11 is ESM-only, and a CJS main makes `new Store()` throw
 *    "Store is not a constructor".
 *  - an ESM preload must be a .mjs file, which the `es` format produces.
 */
export default defineConfig({
  main: {
    build: {
      // @whisper/shared is a workspace symlink, which electron-builder cannot
      // be trusted to pack — bundle it into the main output instead.
      externalizeDeps: { exclude: ['@whisper/shared'] },
      rollupOptions: {
        external: ['uiohook-napi', '@nut-tree-fork/nut-js'],
        output: { format: 'es' },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: ['@whisper/shared'] },
      rollupOptions: {
        output: { format: 'es' },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          // The dashboard and the floating overlay are separate BrowserWindows
          // and therefore separate HTML entry points.
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html'),
        },
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
