import React, { useEffect, useRef, useState } from 'react';
import { clampViewport, followViewport, waveformTime, waveformZooms } from '../utils/waveform';

export interface WaveformMarker { id: string; seconds: number; title: string; }
interface Peaks { start: number; step: number; duration: number; peaks: number[]; }
const timeLabel = (t: number) => { const s = Math.floor(t); return `${Math.floor(s / 3600).toString().padStart(2, '0')}:${Math.floor(s / 60 % 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`; };
const zoomLabel = (n: number) => !Number.isFinite(n) ? 'Full Book' : n < 60 ? `${n} seconds` : n < 3600 ? `${n / 60} minute${n === 60 ? '' : 's'}` : `${n / 3600} hour${n === 3600 ? '' : 's'}`;

export function AudioWaveform({ url, duration, currentTime, playing, audioRef, markers, selectedId, onSeek, onMarker }: {
  url?: string; duration: number; currentTime: number; playing: boolean;
  audioRef: React.RefObject<HTMLAudioElement>; markers: WaveformMarker[]; selectedId?: string;
  onSeek: (time: number) => void; onMarker: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(3);
  const [start, setStart] = useState(0);
  const [follow, setFollow] = useState(true);
  const [width, setWidth] = useState(800);
  const [data, setData] = useState<Peaks | null>(null);
  const [status, setStatus] = useState('Loading waveform…');
  const [retry, setRetry] = useState(0);
  const [themeRevision, setThemeRevision] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const position = useRef(currentTime); position.current = currentTime;
  const span = Math.min(waveformZooms[zoom], duration || 1);
  const viewStart = clampViewport(start, span, duration);
  useEffect(() => { setStart(0); setFollow(true); setZoom(3); }, [url]);
  useEffect(() => {
    const redraw = () => setThemeRevision(value => value + 1);
    window.addEventListener('swissmouse-theme-changed', redraw);
    return () => window.removeEventListener('swissmouse-theme-changed', redraw);
  }, []);
  useEffect(() => { setFollow(true); setStart(clampViewport(position.current - span / 2, span, duration)); }, [selectedId]);
  useEffect(() => { if (follow) setStart(s => followViewport(currentTime, s, span, duration)); }, [currentTime, follow, span, duration]);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(1, Math.round(entries[0].contentRect.width))));
    observer.observe(canvas.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = canvas.current;
    if (!node || span >= duration) return;
    const scroll = (event: WheelEvent) => {
      event.preventDefault();
      const delta = (event.deltaX || event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1);
      setFollow(false);
      setStart(s => clampViewport(s + delta / width * span, span, duration));
    };
    node.addEventListener('wheel', scroll, { passive: false });
    return () => node.removeEventListener('wheel', scroll);
  }, [span, duration, width]);
  useEffect(() => {
    setData(null);
    if (!url) { setStatus('Waveform unavailable for local audio. Playback remains available.'); return; }
    const abort = new AbortController();
    setStatus('Loading waveform…');
    // Debounce panning; fetch only the selected LOD and viewport (bounded to pixels).
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${url}?start=${viewStart}&duration=${span}&pixels=${Math.min(4096, width)}`, { signal: abort.signal });
        if (!response.ok) throw new Error('Waveform unavailable. Playback remains available.');
        const result = await response.json();
        if (!abort.signal.aborted) { setData(result); setStatus(''); }
      } catch (e) { if (!abort.signal.aborted) setStatus(e instanceof Error ? e.message : 'Waveform unavailable.'); }
    }, 100);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [url, viewStart, span, width, retry]);
  useEffect(() => {
    const node = canvas.current, ctx = node?.getContext('2d'); if (!node || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    node.width = width * ratio; node.height = 112 * ratio;
    ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, 112);
    const styles = getComputedStyle(document.documentElement);
    const themeColor = (token: string, fallback: string) => styles.getPropertyValue(token).trim() || fallback;
    ctx.strokeStyle = themeColor('--sm-waveform-baseline', '#d6d3d1'); ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(width, 64); ctx.stroke();
    if (data) {
      // Aggregate into pixel columns even for very high resolution displays.
      const columns = new Float32Array(width);
      data.peaks.forEach((peak, i) => {
        const left = Math.max(0, Math.floor((data.start + i * data.step - viewStart) / span * width));
        const right = Math.min(width, Math.ceil((data.start + (i + 1) * data.step - viewStart) / span * width));
        for (let x = left; x < right; x++) columns[x] = Math.max(columns[x], peak);
      });
      ctx.strokeStyle = themeColor('--sm-waveform', '#a8a29e'); ctx.beginPath();
      columns.forEach((peak, x) => { const height = Math.max(0.5, peak * 44); ctx.moveTo(x + 0.5, 64 - height); ctx.lineTo(x + 0.5, 64 + height); }); ctx.stroke();
    }
    for (const marker of markers) {
      const x = (marker.seconds - viewStart) / span * width;
      if (x < 0 || x > width) continue;
      ctx.strokeStyle = marker.id === selectedId ? themeColor('--sm-chapter-marker-selected', '#d97706') : themeColor('--sm-chapter-marker', '#78716c');
      ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = marker.id === selectedId ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 112); ctx.stroke();
      ctx.fillRect(x - 4, 0, 8, 12);
      if (marker.id === selectedId) { ctx.font = '11px sans-serif'; ctx.fillText(marker.title, Math.min(x + 7, Math.max(0, width - 140)), 16, 135); }
    }
  }, [data, width, viewStart, span, markers, selectedId, themeRevision]);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const t = audioRef.current?.currentTime ?? position.current;
      const x = (t - viewStart) / span * width;
      if (playhead.current) { playhead.current.style.display = x >= 0 && x <= width ? 'block' : 'none'; playhead.current.style.transform = `translateX(${x}px)`; }
      if (playing) frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [playing, currentTime, viewStart, span, width, audioRef]);
  const pan = (s: number) => { setFollow(false); setStart(clampViewport(s, span, duration)); };
  const changeZoom = (index: number) => {
    const next = Math.min(waveformZooms[index], duration);
    setStart(clampViewport((follow ? currentTime : viewStart + span / 2) - next / 2, next, duration)); setZoom(index);
  };
  return <section aria-label="Audio waveform" className="rounded-lg border border-stone-200 bg-stone-50 p-2 space-y-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-label="Zoom in" disabled={zoom === 0} onClick={() => changeZoom(zoom - 1)} className="px-2 border rounded disabled:opacity-40">+</button>
      <select aria-label="Waveform zoom" value={zoom} onChange={e => changeZoom(Number(e.target.value))} className="border rounded bg-white px-1">{waveformZooms.map((n, i) => <option key={i} value={i}>{zoomLabel(n)}{i === 3 ? ' (default)' : ''}</option>)}</select>
      <button type="button" aria-label="Zoom out" disabled={zoom === waveformZooms.length - 1} onClick={() => changeZoom(zoom + 1)} className="px-2 border rounded disabled:opacity-40">−</button>
      <button type="button" aria-pressed={follow} onClick={() => { setFollow(true); setStart(clampViewport(currentTime - span / 2, span, duration)); }} className="px-2 border rounded">{follow ? 'Following playback' : 'Return to playhead'}</button>
      <span className="font-mono ml-auto">{timeLabel(viewStart)} – {timeLabel(Math.min(duration, viewStart + span))}</span>
    </div>
    <div className="relative overflow-hidden">
      <canvas ref={canvas} className="w-full h-28 cursor-crosshair" role="slider" tabIndex={url ? 0 : -1} aria-label="Waveform seek; arrow keys seek five seconds" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} aria-valuetext={timeLabel(currentTime)} aria-disabled={!url}
        onKeyDown={e => { if (!url) return; const next = e.key === 'ArrowRight' ? currentTime + 5 : e.key === 'ArrowLeft' ? currentTime - 5 : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null; if (next !== null) { e.preventDefault(); onSeek(Math.max(0, Math.min(duration, next))); } }}
        onClick={e => { if (!url) return; const rect = e.currentTarget.getBoundingClientRect(), x = e.clientX - rect.left; const hit = markers.find(m => m.seconds >= viewStart && m.seconds <= viewStart + span && Math.abs((m.seconds - viewStart) / span * rect.width - x) <= 6); if (hit && e.clientY - rect.top < 24) onMarker(hit.id); else onSeek(waveformTime(x, rect.width, viewStart, span)); }} />
      <div ref={playhead} aria-hidden="true" className="waveform-playhead absolute top-0 left-0 h-28 w-0.5 pointer-events-none" />
      {status && <div role="status" className="absolute inset-x-0 bottom-2 text-center text-stone-500 pointer-events-none">{status}</div>}
    </div>
    <div className="flex gap-2 items-center">
      <button type="button" aria-label="Pan earlier" onClick={() => pan(viewStart - span / 2)} disabled={viewStart === 0}>◀</button>
      <input aria-label="Pan waveform" type="range" min={0} max={Math.max(0, duration - span)} step={0.1} value={viewStart} disabled={span >= duration} onChange={e => pan(Number(e.target.value))} className="w-full accent-amber-600" />
      <button type="button" aria-label="Pan later" onClick={() => pan(viewStart + span / 2)} disabled={viewStart + span >= duration}>▶</button>
      {status && url && !status.startsWith('Loading') && <button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button>}
    </div>
    <p className="text-stone-500">Click to seek · Click a chapter flag to select · Scroll or use the slider to inspect</p>
  </section>;
}
