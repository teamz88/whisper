import { MAX_RECORDING_MS, TARGET_SAMPLE_RATE } from '@whisper/shared';

import type { AudioReadyPayload } from '../../../shared/ipc.js';

/** The capture result before OverlayApp stamps the recording generation on it. */
export type CapturedAudio = Omit<AudioReadyPayload, 'generation'>;

/**
 * The overlay owns the microphone. Capture is AudioContext +
 * ScriptProcessorNode — deprecated, but it delivers raw Float32 PCM
 * synchronously with no worklet round-trip, which is exactly what a
 * push-to-talk recorder wants. Browsers give us 48 kHz regardless of any
 * sampleRate hint; we resample to 16 kHz offline afterwards, which cuts the
 * upload to a third.
 */

export type RecorderResult =
  | { kind: 'audio'; payload: CapturedAudio }
  | { kind: 'empty' }
  | { kind: 'denied'; message: string };

interface ActiveCapture {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  sampleRate: number;
  /** Epoch ms, taken right AFTER getUserMedia resolved. */
  audioStartedAt: number;
  maxDurationTimer: number;
}

export class OverlayRecorder {
  private active: ActiveCapture | null = null;
  private starting = false;
  /** Set when stop() arrives while getUserMedia is still pending. */
  private cancelRequested = false;

  private readonly onMaxDuration: () => void;

  constructor(onMaxDuration: () => void) {
    this.onMaxDuration = onMaxDuration;
  }

  get isCapturing(): boolean {
    return this.active !== null || this.starting;
  }

  async start(deviceId: string | null = null): Promise<RecorderResult | null> {
    if (this.isCapturing) return null;

    this.starting = true;
    this.cancelRequested = false;

    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          deviceId === null ? { audio: true } : { audio: { deviceId: { exact: deviceId } } },
        );
      } catch (error) {
        // The chosen device may have been unplugged since it was picked; a
        // dictation on the default mic beats no dictation. Permission errors
        // are not retried — the default device is just as blocked.
        const denied = error instanceof DOMException && error.name === 'NotAllowedError';
        if (deviceId === null || denied) throw error;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (error) {
      this.starting = false;
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      return {
        kind: 'denied',
        message: denied
          ? 'Microphone access is blocked for Whisper.'
          : 'Could not open the microphone.',
      };
    }

    // The user released the hotkey before the permission prompt / device
    // spin-up finished. Nothing was captured; clean up quietly.
    if (this.cancelRequested) {
      this.starting = false;
      for (const track of stream.getTracks()) track.stop();
      return { kind: 'empty' };
    }

    // Timestamped HERE, after getUserMedia resolved — a first-use permission
    // prompt can sit open for many seconds, and none of that is audio.
    const audioStartedAt = Date.now();

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);

    const capture: ActiveCapture = {
      stream,
      context,
      source,
      processor,
      chunks: [],
      sampleRate: context.sampleRate,
      audioStartedAt,
      maxDurationTimer: window.setTimeout(() => this.onMaxDuration(), MAX_RECORDING_MS),
    };

    processor.onaudioprocess = (event) => {
      // Copy — the engine reuses the underlying buffer between callbacks.
      capture.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };

    source.connect(processor);
    // ScriptProcessorNode only fires while connected to the destination. The
    // gain stays at 0 so the user does not hear themselves.
    const mute = context.createGain();
    mute.gain.value = 0;
    processor.connect(mute);
    mute.connect(context.destination);

    this.active = capture;
    this.starting = false;
    return null;
  }

  /** Tear down the mic and hand back 16 kHz mono samples. */
  async stop(): Promise<RecorderResult> {
    if (this.starting) {
      // start() will notice and clean up when getUserMedia resolves.
      this.cancelRequested = true;
      return { kind: 'empty' };
    }

    const capture = this.active;
    if (capture === null) return { kind: 'empty' };
    this.active = null;

    const audioStoppedAt = Date.now();
    window.clearTimeout(capture.maxDurationTimer);

    capture.processor.onaudioprocess = null;
    capture.source.disconnect();
    capture.processor.disconnect();
    for (const track of capture.stream.getTracks()) track.stop();
    await capture.context.close().catch(() => undefined);

    const total = capture.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (total === 0) return { kind: 'empty' };

    const joined = new Float32Array(total);
    let offset = 0;
    for (const chunk of capture.chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    capture.chunks.length = 0;

    const resampled = await resampleTo16k(joined, capture.sampleRate);
    if (resampled.length === 0 || isSilent(resampled)) {
      // A muted mic produces perfect digital silence — don't upload 200 kB of
      // zeroes just so Whisper can hallucinate "Thanks for watching!" at it.
      return { kind: 'empty' };
    }

    return {
      kind: 'audio',
      payload: {
        samples: resampled.buffer as ArrayBuffer,
        sampleRate: TARGET_SAMPLE_RATE,
        audioStartedAt: capture.audioStartedAt,
        audioStoppedAt,
      },
    };
  }
}

async function resampleTo16k(
  samples: Float32Array<ArrayBuffer>,
  fromRate: number,
): Promise<Float32Array<ArrayBuffer>> {
  if (fromRate === TARGET_SAMPLE_RATE) return samples;

  const targetLength = Math.ceil((samples.length * TARGET_SAMPLE_RATE) / fromRate);
  if (targetLength === 0) return new Float32Array(0);

  const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const buffer = offline.createBuffer(1, samples.length, fromRate);
  buffer.copyToChannel(samples, 0);

  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

/** True when the whole capture never rises above the noise floor. */
function isSilent(samples: Float32Array, threshold = 0.0015): boolean {
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]!) > threshold) return false;
  }
  return true;
}
