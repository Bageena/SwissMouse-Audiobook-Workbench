import { MiniPlayerSeek } from './MiniPlayerSeek';
import { MiniPlayerControls } from './MiniPlayerControls';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Volume2, VolumeX } from 'lucide-react';
import { useQuickPlayback } from '../playback/useQuickPlayback';

export function listeningTime(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(value / 60) % 60;
  return `${Math.floor(value / 3600)}:${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function QuickPlayer({ jobId, playRequest = 0, listLabel = 'Playlist', showSkipControls = false }: { jobId: string; playRequest?: number; listLabel?: 'Playlist' | 'Chapter List'; showSkipControls?: boolean }) {
  const [showQueue, setShowQueue] = useState(false);
  const queueId = useId();
  const queueToggle = useRef<HTMLButtonElement>(null);
  const queuePanel = useRef<HTMLDivElement>(null);
  const [queueAnchor, setQueueAnchor] = useState({ left: 0, top: 0, width: 320 });
  const positionQueue = () => {
    const button = queueToggle.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(360, document.documentElement.clientWidth - 16);
    const top = (button.closest('header')?.getBoundingClientRect().bottom ?? rect.bottom) + 4;
    setQueueAnchor({ left: Math.max(8, Math.min(rect.right - width, document.documentElement.clientWidth - width - 8)), top, width });
  };
  useEffect(() => {
    if (!showQueue) return;
    positionQueue();
    const dismiss = (event: PointerEvent) => {
      if (!queuePanel.current?.contains(event.target as Node) && !queueToggle.current?.contains(event.target as Node)) setShowQueue(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowQueue(false); queueToggle.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', positionQueue);
    window.addEventListener('scroll', positionQueue, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', positionQueue);
      window.removeEventListener('scroll', positionQueue, true);
    };
  }, [showQueue]);
  const { state, play, pause, stop, seek, retrySave, seekPreview, endPreview, setVolume, toggleMute } = useQuickPlayback(jobId, playRequest);
  const active = state.status === 'playing' || state.status === 'starting';
  let elapsed = 0;
  const chapters = state.chapters?.length ? state.chapters : (state.queue || []).map(segment => {
    const chapter = { title: segment.title, startSeconds: elapsed }; elapsed += segment.durationSeconds; return chapter;
  });
  const currentChapter = chapters.reduce((found, chapter, index) => chapter.startSeconds <= state.positionSeconds ? index : found, -1);
  const unavailable = !state.totalDurationSeconds || state.status === 'loading';

  return <div className="quick-player text-xs" data-playing={state.status === 'playing'} aria-label="Quick audiobook player">
    {state.preview && <div className="mb-1 flex items-center gap-2"><span className="min-w-0 flex-1 truncate" title={state.preview.file}>Preview: {state.preview.file}</span><button type="button" onClick={() => void endPreview()} className="underline">Return to book</button></div>}
    <div className="quick-player-transport grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
      <MiniPlayerControls playing={active} onTogglePlay={() => void (active ? pause() : play())} onStop={() => void stop()}
        disabled={unavailable} playDisabled={state.status === 'loading'} showSkipControls={showSkipControls}
        onSkip={seconds => void seek(Math.max(0, Math.min(state.totalDurationSeconds, state.positionSeconds + seconds)))}
        onPrevious={!unavailable && !state.preview ? () => void seek(chapters[Math.max(0, currentChapter - 1)]?.startSeconds || 0) : undefined}
        onNext={!unavailable && !state.preview && currentChapter + 1 < chapters.length ? () => void seek(chapters[currentChapter + 1]?.startSeconds || 0) : undefined} />
      <div className="col-span-2 row-start-1 min-w-0">
        <MiniPlayerSeek position={state.positionSeconds} duration={state.totalDurationSeconds} onSeek={seconds => void seek(seconds)}
          formatTime={listeningTime} disabled={unavailable} loading={state.status === 'loading' && !state.totalDurationSeconds} chapters={state.preview ? [] : chapters} />
      </div>
      <div className="quick-player-volume flex shrink-0 items-center gap-1">
        <button type="button" className="quick-player-control inline-flex items-center justify-center rounded border border-stone-300 text-stone-800 hover:bg-stone-50"
          aria-label={state.muted ? 'Unmute audiobook' : 'Mute audiobook'} title={state.muted ? 'Unmute' : 'Mute'} aria-pressed={state.muted} onClick={toggleMute}>
          {state.muted || state.volume === 0 ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
        <input type="range" aria-label="Audiobook volume" title={`Volume: ${Math.round((state.muted ? 0 : state.volume) * 100)}%`}
          min={0} max={1} step={0.01} value={state.muted ? 0 : state.volume}
          aria-valuetext={`${Math.round((state.muted ? 0 : state.volume) * 100)} percent`}
          onChange={event => setVolume(Number(event.target.value))} className="w-16 min-w-0 accent-[var(--sm-accent)]" />
      </div>
    </div>
    {state.totalDurationSeconds > 0 && !state.preview && <p className="mt-1 text-right text-[10px] tabular-nums text-stone-500">{listeningTime(Math.max(0, state.totalDurationSeconds - state.positionSeconds))} remaining</p>}
    {state.preview && <input type="range" aria-label="Preview position" className="mt-1 w-full" min={0} max={state.totalDurationSeconds || 1} step={0.1} value={state.positionSeconds} onChange={event => void seekPreview(Number(event.target.value))} />}
    {state.completed && <p className="mt-1 text-stone-600">Finished. Play starts a new listen.</p>}
    {!state.preview && chapters.length > 0 && <div className="mt-2 text-[11px] text-stone-600">
      <button ref={queueToggle} type="button" className="quick-player-list-toggle" aria-expanded={showQueue} aria-controls={queueId}
        onClick={() => { positionQueue(); setShowQueue(value => !value); }}>
        <ChevronDown aria-hidden="true" className={`disclosure-chevron h-3 w-3 ${showQueue ? '' : '-rotate-90'}`} />
        {listLabel} · {chapters.length} {state.chapters?.length ? (chapters.length === 1 ? 'chapter' : 'chapters') : (chapters.length === 1 ? 'track' : 'tracks')}
      </button>
      {showQueue && createPortal(<div ref={queuePanel} id={queueId} role="region" aria-label={listLabel} className="quick-player-playlist"
        style={{ position: 'fixed', left: queueAnchor.left, top: queueAnchor.top, width: queueAnchor.width, maxHeight: `max(80px, calc(100dvh - ${queueAnchor.top + 8}px))` }}>
      <ol className="space-y-1" aria-label={listLabel}>
        {chapters.map((chapter, index) => <li key={`${chapter.startSeconds}:${index}`}>
          <button type="button" aria-current={index === currentChapter ? 'true' : undefined} onClick={() => void seek(chapter.startSeconds)}
            className={`quick-player-chapter flex w-full items-start gap-2 rounded px-1 py-1 text-left ${index === currentChapter ? 'bg-amber-50 font-semibold' : ''}`}>
            <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{index + 1}. {chapter.title}</span>
            <span className="shrink-0 tabular-nums">{listeningTime(chapter.startSeconds)}</span>
          </button>
        </li>)}
      </ol>
      </div>, document.body)}
    </div>}
    {state.notice && <p className="mt-1 text-stone-600">{state.notice}</p>}
    {state.error && <div role="alert" className="mt-2 text-rose-700"><span className="font-semibold">Audio is unavailable.</span><details className="mt-1 text-[11px]"><summary className="cursor-pointer">Playback details</summary><p className="mt-1 break-words [overflow-wrap:anywhere]">{state.error}</p></details></div>}
    {state.saveError && <p role="alert" className="mt-1 text-amber-800">{state.saveError} <button type="button" onClick={() => void retrySave()} className="font-semibold underline">Retry save</button></p>}
  </div>;
}
