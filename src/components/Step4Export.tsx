import { PreviewPanel } from './PreviewPanel';
import { conversionComplete } from '../utils/conversionWorkflow';
import React, { useRef, useState } from 'react';
import { DesktopWindow } from './DesktopWorkspace';
import { createPortal } from 'react-dom';
import { ArrowRight, Play, FileAudio, Loader2 } from 'lucide-react';
import { AudiobookJob, WorkbenchConfig, OutputAudioFormat } from '../types';
import { outputFormats, canCopy, chapterSupport, bitrateOptions, defaultBitrate } from '../audioFormats';
import { useDependencyStatus } from '../dependency-status';
import { planChapterExport } from '../utils/chapterExport';

interface Step4Props {
  actionHost?: HTMLElement | null;
  job: AudiobookJob;
  config: WorkbenchConfig;
  onBuildM4b: (formats: OutputAudioFormat[], convert: boolean, cue: boolean, bitrates: Partial<Record<OutputAudioFormat, number>>, zipOriginals?: boolean) => Promise<void>;
  pendingChapterChanges?: boolean;
  isBuilding: boolean;
  progressMessage?: string;
  error: string | null;
  onNextStep: (runCheck?: boolean) => void;
}

const formatName = (format: OutputAudioFormat) => format.toUpperCase();

