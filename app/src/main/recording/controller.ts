import {
  DICTATE_AUDIO_FIELD,
  isDiscarded,
  type DictateResponse,
  type Session,
  type Settings,
} from '@whisper/shared';

import type {
  AudioReadyPayload,
  RecordingSource,
  RecordingState,
} from '../../shared/ipc.js';
import {
  OVERLAY_DONE_FADE_MS,
  OVERLAY_DONE_PREVIEW_CHARS,
  OVERLAY_ERROR_FADE_MS,
  UNKNOWN_GENERATION,
  type OverlayState,
} from '../../shared/overlay.js';
import type { ApiClient } from '../api/client.js';
import { encodeWav, samplesToMs } from '../audio/wav.js';
import { pasteText } from '../inject/paste.js';
import { log } from '../log.js';
import { getMicDeviceId } from '../store.js';
import type { OverlayWindow } from '../windows/overlay.js';

/** How long the clipboard-fallback message stays up — longer, it must be read. */
const OVERLAY_FALLBACK_FADE_MS = 5_000;

export interface ControllerDeps {
  overlay: OverlayWindow;
  api: ApiClient;
  getSettings: () => Settings;
  /** Send to every renderer (dashboard + overlay). */
  broadcast: <T>(channel: string, payload: T) => void;
}

type Phase = 'idle' | 'listening' | 'processing';

/**
 * Owns the recording lifecycle. The overlay renderer owns the microphone; this
 * class owns everything else: state, upload, paste, and what the overlay shows.
 */
export class RecordingController {
  private readonly deps: ControllerDeps;

  private phase: Phase = 'idle';
  private source: RecordingSource | null = null;

