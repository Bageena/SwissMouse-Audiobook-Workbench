import { formatTimestampMs } from '../utils/chapters';
import { DesktopWindow } from './DesktopWorkspace';
import { BetweenHorizontalStart, MapPin, X, ZoomIn, ZoomOut, ScanLine } from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';
import { clampViewport, followViewport, waveformTime, waveformZooms, waveformRange } from '../utils/waveform';

export interface WaveformMarker { id: string; seconds: number; title: string; }
interface Peaks { start: number; step: number; duration: number; peaks: number[]; }
const timeLabel = (t: number) => { const s = Math.floor(t); return `${Math.floor(s / 3600).toString().padStart(2, '0')}:${Math.floor(s / 60 % 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`; };
const zoomLabel = (n: number) => !Number.isFinite(n) ? 'Full' : n < 60 ? `${n} sec` : n < 3600 ? `${n / 60} min` : `${n / 3600} hr`;

export function AudioWaveform({ url, duration, currentTime, playing, audioRef, seekRevision = 0, markers, selectedId, onSeek, onMarker }: {
  seekRevision?: number;
  url?: string; duration: number; currentTime: number; playing: boolean;
  audioRef: React.RefObject<HTMLAudioElement>; markers: WaveformMarker[]; selectedId?: string;
  onSeek: (time: number) => void; onMarker: (id: string) => void;
}) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [rangeError, setRangeError] = useState('');
  const rangeId = useId();
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
  const span = range ? range.end - range.start : Math.min(waveformZooms[zoom], duration || 1);
  const viewStart = range ? range.start : clampViewport(start, span, duration);
  useEffect(() => { setStart(0); setFollow(true); setZoom(3); setRange(null); setRangeOpen(false); setRangeFrom(''); setRangeTo(''); setRangeError(''); }, [url]);
  useEffect(() => {
    const redraw = () => setThemeRevision(value => value + 1);
    window.addEventListener('swissmouse-theme-changed', redraw);
    return () => window.removeEventListener('swissmouse-theme-changed', redraw);
  }, []);
  useEffect(() => { if (!range) { setFollow(true); setStart(clampViewport(position.current - span / 2, span, duration)); } }, [selectedId]);
  useEffect(() => { if (follow) setStart(s => followViewport(currentTime, s, span, duration)); }, [currentTime, follow, span, duration]);
  // Explicit seeking recenters even when automatic playback following is off.
  useEffect(() => {
    if (!seekRevision) return;
    const time = position.current;
    if (range && time >= range.start && time <= range.end) return;
    if (range) setRange(null);
    const normalSpan = Math.min(waveformZooms[zoom], duration);
    setStart(clampViewport(time - normalSpan / 2, normalSpan, duration));
  }, [seekRevision]);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(1, Math.round(entries[0].contentRect.width))));
    observer.observe(canvas.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = canvas.current;
    if (!node || range || span >= duration) return;
    const scroll = (event: WheelEvent) => {
      event.preventDefault();
      const delta = (event.deltaX || event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1);
      setFollow(false);
      setStart(s => clampViewport(s + delta / width * span, span, duration));
    };
    node.addEventListener('wheel', scroll, { passive: false });
    return () => node.removeEventListener('wheel', scroll);
  }, [span, duration, width, range]);
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
    node.width = width * ratio; node.height = 64 * ratio;
    ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, 64);
    const styles = getComputedStyle(document.documentElement);
    const themeColor = (token: string, fallback: string) => styles.getPropertyValue(token).trim() || fallback;
    ctx.strokeStyle = themeColor('--sm-waveform-baseline', '#d6d3d1'); ctx.beginPath(); ctx.moveTo(0, 36); ctx.lineTo(width, 36); ctx.stroke();
    if (data) {
      // Aggregate into pixel columns even for very high resolution displays.
      const columns = new Float32Array(width);
      data.peaks.forEach((peak, i) => {
        const left = Math.max(0, Math.floor((data.start + i * data.step - viewStart) / span * width));
        const right = Math.min(width, Math.ceil((data.start + (i + 1) * data.step - viewStart) / span * width));
        for (let x = left; x < right; x++) columns[x] = Math.max(columns[x], peak);
      });
      ctx.strokeStyle = themeColor('--sm-waveform', '#a8a29e'); ctx.beginPath();
      columns.forEach((peak, x) => { const height = Math.max(0.5, peak * 26); ctx.moveTo(x + 0.5, 36 - height); ctx.lineTo(x + 0.5, 36 + height); }); ctx.stroke();
    }
    for (const marker of markers) {
      const x = (marker.seconds - viewStart) / span * width;
      if (x < 0 || x > width) continue;
      ctx.strokeStyle = marker.id === selectedId ? themeColor('--sm-chapter-marker-selected', '#d97706') : themeColor('--sm-chapter-marker', '#78716c');
      ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = marker.id === selectedId ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke();
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

  const changeZoom = (index: number) => {
    setRange(null);
    const next = Math.min(waveformZooms[index], duration);
    setStart(clampViewport((follow ? currentTime : viewStart + span / 2) - next / 2, next, duration)); setZoom(index);
  };
  const clearRange = () => { setRange(null); setRangeError(''); setFollow(true); setStart(clampViewport(currentTime - Math.min(waveformZooms[zoom], duration) / 2, Math.min(waveformZooms[zoom], duration), duration)); };
  const orderedMarkers = [...markers].sort((a, b) => a.seconds - b.seconds);
  const chapterEnd = (id: string) => {
    const index = orderedMarkers.findIndex(marker => marker.id === id);
    return orderedMarkers[index + 1]?.seconds ?? duration;
  };
  const draftRange = waveformRange(rangeFrom, rangeTo, duration);
  const rangeControl = 'inline-flex items-center justify-center rounded border border-stone-300 p-1 text-stone-800 hover:bg-stone-50 disabled:opacity-40';
  return <DesktopWindow id="chapter-waveform" title="Waveform" homeWindow="chapter-player" variant="compact" minimumWidth={160}>
    <section aria-label="Audio waveform" className="waveform-panel text-xs">
    <header className="workspace-panel-header waveform-header">
      <h3 className="workspace-panel-title">Waveform</h3>
    <div role="toolbar" aria-label="Waveform toolbar" className="waveform-toolbar flex flex-wrap items-center gap-1.5">
      <button type="button" title="Zoom in" aria-label="Zoom in" disabled={zoom === 0} onClick={() => changeZoom(zoom - 1)} className="waveform-tool"><ZoomIn aria-hidden="true" /></button>
      <select aria-label="Waveform zoom" value={range ? 'range' : zoom} onChange={e => changeZoom(Number(e.target.value))} title="Waveform zoom" className="waveform-zoom">{range && <option value="range">Range</option>}{waveformZooms.map((n, i) => <option key={i} value={i}>{zoomLabel(n)}</option>)}</select>
      <button type="button" title="Zoom out" aria-label="Zoom out" disabled={zoom === waveformZooms.length - 1} onClick={() => changeZoom(zoom + 1)} className="waveform-tool"><ZoomOut aria-hidden="true" /></button>
      <button type="button" className="waveform-tool" aria-label="View range" title="View a range between timestamps or chapters"
        aria-expanded={rangeOpen} aria-controls={rangeId} disabled={!url || !duration}
        onClick={() => {
          if (!rangeOpen && !rangeFrom && !rangeTo) {
            const selected = orderedMarkers.find(marker => marker.id === selectedId);
            setRangeFrom(formatTimestampMs((selected?.seconds ?? viewStart) * 1000));
            setRangeTo(formatTimestampMs((selected ? chapterEnd(selected.id) : Math.min(duration, viewStart + span)) * 1000));
          }
          setRangeOpen(value => !value);
        }}><BetweenHorizontalStart className="h-4 w-4" aria-hidden="true" /></button>
      {range && <button type="button" className="waveform-tool" aria-label="Clear waveform range" title="Return to normal waveform view" onClick={clearRange}><X className="h-4 w-4" aria-hidden="true" /></button>}
      <label className="waveform-follow-control inline-flex items-center gap-1.5" title="Keep the waveform centered on playback. Turning this on exits the selected range.">
        <ScanLine className="h-4 w-4" aria-hidden="true" />
        <button type="button" role="switch" aria-label="Follow playback" aria-checked={follow}
          disabled={!url || !duration} onClick={() => { if (follow) setFollow(false); else clearRange(); }} className="waveform-follow-switch"><span aria-hidden="true" /></button>
        <span>Follow</span>
      </label>
    </div>
      <span className="waveform-time-range font-mono">{timeLabel(viewStart)} – {timeLabel(Math.min(duration, viewStart + span))}</span>
    </header>
    <div className="waveform-body p-2 space-y-2">
    {rangeOpen && <form id={rangeId} className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      const next = waveformRange(rangeFrom, rangeTo, duration);
      if (!next) { setRangeError('Enter HH:MM:SS.mmm timestamps within the audio, with To after From.'); return; }
      setRange(next); setFollow(false); setRangeError('');
    }}>
      {(['From', 'To'] as const).map(endpoint => <div key={endpoint} className="min-w-0 flex flex-wrap items-end gap-1">
        <label className="flex flex-col gap-1">{endpoint}
          <input aria-label={`Waveform range ${endpoint.toLowerCase()}`} className="w-32 rounded border border-stone-300 px-2 py-1 font-mono" placeholder="HH:MM:SS.mmm"
            value={endpoint === 'From' ? rangeFrom : rangeTo} onChange={event => { (endpoint === 'From' ? setRangeFrom : setRangeTo)(event.target.value); setRangeError(''); }} />
        </label>
        <button type="button" className={rangeControl} title={`Use playback position for ${endpoint.toLowerCase()}`} aria-label={`Use playback position for ${endpoint.toLowerCase()}`}
          onClick={() => { (endpoint === 'From' ? setRangeFrom : setRangeTo)(formatTimestampMs((audioRef.current?.currentTime ?? currentTime) * 1000)); setRangeError(''); }}><MapPin className="h-4 w-4" aria-hidden="true" /></button>
        {orderedMarkers.length > 0 && <select aria-label={`${endpoint === 'From' ? 'Start' : 'End'} of chapter`} value="" className="max-w-44 rounded border border-stone-300 px-1 py-1"
          onChange={event => {
            const marker = orderedMarkers.find(item => item.id === event.target.value);
            if (!marker) return;
            (endpoint === 'From' ? setRangeFrom : setRangeTo)(formatTimestampMs((endpoint === 'From' ? marker.seconds : chapterEnd(marker.id)) * 1000));
            setRangeError('');
          }}><option value="">{endpoint === 'From' ? 'Start' : 'End'} of chapter…</option>{orderedMarkers.map(marker => <option key={marker.id} value={marker.id}>{marker.title}</option>)}</select>}
      </div>)}
      <button type="submit" className="rounded border border-stone-300 px-2 py-1" disabled={!url || !duration}>Fit range</button>
      {draftRange && <span className="py-1 font-mono text-stone-600">Duration: {formatTimestampMs((draftRange.end - draftRange.start) * 1000)}</span>}
      {rangeError && <p role="alert" className="w-full text-rose-700">{rangeError}</p>}
    </form>}
    <div className="relative overflow-hidden">
      <canvas ref={canvas} className="w-full h-16 cursor-crosshair" role="slider" tabIndex={url ? 0 : -1} aria-label="Waveform seek; arrow keys seek five seconds" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} aria-valuetext={timeLabel(currentTime)} aria-disabled={!url}
        onKeyDown={e => { if (!url) return; const next = e.key === 'ArrowRight' ? currentTime + 5 : e.key === 'ArrowLeft' ? currentTime - 5 : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null; if (next !== null) { e.preventDefault(); onSeek(Math.max(0, Math.min(duration, next))); } }}
        onClick={e => { if (!url) return; const rect = e.currentTarget.getBoundingClientRect(), x = e.clientX - rect.left; const hit = markers.find(m => m.seconds >= viewStart && m.seconds <= viewStart + span && Math.abs((m.seconds - viewStart) / span * rect.width - x) <= 6); if (hit && e.clientY - rect.top < 24) onMarker(hit.id); else onSeek(waveformTime(x, rect.width, viewStart, span)); }} />
      <div ref={playhead} aria-hidden="true" className="waveform-playhead absolute top-0 left-0 h-16 w-0.5 pointer-events-none" />
      {status && <div role="status" className="absolute inset-x-0 bottom-2 text-center text-stone-500 pointer-events-none">{status}</div>}
    </div>
    {status && url && !status.startsWith('Loading') && <button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button>}
    <p className="text-stone-500">Click to seek · Click a chapter flag to select · Scroll to inspect</p>
    </div>
  </section></DesktopWindow>;
}
