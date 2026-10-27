import React, { useRef, useState } from 'react';

/** Shared lightweight seek control; positions remain in seconds without rounding. */
export function MiniPlayerSeek({ position, duration, onSeek, formatTime, label = 'Listening position', disabled = false, loading = false, chapters = [] }: {
  position: number; duration: number; onSeek: (seconds: number) => void;
  formatTime: (seconds: number) => string; label?: string; disabled?: boolean; loading?: boolean;
  chapters?: { title: string; startSeconds: number }[];
}) {
  const [scrubPosition, setScrubPosition] = useState<number>();
  const scrubPointer = useRef<number>();
  const unavailable = disabled || !duration;
  const positionSeconds = scrubPosition ?? position;
  const percent = duration ? Math.max(0, Math.min(100, positionSeconds / duration * 100)) : 0;
  const seek = (seconds: number) => onSeek(Math.max(0, Math.min(duration, seconds)));
  const pointerPosition = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))) * duration;
  };
  return <div className="mini-player-seek min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] tabular-nums text-stone-600">
          <span>{loading ? 'Loading audio…' : formatTime(positionSeconds)}</span>
          <span>{duration ? formatTime(duration) : '—'}</span>
        </div>
        <div className="relative h-2">
        <div role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={duration || 0} aria-valuenow={positionSeconds}
          aria-disabled={unavailable} tabIndex={unavailable ? -1 : 0}
          aria-valuetext={`${formatTime(positionSeconds)} of ${formatTime(duration)}`}
          onPointerDown={event => {
            if (unavailable || event.button !== 0) return;
            event.preventDefault(); event.currentTarget.focus();
            scrubPointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            setScrubPosition(pointerPosition(event));
          }}
          onPointerMove={event => { if (scrubPointer.current === event.pointerId) setScrubPosition(pointerPosition(event)); }}
          onPointerUp={event => {
            if (scrubPointer.current !== event.pointerId) return;
            const position = pointerPosition(event);
            scrubPointer.current = undefined; setScrubPosition(undefined);
            event.currentTarget.releasePointerCapture(event.pointerId);
            onSeek(position);
          }}
          onPointerCancel={() => { scrubPointer.current = undefined; setScrubPosition(undefined); }}
          onLostPointerCapture={() => { scrubPointer.current = undefined; setScrubPosition(undefined); }}
          onKeyDown={event => {
            if (unavailable) return;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? duration
              : ['ArrowRight', 'ArrowUp'].includes(event.key) ? positionSeconds + 5
              : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? positionSeconds - 5
              : event.key === 'PageUp' ? positionSeconds + 60 : event.key === 'PageDown' ? positionSeconds - 60 : undefined;
            if (next !== undefined) { event.preventDefault(); seek(next); }
          }}
          className="quick-player-seek relative h-2 overflow-hidden rounded-full bg-stone-200">
          <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: 'var(--sm-accent)' }} />
        </div>
          {chapters.filter(chapter => !unavailable && chapter.startSeconds > 0 && chapter.startSeconds <= duration).map((chapter, index) => <button type="button" key={`${chapter.startSeconds}:${index}`}
            title={chapter.title} aria-label={`Jump to chapter: ${chapter.title}`} onClick={() => onSeek(chapter.startSeconds)}
            className="quick-player-chapter-marker" style={{ left: `${chapter.startSeconds / duration * 100}%` }} />)}
        </div>
  </div>;
}
