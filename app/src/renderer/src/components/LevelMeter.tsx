import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/**
 * Live microphone level, used by Onboarding's mic check and the Settings
 * input-device row. The hook owns the entire audio graph and tears all of it
 * down on unmount — a leaked stream leaves the OS recording indicator on.
 */

export function useMicLevel(deviceId?: string): {
  level: number;
  error: string | null;
  ready: boolean;
} {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId !== undefined ? { deviceId: { exact: deviceId } } : true,
        });

        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const node = audioContext.createAnalyser();
        node.fftSize = 1024;
        node.smoothingTimeConstant = 0.6;
        source.connect(node);
        analyser = node;

        setError(null);
        setReady(true);

        const data = new Uint8Array(node.fftSize);
        const tick = (): void => {
          node.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const centred = ((data[i] ?? 128) - 128) / 128;
            sum += centred * centred;
          }
          const rms = Math.sqrt(sum / data.length);
          setLevel(Math.min(1, rms * 3));
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Microphone access was denied.'
            : 'Could not open that microphone.',
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      analyser?.disconnect();
      if (audioContext !== null) {
        void audioContext.close().catch(() => {
          // Already closed; nothing to release.
        });
      }
      if (stream !== null) {
        for (const track of stream.getTracks()) track.stop();
      }
      setLevel(0);
      setReady(false);
      setError(null);
    };
  }, [deviceId]);

  return { level, error, ready };
}

const BAR_COUNT = 14;
const BARS = Array.from({ length: BAR_COUNT }, (_, index) => index);

export function LevelMeter({
  level,
  className,
}: {
  level: number;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn('flex h-10 items-end gap-1', className)}
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      {BARS.map((index) => (
        <div
          key={index}
          className={cn(
            'w-1.5 rounded-full transition-colors duration-75',
            level * BAR_COUNT > index ? 'bg-accent' : 'bg-line',
          )}
          style={{ height: `${30 + (index / (BAR_COUNT - 1)) * 70}%` }}
        />
      ))}
    </div>
  );
}
