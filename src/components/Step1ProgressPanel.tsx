import React, { useState } from 'react';
import { Step1ProcessState } from '../types';
import {
  RefreshCw,
  XCircle,
  CheckCircle2,
  AlertCircle,
  FileAudio,
  Radio,
  Sparkles,
  Terminal,
  Clock,
  Check,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';

interface Step1ProgressPanelProps {
  progress: Step1ProcessState;
  onCancel: () => void;
  onDismissSummary?: () => void;
}

export const Step1ProgressPanel: React.FC<Step1ProgressPanelProps> = ({
  progress,
  onCancel,
  onDismissSummary,
}) => {
  const [showLogs, setShowLogs] = useState<boolean>(false);

  // Stages breakdown
  const stages = [
    { key: 'scanning', label: '1. Scan & Verify Source', desc: 'Inspect local audio files and verify formats' },
    { key: 'probing', label: '2. Probing Audio Streams', desc: 'FFprobe sample rates, bitrates, and durations' },
    { key: 'merging', label: '3. Audio Merge', desc: 'PCM decode or quick stream-copy stitch' },
    { key: 'transcribing', label: '4. Speech Recognition', desc: 'Local Whisper transcription' },
    { key: 'detecting_chapters', label: '5. Chapter Candidate Detection', desc: 'Phoneme alignment & title token extraction' },
    { key: 'completed', label: '6. Review Ready', desc: 'Prepare markers for Step 2 human review' },
  ];

  const getStageStatus = (stageIndex: number) => {
    const currentNum = progress.currentStageNumber;
    if (progress.stage === 'error') {
      if (stageIndex === currentNum - 1) return 'error';
      if (stageIndex < currentNum - 1) return 'done';
      return 'pending';
    }
    if (progress.stage === 'completed') return 'done';
    if (stageIndex < currentNum - 1) return 'done';
    if (stageIndex === currentNum - 1) return 'active';
    return 'pending';
  };

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      id="step1-progress-feedback-panel"
      className="bg-white rounded-xl border border-amber-300 shadow-md p-5 space-y-4 transition-all animate-in fade-in slide-in-from-top-2"
    >
      {/* Top Title & Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-stone-100">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${
            progress.stage === 'error'
              ? 'bg-red-100 text-red-700'
              : progress.stage === 'completed'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-800'
          }`}>
            {progress.stage === 'error' ? (
              <XCircle className="w-5 h-5" />
            ) : progress.stage === 'completed' ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <RefreshCw className="w-5 h-5 animate-spin" />
            )}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-stone-900">
                {progress.stage === 'completed'
                  ? 'Step 1 Processing Complete'
                  : progress.stage === 'error'
                  ? 'Step 1 Processing Error'
                  : progress.label || 'Processing Step 1 Audio'}
              </h3>
              {progress.isActive && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                  Stage {progress.currentStageNumber} of {progress.totalStages}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              {progress.currentTask || progress.liveStatusMessage}
            </p>
          </div>
        </div>

        {/* Action button & timer */}
        <div className="flex items-center space-x-3 self-end sm:self-auto">
          {progress.isActive && progress.elapsedSeconds > 0 && (
            <div className="flex items-center space-x-1 text-xs text-stone-500 font-mono">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatElapsed(progress.elapsedSeconds)}</span>
            </div>
          )}

          {progress.canCancel && !progress.isCancelling && (
            <button
              id="btn-step1-cancel"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
              title="Cancel processing and preserve project state"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Cancel Processing</span>
            </button>
          )}

          {progress.isCancelling && (
            <span className="text-xs font-semibold text-stone-500 animate-pulse">
              Cancelling safely...
            </span>
          )}

          {progress.stage === 'completed' && onDismissSummary && (
            <button
              onClick={onDismissSummary}
              className="px-3 py-1 text-xs font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded cursor-pointer"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar & Percentage */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-stone-700">
            {progress.stage === 'completed' ? 'Extraction 100% finished' : progress.label}
          </span>
          <span className="font-mono font-bold text-amber-800 text-sm">
            {progress.percentage}%
          </span>
        </div>
        <div className="w-full bg-stone-100 rounded-full h-3 overflow-hidden border border-stone-200">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              progress.stage === 'completed'
                ? 'bg-emerald-600'
                : progress.stage === 'error'
                ? 'bg-red-500'
                : 'bg-amber-600'
            }`}
            style={{ width: `${Math.max(5, progress.percentage)}%` }}
          />
        </div>
      </div>

      {/* Step Sequence Indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1">
        {stages.map((stg, idx) => {
          const status = getStageStatus(idx);
          return (
            <div
              key={stg.key}
              className={`p-2 rounded-lg border text-left space-y-1 transition-all ${
                status === 'done'
                  ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                  : status === 'active'
                  ? 'bg-amber-50 border-amber-400 text-amber-950 shadow-xs ring-1 ring-amber-400/50'
                  : status === 'error'
                  ? 'bg-red-50 border-red-300 text-red-950'
                  : 'bg-stone-50 border-stone-200 text-stone-400 opacity-70'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-tight uppercase truncate">
                  Stage {idx + 1}
                </span>
                {status === 'done' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
                ) : status === 'active' ? (
                  <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" />
                ) : status === 'error' ? (
                  <XCircle className="w-3 h-3 text-red-600" />
                ) : null}
              </div>
              <p className={`text-[11px] font-semibold leading-tight line-clamp-1 ${
                status === 'active' ? 'text-amber-900' : ''
              }`}>
                {stg.label.split('. ')[1]}
              </p>
            </div>
          );
        })}
      </div>

      {/* Error display if any */}
      {progress.error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 space-y-1">
          <div className="font-semibold flex items-center space-x-1.5">
            <XCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>Processing Interrupted</span>
          </div>
          <p className="text-[11px] leading-relaxed">{progress.error}</p>
        </div>
      )}

      {/* Completion Summary Card */}
      {progress.summary && (
        <div className="p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-lg text-xs text-emerald-950 space-y-2">
          <div className="flex items-center space-x-2 font-bold text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Processing Summary</span>
          </div>
          <div className="text-[11px] bg-white/70 p-2.5 rounded border border-emerald-100 text-stone-800 leading-relaxed font-mono">
            {typeof progress.summary === 'object' ? (
              <div className="space-y-1">
                <div>Total Files: {progress.summary.totalFilesProcessed}</div>
                <div>Chapters Found: {progress.summary.chaptersFound}</div>
                <div>Model Used: {progress.summary.modelUsed}</div>
                <div>Words Transcribed: {progress.summary.wordsTranscribed}</div>
              </div>
            ) : (
              progress.summary
            )}
          </div>
        </div>
      )}

      {/* Live Log Stream Toggle */}
      {progress.logs && progress.logs.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center space-x-1.5 text-xs text-stone-600 hover:text-stone-900 font-medium cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-stone-500" />
            <span>{showLogs ? 'Hide live terminal log' : `Show live log stream (${progress.logs.length} entries)`}</span>
            {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showLogs && (
            <div className="bg-stone-100 text-stone-800 p-3 rounded-lg font-mono text-[11px] max-h-36 overflow-y-auto space-y-0.5 border border-stone-200 shadow-inner">
              {progress.logs.map((logLine, idx) => (
                <div key={idx} className="leading-relaxed">
                  {logLine}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
