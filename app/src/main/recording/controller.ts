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
import { trimSilence } from '../audio/trim.js';
import { encodeWav, samplesToMs } from '../audio/wav.js';
import { getFocusedAppName } from '../inject/focused-app.js';
import { pasteText } from '../inject/paste.js';
import { log } from '../log.js';
import { getMicDeviceId } from '../store.js';
import type { OverlayWindow } from '../windows/overlay.js';

/** How long the clipboard-fallback message stays up — longer, it must be read. */
const OVERLAY_FALLBACK_FADE_MS = 5_000;

/**
 * After a recording stops, a paste waits up to this long for the modifiers to
 * come up — the other key of a hold combo is often still down for a moment.
 * Then it pastes regardless: Windows sometimes never reports a Win keyup, and
 * trusting a key tracker that missed one meant no dictation got pasted at all.
 * A result arriving later than this after the stop is pasted straight away.
 */
const KEY_RELEASE_GRACE_MS = 600;

/**
 * Pastes wait for every earlier dictation, so one hung upload would hold back
 * all the ones after it. A 10-minute recording transcribes well within this.
 */
const DICTATE_TIMEOUT_MS = 90_000;

/**
 * A dictation pasted straight after the previous one gets a joining space
 * only within this window; after that, focus may have moved without any key
 * or click (a window popping up), and a stray space is worse than none.
 */
const JOIN_WINDOW_MS = 120_000;

/** Text starting with these attaches to the previous text without a space. */
const NO_SPACE_BEFORE = /^[\s.,;:!?…)\]}»”’%]/u;

/** Chinese, Japanese and Korean are written without spaces between sentences. */
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/u;

export interface ControllerDeps {
  overlay: OverlayWindow;
  api: ApiClient;
  getSettings: () => Settings;
  /** Send to every renderer (dashboard + overlay). */
  broadcast: <T>(channel: string, payload: T) => void;
  /** Resolves true once no modifier key is held, false on timeout. */
  waitForModifiersReleased: (timeoutMs: number) => Promise<boolean>;
  /** Changes whenever the user types or clicks — see HotkeyListener. */
  getInputActivity: () => number;
}

/** What a finished dictation has to show on the overlay. */
type Delivery =
  | { kind: 'quiet' }
  | { kind: 'done'; text: string; wordCount: number; pasted: boolean }
  | { kind: 'error'; message: string };

/**
 * Owns the recording lifecycle. The overlay renderer owns the microphone; this
 * class owns everything else: state, upload, paste, and what the overlay shows.
 *
 * Recording and processing overlap: a new dictation can start while earlier
 * ones are still uploading. Uploads run side by side; pastes run one at a time
 * in recording order, and never while a recording is live or a modifier is
 * down.
 */
export class RecordingController {
  private readonly deps: ControllerDeps;

  private listening = false;
  private source: RecordingSource | null = null;

  /**
   * Bumped on every start; identifies each recording. The overlay echoes it on
   * every audio event, so audio from a cancelled or unknown recording is
   * dropped instead of pasted.
   */
  private generation = 0;

  /** Recordings that have stopped and whose audio the overlay still owes. */
  private readonly awaitingAudio = new Set<number>();

  /** Dictations uploading or waiting for their turn to paste. */
  private inFlight = 0;

  /** Chains the pastes so they land in recording order. */
  private pasteQueue: Promise<void> = Promise.resolve();

  private notListeningWaiters: Array<() => void> = [];

  /** When the last recording ended, for the key-release grace before a paste. */
  private lastStoppedAt = 0;

