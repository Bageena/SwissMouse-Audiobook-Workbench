export const waveformZooms = [30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, Infinity];
export const clampViewport = (start: number, span: number, duration: number) => Math.max(0, Math.min(start, Math.max(0, duration - span)));
export const waveformTime = (x: number, width: number, start: number, span: number) => start + Math.max(0, Math.min(1, x / Math.max(1, width))) * span;
export function followViewport(time: number, start: number, span: number, duration: number) {
  return time < start || time > start + span * 0.9 ? clampViewport(time - span * 0.2, span, duration) : start;
}

/** Strict editor timestamps, with optional millisecond precision. */
export function waveformRange(from: string, to: string, duration: number): { start: number; end: number } | null {
  const parse = (value: string) => {
    const match = value.trim().match(/^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number((match[4] || '').padEnd(3, '0')) / 1000 : NaN;
  };
  const start = parse(from), end = parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration ? { start, end } : null;
}
