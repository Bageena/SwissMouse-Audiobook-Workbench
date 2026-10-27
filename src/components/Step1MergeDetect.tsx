import { PreviewPanel } from './PreviewPanel';
import { TranscriptionOptions } from './TranscriptionOptions';
import { TranscriptTimingWarning } from './TranscriptTimingWarning';
import { DesktopWindow } from './DesktopWorkspace';
import { AdaptiveButton } from './AdaptiveButton';
import { type BackendCapabilities } from '../transcription';
import { stitchCompatibility } from '../audioFormats';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AudiobookJob, WorkbenchConfig, ChapterSourceType, AudioMergeMethodType, HardwareInfo, SpeechModelInfo, DiscoveredMp3File } from '../types';
import { hasProcessingDetails, Step1ProgressPanel } from './Step1ProgressPanel';
import { useDependencyStatus } from '../dependency-status';
import { RerunnablePipelineStep, Step1ProcessState } from '../types';
import { canRerunStep } from '../utils/pipelineRerun';
import { Loader2, FileAudio, ListMusic, BookAudio, Music, Sparkles, CheckCircle2, AlertCircle, AlertTriangle, Download, Trash2, XCircle, Play, Sliders, ChevronDown, RefreshCw, Info, Import, Undo2 } from 'lucide-react';

function OptionInfo({ text }: { text: string }) {
  return <span className="chapter-option-info" tabIndex={0} role="img" aria-label={text} title={text}
    onClick={event => event.preventDefault()}><Info aria-hidden="true" className="h-3.5 w-3.5" /></span>;
}

function ModelAction({ icon, label, modelName, title, disabled, onClick, id }: {
  icon: React.ReactNode; label: string; modelName: string; id?: string; title?: string; disabled?: boolean; onClick: () => void;
}) {
  return <span className="processing-model-action" onClick={event => event.stopPropagation()}>
    <button id={id} type="button" aria-label={`${label} ${modelName}`.trim()} title={title || `${label} ${modelName}`} disabled={disabled}
      className="processing-model-action-icon" onClick={onClick}>{icon}</button>
    <span className="processing-model-action-label">{label}</span>
  </span>;
}

interface Step1Props {
  mode?: 'import' | 'process' | 'file-review';
  job: AudiobookJob;
  config: WorkbenchConfig;
  onRunStep1: (options?: {
    generateWaveform?: boolean;
    generateTranscript?: boolean;
    chapterSource?: ChapterSourceType;
    mergeMethod?: AudioMergeMethodType;
    selectedModelId?: string;
    transcriptionSettings?: AudiobookJob['transcriptionSettings'];
    sourceFolderPath?: string;
    outputFolderPath?: string;
    parts?: any[];
  }) => Promise<void>;
  onRerunStep: (step: RerunnablePipelineStep, settings?: { transcriptionSettings?: AudiobookJob['transcriptionSettings']; selectedModelId?: string }) => Promise<void>;
  isRunning: boolean;
  onReadinessChange?: (value: { jobId: string; valid: boolean }) => void;
  onUpdateJobSettings?: (settings: Partial<AudiobookJob>) => Promise<void>;
  onConfigChange?: (config: WorkbenchConfig) => void;
}

