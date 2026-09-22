import React from 'react';
import { transcriptionSettings, supportedBatchSizes, capabilityLabel, type BackendCapabilities, type TranscriptionBackend, type TranscriptionSettings, type BatchSetting } from '../transcription';

export function TranscriptionOptions({ engine, model, value, capability, disabled, onChange }: {
  engine: TranscriptionBackend; model: string; value?: TranscriptionSettings; capability: BackendCapabilities | null;
  disabled: boolean; onChange: (value: TranscriptionSettings) => void;
}) {
  const settings = transcriptionSettings(engine, value);
  const sizes = capability ? supportedBatchSizes(capability, model) : [];
  const batchingAvailable = sizes.length > 0 && settings.device !== 'cpu';
  const update = (changes: Partial<TranscriptionSettings>) => onChange(transcriptionSettings(engine, { ...settings, ...changes }));
  const invalidBatch = settings.batching !== 'off' && (!batchingAvailable || (typeof settings.batching === 'number' && !sizes.includes(settings.batching)));
  return <fieldset disabled={disabled} className="space-y-4 rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs text-stone-700">
    <legend className="px-1 font-bold">Advanced transcription</legend>
    <label className="block space-y-1">
      <span className="font-semibold">Processing device</span>
      <select value={settings.device} onChange={event => update({ device: event.target.value as 'auto' | 'cpu', ...(event.target.value === 'cpu' ? { batching: 'off' as const } : {}) })} className="block w-full rounded border border-stone-300 bg-white p-2">
        <option value="auto">Auto — use this backend's GPU support when available</option>
        <option value="cpu">CPU</option>
      </select>
    </label>
    <p role="status">{capability ? capabilityLabel(capability, settings.device) : 'Checking backend capabilities…'}
      {capability?.reason ? ' — ' + capability.reason : ''}
      {settings.device !== 'cpu' && capability?.gpuAvailable && capability.initialization === 'not-tested' ? ' GPU model initialization is verified when transcription starts.' : ''}
    </p>
    <label className="block space-y-1">
      <span className="font-semibold">Experimental GPU Batching</span>
      <select aria-label="Experimental GPU Batching" value={settings.batching} disabled={!batchingAvailable && settings.batching === 'off'}
        title={batchingAvailable ? 'Optional experimental GPU throughput control' : 'Requires Faster Whisper, its batching pipeline, and a usable CUDA device'}
        onChange={event => update({ batching: (/^\d+$/.test(event.target.value) ? Number(event.target.value) : event.target.value) as BatchSetting })}
        className="block w-full rounded border border-stone-300 bg-white p-2 disabled:opacity-60">
        <option value="off">Off (default)</option>
        <option value="auto" disabled={!batchingAvailable}>Auto (conservative)</option>
        {sizes.map(size => <option key={size} value={size} disabled={!batchingAvailable}>{size}</option>)}
        {typeof settings.batching === 'number' && !sizes.includes(settings.batching) && <option value={settings.batching} disabled>{settings.batching} — unavailable</option>}
      </select>
    </label>
    <p>Processes multiple transcription segments simultaneously. Higher batch sizes can improve GPU throughput but require more VRAM and may slightly change transcription behavior. Leave Off if stability or consistent results are more important.</p>
    {!batchingAvailable && <p>Batching requires Faster Whisper and GPU processing. Regular Whisper and CPU processing keep batching Off.</p>}
    {invalidBatch && <p role="alert" className="text-amber-800">The saved batch setting is unavailable for this model/runtime. Select Off or an available size before processing.</p>}
    <label className="block space-y-1">
      <span className="font-semibold">Beam Size: {engine === 'faster-whisper' ? settings.beamSize : 'Native Whisper decoding'}</span>
      <input aria-label="Beam Size" type="range" min="1" max="5" step="1" value={settings.beamSize ?? 5}
        disabled={engine !== 'faster-whisper'} title={engine === 'faster-whisper' ? 'Integer beam size, 1–5' : 'Regular Whisper retains its original temperature-based decoding defaults'}
        onChange={event => update({ beamSize: Number(event.target.value) })} className="block w-full accent-amber-600" />
    </label>
    <p>{engine === 'faster-whisper' ? ['1 — Fastest', '2 — Faster', '3 — Balanced', '4 — More search', '5 — Most search (default)'][(settings.beamSize ?? 5) - 1] : 'This beam control applies only to Faster Whisper.'}</p>
    <p>Higher beam sizes evaluate more possible transcription results and may improve recognition accuracy, but require more processing time. Lower values are faster but may reduce accuracy. These are general tradeoffs, not guarantees.</p>
  </fieldset>;
}
