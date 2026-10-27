import { Info } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { transcriptionSettings, supportedBatchSizes, type BackendCapabilities, type TranscriptionBackend, type TranscriptionSettings, type BatchSetting } from '../transcription';

export function TranscriptionOptions({ engine, model, value, capability, disabled, onChange, leadingControls }: {
  engine: TranscriptionBackend; model: string; value?: TranscriptionSettings; capability: BackendCapabilities | null;
  leadingControls?: ReactNode; disabled: boolean; onChange: (value: TranscriptionSettings) => void;
}) {
  const id = useId();
  const settings = transcriptionSettings(engine, value);
  const sizes = capability ? supportedBatchSizes(capability, model) : [];
  const batchingAvailable = sizes.length > 0 && settings.device !== 'cpu';
  const update = (changes: Partial<TranscriptionSettings>) => onChange(transcriptionSettings(engine, { ...settings, ...changes }));
  const invalidBatch = settings.batching !== 'off' && (!batchingAvailable || (typeof settings.batching === 'number' && !sizes.includes(settings.batching)));
  const batchChoices: BatchSetting[] = ['auto', ...sizes as BatchSetting[]];
  if (typeof settings.batching === 'number' && !sizes.includes(settings.batching)) batchChoices.push(settings.batching);
  return <fieldset disabled={disabled} className="processing-transcription-options space-y-3 text-xs text-stone-700">
    <legend className="sr-only">Advanced transcription</legend>
    <div className="processing-transcription-top">
    <div className="processing-setting-switches">
      {leadingControls}
    <div className="processing-setting-switch">
      <button type="button" role="switch" aria-label="Automatic processing device" aria-checked={settings.device === 'auto'}
        title="Auto uses GPU acceleration when available and otherwise uses CPU. Select CPU to always use the processor."
        className="processing-compact-switch" onClick={() => update(settings.device === 'cpu' ? { device: 'auto' } : { device: 'cpu', batching: 'off' })}><span aria-hidden="true" /></button>
      <span className="text-sm font-bold">Processing device</span>
      <span className="processing-device-value">{settings.device === 'cpu' ? 'CPU' : 'Auto'}</span>
      <span className="chapter-option-info" tabIndex={0} role="img" aria-label="Auto uses GPU acceleration when available and otherwise uses CPU. Select CPU to always use the processor."
        title="Auto uses GPU acceleration when available and otherwise uses CPU. Select CPU to always use the processor."><Info aria-hidden="true" className="h-3.5 w-3.5" /></span>
    </div>
    </div>
    <div className="processing-tuning-grid">
      <fieldset className="processing-tuning-card">
        <legend className="processing-tuning-heading">GPU Batching <span className="font-normal">· {settings.batching === 'off' ? 'Off' : settings.batching === 'auto' ? 'Auto' : settings.batching}</span></legend>
        <div className="processing-tuning-choices" role="radiogroup" aria-label="GPU Batching">
          {batchChoices.map(choice => <label key={choice} className="inline-flex items-center gap-1.5">
            <input type="radio" name={`${id}-batch`} aria-label={`GPU Batching ${choice}`} checked={settings.batching === choice}
              disabled={!batchingAvailable && settings.batching !== choice}
              onChange={() => {}} onClick={() => update({ batching: settings.batching === choice ? 'off' : choice })} />
            {choice === 'auto' ? 'Auto (conservative)' : choice}
          </label>)}
        </div>
        <p>Processes multiple transcription segments simultaneously. Higher batch sizes can improve GPU throughput but require more VRAM and may slightly change transcription behavior. Leave Off if stability or consistent results are more important.</p>
        {!batchingAvailable && <p>Batching requires Faster Whisper and GPU processing. Regular Whisper and CPU processing keep batching Off.</p>}
        {invalidBatch && <p role="alert" className="text-amber-800">The saved batch setting is unavailable for this model/runtime. Deselect it or select an available size before processing.</p>}
      </fieldset>
      <fieldset className="processing-tuning-card" disabled={engine !== 'faster-whisper'}>
        <legend className="processing-tuning-heading">Beam size</legend>
        <div className="processing-tuning-choices" role="radiogroup" aria-label="Beam size">
          {['Fastest', 'Faster', 'Balanced', 'Improved accuracy', 'Most accurate'].map((label, index) => <label key={label} className="inline-flex items-center gap-1.5">
            <input type="radio" name={`${id}-beam`} aria-label={`Beam size ${index + 1} — ${label}`} checked={(settings.beamSize ?? 5) === index + 1}
              onChange={() => update({ beamSize: index + 1 })} />{index + 1} · {label}
          </label>)}
        </div>
        {engine !== 'faster-whisper' && <p>This beam control applies only to Faster Whisper. Regular Whisper retains its original decoding defaults.</p>}
        <p>Higher beam sizes evaluate more possible transcription results and may improve recognition accuracy, but require more processing time. Lower values are faster but may reduce accuracy. These are general tradeoffs, not guarantees.</p>
      </fieldset>
    </div>
    </div>
  </fieldset>;
}
