import { DesktopWindow } from './DesktopWorkspace';
import { MiniPlayerSeek } from './MiniPlayerSeek';
import { MiniPlayerControls } from './MiniPlayerControls';
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { AlignedWord } from '../types';
import { AudioWaveform, WaveformMarker } from './AudioWaveform';
import { playbackTranscriptWindow, revealTranscriptWord } from '../utils/wordAlignment';
import { formatTimestampMs } from '../utils/chapters';
import { Volume2, VolumeX, Sparkles, CheckCircle2, Clock, MapPin, Plus, ChevronsDown, ChevronsUp } from 'lucide-react';

export interface ActiveAudioTrack {
  id: string;
  chapterIndex?: number;
  title: string;
  start: string; // HH:MM:SS.mmm
  seconds: number;
  stopSeconds?: number;
  seekRevision?: number;
  snippetText?: string;
  contextBefore?: string;
  matchedText?: string;
  contextAfter?: string;
  words?: AlignedWord[];
  sourceType: 'chapter' | 'candidate' | 'transcript';
}

interface ChapterAudioPlayerProps {
  transcriptWords: AlignedWord[];
  activeTrack: ActiveAudioTrack | null;
  isPlaying: boolean;
  onPlay: (track: ActiveAudioTrack) => void;
  onPause: () => void;
  onStop: () => void;
  onWordClick?: (timestamp: string, word: string, seconds: number) => void;
  totalDurationSeconds: number;
  audioSrc: string;
  waveformSrc?: string;
  chapterMarkers?: WaveformMarker[];
  onChapterMarker?: (id: string) => void;
  onSeek?: (seconds: number) => void;
  onPlaybackTime?: (seconds: number) => void;
  timestampTarget?: string;
  selectedChapterId?: string;
  onSetTimestamp?: (seconds: number) => void;
  onAddChapter?: (seconds: number) => void;
}

