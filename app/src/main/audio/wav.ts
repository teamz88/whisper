import { TARGET_SAMPLE_RATE } from '@whisper/shared';

/**
 * Float32 PCM -> 16-bit WAV, in memory. No temp files: the audio goes straight
 * from the overlay's capture buffer into the multipart upload.
 *
 * The samples arrive already resampled to 16 kHz mono by the overlay's
 * OfflineAudioContext, so this is purely a container-and-quantise step.
 */
export function encodeWav(samples: Float32Array, sampleRate: number = TARGET_SAMPLE_RATE): Buffer {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataLength);

  // RIFF header
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8, 'ascii');

  // fmt chunk — PCM, mono
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // audio format: PCM
  buffer.writeUInt16LE(1, 22); // channels: mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before quantising: resampling can overshoot [-1, 1] slightly, and
    // an unclamped +1.01 wraps around to a loud negative click.
    const sample = Math.max(-1, Math.min(1, samples[i]!));
    buffer.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), offset);
    offset += 2;
  }

  return buffer;
}

/** Duration implied by a sample count, used for logging. */
export function samplesToMs(sampleCount: number, sampleRate: number = TARGET_SAMPLE_RATE): number {
  return Math.round((sampleCount / sampleRate) * 1000);
}
