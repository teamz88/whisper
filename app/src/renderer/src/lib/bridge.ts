import type { WhisperBridge } from '../../../shared/ipc.js';

declare global {
  interface Window {
    whisper: WhisperBridge;
  }
}

/**
 * The only channel between the UI and everything else. There is no Node, no
 * `require`, and no network client in here — the renderer asks main, main talks
 * to the API.
 */
export const bridge: WhisperBridge = window.whisper;

export type { WhisperBridge };