  /**
   * Bumped on every start. Audio and errors arriving from a previous
   * generation (a stale overlay flush after the user already started a new
   * dictation) are dropped instead of pasted into the present.
   */
  private generation = 0;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
  }

  /** Only 'listening' counts — the hotkey must not "stop" a processing upload. */
  isListening(): boolean {
    return this.phase === 'listening';
  }

  getState(): RecordingState {
    return { active: this.phase === 'listening', source: this.source };
  }

  /**
   * Effectively synchronous by design: nothing is awaited before the overlay
   * is told to open the microphone. Every millisecond here is between the
   * user's keypress and the moment audio starts being captured.
   */
  startRecording(source: RecordingSource): void {
    if (this.phase !== 'idle') return;

    this.generation += 1;
    this.phase = 'listening';
    this.source = source;

    // The device preference rides along because the overlay renderer is the
    // one calling getUserMedia; the generation rides along so every audio
    // event the renderer sends back can be attributed to THIS dictation.
    this.setOverlay({
      kind: 'listening',
      startedAt: Date.now(),
      micDeviceId: getMicDeviceId(),
      generation: this.generation,
    });
    this.broadcastState();

    log.info(`[rec] start (${source})`);
  }

  /**
   * Also effectively synchronous. The overlay reacts to leaving 'listening' by
   * closing the mic, resampling to 16 kHz and sending overlay:audio-ready.
   */
  stopRecording(reason: string): void {
    if (this.phase !== 'listening') return;

    this.phase = 'processing';
    this.setOverlay({ kind: 'processing' });
    this.broadcastState();

    log.info(`[rec] stop (${reason})`);
  }

  /**
   * Like stop, but nothing is uploaded or pasted. The generation bump makes
   * any audio the overlay still flushes for this recording stale.
   */
  cancelRecording(reason: string): void {
    if (this.phase !== 'listening') return;

    this.generation += 1;
    this.finishQuietly();

    log.info(`[rec] cancelled (${reason})`);
  }

  /** The dashboard Dictation Bar — and the universal stop for any recording. */
  toggle(): RecordingState {
    if (this.phase === 'listening') {
      this.stopRecording('dashboard');
    } else if (this.phase === 'idle') {
      this.startRecording('dashboard');
    }
    return this.getState();
  }

  // -------------------------------------------------------------------------
  // Overlay renderer events
  // -------------------------------------------------------------------------

  /** The mic stream closed and the audio is resampled: upload and paste. */
  onAudioReady(payload: AudioReadyPayload): void {
    if (payload.generation !== this.generation) {
      log.warn('[rec] stale audio dropped (superseded dictation)');
      return;
    }
    const generation = payload.generation;

    // Recording can also end without a stop call (10-minute cap).
    if (this.phase === 'listening') {
      this.phase = 'processing';
      this.setOverlay({ kind: 'processing' });
      this.broadcastState();
    }

    void this.process(payload, generation).catch((error: unknown) => {
      log.error('[rec] processing failed', error);
      this.failIfCurrent(generation, error instanceof Error ? error.message : 'Something went wrong.');
    });
  }

  onAudioEmpty(generation: number): void {
    // UNKNOWN_GENERATION is a fresh overlay renderer answering a replayed
    // 'processing' it never recorded for — honoured only while actually wedged
    // there. Anything else must match the live generation, or it is the flush
    // of a superseded dictation and gets dropped.
    if (generation === UNKNOWN_GENERATION) {
      if (this.phase !== 'processing') return;
    } else if (generation !== this.generation || this.phase === 'idle') {
      return;
    }
    log.info('[rec] no audio captured');
    this.finishQuietly();
  }

  /** The overlay renderer died. Whatever was in flight is unrecoverable. */
  abort(reason: string): void {
    if (this.phase === 'idle') return;
    log.warn(`[rec] aborted: ${reason}`);
    this.generation += 1; // orphan any in-flight process() result
    this.finishQuietly();
  }

  onMicDenied(message: string, generation: number): void {
    if (generation !== this.generation) {
      log.warn('[rec] stale mic-denied dropped');
      return;
    }
    log.warn(`[rec] microphone denied: ${message}`);
    this.phase = 'idle';
    this.source = null;
    this.setOverlay({ kind: 'error', message: 'Microphone blocked' });
    this.deps.overlay.hideAfter(OVERLAY_ERROR_FADE_MS);
    this.broadcastState();
    // The dashboard shows the recovery modal with the OS-settings shortcut.
    this.deps.broadcast('mic:permission-denied', { message });
  }

  onOverlayStopRequested(reason: 'escape' | 'max-duration'): void {
    this.stopRecording(reason);
  }

  // -------------------------------------------------------------------------
  // The pipeline
  // -------------------------------------------------------------------------

  private async process(payload: AudioReadyPayload, generation: number): Promise<void> {
    const settings = this.deps.getSettings();
    const samples = new Float32Array(payload.samples);

    if (samples.length === 0) {
      this.finishQuietly();
      return;
    }

    const wav = encodeWav(samples, payload.sampleRate);
    const durationMs = Math.max(0, payload.audioStoppedAt - payload.audioStartedAt);

    log.info(
      `[rec] audio ready: ${samplesToMs(samples.length, payload.sampleRate)}ms of samples, ` +
        `${(wav.byteLength / 1024).toFixed(0)} kB wav, mic open ${durationMs}ms`,
    );

    // Field order is a protocol detail, not a style choice: the server reads
    // text fields off the file part, and multipart fields appended AFTER the
    // file have not been parsed yet when the server reaches it.
    const form = new FormData();
    form.append('language', settings.language);
    form.append('style', settings.defaultStyle);
    form.append('aiCleanup', String(settings.aiCleanup));
    form.append('durationMs', String(durationMs));
    form.append('audioStartedAt', String(payload.audioStartedAt));
    form.append('audioStoppedAt', String(payload.audioStoppedAt));
    form.append(
      DICTATE_AUDIO_FIELD,
      new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
      'dictation.wav',
    );

    const response = await this.deps.api.request<DictateResponse>('/dictate', {
      method: 'POST',
      formData: form,
    });

    if (generation !== this.generation) {
      log.warn('[rec] stale dictation result dropped');
      return;
    }

    if (isDiscarded(response)) {
      log.info(`[rec] discarded by server (${response.reason})`);
      this.finishQuietly();
      return;
    }

    const outcome = await pasteText(response.cleaned);

    // Re-checked after the paste too: pasteText awaits real time (clipboard
    // settle, subprocess on the fallback path), and a newer dictation starting
    // meanwhile owns the overlay and the phase now.
    if (generation !== this.generation) {
      log.warn('[rec] dictation superseded during paste');
      return;
    }

    const previewText =
      response.cleaned.length > OVERLAY_DONE_PREVIEW_CHARS
        ? `${response.cleaned.slice(0, OVERLAY_DONE_PREVIEW_CHARS).trimEnd()}…`
        : response.cleaned;

    this.phase = 'idle';
    this.source = null;
    this.setOverlay({
      kind: 'done',
      text: previewText,
      wordCount: response.wordCount,
      pasted: outcome.pasted,
    });
    this.deps.overlay.hideAfter(outcome.pasted ? OVERLAY_DONE_FADE_MS : OVERLAY_FALLBACK_FADE_MS);
    this.broadcastState();

    // Keep the dashboard's Today list and stats live without a refetch cycle.
    if (response.sessionId !== undefined) {
      const session: Session = {
        id: response.sessionId,
        rawTranscript: response.raw,
        cleanedTranscript: response.cleaned,
        wordCount: response.wordCount,
        durationMs,
        style: settings.defaultStyle,
        language: settings.language,
        createdAt: new Date().toISOString(),
      };
      this.deps.broadcast('session:created', session);
    } else {
      this.deps.broadcast('session:completed', {
        wordCount: response.wordCount,
        durationMs,
      });
    }
  }

  /** Silence, hallucination, empty capture: the overlay just goes away. */
  private finishQuietly(): void {
    this.phase = 'idle';
    this.source = null;
    this.setOverlay({ kind: 'idle' });
    this.broadcastState();
  }

  private failIfCurrent(generation: number, message: string): void {
    if (generation !== this.generation) return;
    this.phase = 'idle';
    this.source = null;
    this.setOverlay({ kind: 'error', message: shorten(message) });
    this.deps.overlay.hideAfter(OVERLAY_ERROR_FADE_MS);
    this.broadcastState();
  }

  private setOverlay(state: OverlayState): void {
    this.deps.overlay.setState(state);
  }

  private broadcastState(): void {
    this.deps.broadcast('recording:state', this.getState());
  }
}

/** The overlay is 280px wide; error text has to fit on one breath. */
function shorten(message: string): string {
  return message.length <= 60 ? message : `${message.slice(0, 57)}…`;
}
