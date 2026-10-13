/**
 * Whisper fills silence with phantom words: a trailing "Okay." after the user
 * stops talking, "Okay. Okay." for a near-empty clip. Cutting the silence off
 * both ends before upload removes what it would hallucinate from.
 *
 * Speech is found relative to the clip's own levels, not a fixed threshold,
 * so a quiet mic and a noisy room both work. When the clip shows no clear
 * contrast between speech and background, it is left alone — the server's
 * own filters still apply.
 */

const FRAME_MS = 20;

/** Kept around the speech so first and last syllables are never clipped. */
const LEAD_MARGIN_MS = 300;
const TAIL_MARGIN_MS = 600;

/** Less voiced audio than this is a click or a breath, not a dictation. */
const MIN_SPEECH_MS = 150;

/** Loud frames must be at least this far above the background to call it speech. */
const MIN_CONTRAST = 2.5;

export type TrimResult =
  | { kind: 'speech'; samples: Float32Array; trimmedMs: number }
  /** Clear background with almost nothing above it: do not upload. */
  | { kind: 'no-speech' };

export function trimSilence(samples: Float32Array, sampleRate: number): TrimResult {
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const frames = Math.floor(samples.length / frame);
  const untouched: TrimResult = { kind: 'speech', samples, trimmedMs: 0 };
  if (frames < 5) return untouched;

  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i += 1) {
      const sample = samples[i]!;
      sum += sample * sample;
    }
    rms[f] = Math.sqrt(sum / frame);
  }

  // Percentiles, not min/max: one key click must not set the scale.
  const sorted = Float32Array.from(rms).sort();
  const background = sorted[Math.floor(frames * 0.2)]!;
  const loud = sorted[Math.floor(frames * 0.95)]!;

  let threshold: number;
  if (loud >= background * MIN_CONTRAST) {
    threshold = Math.min(Math.max(background * 3, loud * 0.1), loud * 0.5);
  } else {
    // Whatever stands out is under 5% of the clip: one short word, or a click.
    if (sorted[frames - 1]! < background * 3) return untouched; // steady noise throughout
    threshold = background * 3;
  }

  let first = -1;
  let last = -1;
  let voiced = 0;
  for (let f = 0; f < frames; f += 1) {
    if (rms[f]! < threshold) continue;
    if (first < 0) first = f;
    last = f;
    voiced += 1;
  }

  if (first < 0 || voiced * FRAME_MS < MIN_SPEECH_MS) return { kind: 'no-speech' };

  const toSamples = (ms: number): number => Math.round((sampleRate * ms) / 1000);
  const start = Math.max(0, first * frame - toSamples(LEAD_MARGIN_MS));
  const end = Math.min(samples.length, (last + 1) * frame + toSamples(TAIL_MARGIN_MS));

  return {
    kind: 'speech',
    samples: samples.subarray(start, end),
    trimmedMs: Math.round(((samples.length - (end - start)) * 1000) / sampleRate),
  };
}
