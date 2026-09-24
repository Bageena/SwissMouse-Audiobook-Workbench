import React, { useState } from 'react';
import { ArrowRight, ChevronDown, Download, FileAudio, Loader2, Settings2 } from 'lucide-react';
import { AudiobookJob, WorkbenchConfig, OutputAudioFormat } from '../types';
import { outputFormats, canCopy, chapterSupport, bitrateOptions, defaultBitrate } from '../audioFormats';
import { useDependencyStatus } from '../dependency-status';
import { planChapterExport } from '../utils/chapterExport';

interface Step4Props {
  job: AudiobookJob;
  config: WorkbenchConfig;
  onBuildM4b: (formats: OutputAudioFormat[], convert: boolean, cue: boolean, bitrates: Partial<Record<OutputAudioFormat, number>>) => Promise<void>;
  isBuilding: boolean;
  error: string | null;
  onNextStep: () => void;
}

const formatName = (format: OutputAudioFormat) => format.toUpperCase();

export const Step4Export: React.FC<Step4Props> = ({ job, onBuildM4b, isBuilding, error, onNextStep }) => {
  const exportAvailability = useDependencyStatus().feature('audio_export');
  const [selected, setSelected] = useState<OutputAudioFormat[]>([
    outputFormats.includes(job.sourceFormat as OutputAudioFormat) ? job.sourceFormat as OutputAudioFormat : 'm4b',
  ]);
  const [convert, setConvert] = useState(false);
  const [cue, setCue] = useState(true);
  const [bitrates, setBitrates] = useState<Partial<Record<OutputAudioFormat, number>>>({});
  const recommended = defaultBitrate(job.sourceBitrate);
  let removedSeconds = 0;
  try { removedSeconds = planChapterExport(job.chapters, job.totalDurationSeconds).removedSeconds; } catch { /* Export validates incomplete chapters. */ }
  const requiresTrimming = removedSeconds > 0;
  const chaptersAreStale = job.staleSteps?.some(step => step === 'chapter_detection' || step === 'chapter_review') ?? false;
  const exportedCoverPath = job.exports?.find(item => item.status === 'success' && item.coverPath)?.coverPath;
  const toggleFormat = (format: OutputAudioFormat) => setSelected(current => current.includes(format) ? current.filter(item => item !== format) : [...current, format]);

  return (
    <section className="space-y-5 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 border-b border-stone-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-amber-700"><Download className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-[0.14em]">Ready to finish</span></div>
          <h2 className="text-xl font-bold tracking-tight text-stone-950">Create your audiobook</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-stone-600">Choose the file type you want. SwissMouse adds your reviewed chapters and book details without changing the originals.</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600"><span className="block font-semibold text-stone-800">Source quality</span>{job.sourceFormat?.toUpperCase()} · {job.sourceCodec} {job.sourceBitrate ? `· ${job.sourceBitrate} kbps` : ''}</div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-stone-900">Choose file types</h3>
        <p className="mt-0.5 text-xs text-stone-500">M4B is the best all-around choice for most audiobook apps.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {outputFormats.map(format => {
            const isSelected = selected.includes(format);
            const copied = !requiresTrimming && !convert && canCopy(job.sourceCodec || '', format);
            return <label key={format} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${isSelected ? 'border-amber-500 bg-amber-50 shadow-sm' : 'border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-white'}`}>
              <input type="checkbox" disabled={isBuilding} checked={isSelected} onChange={() => toggleFormat(format)} className="mt-0.5 h-4 w-4 accent-amber-700" />
              <span className="min-w-0">
                <span className="flex items-center gap-2"><strong className="text-sm text-stone-900">{formatName(format)}</strong>{format === 'm4b' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">Recommended</span>}</span>
                <span className="mt-1 block text-xs text-stone-600">{chapterSupport[format]}</span>
                <span className={`mt-1.5 block text-[11px] font-medium ${copied ? 'text-emerald-700' : 'text-stone-500'}`}>{copied ? 'Keeps the original audio quality' : 'Converts audio for this format'}</span>
              </span>
            </label>;
          })}
        </div>
      </div>

      {requiresTrimming && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Your chapter ranges exclude {removedSeconds.toFixed(3)} seconds. Export removes this audio, adjusts chapter positions, and converts audio for precise cuts. The source and editor timeline stay unchanged.</p>}
      <details className="advanced-disclosure rounded-xl border border-stone-200 bg-stone-50">
        <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-stone-800"><span className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-stone-500" />Advanced export options</span><ChevronDown className="disclosure-chevron h-4 w-4 text-stone-400" /></summary>
        <div className="space-y-4 border-t border-stone-200 px-4 py-4">
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-2 font-semibold text-stone-900">Audio handling</legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-white p-3 ring-1 ring-stone-200"><input type="radio" name="exportMode" disabled={isBuilding} checked={!convert} onChange={() => setConvert(false)} className="mt-0.5 accent-amber-700" /><span><span className="block font-semibold">Keep original audio when possible</span><span className="mt-0.5 block text-xs text-stone-500">Faster, with no quality loss when copying. SwissMouse converts when the chosen format or precise chapter cuts require it.</span></span></label>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-white p-3 ring-1 ring-stone-200"><input type="radio" name="exportMode" disabled={isBuilding} checked={convert} onChange={() => setConvert(true)} className="mt-0.5 accent-amber-700" /><span><span className="block font-semibold">Convert all selected formats</span><span className="mt-0.5 block text-xs text-stone-500">Useful for standardizing files or reducing size.</span></span></label>
          </fieldset>
          <div>
            <p className="mb-2 text-sm font-semibold text-stone-900">Conversion quality</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {outputFormats.filter(format => selected.includes(format) && !['flac', 'wav'].includes(format)).map(format => <label key={format} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-stone-200"><span className="font-semibold">{formatName(format)}</span><select aria-label={`${formatName(format)} encoding bitrate`} disabled={isBuilding || (!requiresTrimming && !convert && canCopy(job.sourceCodec || '', format))} value={bitrates[format] ?? recommended} onChange={event => setBitrates({ ...bitrates, [format]: Number(event.target.value) })} className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs">{bitrateOptions.map(rate => <option key={rate} value={rate}>{rate} kbps</option>)}</select></label>)}
            </div>
            <p className="mt-2 text-[11px] text-stone-500">Recommended when conversion is needed: {recommended} kbps. A higher setting increases file size but cannot improve the source recording.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700" title="A CUE file is a small sidecar chapter list used by some players."><input type="checkbox" disabled={isBuilding} checked={cue} onChange={event => setCue(event.target.checked)} className="h-4 w-4 accent-amber-700" />Also create a CUE chapter file</label>
          <p className="text-[11px] leading-relaxed text-stone-500">A selected cover is saved as cover.jpg or cover.png beside the audiobook. Cover art cannot be embedded in WAV, OGG, or Opus exports. Player support varies, so test playback in your preferred app afterward.</p>
        </div>
      </details>

      {chaptersAreStale && <p className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-xs font-medium text-orange-900">Review the refreshed chapter list before exporting.</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-stone-500">{selected.length ? `${selected.length} file type${selected.length === 1 ? '' : 's'} selected` : 'Choose at least one file type'}</p>
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-700 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-800 disabled:bg-stone-300 disabled:text-stone-500" title={chaptersAreStale ? 'Review chapter detection before exporting' : exportAvailability.tooltip} disabled={chaptersAreStale || !exportAvailability.ready || isBuilding || !selected.length || !job.mergedMp3 || !job.chapters.length} onClick={() => onBuildM4b(selected, convert, cue, Object.fromEntries(outputFormats.map(format => [format, bitrates[format] ?? recommended])))}>{isBuilding ? <><Loader2 className="h-4 w-4 animate-spin" />Creating files…</> : <><Download className="h-4 w-4" />Create audiobook</>}</button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">Could not create audiobook: {error}</p>}

      {!!job.exports?.length && <div aria-live="polite" className="space-y-2 border-t border-stone-100 pt-4"><h3 className="text-sm font-bold text-stone-900">Created files</h3>{job.exports.map(item => <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm" key={item.format}><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 font-semibold text-stone-900"><FileAudio className="h-4 w-4 text-amber-700" />{formatName(item.format)}</span><span className="text-xs font-medium text-stone-600">{item.status} · {item.progress}% {item.mode === 'copy' ? '· original audio kept' : item.mode === 'convert' ? '· audio converted' : ''}</span></div><p className="mt-1 break-all text-xs text-stone-500">{item.fullPath || item.filename}</p>{item.sampleRateSummary && <p className="mt-1 text-xs text-stone-600">{item.sampleRateSummary}</p>}{item.error && <p className="mt-1 text-xs font-medium text-red-700">{item.error}</p>}{item.warnings?.map(warning => <p className="mt-1 text-xs text-amber-800" key={warning}>{warning}</p>)}{item.verifiedTags && <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-stone-600">Technical metadata</summary>{Object.entries(item.verifiedTags).map(([key, value]) => <p className="break-all" key={key}>{key}: {value}</p>)}</details>}</div>)}</div>}
      {exportedCoverPath && <p className="break-all text-xs text-stone-600">Cover saved: {exportedCoverPath}</p>}
      {job.outputM4b && <button className="inline-flex items-center gap-1 text-sm font-semibold text-amber-800 hover:text-amber-950" onClick={onNextStep} title="Check the latest exported file against your chapter list">Continue to final check <ArrowRight className="h-4 w-4" /></button>}
    </section>
  );
};