export const ChapterAudioPlayer: React.FC<ChapterAudioPlayerProps> = ({
  transcriptWords,
  activeTrack,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  onWordClick,
  totalDurationSeconds,
  audioSrc,
  waveformSrc,
  chapterMarkers = [],
  onChapterMarker = () => {},
  onSeek,
  onPlaybackTime,
  timestampTarget,
  selectedChapterId,
  onSetTimestamp,
  onAddChapter,
}) => {
  const audioUrl = audioSrc;
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(totalDurationSeconds || 60);
  const [volume, setVolume] = useState<number>(0.9);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [lastClickedWord, setLastClickedWord] = useState<{ word: string; timestamp: string } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastTrack = useRef<string>('');
  const wordPane = useRef<HTMLDivElement>(null);
  const highlightedWord = useRef<HTMLButtonElement>(null);

  // Play audio chime using Web Audio API for auditory feedback on clicks
  const playWordChime = (pitch: number = 740) => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(pitch * 1.25, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.08 * (isMuted ? 0 : volume), ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.2);
      osc.onended = () => { void ctx.close(); };
    } catch {
      // AudioContext policy
    }
  };

  // Derive words from the live playhead, including waveform seeks and end edits.
  const words = transcriptWords.length ? transcriptWords : activeTrack?.words || [];
  const windowPosition = playbackTranscriptWindow(words, currentTime);
  const visibleWords = useMemo(() => words.slice(windowPosition.offset, windowPosition.offset + 400), [words, windowPosition.offset]);
  useEffect(() => {
    if (wordPane.current && highlightedWord.current) {
      revealTranscriptWord(wordPane.current, highlightedWord.current);
      const lineHeight = highlightedWord.current.offsetHeight + (parseFloat(getComputedStyle(wordPane.current).rowGap) || 0);
      if (lineHeight) wordPane.current.scrollTop = Math.round(wordPane.current.scrollTop / lineHeight) * lineHeight;
    }
  }, [windowPosition.active, windowPosition.offset, transcriptExpanded]);

  // Native timeupdate remains a fallback; sample playback at 12.5 Hz for words.
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0, last = 0;
    const update = (now: number) => {
      if (now - last >= 80 && audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
        last = now;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  // Synchronize playback when activeTrack or isPlaying changes
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      const audio = audioRef.current;
      audio.volume = isMuted ? 0 : volume;

      const trackKey = activeTrack ? `${activeTrack.id}:${activeTrack.seconds}:${activeTrack.seekRevision ?? 0}` : '';
      if (activeTrack && lastTrack.current !== trackKey) {
        audio.currentTime = activeTrack.seconds;
        setCurrentTime(activeTrack.seconds);
        lastTrack.current = trackKey;
      }
      if (isPlaying) {
        audio.play().catch((e) => {
          console.warn('Playback error:', e);
        });
      } else {
        audio.pause();
      }
      return;
    }

  }, [activeTrack?.id, activeTrack?.start, activeTrack?.seconds, activeTrack?.seekRevision, isPlaying, audioUrl]);

  useEffect(() => { if(audioRef.current) audioRef.current.volume = isMuted ? 0 : volume; }, [volume,isMuted]);

  // Audio element events
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      if (isPlaying && activeTrack?.stopSeconds !== undefined && audioRef.current.currentTime >= activeTrack.stopSeconds) {
        audioRef.current.pause();
        onPause();
      }
      setCurrentTime(audioRef.current.currentTime);
      onPlaybackTime?.(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || totalDurationSeconds);
      if (activeTrack) {
        audioRef.current.currentTime = activeTrack.seconds;
        setCurrentTime(activeTrack.seconds);
      }
    }
  };

  // Nudge playback -5s or +5s
  const [waveformSeekRevision, setWaveformSeekRevision] = useState(0);
  const seekTo = (seconds: number) => {
    const nextTime = Math.min(duration, Math.max(0, seconds));
    setCurrentTime(nextTime);
    setWaveformSeekRevision(revision => revision + 1);
    if (audioRef.current && audioUrl) audioRef.current.currentTime = nextTime;
    onSeek?.(nextTime);
  };
  const captureTimestamp = () => onSetTimestamp?.(audioRef.current?.currentTime ?? currentTime);
  const addChapterHere = () => onAddChapter?.(audioRef.current?.currentTime ?? currentTime);
  const handleSeekOffset = (offset: number) => {
    seekTo(currentTime + offset);
  };

  // Word Click Handler: snaps chapter timestamp to this clicked word!
  const handleWordClicked = (wordItem: AlignedWord) => {
    playWordChime(880);
    seekTo(wordItem.startSeconds);
    setLastClickedWord({
      word: wordItem.word,
      timestamp: wordItem.start,
    });

    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = wordItem.startSeconds;
      if (!isPlaying) {
        if (activeTrack) onPlay(activeTrack);
      }
    }

    if (onWordClick) {
      onWordClick(wordItem.start, wordItem.word, wordItem.startSeconds);
    }
  };

  return (
    <div className="bg-white text-stone-900 rounded-xl p-4 shadow-md border border-stone-200 space-y-3">
      {/* Hidden Audio Element for actual files */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => onPause()}
        />
      )}

      <div className="min-w-0 space-y-2">
      {/* Interactive Transcribe / Word Alignment Section (Click any word to update timestamp) */}
      <DesktopWindow id="interactive-transcription" title="Interactive Transcription Window" homeWindow="chapter-player" variant="compact" minimumWidth={160}>
      <section className="interactive-transcription" data-expanded={transcriptExpanded}>
        <header className="workspace-panel-header interactive-transcription-header">
          <div className="flex min-w-0 items-center gap-1">
            <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
            <h3 className="workspace-panel-title" title="Click a word to move the selected chapter start to that exact moment">Interactive Transcription Window</h3>
          </div>
          <div role="toolbar" aria-label="Interactive transcription tools" className="interactive-transcription-tools">
            {lastClickedWord && <span role="status" title={`Snapped to "${lastClickedWord.word}" (${lastClickedWord.timestamp})`}>
              <CheckCircle2 className="h-3 w-3 text-emerald-700" aria-hidden="true" />
              <span className="sr-only">Snapped to "{lastClickedWord.word}" ({lastClickedWord.timestamp})</span>
            </span>}
            <button type="button" className="workspace-header-toggle interactive-transcription-toggle" aria-expanded={transcriptExpanded} aria-controls="interactive-transcription-words"
              aria-label={transcriptExpanded ? 'Show one line of transcription' : 'Show ten lines of transcription'}
              title={transcriptExpanded ? 'Collapse to one line' : 'Expand to ten lines'}
              onClick={() => setTranscriptExpanded(expanded => !expanded)}>
              {transcriptExpanded ? <ChevronsUp aria-hidden="true" /> : <ChevronsDown aria-hidden="true" />}
            </button>
          </div>
        </header>

        <div id="interactive-transcription-words" ref={wordPane} className="interactive-transcription-words" aria-label="Interactive transcription words">
          {visibleWords.length > 0 ? (
            visibleWords.map((w, idx) => {
              const isSelectedWord = windowPosition.active === windowPosition.offset + idx;

              return (
                <button
                  key={`${w.start}-${windowPosition.offset + idx}`}
                  ref={isSelectedWord ? highlightedWord : undefined}
                  aria-current={isSelectedWord ? 'true' : undefined}
                  type="button"
                  onClick={() => handleWordClicked(w)}
                  className={`interactive-transcription-word group relative inline-flex items-center font-sans cursor-pointer ${
                    isSelectedWord
                      ? 'transcript-word-active font-bold'
                      : 'bg-white text-stone-700 hover:bg-stone-200 hover:text-stone-900 border border-stone-200'
                  }`}
                  title={`Click to set timestamp to ${w.start}`}
                >
                  <span>{w.word}</span>

                  {/* Micro timestamp popup on hover */}
                  <span className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:flex items-center space-x-1 bg-stone-900 text-amber-300 text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg border border-stone-700 whitespace-nowrap z-20 pointer-events-none">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{w.start}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="interactive-transcription-empty text-stone-500 text-[11px] italic">
              {activeTrack?.snippetText || 'No transcription segment available.'}
            </div>
          )}
        </div>
      </section>
      </DesktopWindow>

      <AudioWaveform url={audioUrl === audioSrc ? waveformSrc : undefined}
        seekRevision={waveformSeekRevision} duration={duration} currentTime={currentTime} playing={isPlaying} audioRef={audioRef}
        markers={chapterMarkers} selectedId={selectedChapterId}
        onSeek={seekTo} onMarker={onChapterMarker} />
        <MiniPlayerSeek position={currentTime} duration={duration} onSeek={seekTo} label="Playback position"
          disabled={!audioUrl} formatTime={seconds => formatTimestampMs(seconds * 1000)}
          chapters={chapterMarkers.map(marker => ({ title: marker.title, startSeconds: marker.seconds }))} />
      </div>

      {/* Main Transport & Timeline Controls */}
      <div role="toolbar" aria-label="Audio player controls" className="mini-player-controls flex flex-wrap items-center justify-between gap-2 pt-1">
        {/* Play / Pause / Seek Buttons */}
        <div className="mini-player-controls flex flex-wrap items-center gap-2">
          <MiniPlayerControls playing={isPlaying} label="chapter preview" showSkipControls onSkip={handleSeekOffset}
            disabled={!audioUrl} playDisabled={!audioUrl}
            onTogglePlay={() => { if (isPlaying) onPause(); else onPlay(activeTrack || { id: 'project-audio', title: 'Audiobook audio', start: formatTimestampMs(currentTime * 1000), seconds: currentTime, sourceType: 'transcript' }); }}
            onStop={() => { seekTo(0); onStop(); }}
            onPrevious={chapterMarkers.length ? () => { const previous = [...chapterMarkers].reverse().find(marker => marker.seconds < currentTime - .5) || chapterMarkers[0]; onChapterMarker(previous.id); } : undefined}
            onNext={chapterMarkers.some(marker => marker.seconds > currentTime + .5) ? () => { const next = chapterMarkers.find(marker => marker.seconds > currentTime + .5); if (next) onChapterMarker(next.id); } : undefined} />
          {timestampTarget && onSetTimestamp && (
            <div className="flex items-center gap-2 border-l border-stone-200 pl-2">
              <button type="button" onClick={captureTimestamp}
                className="quick-player-control inline-flex items-center justify-center rounded border border-stone-300 text-stone-800 hover:bg-stone-50"
                aria-label="Set Chapter Start"
                title={`Set ${timestampTarget} start to the player's current position`}>
                <MapPin aria-hidden="true" />
              </button>
            </div>
          )}
          {onAddChapter && <button type="button" onClick={addChapterHere}
            className="quick-player-control inline-flex items-center justify-center rounded border border-stone-300 text-stone-800 hover:bg-stone-50"
            aria-label="Add Chapter Here"
            title="Add a chapter at the player's current position"><Plus aria-hidden="true" /></button>}
        </div>




        {/* Volume Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="quick-player-control inline-flex items-center justify-center rounded border border-stone-300 text-stone-800 hover:bg-stone-50"
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVolume(val);
              setIsMuted(false);
              if (audioRef.current) audioRef.current.volume = val;
            }}
            className="w-16 h-1.5 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
            aria-label="Volume" title="Volume"
          />
        </div>
      </div>
    </div>
  );
};
