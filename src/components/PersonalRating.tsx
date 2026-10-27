import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Star } from 'lucide-react';
import { PersonalRatingController, personalRatingAtPosition, personalRatingForKey, type PersonalRatingValue } from '../utils/personalRating';

export interface PersonalRatingProps {
  bookId: string;
  value: PersonalRatingValue;
  onChange?: (bookId: string, value: PersonalRatingValue) => Promise<void>;
  starsOnly?: boolean;
}

function RatingForBook({ bookId, value, onChange, starsOnly = false }: PersonalRatingProps) {
  const saveRef = useRef(onChange);
  saveRef.current = onChange;
  const [controller] = useState(() => new PersonalRatingController(value, (next) => saveRef.current?.(bookId, next) ?? Promise.resolve()));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const starsRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<number | null>(null);
  const hintId = useId();
  const errorId = useId();
  const disabled = !onChange;

  useEffect(() => { controller.syncSaved(value); }, [controller, value]);
  useEffect(() => () => { controller.flush(); }, [controller]);

  const previewAt = (clientX: number) => {
    const stars = Array.from(starsRef.current?.querySelectorAll<HTMLElement>('[data-rating-star]') ?? []);
    const next = personalRatingAtPosition(clientX, stars.map((star) => star.getBoundingClientRect()));
    if (next !== null) controller.preview(next);
  };
  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== event.pointerId) return;
    dragRef.current = null;
    controller.flush();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const label = state.value === null ? 'Unrated' : `${state.value / 2} out of 5 stars`;

  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Personal rating"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-orientation="horizontal"
        aria-valuenow={(state.value ?? 0) / 2}
        aria-valuetext={label}
        aria-disabled={disabled}
        aria-describedby={`${hintId}${state.error ? ` ${errorId}` : ''}`}
        title="Click or drag to rate in half stars. Double-click to clear."
        className={`inline-flex min-h-8 touch-none select-none items-center rounded-md px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--sm-ring)] ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
        onPointerDown={(event) => {
          if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
          event.preventDefault();
          event.currentTarget.focus();
          dragRef.current = event.pointerId;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          previewAt(event.clientX);
        }}
        onPointerMove={(event) => { if (dragRef.current === event.pointerId) previewAt(event.clientX); }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={(event) => { if (dragRef.current === event.pointerId) { dragRef.current = null; controller.flush(); } }}
        onDoubleClick={(event) => {
          if (disabled) return;
          event.preventDefault();
          dragRef.current = null;
          void controller.commit(null);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const next = personalRatingForKey(state.value, event.key);
          if (next === undefined) return;
          event.preventDefault();
          void controller.commit(next);
        }}
      >
        <span ref={starsRef} className="inline-flex gap-0.5" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => {
            const fill = Math.max(0, Math.min(2, (state.value ?? 0) - index * 2)) * 50;
            return <span key={index} data-rating-star className="relative block h-5 w-5">
              <Star className="h-5 w-5 text-stone-400" strokeWidth={1.6} />
              <span className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden text-amber-700" style={{ width: `${fill}%` }}>
                <Star className="h-5 w-5 max-w-none fill-current" strokeWidth={1.6} />
              </span>
            </span>;
          })}
        </span>
      </div>
      {!starsOnly && <span className="text-[10px] tabular-nums text-stone-500" aria-hidden="true">{state.value === null ? 'Unrated' : `${state.value / 2}/5`}</span>}
      <span role="status" className="text-[10px] text-stone-500">{state.saving ? 'Saving…' : ''}</span>
    </div>
    <span id={hintId} className="sr-only">Use arrow keys for half stars, Home for zero, End for five, or Delete to clear. Double-click to clear.</span>
    {state.error && <p id={errorId} role="alert" className="max-w-sm text-xs text-red-700">{state.error}</p>}
  </div>;
}

export function PersonalRating(props: PersonalRatingProps) {
  return <RatingForBook key={props.bookId} {...props} />;
}
