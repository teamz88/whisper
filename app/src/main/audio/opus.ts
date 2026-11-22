import OpusScript from 'opusscript';

import { TARGET_SAMPLE_RATE } from '@whisper/shared';

import { muxOggOpus } from './ogg-opus.js';

/**
 * Float32 PCM -> Ogg Opus, in memory.
 *
 * WAV at 16 kHz is 32 kB per second of speech; Opus at 24 kbit/s is 3 kB, so
 * the same dictation uploads about 10x faster. That matters most for the people
 * it hurts most: on a slow or flaky connection a 90 s WAV (2.7 MB) was seen
 * taking 20+ seconds just to reach the server. 24 kbit/s wideband Opus is
 * effectively transparent for speech recognition.
 *
 * opusscript is libopus compiled to WebAssembly: no native module, so nothing
 * to rebuild per Electron version or per platform.
 */

export const OPUS_BITRATE = 24_000;

const FRAME_MS = 20;

/**
 * Samples libopus holds back at the start (its lookahead), which the decoder
 * must drop: 2.5 ms + 4 ms of delay compensation. RFC 7845 states pre-skip in
 * 48 kHz samples whatever the input rate, so 6.5 ms = 312.
 */
const PRE_SKIP_48K = 312;

/**
 * Measured on a 90 s clip (WebAssembly, one core): complexity 10 (libopus's
 * default) took ~1.4 s, 3 took ~0.55 s, for the same file size and a waveform
 * correlation of 0.995 vs 0.997. The encode runs on the main process while the
 * user waits for their text, so the cheaper setting wins.
 */
const OPUS_COMPLEXITY = 3;

// opus_defines.h
const OPUS_SET_COMPLEXITY_REQUEST = 4010;
const OPUS_SET_SIGNAL_REQUEST = 4024;
const OPUS_SIGNAL_VOICE = 3001;

type OpusRate = 8000 | 12000 | 16000 | 24000 | 48000;

function isOpusRate(rate: number): rate is OpusRate {
  return rate === 8000 || rate === 12000 || rate === 16000 || rate === 24000 || rate === 48000;
}

export interface OpusPackets {
  packets: Buffer[];
  /** Samples per packet at the input rate. */
  frameSize: number;
}

/** Encode mono Float32 samples into 20 ms Opus packets (the last one zero-padded). */
export function encodeOpusPackets(
  samples: Float32Array,
  sampleRate: number = TARGET_SAMPLE_RATE,
  bitrate: number = OPUS_BITRATE,
): OpusPackets {
  if (!isOpusRate(sampleRate)) {
    throw new RangeError(`Opus cannot encode at ${sampleRate} Hz`);
  }
  if (samples.length === 0) throw new Error('No samples to encode');

  const frameSize = (sampleRate * FRAME_MS) / 1000;
  // AUDIO rather than VOIP: VOIP tunes for how speech sounds to a person on a
  // call, AUDIO keeps the waveform itself (0.995 vs 0.75 correlation at the same
  // size), and what listens to this upload is a speech-recognition model.
  const encoder = new OpusScript(sampleRate, 1, OpusScript.Application.AUDIO);
  try {
    encoder.setBitrate(bitrate);
    encoder.encoderCTL(OPUS_SET_COMPLEXITY_REQUEST, OPUS_COMPLEXITY);
    encoder.encoderCTL(OPUS_SET_SIGNAL_REQUEST, OPUS_SIGNAL_VOICE);

    const packets: Buffer[] = [];
    // One reusable frame of 16-bit little-endian PCM — the encoder copies it.
    const frame = Buffer.alloc(frameSize * 2);

    for (let start = 0; start < samples.length; start += frameSize) {
      const end = Math.min(start + frameSize, samples.length);
      let offset = 0;
      for (let i = start; i < end; i += 1) {
        // Same clamp-then-quantise as the WAV path: a resampling overshoot past
        // ±1 must not wrap around into a loud click.
        const sample = Math.max(-1, Math.min(1, samples[i]!));
        frame.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), offset);
        offset += 2;
      }
      frame.fill(0, offset); // pad the final, partial frame with silence

      packets.push(encoder.encode(frame, frameSize));
    }

    return { packets, frameSize };
  } finally {
    encoder.delete();
  }
}

/** A complete .ogg file, ready to upload. */
export function encodeOggOpus(
  samples: Float32Array,
  sampleRate: number = TARGET_SAMPLE_RATE,
  bitrate: number = OPUS_BITRATE,
): Buffer {
  const { packets, frameSize } = encodeOpusPackets(samples, sampleRate, bitrate);
  return muxOggOpus({
    packets,
    frameSize,
    sampleCount: samples.length,
    inputSampleRate: sampleRate,
    preSkip: PRE_SKIP_48K,
  });
}
