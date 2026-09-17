import React, { useState } from 'react';
import { AudiobookJob, WorkbenchConfig, OutputAudioFormat } from '../types';
import { outputFormats, canCopy, chapterSupport, bitrateOptions, defaultBitrate } from '../audioFormats';

export const Step4BuildM4b: React.FC<{job: AudiobookJob; config: WorkbenchConfig; onBuildM4b: (formats: OutputAudioFormat[], convert: boolean, cue: boolean, bitrates: Partial<Record<OutputAudioFormat,number>>) => Promise<void>; isBuilding: boolean; onNextStep: () => void}> = ({job, onBuildM4b, isBuilding, onNextStep}) => {
  const [selected, setSelected] = useState<OutputAudioFormat[]>([outputFormats.includes(job.sourceFormat as any) ? job.sourceFormat as OutputAudioFormat : 'm4b']);
  const [convert, setConvert] = useState(false);
  const [cue, setCue] = useState(true);
  const [bitrates, setBitrates] = useState<Partial<Record<OutputAudioFormat,number>>>({});
  const recommended = defaultBitrate(job.sourceBitrate);
  return <div className="space-y-5 bg-white border rounded-xl p-6">
    <div><h2 className="text-lg font-bold">Export your finished audiobook</h2><p className="text-sm text-stone-600 mt-1">Choose one or more file types, then create copies with your reviewed chapters and book details. Your original files are never changed.</p></div>
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700"><strong>Imported audio:</strong> {job.sourceFormat?.toUpperCase()} / {job.sourceCodec}; {job.sourceBitrate ? `${job.sourceBitrate} kbps` : 'bitrate could not be measured'}. <span title="Bitrate is the amount of audio data used each second. Higher numbers make larger files but cannot improve an already lower-quality source.">About bitrate</span>: SwissMouse recommends {recommended} kbps when conversion is needed.</div>
    <div className="grid grid-cols-2 gap-3">{outputFormats.map(format => <div key={format} className="border rounded-lg p-3">
      <label title={`Create a ${format.toUpperCase()} copy`}><input type="checkbox" disabled={isBuilding} checked={selected.includes(format)} onChange={() => setSelected(selected.includes(format) ? selected.filter(f => f !== format) : [...selected, format])} /> <strong>{format.toUpperCase()}</strong></label>
      <p className="text-sm">{!convert && canCopy(job.sourceCodec || '', format) ? 'Audio can be copied without re-encoding' : 'Audio will be converted for this format'}</p>
      <p className="text-xs text-stone-600">{chapterSupport[format]}</p>
      {!['flac','wav'].includes(format) && <label className="block mt-2 text-sm" title="Used only when audio must be re-encoded. A higher number creates a larger file, not better source audio.">{format.toUpperCase()} quality <select aria-label={`${format.toUpperCase()} encoding bitrate`} className="border rounded p-1" disabled={isBuilding || (!convert && canCopy(job.sourceCodec || '',format))} value={bitrates[format] ?? recommended} onChange={e=>setBitrates({...bitrates,[format]:Number(e.target.value)})}>{bitrateOptions.map(rate=><option key={rate} value={rate}>{rate} kbps</option>)}</select></label>}
    </div>)}</div>
    <fieldset className="space-y-2 text-sm"><legend className="font-semibold">How should the audio be handled?</legend>
      <label className="block" title="Copies compatible audio exactly as it is, so export is faster and does not reduce quality."><input type="radio" name="exportMode" disabled={isBuilding} checked={!convert} onChange={()=>setConvert(false)} /> Keep the original audio when possible (recommended)</label>
      <p className="text-stone-600">Compatible formats keep the existing audio and add your chapters and metadata. Quality choices apply only when conversion is required.</p>
      <label className="block" title="Creates new audio using the selected quality level. Use this to standardize formats or reduce file size."><input type="radio" name="exportMode" disabled={isBuilding} checked={convert} onChange={()=>setConvert(true)} /> Convert audio using the selected quality</label>
    </fieldset>
    <label className="block text-sm" title="A CUE file is a small sidecar chapter list. Some players can use it when embedded chapters are unavailable."><input type="checkbox" disabled={isBuilding} checked={cue} onChange={e => setCue(e.target.checked)} /> Also create a CUE chapter file</label>
    <p className="text-xs text-stone-600">SwissMouse checks the exported file’s metadata and chapter list. Test playback in your preferred player afterward; player support differs, especially for WAV, Ogg, and Opus. Cover art cannot be embedded in WAV, Ogg, or Opus exports.</p>
    <button className="px-4 py-2 bg-amber-600 text-white rounded disabled:opacity-40" disabled={isBuilding || !selected.length || !job.mergedMp3 || !job.chapters.length} onClick={() => onBuildM4b(selected, convert, cue, Object.fromEntries(outputFormats.map(f=>[f,bitrates[f] ?? recommended])))}>{isBuilding ? 'Exporting…' : 'Export selected formats'}</button>
    <div aria-live="polite" className="space-y-2">{job.exports?.map(item => <div className="border rounded p-3 text-sm" key={item.format}>
      <strong>{item.format.toUpperCase()}</strong>: {item.status} {item.progress}% {item.mode === 'copy' ? '— audio copied' : item.mode === 'convert' ? '— audio converted' : ''}
      <p className="break-all">{item.fullPath || item.filename}</p><p className="text-red-700">{item.error}</p>{item.warnings?.map(w => <p key={w}>{w}</p>)}
      {item.verifiedTags && <details><summary>Metadata read from output</summary>{Object.entries(item.verifiedTags).map(([key,value])=><p className="break-all" key={key}>{key}: {value}</p>)}</details>}
    </div>)}</div>
    {job.outputM4b && <button className="underline" onClick={onNextStep} title="Check the latest exported file against your chapter list">Verify latest export</button>}
  </div>;
};