export const Step4Export: React.FC<Step4Props> = ({ actionHost, job, config, onBuildM4b, pendingChapterChanges, isBuilding, progressMessage, error, onNextStep }) => {
  const exportAvailability = useDependencyStatus().feature('audio_export');
  const [selected, setSelected] = useState<OutputAudioFormat[]>([job.mergeMethod === 'skip' && outputFormats.includes(job.sourceFormat as OutputAudioFormat) ? job.sourceFormat as OutputAudioFormat : 'm4b']);
  const [convert, setConvert] = useState(false);
  const [zipOriginals, setZipOriginals] = useState(false);
  const [bitrates, setBitrates] = useState<Partial<Record<OutputAudioFormat, number>>>({});
  const recommended = defaultBitrate(job.sourceBitrate);
  let removedSeconds = 0;
  try { removedSeconds = planChapterExport(job.chapters, job.totalDurationSeconds).removedSeconds; } catch { /* Export validates incomplete chapters. */ }
  const requiresTrimming = removedSeconds > 0;
  const chaptersAreStale = job.staleSteps?.some(step => step === 'chapter_detection' || step === 'chapter_review') ?? false;
  const exportedCoverPath = job.exports?.find(item => item.status === 'success' && item.coverPath)?.coverPath;
  const toggleFormat = (format: OutputAudioFormat) => setSelected(current => current.includes(format) ? current.filter(item => item !== format) : [...current, format]);

  const optionsKey = JSON.stringify({ selected, convert, zipOriginals, saveCover: config.save_cover_beside_audio !== false, bitrates: selected.map(format => convert ? bitrates[format] ?? recommended : recommended), sourceKey: job.sourceKey });
  const submittedOptions = useRef(optionsKey);
  const complete = optionsKey === submittedOptions.current && !pendingChapterChanges && !chaptersAreStale && conversionComplete(job.exports, selected, isBuilding, error);
  const sourceQuality = [job.sourceFormat?.toUpperCase(), job.sourceCodec, job.sourceBitrate ? `${job.sourceBitrate} kbps` : undefined].filter(Boolean).join(' · ') || 'Unknown';
  const runConversion = () => {
    submittedOptions.current = optionsKey;
    return onBuildM4b(selected, convert, true, convert ? Object.fromEntries(outputFormats.map(format => [format, bitrates[format] ?? recommended])) : {}, zipOriginals);
  };

  const createAction = <span className="processing-model-action" role="group" aria-label="Conversion controls">
    <button type="button" id="btn-create-audiobook" className="processing-model-action-icon" aria-label={isBuilding ? 'Converting' : 'Convert'}
      title="Convert" disabled={chaptersAreStale || !exportAvailability.ready || isBuilding || !selected.length || !job.mergedMp3 || !job.chapters.length} onClick={() => void runConversion()}>
      {isBuilding ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
    </button>
  </span>;
  const headerActions = <div className="conversion-header-actions flex flex-wrap items-center justify-end gap-3">
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs" title="Save Originals.zip beside the finished audiobook. SwissMouse verifies the archive before removing original audio; originals are kept if verification fails.">
      <input type="checkbox" checked={zipOriginals} disabled={isBuilding} onChange={event => setZipOriginals(event.target.checked)} className="h-4 w-4 accent-amber-700" />
      ZIP originals
    </label>
    {createAction}
  </div>;
  const nextAction = <div className="flex justify-end"><button type="button" aria-label={complete ? 'Run Final Check' : 'Continue to final check'} disabled={isBuilding} onClick={() => onNextStep(complete)}
    title={job.outputM4b ? 'Review the finished audiobook' : 'Skip conversion and review the original audio'}
    className="paper-action-dark inline-flex items-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-40">
    {complete ? 'Run Final Check' : 'Continue to final check'}<ArrowRight className="h-4 w-4" aria-hidden="true" />
  </button></div>;

  return (<>
    {actionHost ? createPortal(nextAction, actionHost) : nextAction}
    <PreviewPanel id="conversion-workflow" title="Workflow">
      <div className="space-y-2 text-xs">
        <p role="status" className="font-semibold">{isBuilding ? 'Converting…' : complete ? 'Conversion complete' : error ? 'Conversion needs attention' : 'Ready to convert'}</p>
        {complete ? <p>{selected.map(formatName).join(', ')} created.</p> : <>
          <ul aria-label="Selected conversion options" className="list-disc list-inside space-y-1">
            {selected.length ? selected.map(format => {
              const copy = !requiresTrimming && !convert && canCopy(job.sourceCodec || '', format);
              return <li key={format}>{formatName(format)} · {copy ? 'Original audio' : ['flac', 'wav'].includes(format) ? 'Lossless conversion' : `${convert ? bitrates[format] ?? recommended : recommended} kbps conversion`}</li>;
            }) : <li>No formats selected</li>}
          </ul>
          <ul aria-label="Selected advanced export options" className="space-y-1">
            <li>{convert ? 'Manual encoding' : 'Auto · keep original audio when possible'}</li>
            <li>Cover image: {config.save_cover_beside_audio !== false ? 'Save beside audiobook' : 'Embedded only'}</li>
            <li>Originals: {zipOriginals ? 'Archive as ZIP' : 'Keep in place'}</li>
            {requiresTrimming && <li>Trim excluded audio: {removedSeconds.toFixed(3)} seconds</li>}
          </ul>
        </>}
      </div>
      <div className="mt-3 border-t border-stone-300/60 pt-2 text-xs"><p className="font-semibold">Source Quality</p><p>{sourceQuality}</p></div>
    </PreviewPanel>
    <DesktopWindow id="export" title="Convert" collapsedActions={headerActions}><section className="workspace-panel processing-panel processing-export rounded-2xl border border-stone-200 bg-white shadow-sm">
      <header className="workspace-panel-header workspace-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <h2 className="workspace-panel-title text-sm font-bold text-stone-900">Convert</h2>
        {headerActions}
      </header>
      <div className="space-y-5 p-4 sm:p-6">
      {pendingChapterChanges && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Your Chapter Editor changes will be saved before this audiobook is created.</p>}

      <div>
        <h3 className="text-sm font-bold text-stone-900">Choose file types</h3>
        <p className="mt-0.5 text-xs text-stone-500">M4B is the best all-around choice for most audiobook apps.</p>
        <div className="processing-format-grid mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {outputFormats.map(format => {
            const isSelected = selected.includes(format);
            return <label key={format} title={`${formatName(format)}: ${chapterSupport[format]}`} className={`processing-format-card flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${isSelected ? 'border-amber-500 bg-amber-50 shadow-sm' : 'border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-white'}`}>
              <input type="checkbox" disabled={isBuilding} checked={isSelected} onChange={() => toggleFormat(format)} className="mt-0.5 h-4 w-4 accent-amber-700" />
              <span className="min-w-0">
                <span className="processing-format-name flex items-center gap-2"><FileAudio className="processing-format-icon" aria-hidden="true" /><strong className="text-sm text-stone-900">{formatName(format)}</strong>{format === 'm4b' && <span className="processing-format-recommendation rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">Recommended</span>}</span>
                <span className="mt-1 block text-xs text-stone-600">{chapterSupport[format]}</span>
              </span>
            </label>;
          })}
        </div>
      </div>

      {requiresTrimming && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Your chapter ranges exclude {removedSeconds.toFixed(3)} seconds. Export removes this audio, adjusts chapter positions, and converts audio for precise cuts. The source and editor timeline stay unchanged.</p>}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-stone-900">Audio Quality</h3>
        <div className="processing-setting-switch">
          <span className="text-xs font-semibold">Auto</span>
          <button type="button" role="switch" aria-label="Manual encoding" aria-checked={convert} disabled={isBuilding}
            title="Auto keeps compatible audio unchanged and uses the highest supported bitrate at or below the source when conversion is needed. Manual sets the encoding bitrate."
            onClick={() => setConvert(value => !value)} className="processing-compact-switch"><span aria-hidden="true" /></button>
          <span className="text-xs font-semibold">Manual</span>
        </div>
        {convert && <div className="processing-quality-grid grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {selected.filter(format => !['flac', 'wav'].includes(format)).map(format => <label key={format} className="inline-flex items-center gap-2 text-xs"><span className="font-semibold">{formatName(format)}</span><select aria-label={`${formatName(format)} encoding bitrate`} disabled={isBuilding} value={bitrates[format] ?? recommended} onChange={event => setBitrates({ ...bitrates, [format]: Number(event.target.value) })} className="rounded border border-stone-300 bg-white px-2 py-1 text-xs">{bitrateOptions.map(rate => <option key={rate} value={rate}>{rate} kbps</option>)}</select></label>)}
          {selected.length > 0 && selected.every(format => ['flac', 'wav'].includes(format)) && <p className="text-xs text-stone-600">Lossless encoding has no bitrate setting.</p>}
        </div>}
      </div>

      {job.originalsArchive && <p role="status" className="break-all text-xs text-emerald-800">Original audio archived and verified: {job.originalsArchive.path}</p>}
      {job.originalsArchiveError && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Audiobook created. Original audio cleanup needs attention: {job.originalsArchiveError}</p>}
      {isBuilding && progressMessage && <p role="status" className="text-sm text-stone-700">{progressMessage}</p>}

      {chaptersAreStale && <p className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-xs font-medium text-orange-900">Review the refreshed chapter list before exporting.</p>}
      <div className="workspace-toolbar processing-export-actions flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-stone-500">{selected.length ? `${selected.length} file type${selected.length === 1 ? '' : 's'} selected` : 'Choose at least one file type'}</p>

      </div>
      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">Could not create audiobook: {error}</p>}

      {!!job.exports?.length && <div aria-live="polite" className="space-y-2 border-t border-stone-100 pt-4"><h3 className="text-sm font-bold text-stone-900">Created files</h3>{job.exports.map(item => <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm" key={item.format}><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 font-semibold text-stone-900"><FileAudio className="h-4 w-4 text-amber-700" />{formatName(item.format)}</span><span className="text-xs font-medium text-stone-600">{item.status} · {item.progress}% {item.mode === 'copy' ? '· audio copied without re-encoding' : item.mode === 'convert' ? '· audio converted' : ''}</span></div><p className="mt-1 break-all text-xs text-stone-500">{item.fullPath || item.filename}</p>{item.sampleRateSummary && <p className="mt-1 text-xs text-stone-600">{item.sampleRateSummary}</p>}{item.error && <p className="mt-1 text-xs font-medium text-red-700">{item.error}</p>}{item.warnings?.map(warning => <p className="mt-1 text-xs text-amber-800" key={warning}>{warning}</p>)}{item.verifiedTags && <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-stone-600">Technical metadata</summary>{Object.entries(item.verifiedTags).map(([key, value]) => <p className="break-all" key={key}>{key}: {value}</p>)}</details>}</div>)}</div>}
      {exportedCoverPath && <p className="break-all text-xs text-stone-600">Cover saved: {exportedCoverPath}</p>}

      </div>
    </section></DesktopWindow></>
  );
};
