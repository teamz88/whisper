import { encodeOggOpus } from './opus.js';
import { encodeWav } from './wav.js';

export interface EncodedAudio {
  bytes: Buffer;
  filename: string;
  mimetype: string;
  format: 'opus' | 'wav';
  /** Set when Opus failed and this is the WAV fallback. */
  fallbackReason?: string;
}

/**
 * The upload format: Ogg Opus, with WAV as the safety net.
 *
 * A dictation must never be lost to an encoder problem, so any Opus failure
 * (a WebAssembly load error, an encoder error) falls back to the WAV path the
 * server has always accepted. The server takes either; the filename extension
 * and content type tell the transcription provider which one it got.
 */
export function encodeForUpload(samples: Float32Array, sampleRate: number): EncodedAudio {
  try {
    return {
      bytes: encodeOggOpus(samples, sampleRate),
      filename: 'dictation.ogg',
      mimetype: 'audio/ogg',
      format: 'opus',
    };
  } catch (error) {
    return {
      bytes: encodeWav(samples, sampleRate),
      filename: 'dictation.wav',
      mimetype: 'audio/wav',
      format: 'wav',
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}
