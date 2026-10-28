import { Play, Pause, Square, SkipBack, SkipForward, RotateCcw, RotateCw } from 'lucide-react';

export function MiniPlayerControls({ playing, onTogglePlay, onStop, onPrevious, onNext, disabled = false, playDisabled = false, busy = false, showSkipControls = false, onSkip, label = 'audiobook' }: {
  playing: boolean; onTogglePlay: () => void; onStop: () => void; onPrevious?: () => void; onNext?: () => void;
  disabled?: boolean; playDisabled?: boolean; busy?: boolean; showSkipControls?: boolean; onSkip?: (seconds: number) => void; label?: string;
}) {
  const control = 'quick-player-control inline-flex shrink-0 items-center justify-center rounded border border-stone-300 text-stone-800 hover:bg-stone-50';
  // A brief source check blocks input without flashing otherwise available controls.
  const appearance = (unavailable: boolean) => `${control}${unavailable ? ' opacity-50' : ''}`;
  return <div className="mini-player-controls quick-player-buttons flex shrink-0 items-center gap-1">
    <button type="button" className={appearance(disabled || !onPrevious)} disabled={busy || disabled || !onPrevious} aria-label="Previous chapter" title="Previous chapter" onClick={onPrevious}><SkipBack aria-hidden="true" /></button>
    {showSkipControls && <button type="button" className={appearance(disabled || !onSkip)} disabled={busy || disabled || !onSkip} aria-label="Rewind 5 seconds" title="Rewind 5 seconds" onClick={() => onSkip?.(-5)}><RotateCcw aria-hidden="true" /></button>}
    <button type="button" className={appearance(playDisabled && !busy)} disabled={busy || playDisabled} aria-label={`${playing ? 'Pause' : 'Play'} ${label}`} title={playing ? 'Pause' : 'Play'} onClick={onTogglePlay}>
      {playing ? <Pause aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" fill="currentColor" />}
    </button>
    <button type="button" className={appearance(disabled)} disabled={busy || disabled} aria-label={`Stop ${label} playback`} title="Stop and return to beginning" onClick={onStop}><Square aria-hidden="true" fill="currentColor" /></button>
    {showSkipControls && <button type="button" className={appearance(disabled || !onSkip)} disabled={busy || disabled || !onSkip} aria-label="Forward 5 seconds" title="Forward 5 seconds" onClick={() => onSkip?.(5)}><RotateCw aria-hidden="true" /></button>}
    <button type="button" className={appearance(disabled || !onNext)} disabled={busy || disabled || !onNext} aria-label="Next chapter" title="Next chapter" onClick={onNext}><SkipForward aria-hidden="true" /></button>
  </div>;
}
