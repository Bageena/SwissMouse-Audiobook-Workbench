import React from 'react';
import {
  Folder,
  Video,
  Clock,
  HardDrive,
  FileAudio,
  Layers,
  Sparkles,
  CheckCircle2,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import { SourceSummaryData } from '../types';

interface SourceSummaryProps {
  summary: SourceSummaryData;
  onResetSource?: () => void;
}

export const SourceSummary: React.FC<SourceSummaryProps> = ({
  summary,
  onResetSource,
}) => {
  const isYouTube = summary.inputMethod === 'youtube';

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  };

  return (
    <div
      id="source-summary-panel"
      className="bg-white border border-stone-200/80 rounded-xl p-5 shadow-xs relative overflow-hidden"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3.5 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            {isYouTube ? <Video className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                Audio source selected
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                {isYouTube ? 'YouTube Import' : 'Local Folder'}
              </span>
            </div>
            <p className="text-xs text-stone-600 font-mono truncate max-w-md sm:max-w-lg mt-0.5" title={summary.sourcePath}>
              {summary.sourcePath}
            </p>
          </div>
        </div>

        {onResetSource && (
          <button
            type="button"
            onClick={onResetSource}
            className="self-start sm:self-center px-2.5 py-1.5 rounded-md bg-stone-100 hover:bg-stone-200 text-stone-700 hover:text-stone-900 text-xs flex items-center gap-1.5 transition-colors border border-stone-200 font-medium"
          >
            <RefreshCw className="w-3 h-3" />
            Choose different audio
          </button>
        )}
      </div>

      {/* Grid of Key Source Attributes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Audio Formats */}
        <div className="bg-stone-50/50 border border-stone-200/80 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-stone-500 text-xs mb-1">
            <FileAudio className="w-3.5 h-3.5 text-amber-600" />
            <span>Format(s)</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {summary.formatsDetected.map(fmt => (
              <span
                key={fmt}
                className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-mono text-xs uppercase font-semibold"
              >
                {fmt}
              </span>
            ))}
          </div>
        </div>

        {/* Audio Files Count */}
        <div className="bg-stone-50/50 border border-stone-200/80 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-stone-500 text-xs mb-1">
            <Layers className="w-3.5 h-3.5 text-amber-600" />
            <span>Audio Files</span>
          </div>
          <div className="text-sm font-semibold text-stone-900 mt-1">
            {summary.totalFiles} {summary.totalFiles === 1 ? 'file' : 'files'}
          </div>
        </div>

        {/* Duration */}
        <div className="bg-stone-50/50 border border-stone-200/80 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-stone-500 text-xs mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Total Duration</span>
          </div>
          <div className="text-sm font-semibold text-stone-900 mt-1 font-mono">
            {formatTime(summary.totalDurationSeconds)}
          </div>
        </div>

        {/* Chapter Workflow */}
        <div className="bg-stone-50/50 border border-stone-200/80 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-stone-500 text-xs mb-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>Chapter method</span>
          </div>
          <div className="text-xs font-semibold text-stone-900 mt-1 truncate" title={summary.chapterWorkflow === 'existing_files' ? 'Pre-split files as chapters' : 'Whisper AI detection'}>
            {summary.chapterWorkflow === 'existing_files' ? 'Files and folders' : 'AI speech detection'}
          </div>
        </div>
      </div>
    </div>
  );
};
