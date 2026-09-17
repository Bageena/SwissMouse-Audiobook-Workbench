import React, { useRef, useState, useEffect, useMemo } from 'react';
import { AlignedWord } from '../types';
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
  Upload,
  Radio,
  FileAudio,
  Sparkles,
  Info,
  CheckCircle2,
  Clock,
  Pin
} from 'lucide-react';

export interface ActiveAudioTrack {
  id: string;
  chapterIndex?: number;
  title: string;
  start: string; // HH:MM:SS.mmm
  seconds: number;
  snippetText?: string;
  contextBefore?: string;
  matchedText?: string;
  contextAfter?: string;
  words?: AlignedWord[];
  sourceType: 'chapter' | 'candidate';
}

interface ChapterAudioPlayerProps {
  activeTrack: ActiveAudioTrack | null;
  isPlaying: boolean;
  onPlay: (track: ActiveAudioTrack) => void;
  onPause: () => void;
  onStop: () => void;
  onWordClick?: (timestamp: string, word: string, seconds: number) => void;
  totalDurationSeconds: number;
  audioSrc: string;
}

export const ChapterAudioPlayer: React.FC<ChapterAudioPlayerProps> = ({
  activeTrack,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  onWordClick,
  totalDurationSeconds,
  audioSrc,
}) => {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(audioSrc);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(totalDurationSeconds || 60);
  const [volume, setVolume] = useState<number>(0.9);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [lastClickedWord, setLastClickedWord] = useState<{ word: string; timestamp: string } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastTrack = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Helper: Format seconds to HH:MM:SS
  const formatSec = (s: number): string => {
    const safe = Math.max(0, s);
    const hrs = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
    } catch {
      // AudioContext policy
    }
  };

  // Build aligned clickable words for the active track
  const alignedWordsData = useMemo(() => {
    if (!activeTrack) return null;
    if (activeTrack.words && activeTrack.words.length > 0) {
      return {
        words: activeTrack.words,
        matchedStartIndex: 0,
        matchedEndIndex: activeTrack.words.length - 1,
      };
    }

    return null;
  }, [activeTrack]);

  useEffect(() => {
    setAudioUrl(audioSrc);
  }, [audioSrc]);

  // Clean up only locally-created object URLs. The review source is an app URL.
  useEffect(() => {
    return () => {
      if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Handle user uploading local audiobook MP3
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(file);
      setAudioFile(file);
      setAudioUrl(url);

      if (activeTrack) {
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.currentTime = activeTrack.seconds;
            audioRef.current.play().catch(() => {});
          }
        }, 150);
      }
    }
  };

  // Synchronize playback when activeTrack or isPlaying changes
  useEffect(() => {
    if (!activeTrack) {
      if (isPlaying) onStop();
      return;
    }

    if (audioUrl && audioRef.current) {
      const audio = audioRef.current;
      audio.volume = isMuted ? 0 : volume;

      const trackKey = `${activeTrack.id}:${activeTrack.seconds}`;
      if (lastTrack.current !== trackKey) {
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

  }, [activeTrack?.id, activeTrack?.start, activeTrack?.seconds, isPlaying, audioUrl]);

  useEffect(() => { if(audioRef.current) audioRef.current.volume = isMuted ? 0 : volume; }, [volume,isMuted]);

  // Audio element events
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
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
  const handleSeekOffset = (offset: number) => {
    const nextTime = Math.min(duration, Math.max(0, currentTime + offset));
    setCurrentTime(nextTime);
    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = nextTime;
    }
  };

  // Word Click Handler: snaps chapter timestamp to this clicked word!
  const handleWordClicked = (wordItem: AlignedWord) => {
    playWordChime(880);
    setCurrentTime(wordItem.startSeconds);
    setLastClickedWord({
      word: wordItem.word,
      timestamp: wordItem.start,
    });

    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = wordItem.startSeconds;
      if (!isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }

    if (onWordClick) {
      onWordClick(wordItem.start, wordItem.word, wordItem.startSeconds);
    }
  };

  if (!activeTrack) {
    return (
      <div className="bg-stone-50 border border-stone-200/80 rounded-xl p-3 text-stone-500 text-xs flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center space-x-2">
          <Radio className="w-4 h-4 text-stone-400" />
          <span>
            Preview audio: use <strong className="text-stone-700">Listen ▶</strong> beside a chapter, then click a transcript word to place that chapter start precisely.
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <input
            type="file"
            ref={fileInputRef}
            accept="audio/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-white border border-stone-300 text-stone-700 hover:bg-stone-100 text-[11px] font-medium shadow-2xs cursor-pointer"
            title="Choose a local audio file to preview while editing chapters"
          >
            <Upload className="w-3.5 h-3.5 text-stone-500" />
            <span>Load Local MP3 for Real Audio</span>
          </button>
        </div>
      </div>
    );
  }

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

      {/* Track Header & Mode Badges */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-2.5 text-xs">
        <div className="flex items-center space-x-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isPlaying
                ? 'bg-amber-500 text-stone-950 animate-pulse'
                : 'bg-stone-100 text-stone-700'
            }`}
          >
            <Volume2 className="w-4 h-4" />
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-stone-900 text-sm tracking-tight">
                {activeTrack.title}
              </span>
              <span className="font-mono bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded text-[11px] font-semibold border border-stone-200">
                {activeTrack.start}
              </span>
            </div>
            <p className="text-[11px] text-stone-500 mt-0.5">
              {activeTrack.sourceType === 'candidate' ? 'Detected Candidate Mark' : 'Active Chapter Track'}
            </p>
          </div>
        </div>

        {/* Playback Mode Controls */}
        <div className="flex items-center space-x-2 text-xs">
          {audioFile ? (
            <div className="flex items-center space-x-1.5 bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded border border-emerald-200 text-[11px]">
              <FileAudio className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[140px]" title={audioFile.name}>
                {audioFile.name}
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 bg-emerald-50 text-emerald-900 px-2.5 py-1 rounded border border-emerald-200 text-[11px]">
              <FileAudio className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Actual merged audiobook audio</span>
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            accept="audio/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] border border-stone-200 cursor-pointer"
            title="Upload actual audiobook MP3 to listen directly to the narrator"
          >
            <Upload className="w-3 h-3 text-stone-500" />
            <span>{audioFile ? 'Change MP3' : 'Use MP3 File'}</span>
          </button>
        </div>
      </div>

      {/* Interactive Transcribe / Word Alignment Section (Click any word to update timestamp) */}
      <div className="bg-stone-50 rounded-lg p-3 border border-stone-200 text-xs space-y-2">
        <div className="flex items-center justify-between text-[11px] text-stone-500 border-b border-stone-200 pb-1.5">
          <div className="flex items-center space-x-1.5 text-stone-900 font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>Interactive Transcription Window</span>
          </div>

          <div className="flex items-center space-x-2">
            {lastClickedWord && (
              <span className="text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center space-x-1 text-[10px] animate-fadeIn">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span>
                  Snapped to <strong>"{lastClickedWord.word}"</strong> ({lastClickedWord.timestamp})
                </span>
              </span>
            )}
            <span className="text-stone-500 text-[10px] hidden sm:inline">
              Click a word to move the active chapter start to that exact moment
            </span>
          </div>
        </div>

        {/* Word Chips Flow */}
        <div className="flex flex-wrap gap-1 leading-relaxed max-h-40 overflow-y-auto pr-1 py-1">
          {alignedWordsData && alignedWordsData.words.length > 0 ? (
            alignedWordsData.words.map((w, idx) => {
              const isMatchedWord =
                idx >= alignedWordsData.matchedStartIndex && idx <= alignedWordsData.matchedEndIndex;
              const isSelectedWord = lastClickedWord?.timestamp === w.start;

              return (
                <button
                  key={`${w.start}-${idx}`}
                  type="button"
                  onClick={() => handleWordClicked(w)}
                  className={`group relative inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-sans transition-all cursor-pointer ${
                    isSelectedWord
                      ? 'bg-amber-500 text-stone-950 font-bold ring-2 ring-amber-300 scale-105 shadow-xs'
                      : isMatchedWord
                      ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 font-medium'
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
            <div className="text-stone-500 text-[11px] italic">
              {activeTrack.snippetText || 'No transcription segment available.'}
            </div>
          )}
        </div>
      </div>

      {/* Main Transport & Timeline Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        {/* Play / Pause / Seek Buttons */}
        <div className="flex items-center space-x-2">
          <button
            id="btn-player-seek-back"
            onClick={() => handleSeekOffset(-5)}
            className="p-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 cursor-pointer transition-colors"
            title="Rewind 5 seconds"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            id="btn-player-toggle-play"
            onClick={() => {
              if (isPlaying) onPause();
              else onPlay(activeTrack);
            }}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold flex items-center space-x-1.5 shadow-sm transition-transform active:scale-95 cursor-pointer"
            title={isPlaying ? 'Pause Chapter Preview' : 'Play Chapter Preview'}
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-stone-950" />
                <span className="text-xs">Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-stone-950" />
                <span className="text-xs">Play</span>
              </>
            )}
          </button>

          <button
            id="btn-player-seek-fwd"
            onClick={() => handleSeekOffset(5)}
            className="p-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 cursor-pointer transition-colors"
            title="Forward 5 seconds"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <button
            id="btn-player-stop"
            onClick={onStop}
            className="p-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-500 hover:text-red-600 cursor-pointer transition-colors"
            title="Stop & Dismiss Player"
          >
            <Square className="w-4 h-4" />
          </button>
        </div>

        {/* Timestamp Scrubber & Display */}
        <div className="flex-1 flex items-center space-x-3 px-2">
          <span className="font-mono text-xs text-amber-700 font-semibold">
            {formatSec(currentTime)}
          </span>

          <div className="flex-1 relative flex items-center">
            <input
              type="range"
              min={0}
              max={duration}
              step="0.5"
              value={currentTime}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setCurrentTime(val);
                if (audioRef.current && audioUrl) {
                  audioRef.current.currentTime = val;
                }
              }}
              className="w-full h-1.5 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
            />
          </div>

          <span className="font-mono text-xs text-stone-500">
            {formatSec(duration)}
          </span>
        </div>

        {/* Volume Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-1 text-stone-500 hover:text-stone-800 cursor-pointer"
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
            title="Volume"
          />
        </div>
      </div>
    </div>
  );
};
