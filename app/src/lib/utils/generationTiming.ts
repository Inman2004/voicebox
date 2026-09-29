import { useEffect, useState } from 'react';

/** Server datetimes are naive UTC; SSE ones carry a "Z". Parse both as UTC. */
export function parseServerDate(value?: string | null): number | null {
  if (!value) return null;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(value);
  const ms = Date.parse(hasZone ? value : `${value}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** "0.8s", "12.4s", "1m 05s". */
export function formatSeconds(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/** Audio seconds produced per wall-clock second (e.g. 4.2 → "4.2× realtime"). */
export function realtimeFactor(audioSeconds?: number | null, generationSeconds?: number | null): number | null {
  if (!audioSeconds || !generationSeconds || generationSeconds <= 0) return null;
  return audioSeconds / generationSeconds;
}

/** Seconds elapsed since *startMs*, ticking every 100 ms while *running*. */
export function useElapsed(startMs: number | null, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || startMs == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running, startMs]);
  if (startMs == null) return null;
  return Math.max(0, (now - startMs) / 1000);
}
