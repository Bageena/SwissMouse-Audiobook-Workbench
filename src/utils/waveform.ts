export const waveformZooms = [30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, Infinity];
export const clampViewport = (start: number, span: number, duration: number) => Math.max(0, Math.min(start, Math.max(0, duration - span)));
export const waveformTime = (x: number, width: number, start: number, span: number) => start + Math.max(0, Math.min(1, x / Math.max(1, width))) * span;
export function followViewport(time: number, start: number, span: number, duration: number) {
  return time < start || time > start + span * 0.9 ? clampViewport(time - span * 0.2, span, duration) : start;
}
