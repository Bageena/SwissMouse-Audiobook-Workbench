import React from 'react';
import type { AudiobookJob } from '../types';
import { formatTimestamp, missingWordTimestampSegments } from '../utils/wordAlignment';

export function TranscriptTimingWarning({ segments }: { segments: AudiobookJob['transcriptSegments'] }): React.JSX.Element | null {
  const missing = missingWordTimestampSegments(segments || []);
  if (!missing.length) return null;
  return <details className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
    <summary className="cursor-pointer font-semibold">Word timestamps missing in {missing.length} transcript {missing.length === 1 ? 'segment' : 'segments'}</summary>
    <p className="mt-2">The text is saved below. These are segment time ranges, not word timings. Available timed words remain usable; review these passages manually when setting chapter boundaries.</p>
    <ol className="mt-2 max-h-64 overflow-y-auto space-y-3" aria-label="Segments without word timestamps">
      {missing.map((segment, index) => <li key={`${segment.id}:${index}`}>
        <span className="font-mono text-xs">{formatTimestamp(segment.start)} – {formatTimestamp(segment.end)}</span>
        <p className="break-words">{segment.text}</p>
      </li>)}
    </ol>
  </details>;
}