export const Step1MergeDetect: React.FC<Step1Props> = ({
  mode = 'process',
  job,
  config,
  onRunStep1,
  onRerunStep,
  isRunning,
  onReadinessChange,
  onUpdateJobSettings,
  onConfigChange,
}) => {
  const { feature } = useDependencyStatus();
  const [fasterEnabled, setFasterEnabled] = useState(config.faster_transcription);
  useEffect(() => setFasterEnabled(config.faster_transcription), [config.faster_transcription]);
  const [isSwitchingEngine, setIsSwitchingEngine] = useState(false);
  const [isSavingMusicSetting, setIsSavingMusicSetting] = useState(false);
  const [musicSettingError, setMusicSettingError] = useState('');
  const handleMusicDetectionChange = async (enabled: boolean) => {
    setIsSavingMusicSetting(true);
    setMusicSettingError('');
    try {
      const response = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ detect_musical_transitions: enabled }) });
      if (!response.ok) throw new Error('Could not save improved chapter detection setting.');
      const saved = await response.json();
      onConfigChange?.(saved.config);
    } catch (error) { setMusicSettingError(error instanceof Error ? error.message : 'Could not save setting.'); }
    finally { setIsSavingMusicSetting(false); }
  };
  const transcriptionEngine = fasterEnabled ? 'faster-whisper' : 'openai-whisper';
  const [transcriptionOptions, setTranscriptionOptions] = useState(job.transcriptionSettings || {});
  const [backendCapability, setBackendCapability] = useState<BackendCapabilities | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setBackendCapability(null);
      try {
        const response = await fetch('/api/transcription/capabilities?engine=' + transcriptionEngine);
        if (!response.ok) throw new Error('Capability check failed');
        const data = await response.json();
        if (active) setBackendCapability(data);
      } catch { if (active) setBackendCapability(null); }
    };
    void load();
    window.addEventListener('requirements-changed', load);
    return () => { active = false; window.removeEventListener('requirements-changed', load); };
  }, [transcriptionEngine]);
  const modelAvailability = feature(fasterEnabled ? 'faster_model_management' : 'openai_model_management');
  const modelsApi = `/api/models?engine=${transcriptionEngine}`;
  const engineRef = useRef(transcriptionEngine);
  engineRef.current = transcriptionEngine;
  const sourceFolderPath = job.sourceFolderPath || (mode === 'file-review' ? job.source?.path || '' : '');
  const [discoveredFiles, setDiscoveredFiles] = useState<DiscoveredMp3File[]>(
    job.sourceFolderPath ? job.discoveredFiles || job.parts.map(part => ({
      relativePath: part.sourceRelativePath || part.name, storedName: part.name, fileName: part.name,
      folderName: 'Root', sizeBytes: part.sizeBytes, durationSeconds: part.durationSeconds,
    })) : [],
  );

  // Workflow State (persisted on job or default to safe workflow)
  const [chapterSource, setChapterSource] = useState<ChapterSourceType>(
    job.chapterSource || 'whisperx'
  );
  const [generateTranscript, setGenerateTranscript] = useState(job.generateTranscript === true);
  const [generateWaveform,setGenerateWaveform] = useState(job.generateWaveform === true);
  useEffect(()=>setGenerateWaveform(job.generateWaveform===true),[job.generateWaveform]);
  const needsTranscript = chapterSource === 'whisperx' || generateTranscript;
  const [existingChapterInfo, setExistingChapterInfo] = useState<{count:number;source?:string;importedName?:string}>({ count: job.existingChapters?.length || 0, source: job.existingChapterSource });
  const chapterFileInput = useRef<HTMLInputElement>(null);
  const chapterInfoRequest = useRef(0);
  const [importingChapterFile,setImportingChapterFile] = useState(false);
  const [chapterFileMessage,setChapterFileMessage] = useState('');
  const importChapterFile = async (file:File) => {
    chapterInfoRequest.current++;
    setImportingChapterFile(true);setChapterFileMessage('');
    try {
      if(file.size>1024*1024)throw new Error('Choose a chapter or playlist file smaller than 1 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let content:string;
      if(bytes[0]===255&&bytes[1]===254)content=new TextDecoder('utf-16le').decode(bytes);
      else if(bytes[0]===254&&bytes[1]===255)content=new TextDecoder('utf-16be').decode(bytes);
      else {try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{content=new TextDecoder('windows-1252').decode(bytes);}}
      const response=await fetch(`/api/jobs/${job.id}/chapter-file`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,content})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not import chapter file.');
      setExistingChapterInfo(result);setChapterSource('existing_chapters');
      setChapterFileMessage(`${result.count} ${result.kind==='tracks'?'file-boundary chapters':'chapter markers'} loaded. Run this workflow to open them in the editor. Your current chapter edits have not been replaced.`);
    }catch(error:any){setChapterFileMessage(error.message||'Could not import chapter file.');}
    finally{setImportingChapterFile(false);if(chapterFileInput.current)chapterFileInput.current.value='';}
  };
  const clearChapterFile = async () => {
    chapterInfoRequest.current++;
    setImportingChapterFile(true);
    try {
      const response=await fetch(`/api/jobs/${job.id}/chapter-file`,{method:'DELETE'});
      if(!response.ok)throw new Error((await response.json()).error);
      const detected=await fetch(`/api/jobs/${job.id}/existing-chapters`);if(detected.ok)setExistingChapterInfo(await detected.json());
      setChapterFileMessage('Imported source cleared. Existing embedded or matched chapter files will be used. Current chapter edits are unchanged.');
    }catch(error:any){setChapterFileMessage(error.message||'Could not clear the imported source.');}finally{setImportingChapterFile(false);}
  };
  useEffect(() => {
    let current = true;
    const request = ++chapterInfoRequest.current;
    void fetch(`/api/jobs/${job.id}/existing-chapters`).then(response => response.ok ? response.json() : undefined)
      .then(value => { if (current && request === chapterInfoRequest.current && value) setExistingChapterInfo(value); }).catch(() => {});
    return () => { current = false; };
  }, [job.id, job.parts, job.sourceFolderPath]);
  const [mergeMethod, setMergeMethod] = useState<AudioMergeMethodType>(
    job.mergeMethod || 'standard'
  );

  useEffect(() => {
    if (job.discoveredFiles) setDiscoveredFiles(job.discoveredFiles);
  }, [job.discoveredFiles]);
  const compatibility = useMemo(() => {
    const selected = new Set(job.parts.map(part => (part.sourceRelativePath || part.name).replace(/\\/g, '/')));
    return stitchCompatibility(discoveredFiles.filter(file => selected.has(file.relativePath.replace(/\\/g, '/'))));
  }, [discoveredFiles, job.parts]);
  const streamCopyCompatible = compatibility.compatible;

  // If streamCopy is incompatible and user has quick merge selected, enforce standard merge
  useEffect(() => {
    if (!streamCopyCompatible && mergeMethod === 'quick') {
      setMergeMethod('standard');
      notifyJobUpdate({ mergeMethod: 'standard' });
    }
  }, [streamCopyCompatible, mergeMethod]);

  // Output Folder State
  const [outputFolderPath, setOutputFolderPath] = useState<string>(
    job.outputFolderPath || 'output'
  );
  const [isOutputWritable, setIsOutputWritable] = useState<boolean>(true);

  // Hardware & Speech Models State
  const [hardware, setHardware] = useState<HardwareInfo>({
    mode: 'cpu',
    cpuModel: 'Local CPU Host',
    recommendedModelId: 'small',
  });
  const [models, setModels] = useState<SpeechModelInfo[]>([]);
  const applyModels = (items: SpeechModelInfo[]) => {
    if (items.every(model => model.backend === engineRef.current)) setModels(items);
  };
  const [selectedModelId, setSelectedModelId] = useState<string>(
    job.selectedModelId || 'small'
  );

  // GPU Required Modal State
  const [showGpuRequiredModal, setShowGpuRequiredModal] = useState<boolean>(false);
  const [blockedModelName, setBlockedModelName] = useState<string>('');

  // Step 1 Live Progress Feedback State
  const [step1Progress, setStep1Progress] = useState<Step1ProcessState | null>(null);

  // Poll live Step 1 processing progress
  useEffect(() => {
    let interval: NodeJS.Timeout;
    const fetchProgress = async () => {
      try {
        const res = await fetch('/api/step1/progress');
        if (res.ok) {
          const prog: Step1ProcessState = await res.json();
          setStep1Progress(prog);
        }
      } catch (e) {}
    };

    fetchProgress();
    if (isRunning) {
      interval = setInterval(fetchProgress, 600);
    } else {
      interval = setInterval(fetchProgress, 2500);
    }
    return () => clearInterval(interval);
  }, [isRunning]);

  // Cancel Step 1 Handler
  const handleCancelStep1 = async () => {
    try {
      await fetch('/api/step1/cancel', { method: 'POST' });
      const res = await fetch('/api/step1/progress');
      if (res.ok) {
        setStep1Progress(await res.json());
      }
    } catch (e) {}
  };


  // Load initial hardware, models, and output directory
  useEffect(() => {
    let cancelled = false;
    async function initHardwareAndModels() {
      try {
        const [hwRes, modelsRes, outRes] = await Promise.all([
          fetch('/api/system/hardware'),
          fetch(`${modelsApi}&refresh=true`),
          fetch('/api/system/output-folder'),
        ]);

        if (hwRes.ok) {
          const hwData: HardwareInfo = await hwRes.json();
          setHardware(hwData);
          if (!job.selectedModelId) {
            setSelectedModelId(hwData.recommendedModelId);
          }
        }

        if (modelsRes.ok) {
          const modelsData: SpeechModelInfo[] = await modelsRes.json();
          if (!cancelled) applyModels(modelsData);
        }

        if (outRes.ok) {
          const outData = await outRes.json();
          setOutputFolderPath(job.outputFolderPath || outData.outputFolder);
          setIsOutputWritable(outData.isWritable);
        }
      } catch (err) {
        console.error('Failed to load hardware or models info:', err);
      }
    }

    initHardwareAndModels();
    return () => { cancelled = true; };
  }, [modelsApi]);

  // Poll state only while a download is active, without restarting on each update.
  const hasModelDownload = models.some((m) => m.isDownloading);
  useEffect(() => {
    if (!hasModelDownload) return;

    let cancelled = false;
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const res = await fetch(`${modelsApi}&progress=true`);
        if (res.ok) {
          const updated: SpeechModelInfo[] = await res.json();
          if (!cancelled) applyModels(updated);
        }
      } catch (err) {
        console.error('Polling models failed:', err);
      } finally { pending = false; }
    }, 500);

    return () => { cancelled = true; clearInterval(timer); };
  }, [hasModelDownload, modelsApi]);

  // Sync settings back to parent / job state
  const notifyJobUpdate = async (updates: Partial<AudiobookJob>) => {
    if (onUpdateJobSettings) {
      await onUpdateJobSettings(updates);
    }
    if (updates.selectedModelId) {
      fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected_model: updates.selectedModelId }) })
        .then(response => response.ok ? response.json() : Promise.reject(new Error('Could not save the selected model.')))
        .then(data => onConfigChange?.(data.config))
        .catch(error => console.error(error));
    }
  };

  // ----------------------------------------------------
  // Speech Models Handlers
  // ----------------------------------------------------

  const handleInstallModel = async (model: SpeechModelInfo, force = false) => {
    if (!modelAvailability.ready) return;
    try {
      const action = fasterEnabled ? 'prepare' : 'install';
      const query = `?engine=${transcriptionEngine}${force ? '&force=true' : ''}`;
      const res = await fetch(`/api/models/${model.id}/${action}${query}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.includes('NVIDIA GPU')) {
          setBlockedModelName(model.name);
          setShowGpuRequiredModal(true);
        } else {
          alert(data.error || 'Failed to install model');
        }
        return;
      }
      // Refresh models
      const modelsRes = await fetch(modelsApi);
      if (modelsRes.ok) {
        applyModels(await modelsRes.json());
      }
    } catch (err) {
      console.error('Install model error:', err);
    }
  };

  const handleCancelDownload = async (modelId: string) => {
    try {
      await fetch(`/api/models/${modelId}/cancel?engine=${transcriptionEngine}`, { method: 'POST' });
      const modelsRes = await fetch(modelsApi);
      if (modelsRes.ok) {
        applyModels(await modelsRes.json());
      }
    } catch (err) {
      console.error('Cancel download error:', err);
    }
  };

  const handleUninstallModel = async (modelId: string) => {
    if (!modelAvailability.ready) return;
    try {
      await fetch(`/api/models/${modelId}/uninstall?engine=${transcriptionEngine}`, { method: 'POST' });
      const modelsRes = await fetch(modelsApi);
      if (modelsRes.ok) {
        applyModels(await modelsRes.json());
      }
    } catch (err) {
      console.error('Uninstall model error:', err);
    }
  };

  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const handleRefreshModels = async () => {
    setIsRefreshingModels(true);
    try {
      const res = await fetch(`/api/models/refresh?engine=${transcriptionEngine}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        applyModels(data.models || []);
      }
    } catch (err) {
      console.error('Refresh models error:', err);
    } finally {
      setIsRefreshingModels(false);
    }
  };

  const handleFasterTranscriptionChange = async (enabled: boolean) => {
    setIsSwitchingEngine(true);
    try {
      const saveResponse = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faster_transcription: enabled }) });
      if (!saveResponse.ok) throw new Error('The setting could not be saved.');
      const saved = await saveResponse.json();
      setFasterEnabled(enabled);
      setModels([]);
      onConfigChange?.(saved.config);

    } catch (error) {
      setFasterEnabled(!enabled);
      console.error('Could not update transcription engine:', error);
    } finally { setIsSwitchingEngine(false); }
  };

  // ----------------------------------------------------
  // Validation Logic Before Continuing
  // ----------------------------------------------------

  const hasSourceFolder = Boolean(sourceFolderPath && sourceFolderPath.trim().length > 0);
  const hasAudioFiles = discoveredFiles.length > 0;
  const isOutputValid = isOutputWritable;

  // WhisperX downloads the selected Faster-Whisper model into the app-local cache
  // on first use, so a previous manual model download is not a prerequisite.
  const selectedModel = models.find((m) => m.id === selectedModelId && m.backend === transcriptionEngine);
  const isSelectedModelCompatible = selectedModel
    ? hardware.mode === 'gpu' || !selectedModel.requiresGpu
    : false;
  const isWhisperXValid =
    !needsTranscript || isSelectedModelCompatible;

  const processAvailability = feature(
    'audio_processing',
    ...(needsTranscript ? [fasterEnabled ? 'faster_transcription' : 'openai_transcription'] as const : []),
  );
  const canRunStep1 = processAvailability.ready && !isSwitchingEngine && !isSavingMusicSetting && hasSourceFolder && hasAudioFiles && isOutputValid && isWhisperXValid;
  useEffect(() => {
    onReadinessChange?.({ jobId: job.id, valid: canRunStep1 });
    return () => onReadinessChange?.({ jobId: job.id, valid: false });
  }, [job.id, canRunStep1, onReadinessChange]);
  const hasCompletedStep1 = Boolean(job.pipelineSteps?.extracting_chapters?.hasOutput
    || job.pipelineSteps?.detecting_chapters?.hasOutput
    || (job.status !== 'draft' && job.chapters.length > 0));
  const runButtonLabel = mergeMethod === 'skip' && !needsTranscript ? 'Continue to chapter review' : chapterSource !== 'whisperx'
    ? hasCompletedStep1 ? 'Re-run audio and chapters' : 'Prepare audio and chapters'
    : hasCompletedStep1 ? 'Re-run processing' : 'Run processing';

  // Execute Step 1
  const handleExecute = async () => {
    if (!canRunStep1) return;
    if (hasCompletedStep1 && !window.confirm('Audio preparation has already been completed. Are you sure you want to rerun it?')) return;

    await onRunStep1({
      generateWaveform,
      generateTranscript,
      chapterSource,
      mergeMethod,
      selectedModelId,
      transcriptionSettings: transcriptionOptions,
      sourceFolderPath,
      outputFolderPath,
      parts: discoveredFiles.map((f, idx) => ({
        id: `p-${idx + 1}`,
        name: f.storedName || f.relativePath || f.fileName,
        sourceRelativePath: f.relativePath,
        discNumber: f.discNumber,
        trackNumber: f.trackNumber,
        sizeBytes: f.sizeBytes,
        durationSeconds: f.durationSeconds,
        bitrate: f.bitrate || 0,
        order: idx + 1,
      })),
    });
  };

  const rerunnableStageCards: Step1ProcessState['stages'] = [
    { key: 'generating_waveform', label: 'Generate waveform (optional)', desc: 'Create waveform data for chapter review.' },
    { key: 'transcribing_whisper', label: chapterSource === 'whisperx' ? 'Speech recognition' : 'Generate transcript only', desc: 'Transcribe audio. Existing chapter markers remain unchanged.' },
    ...(chapterSource === 'whisperx' ? [{ key: 'detecting_chapters' as const, label: 'Detect chapter candidates', desc: 'Generate candidates from the transcript.' }]
      : chapterSource === 'manual' ? [] : [{ key: 'extracting_chapters' as const, label: chapterSource === 'existing_chapters' ? 'Read existing chapters' : 'Create chapters from files', desc: 'Read chapter markers for editing.' }]),
  ];
  const processingProgress: Step1ProcessState = step1Progress && (!step1Progress.jobId || step1Progress.jobId === job.id) ? {
    ...step1Progress,
    isActive: isRunning || step1Progress.isActive,
    ...(step1Progress.rerunStep ? { stages: rerunnableStageCards, totalStages: rerunnableStageCards.length } : {}),
  } : {
    jobId: job.id, isActive: isRunning, stage: hasCompletedStep1 ? 'completed' : 'idle', label: canRunStep1 ? 'Ready for Processing' : 'Not Ready', currentTask: hasCompletedStep1 ? 'Individual stages can be rerun.' : canRunStep1 ? 'Ready to start.' : 'Check the processing options and requirements below.',
    currentStageNumber: 0, totalStages: rerunnableStageCards.length, stages: rerunnableStageCards,
    percentage: hasCompletedStep1 ? 100 : 0, isDeterminate: true, elapsedSeconds: 0, liveStatusMessage: hasCompletedStep1 ? 'Processing complete.' : 'Idle', logs: [], canCancel: false,
  };

  const processingAction = (collapsed = false) => <ModelAction
    id={collapsed ? 'btn-run-step1-collapsed' : 'btn-run-step1-main'}
    icon={isRunning ? <Loader2 className="animate-spin" /> : <Play />}
    label={isRunning ? 'Processing...' : hasCompletedStep1 ? 'Re-run' : 'Run processing'} modelName=""
    title={processAvailability.tooltip || runButtonLabel}
    disabled={isRunning || !canRunStep1} onClick={() => void handleExecute()} />;

  return (
    <div className="processing-stage space-y-6">
      <TranscriptTimingWarning segments={job.transcriptSegments} />
      {/* GPU Required Modal */}
      {showGpuRequiredModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-xs p-4"
        >
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-stone-200 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-amber-800">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-stone-900">NVIDIA GPU Required</h3>
                <p className="text-xs text-stone-500 font-mono">
                  Target: {blockedModelName || 'High-Accuracy Model'}
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-stone-50 rounded-lg border border-stone-200 text-xs text-stone-700 leading-relaxed">
              This speech model requires a compatible NVIDIA GPU and cannot be installed or used in
              CPU-only mode. Choose a CPU-compatible model instead (such as Whisper Small or Base).
            </div>

            <div className="flex justify-end pt-2">
              <button
                id="btn-close-gpu-modal"
                onClick={() => setShowGpuRequiredModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-stone-100 cursor-pointer transition-colors"
              >
                Acknowledge & Choose CPU Model
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'process' && <>
      {/* Real-time Step 1 Processing Feedback Panel */}
      <DesktopWindow id="processing-progress" title="Audio processing" collapsedIcon={<Music className="h-5 w-5" />} headerOnly={!hasProcessingDetails(processingProgress, job.pipelineSteps)} expandWhen={processingProgress.isActive} collapsedActions={processingAction(true)}><Step1ProgressPanel
        ready={canRunStep1}
        processingAction={
          processingAction()
        }
        progress={processingProgress}
        pipelineSteps={job.pipelineSteps}
        onRerunStep={async step => {
          await onRerunStep(step, step === 'transcribing_whisper' ? { transcriptionSettings: transcriptionOptions, selectedModelId } : undefined);
        }}
        canRerunStep={(step) => !isSavingMusicSetting && canRerunStep(job, step)}
        onCancel={handleCancelStep1}
        onDismissSummary={() => setStep1Progress(null)}
      /></DesktopWindow>
      </>}

      {mode === 'process' && <>


      {/* Basic Workflow Options: chapter source and audio merge method */}
      <DesktopWindow id="processing-options" title="Audio and Chapters" collapsedIcon={<BookAudio className="h-5 w-5" />}><div className="workspace-panel processing-panel processing-options-parent bg-white rounded-xl border border-stone-200/80 shadow-xs">
        <header className="workspace-panel-header workspace-toolbar flex items-center gap-2 border-b border-stone-200 px-4 py-3">
          <Sliders className="w-5 h-5 text-amber-600" />
          <h3 className="workspace-panel-title inline-block font-bold text-sm text-stone-900">Audio and Chapters</h3>
        </header>
        <div className="processing-option-children p-4">

        <DesktopWindow id="chapter-creation" title="Chapter Creation" role="child" homeWindow="processing-options">
        <section className="workspace-panel processing-panel processing-options rounded-xl border border-stone-200 bg-white">
        <header className="workspace-panel-header workspace-toolbar px-4 py-3 border-b border-stone-200"><h4 className="workspace-panel-title text-sm font-bold">Chapter Creation</h4></header>
        <div className="chapter-option-notes grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
          {([
            {source:'whisperx',label:'Find spoken chapters',description:'Most accurate and feature-rich. Generates a transcript and suggests chapter starts.',help:'Best when the book has spoken chapter headings but no usable chapter list. AI suggests chapter starts for you to review.'},
            {source:'existing_files',label:'Use files & folders',description:'Creates chapters from sequential numbered folders. Individual files become their own chapters.',help:'Best when each audio file or numbered folder represents a chapter. Uses that structure to create markers without AI.'},
            {source:'grouped_files',label:'Use chapter groups',description:'Uses chapter groups from Book Files. Ungrouped files become their own chapters.',help:'Best when a chapter spans several files or you want to name the groups yourself. Create groups in Book Files first, then use them as chapters.'},
            {source:'existing_chapters',label:'Use existing chapters',description:'Use embedded markers or a matched chapter/playlist file.',help:'Best when the audiobook already has embedded chapters or a chapter/playlist file. Load those markers, then edit any names or timings that need fixing.'},
            {source:'manual',label:'Skip',description:'Open the Chapter Editor without generating markers.',help:'Best when you want to build the chapter list yourself or keep working on your current edits. Opens the editor without generating new markers.'},
          ] as const).map(choice=>{
            const selected=chapterSource===choice.source;
            const ai=choice.source==='whisperx'||(selected&&generateTranscript);
            return <div key={choice.source} onClick={event=>{if(isRunning||(event.target as Element).closest('input,button,label,.chapter-option-info,.chapter-transcript-option'))return;setChapterSource(choice.source);void notifyJobUpdate({chapterSource:choice.source});}} className={`chapter-option-note p-4 rounded-xl border-2 flex flex-col ${selected?'border-amber-500 bg-amber-50/60':'border-stone-200'}`}>
              <span className="flex items-center gap-2"><label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="chapterSource" value={choice.source} aria-label={choice.source==='existing_files'?'Use files and folders':choice.label} checked={selected} disabled={isRunning} onChange={()=>{setChapterSource(choice.source);void notifyJobUpdate({chapterSource:choice.source});}} />
                <span className="font-bold text-sm">{choice.label} <OptionInfo text={choice.help}/></span>
              </label></span>
              <div className="chapter-source-badges mt-2 flex flex-wrap items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${ai?'bg-amber-100 text-amber-800':'bg-stone-200 text-stone-700'}`}>{ai?'AI · Slow':'No AI · Fast'}</span>
                {choice.source==='existing_chapters'&&existingChapterInfo.count>0&&<>
                  <span role="status" className="px-2 py-0.5 rounded bg-stone-200 text-stone-700 text-[11px] font-semibold">{existingChapterInfo.count} chapters</span>
                  <span role="img" aria-label={existingChapterInfo.source||'Embedded chapters from audio'} title={existingChapterInfo.source||'Embedded chapters from audio'} className="chapter-source-mark inline-flex opacity-70" style={{color:'var(--sm-muted)'}}>
                    {(!existingChapterInfo.source||existingChapterInfo.source==='Embedded chapters')?<FileAudio aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5}/>:<ListMusic aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5}/>}
                  </span>
                </>}
              </div>
              <p className="mt-2 text-xs">{choice.description}</p>
              {choice.source==='grouped_files'&&<span className="mt-2 text-[11px]">{new Set(job.parts.flatMap(part=>part.chapterGroup?[part.chapterGroup.id]:[])).size} chapter groups saved in Book Files</span>}
              {choice.source==='existing_chapters'&&<>
                {!existingChapterInfo.count&&<p role="status" className="mt-2 text-xs">{existingChapterInfo.source||'No confirmed chapters found yet. Checks the selected audio and matching chapter files again when you continue.'}</p>}
                {chapterFileMessage&&<p role="status" className="mt-2 text-xs">{chapterFileMessage}</p>}
                <div className="mt-auto flex items-center gap-2 pt-3">
                  <input ref={chapterFileInput} type="file" hidden aria-label="Chapter or playlist file" accept=".cue,.m3u,.m3u8,.pls,.xspf,.wpl,.asx,.ffmeta,.ffmetadata,.txt,.xml,.vtt" onChange={event=>{const file=event.target.files?.[0];if(file)void importChapterFile(file);}} />
                  <div className="ml-auto flex items-center gap-2">
                    {existingChapterInfo.importedName&&<button type="button" aria-label="Clear imported chapter source" title="Use detected chapters again" disabled={isRunning||importingChapterFile} onClick={()=>void clearChapterFile()} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-300"><Undo2 className="h-4 w-4"/></button>}
                    <button type="button" aria-label="Import chapter or playlist file" title="Import chapters or playlist: CUE, M3U/M3U8, PLS, XSPF, WPL, ASX, FFmetadata, chapter TXT/XML or WebVTT" disabled={isRunning||importingChapterFile} onClick={()=>chapterFileInput.current?.click()} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-300 disabled:opacity-50">{importingChapterFile?<Loader2 className="h-4 w-4 animate-spin"/>:<Import className="h-4 w-4"/>}</button>
                  </div>
                </div>
              </>}
              {selected&&choice.source!=='whisperx'&&<div className="chapter-transcript-option mt-auto pt-3 text-right">
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px]">
                  <input type="checkbox" aria-label="Generate transcript" checked={generateTranscript} disabled={isRunning} onChange={event=>{setGenerateTranscript(event.target.checked);void notifyJobUpdate({generateTranscript:event.target.checked});}} />
                  <span>Generate transcript <OptionInfo text="Use this when you want searchable text or word-by-word timing for review. Your chapter markers stay unchanged."/></span>
                </label>
              </div>}
            </div>;
          })}
        </div>
        <div className="px-4 pb-4 space-y-2">
        </div>
        </section>
        </DesktopWindow>

        {/* Audio Merge Method */}
        <DesktopWindow id="audio-preparation" title="Audio Preparation" role="child" homeWindow="processing-options">
        <section className="workspace-panel processing-panel processing-options rounded-xl border border-stone-200 bg-white">
        <header className="workspace-panel-header workspace-toolbar px-4 py-3 border-b border-stone-200"><h4 className="workspace-panel-title text-sm font-bold">Audio Preparation</h4></header>
          <div className="space-y-3 p-4">
            <div className="chapter-option-notes grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                {method:'standard',label:'Prepare for accuracy',description:'Standardizes audio for reliable timing and chapter detection.',help:'Best for mixed audio formats or files with inconsistent timing. Standardizes audio for reliable chapter review and transcription, but takes longer.'},
                {method:'quick',label:'Join without converting',description:'Joins compatible audio unchanged.',help:'Best when you have several clean files with matching audio settings. Joins them without re-encoding after the audio check confirms they are compatible.'},
                {method:'skip',label:'Skip',description:'Keep the original files without normalization or joining.',help:'Best for clean, finished audio that only needs metadata or chapter edits. Keeps the original files as the audio source and leaves any required joining until export.'},
              ] as const).map(choice=>{
                const selected=mergeMethod===choice.method;
                const unavailable=choice.method==='quick'&&!streamCopyCompatible;
                const ai=selected&&needsTranscript;
                const fast=choice.method!=='standard'&&!ai;
                return <div key={choice.method} onClick={event=>{if(isRunning||unavailable||selected||(event.target as Element).closest('input,label,button,.chapter-option-info'))return;setMergeMethod(choice.method);void notifyJobUpdate({mergeMethod:choice.method});}} className={`chapter-option-note p-4 rounded-xl border-2 flex flex-col ${unavailable?'opacity-50 cursor-not-allowed':selected?'border-amber-500 bg-amber-50/60':'border-stone-200'}`} title={unavailable?`Unavailable: ${compatibility.reason}`:undefined}>
                  <span className="flex items-center gap-2"><label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="mergeMethod" value={choice.method} aria-label={choice.label} disabled={isRunning||unavailable} checked={selected} onChange={()=>{setMergeMethod(choice.method);void notifyJobUpdate({mergeMethod:choice.method});}} />
                    <span className="font-bold text-sm">{choice.label} <OptionInfo text={choice.help}/></span>
                  </label></span>
                  <span className={`self-start mt-2 px-2 py-0.5 rounded text-[11px] font-semibold ${ai?'bg-amber-100 text-amber-800':'bg-stone-200 text-stone-700'}`}>{ai?'AI':'No AI'} · {fast?'Fast':'Slow'}</span>
                  <p className="mt-2 text-xs">{choice.description}</p>
                  <div className="audio-waveform-option mt-auto pt-3 text-right">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px]">
                      <input type="checkbox" aria-label={`Generate waveform — ${choice.label}`} checked={selected&&generateWaveform} disabled={isRunning||unavailable||!selected} onChange={event=>{setGenerateWaveform(event.target.checked);void notifyJobUpdate({generateWaveform:event.target.checked});}} />
                      <span>Generate waveform <OptionInfo text="Enable this for a visual audio timeline when reviewing chapter boundaries. Leave it off to skip waveform analysis; transcription can still run."/></span>
                    </label>
                  </div>
                </div>;
              })}
            </div>

            {/* Persistent inline warning for Quick Merge */}
            {mergeMethod === 'quick' && streamCopyCompatible && (
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 flex items-start space-x-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold">Warning:</span> Use Skip PCM only with clean audio, continuous timestamps and matching stream parameters. Files with timestamp drift, malformed headers, or inconsistent encoders may produce inaccurate transcription timing or chapter boundaries.
                </div>
              </div>
            )}
          </div>
        </section>
        </DesktopWindow>
      </div>

      </div>

      </DesktopWindow>
      {/* Model management is intentionally secondary to the main import workflow. */}
      <DesktopWindow id="transcription-settings" title="Transcription Settings"><details
        className={`workspace-panel processing-panel processing-models advanced-disclosure bg-white rounded-xl border transition-all ${
          'border-stone-200/80 shadow-xs'
        }`}
      >
        <summary className="workspace-panel-header workspace-toolbar flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
          <span className="flex min-w-0 items-center gap-3"><Sparkles className="h-4 w-4 shrink-0 text-amber-700" /><span className="min-w-0"><span className="workspace-panel-title inline-block text-sm font-bold text-stone-900">Transcription Settings</span><span className="block truncate text-xs text-stone-500">{selectedModel?.name || 'Choose a speech model'} · {fasterEnabled ? 'optimized engine' : 'compatibility engine'}</span></span></span>
          <span className="workspace-header-toggle ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center text-stone-500"><ChevronDown aria-hidden="true" className="disclosure-chevron h-4 w-4" /></span>
        </summary>
        <div className="space-y-4 border-t border-stone-200 p-5">
        {musicSettingError && <p role="alert" className="text-xs text-red-700">{musicSettingError}</p>}
        <TranscriptionOptions engine={transcriptionEngine} model={selectedModelId}
          leadingControls={<>

          <div className="processing-setting-switch">
            <button type="button" role="switch" aria-label="Faster Transcription" aria-checked={fasterEnabled}
              disabled={isSwitchingEngine || isRunning} onClick={() => void handleFasterTranscriptionChange(!fasterEnabled)}
              className="processing-compact-switch"><span aria-hidden="true" /></button>
            <span className="text-sm font-bold">Faster Transcription</span>
            <OptionInfo text="Uses the optimized Faster Whisper engine for faster processing and lower memory usage. Recommended for most systems." />
          </div>
          <div className="processing-setting-switch">
            <button type="button" role="switch" aria-label="Improved Chapter Detection" aria-checked={config.detect_musical_transitions === true}
              disabled={isRunning || isSavingMusicSetting || chapterSource !== 'whisperx'}
              onClick={() => void handleMusicDetectionChange(config.detect_musical_transitions !== true)}
              className="processing-compact-switch"><span aria-hidden="true" /></button>
            <span className="text-sm font-bold">Improved Chapter Detection <span className="text-xs font-normal text-amber-700">Experimental</span></span>
            <OptionInfo text="Off by default. Suggests numbered sections, isolated titles, source boundaries and acoustic cues. Rechecks a limited number of uncertain headings with your existing model. Suggestions require acceptance in chapter review; no additional models are installed." />
          </div>
          </>}
          value={transcriptionOptions[transcriptionEngine]} capability={backendCapability} disabled={isRunning || isSwitchingEngine}
          onChange={value => {
            const updated = { ...transcriptionOptions, [transcriptionEngine]: value };
            setTranscriptionOptions(updated);
            notifyJobUpdate({ transcriptionSettings: updated });
          }} />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-amber-600" />
            <div>
              <h3 className="font-bold text-sm text-stone-900">Models</h3>
              <p className="inline-flex items-center gap-2 text-xs font-semibold text-amber-800">
                {fasterEnabled ? 'Faster Whisper' : 'OpenAI Whisper / PyTorch models'}
                <OptionInfo text="Installed models are marked and can be reinstalled or removed. Larger models are usually more accurate but take longer and use more storage." />
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {!needsTranscript ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded bg-stone-200 text-stone-600">
                Not needed for file-based chapters
              </span>
            ) : (
              <>
                <AdaptiveButton
                  onClick={handleRefreshModels}
                  disabled={isRefreshingModels}
                  icon={<RefreshCw className={isRefreshingModels ? 'animate-spin' : ''} />}
                  label={isRefreshingModels ? 'Checking Disk...' : 'Refresh Models'}
                  compactLabel="Refresh"
                  className="px-2.5 py-1 rounded text-[11px] font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 transition-colors cursor-pointer flex items-center space-x-1"
                  title="Scan local models directory on disk for downloaded weights"
                />

              </>
            )}
          </div>
        </div>

        {!needsTranscript ? (
          <div className="p-3 bg-stone-100/70 rounded-lg text-xs text-stone-500 italic">
            Transcription is optional for this chapter source. Enable Generate transcript above to configure it, or run Generate transcript only after opening chapter review.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Models Table / Cards */}
            <div className="processing-model-grid grid grid-cols-1 md:grid-cols-2 gap-3">
              {models.filter(model => model.backend === transcriptionEngine).map((model) => {
                const isSelected = selectedModelId === model.id;
                const isRecommended = hardware.recommendedModelId === model.id;
                const isUnavailableGpu = model.requiresGpu && hardware.mode === 'cpu';

                return (
                  <div
                    key={model.id}
                    onClick={() => {
                      if (isUnavailableGpu) {
                        setBlockedModelName(model.name);
                        setShowGpuRequiredModal(true);
                      } else {
                        setSelectedModelId(model.id);
                        notifyJobUpdate({ selectedModelId: model.id });
                      }
                    }}
                    className={`processing-model-card p-4 rounded-xl border-2 transition-all flex flex-col justify-between ${
                      isUnavailableGpu
                        ? 'opacity-60 bg-stone-100/80 border-stone-200 cursor-not-allowed'
                        : isSelected
                        ? 'bg-amber-50/70 border-amber-500 shadow-xs cursor-pointer'
                        : 'bg-white border-stone-200 hover:border-stone-300 cursor-pointer'
                    }`}
                  >
                    <div className="space-y-2">
                      {/* Title & Badges */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name="selectedModel"
                            value={model.id}
                            checked={isSelected}
                            disabled={isUnavailableGpu}
                            onChange={() => {
                              setSelectedModelId(model.id);
                              notifyJobUpdate({ selectedModelId: model.id });
                            }}
                            className="w-4 h-4 text-amber-600 focus:ring-amber-500"
                          />
                          <div>
                            <span className="font-bold text-sm text-stone-900 block">
                              {model.name}
                            </span>
                            <span className="text-[11px] font-mono text-stone-500">
                              Size: {model.sizeLabel}
                              {model.isInstalled && model.sizeOnDiskLabel && (
                                <span className="ml-1 text-emerald-700 font-semibold">
                                  ({model.sizeOnDiskLabel} on disk)
                                </span>
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="processing-model-badges">
                          <span title={model.requiresGpu ? 'Requires a compatible NVIDIA GPU' : 'Compatible with GPU and CPU processing'}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium ${model.requiresGpu ? hardware.mode === 'gpu' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800' : 'bg-stone-100 text-stone-700'}`}>
                            {model.requiresGpu ? 'GPU' : 'GPU & CPU'}
                          </span>
                          {isRecommended && <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">★ Recommended</span>}
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-xs text-stone-600 leading-relaxed">{model.description}</p>

                      {/* Inline GPU Warning if CPU mode */}
                      {isUnavailableGpu && (
                        <div className="p-2 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800 flex items-center space-x-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                          <span>
                            Requires a compatible NVIDIA GPU. Your system is currently running in CPU-only mode.
                          </span>
                        </div>
                      )}

                      {/* Download Error Banner if any */}
                      {model.downloadError && (
                        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start space-x-2">
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <span className="font-semibold block text-[11px]">Download failed</span>
                            <span className="text-[11px] text-rose-700">{model.downloadError}</span>
                          </div>
                        </div>
                      )}

                      {/* Download Progress Bar if downloading */}
                      {model.isDownloading && (
                        <div className="space-y-1 pt-1">
                          <div className="flex justify-between text-[11px] text-amber-900 font-mono">
                            <span>Downloading model files ({model.downloadSpeed || 'in progress'})...</span>
                            <span className="font-bold">
                              {model.downloadedBytes && model.totalBytes
                                ? `${(model.downloadedBytes / (1024 * 1024)).toFixed(1)} / ${(model.totalBytes / (1024 * 1024)).toFixed(1)} MB (${model.downloadProgress || 0}%)`
                                : `${model.downloadProgress || 0}%`}
                            </span>
                          </div>
                          <div className="w-full bg-stone-200 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-amber-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${Math.max(2, model.downloadProgress || 0)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="processing-model-footer pt-3 border-t border-stone-100 mt-3 flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-1.5">
                        {model.isInstalled ? (
                          <span className="inline-flex items-center text-emerald-700 font-semibold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                            Installed {model.sizeOnDiskLabel ? `(${model.sizeOnDiskLabel})` : ''}
                          </span>
                        ) : model.isDownloading ? (
                          <span className="inline-flex items-center text-amber-700 font-semibold text-[11px]">
                            <div className="w-3 h-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mr-1.5" />
                            Downloading...
                          </span>
                        ) : (
                          <span className="text-stone-400 text-[11px]">{model.downloadError ? 'Failed' : 'Not Installed'}</span>
                        )}
                      </div>

                      <div className="processing-model-actions">
                        {model.isDownloading ? (
                          <ModelAction icon={<XCircle />} label="Cancel" modelName={model.name} onClick={() => void handleCancelDownload(model.id)} />
                        ) : model.isInstalled ? <>
                          <ModelAction icon={<RefreshCw />} label="Reinstall" modelName={model.name}
                            disabled={!modelAvailability.ready} title={modelAvailability.tooltip || 'Download a fresh copy of this model into the application cache'}
                            onClick={() => void handleInstallModel(model, true)} />
                          <ModelAction icon={<Trash2 />} label="Uninstall" modelName={model.name}
                            title="Removes only downloaded weights; never touches user audiobooks or settings"
                            disabled={!modelAvailability.ready} onClick={() => void handleUninstallModel(model.id)} />
                        </> : (
                          <ModelAction icon={<Download />} label="Install" modelName={model.name}
                            disabled={isUnavailableGpu || !modelAvailability.ready} title={modelAvailability.tooltip}
                            onClick={() => void handleInstallModel(model)} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>
      </details></DesktopWindow>

      <PreviewPanel id="processing-readiness" title="Workflow">
          <ul aria-label="Selected processing options" className="list-disc list-inside space-y-2 text-xs font-medium text-amber-800">
            <li>{chapterSource === 'whisperx' ? 'Find spoken chapters' : chapterSource === 'grouped_files' ? 'Use chapter groups' : chapterSource === 'existing_chapters' ? 'Use existing chapters' : chapterSource === 'manual' ? 'Edit chapters manually' : 'Use files & folders'}</li>
            <li>{mergeMethod === 'skip' ? 'Skip' : mergeMethod === 'quick' ? 'Join without converting' : 'Prepare for accuracy'}</li>
            {generateWaveform && <li>Generate waveform</li>}
            {needsTranscript && selectedModel && <li>{selectedModel.name}</li>}
          </ul>
          <p className="processing-gpu-summary" role="status">
            <span>GPU acceleration</span>
            <span tabIndex={0} className={`processing-gpu-status ${backendCapability?.gpuAvailable ? 'is-available' : !backendCapability || backendCapability.gpuDetected || hardware.mode === 'gpu' ? 'is-unavailable' : 'is-missing'}`}
              title={backendCapability?.gpuAvailable ? hardware.gpuName || 'Compatible CUDA GPU detected' : !backendCapability ? 'Checking GPU support for the selected transcription engine.' : backendCapability.gpuDetected || hardware.mode === 'gpu' ? backendCapability.reason || 'A GPU was detected, but acceleration is unavailable for the selected transcription engine or runtime.' : 'GPU acceleration requires a CUDA-capable GPU.'}>
              {backendCapability?.gpuAvailable ? 'Available' : !backendCapability || backendCapability.gpuDetected || hardware.mode === 'gpu' ? 'Unavailable' : 'Hardware not detected'}
            </span>
          </p>
      </PreviewPanel></>}
    </div>
  );
};