  /** The last successful paste, to tell whether the next one continues it. */
  private lastPaste: { text: string; inputActivity: number; at: number } | null = null;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
  }

  /** Only a live recording counts — the hotkey must not "stop" an upload. */
  isListening(): boolean {
    return this.listening;
  }

  getState(): RecordingState {
    return { active: this.listening, source: this.source };
  }

  /**
   * Effectively synchronous by design: nothing is awaited before the overlay
   * is told to open the microphone. Every millisecond here is between the
   * user's keypress and the moment audio starts being captured.
   */
  startRecording(source: RecordingSource): void {
    if (this.listening) return;

    this.generation += 1;
    this.listening = true;
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

    log.info(`[rec] #${this.generation} start (${source})`);
  }

  /**
   * Also effectively synchronous. The overlay reacts to leaving 'listening' by
   * closing the mic, resampling to 16 kHz and sending overlay:audio-ready.
   */
  stopRecording(reason: string): void {
    if (!this.listening) return;

    this.awaitingAudio.add(this.generation);
    this.endListening();
    this.setOverlay({ kind: 'processing' });
    this.broadcastState();

    log.info(`[rec] #${this.generation} stop (${reason})`);
  }

  /**
   * Like stop, but nothing is uploaded or pasted: the generation never enters
   * awaitingAudio, so whatever the overlay still flushes for it is dropped.
   */
  cancelRecording(reason: string): void {
    if (!this.listening) return;

    this.endListening();
    this.settleOverlay();
    this.broadcastState();

    log.info(`[rec] #${this.generation} cancelled (${reason})`);
  }

  /** The dashboard Dictation Bar — and the universal stop for any recording. */
  toggle(): RecordingState {
    if (this.listening) {
      this.stopRecording('dashboard');
    } else {
      this.startRecording('dashboard');
    }
    return this.getState();
  }

  // -------------------------------------------------------------------------
  // Overlay renderer events
  // -------------------------------------------------------------------------

  /** The mic stream closed and the audio is resampled: upload and paste. */
  onAudioReady(payload: AudioReadyPayload): void {
    const { generation } = payload;

    // Recording can also end without a stop call (10-minute cap).
    if (this.listening && generation === this.generation) {
      this.awaitingAudio.add(generation);
      this.endListening();
      this.broadcastState();
    }

    if (!this.awaitingAudio.delete(generation)) {
      log.warn(`[rec] #${generation} stale audio dropped (cancelled or superseded recording)`);
      return;
    }

    this.enqueue(payload, generation);
  }

  onAudioEmpty(generation: number): void {
    // UNKNOWN_GENERATION is a fresh overlay renderer answering a replayed
    // 'processing' it never recorded for: whatever audio we were still owed
    // is gone. Anything else must be a recording we are waiting on.
    if (generation === UNKNOWN_GENERATION) {
      if (this.listening || this.awaitingAudio.size === 0) return;
      this.awaitingAudio.clear();
    } else if (!this.awaitingAudio.delete(generation)) {
      return;
    }
    log.info(`[rec] #${generation} no audio captured`);
    this.settleOverlay();
  }

  /**
   * The overlay renderer died. Audio it still held is unrecoverable; dictations
   * already uploading are not affected.
   */
  abort(reason: string): void {
    if (!this.listening && this.awaitingAudio.size === 0) return;
    log.warn(`[rec] aborted: ${reason}`);
    this.awaitingAudio.clear();
    if (this.listening) {
      this.endListening();
      this.broadcastState();
    }
    this.settleOverlay();
  }

  onMicDenied(message: string, generation: number): void {
    if (generation !== this.generation) {
      log.warn('[rec] stale mic-denied dropped');
      return;
    }
    log.warn(`[rec] microphone denied: ${message}`);
    this.awaitingAudio.delete(generation);
    if (this.listening) this.endListening();
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

  private enqueue(payload: AudioReadyPayload, generation: number): void {
    const settings = this.deps.getSettings();
    const durationMs = Math.max(0, payload.audioStoppedAt - payload.audioStartedAt);

    this.inFlight += 1;
    this.settleOverlay();

    // The upload starts now, alongside any earlier ones still running; only
    // the paste waits its turn. The no-op catch keeps a failure from counting
    // as unhandled before deliver() gets to it.
    const upload = this.upload(payload, settings, durationMs, generation);
    upload.catch(() => undefined);

    this.pasteQueue = this.pasteQueue.then(async () => {
      let result: Delivery;
      try {
        result = await this.deliver(upload, settings, durationMs, generation);
      } catch (error) {
        log.error(`[rec] #${generation} processing failed`, error);
        result = {
          kind: 'error',
          message: error instanceof Error ? error.message : 'Something went wrong.',
        };
      }
      this.inFlight -= 1;
      this.showResult(result);
    });
  }

  /** Null when there is nothing worth sending. */
  private async upload(
    payload: AudioReadyPayload,
    settings: Settings,
    durationMs: number,
    generation: number,
  ): Promise<DictateResponse | null> {
    const captured = new Float32Array(payload.samples);
    if (captured.length === 0) return null;

    const trimmed = trimSilence(captured, payload.sampleRate);
    if (trimmed.kind === 'no-speech') {
      log.info(
        `[rec] #${generation} no speech in ${samplesToMs(captured.length, payload.sampleRate)}ms of audio, not sent`,
      );
      return null;
    }

    const samples = trimmed.samples;
    const wav = encodeWav(samples, payload.sampleRate);

    log.info(
      `[rec] #${generation} audio ready: ${samplesToMs(samples.length, payload.sampleRate)}ms of samples ` +
        `(${trimmed.trimmedMs}ms of silence trimmed), ${(wav.byteLength / 1024).toFixed(0)} kB wav, ` +
        `mic open ${durationMs}ms`,
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

    const startedAt = Date.now();
    const response = await this.deps.api.request<DictateResponse>('/dictate', {
      method: 'POST',
      formData: form,
      timeoutMs: DICTATE_TIMEOUT_MS,
    });
    log.info(`[rec] #${generation} server answered in ${Date.now() - startedAt}ms`);
    return response;
  }

  private async deliver(
    upload: Promise<DictateResponse | null>,
    settings: Settings,
    durationMs: number,
    generation: number,
  ): Promise<Delivery> {
    const response = await upload;
    if (response === null) return { kind: 'quiet' };

    if (isDiscarded(response)) {
      log.info(`[rec] #${generation} discarded by server (${response.reason})`);
      return { kind: 'quiet' };
    }

    // Never paste into a live recording, and not while the hotkey that just
    // stopped one may still be down: the synthetic Ctrl+V sent while Win is
    // held arrives as Win+Ctrl+V, a system shortcut. A recording that starts
    // during the wait means waiting again.
    const waitStartedAt = Date.now();
    if (this.listening) log.info(`[rec] #${generation} ready, waiting for the live recording to end`);
    do {
      await this.whenNotListening();
      const sinceStop = Date.now() - this.lastStoppedAt;
      if (sinceStop < KEY_RELEASE_GRACE_MS) {
        const released = await this.deps.waitForModifiersReleased(KEY_RELEASE_GRACE_MS - sinceStop);
        if (!released) log.warn(`[rec] #${generation} modifiers still look held — pasting anyway`);
      }
    } while (this.listening);

    const text = this.joinWithPrevious(response.cleaned);
    // Diagnostics only, never awaited: which app had focus when the keystroke
    // went out tells a paste that landed elsewhere from one that was never sent.
    void getFocusedAppName().then((focused) => {
      log.info(`[rec] #${generation} focus at paste: ${focused ?? 'unknown'}`);
    });
    const outcome = await pasteText(text);
    if (outcome.pasted) {
      this.lastPaste = { text, inputActivity: this.deps.getInputActivity(), at: Date.now() };
    }
    log.info(
      `[rec] #${generation} ${outcome.pasted ? `pasted via ${outcome.method}` : `not pasted (${outcome.error ?? 'unknown'})`}` +
        ` after waiting ${Date.now() - waitStartedAt}ms`,
    );

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

    const previewText =
      response.cleaned.length > OVERLAY_DONE_PREVIEW_CHARS
        ? `${response.cleaned.slice(0, OVERLAY_DONE_PREVIEW_CHARS).trimEnd()}…`
        : response.cleaned;

    return {
      kind: 'done',
      text: previewText,
      wordCount: response.wordCount,
      pasted: outcome.pasted,
    };
  }

  /**
   * Two dictations in a row would otherwise glue together ("paper.Second").
   * When nothing has typed or clicked since the previous paste, the caret is
   * still right after it, so the new text gets a leading space.
   */
  private joinWithPrevious(text: string): string {
    const last = this.lastPaste;
    if (last === null) return text;
    if (this.deps.getInputActivity() !== last.inputActivity) return text;
    if (Date.now() - last.at > JOIN_WINDOW_MS) return text;
    if (/\s$/u.test(last.text) || NO_SPACE_BEFORE.test(text)) return text;
    if (CJK.test(last.text.slice(-1)) || CJK.test(text.charAt(0))) return text;
    return ` ${text}`;
  }

  /**
   * A live recording owns the overlay. Otherwise errors and the "on clipboard"
   * fallback always show; a pasted result only shows when it is the last
   * dictation in flight, else the overlay stays on 'processing'.
   */
  private showResult(result: Delivery): void {
    if (this.listening) return;

    if (result.kind === 'error') {
      this.setOverlay({ kind: 'error', message: shorten(result.message) });
      this.deps.overlay.hideAfter(OVERLAY_ERROR_FADE_MS);
      return;
    }

    if (result.kind === 'quiet' || (result.pasted && this.hasPendingWork())) {
      this.settleOverlay();
      return;
    }

    this.setOverlay(result);
    this.deps.overlay.hideAfter(result.pasted ? OVERLAY_DONE_FADE_MS : OVERLAY_FALLBACK_FADE_MS);
  }

  /** Nothing new to report: 'processing' while work remains, else hidden. */
  private settleOverlay(): void {
    if (this.listening) return;
    this.setOverlay(this.hasPendingWork() ? { kind: 'processing' } : { kind: 'idle' });
  }

  private hasPendingWork(): boolean {
    return this.awaitingAudio.size > 0 || this.inFlight > 0;
  }

  private endListening(): void {
    this.listening = false;
    this.source = null;
    this.lastStoppedAt = Date.now();
    const waiters = this.notListeningWaiters;
    this.notListeningWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private whenNotListening(): Promise<void> {
    if (!this.listening) return Promise.resolve();
    return new Promise((resolve) => this.notListeningWaiters.push(resolve));
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
