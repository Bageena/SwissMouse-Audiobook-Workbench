import { TranscriptionOptions } from './TranscriptionOptions';
import { capabilityLabel, type BackendCapabilities } from '../transcription';
import { YouTubeIcon } from './YouTubeIcon';
import { stitchCompatibility } from '../audioFormats';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  AudiobookJob,
  WorkbenchConfig,
  ChapterSourceType,
  AudioMergeMethodType,
  HardwareInfo,
  SpeechModelInfo,
  DiscoveredMp3File,
  FolderScanResult,
  SourceSummaryData,
  Step1InputMethod
} from '../types';
import { SourceSummary } from './SourceSummary';
import { YouTubeAudioImport } from './YouTubeAudioImport';
import { LibriVoxImport } from './LibriVoxImport';
import { Step1ProgressPanel } from './Step1ProgressPanel';
import { useDependencyStatus } from '../dependency-status';
import { RerunnablePipelineStep, Step1ProcessState } from '../types';
import { canRerunStep } from '../utils/pipelineRerun';
import {
  Loader2, FolderOpen, BookOpen,
  FolderCheck,
  FileAudio,
  Layers,
  Cpu,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Download,
  Trash2,
  XCircle,
  RotateCcw,
  Play,
  ArrowRight,
  Clock,
  HardDrive,
  ShieldCheck,
  Sliders,
  ChevronDown,
  ChevronUp,
  FolderSync,
  FolderEdit,
  Radio,
  FileCheck,
  RefreshCw
} from 'lucide-react';

interface Step1Props {
  job: AudiobookJob;
  config: WorkbenchConfig;
  onRunStep1: (options?: {
    chapterSource?: ChapterSourceType;
    mergeMethod?: AudioMergeMethodType;
    selectedModelId?: string;
    transcriptionSettings?: AudiobookJob['transcriptionSettings'];
    sourceFolderPath?: string;
    outputFolderPath?: string;
    parts?: any[];
  }) => Promise<void>;
  onRerunStep: (step: RerunnablePipelineStep) => Promise<void>;
  isRunning: boolean;
  onNextStep: () => void;
  onUpdateJobSettings?: (settings: Partial<AudiobookJob>) => void;
  onConfigChange?: (config: WorkbenchConfig) => void;
}

export const Step1MergeDetect: React.FC<Step1Props> = ({
  job,
  config,
  onRunStep1,
  onRerunStep,
  isRunning,
  onNextStep,
  onUpdateJobSettings,
  onConfigChange,
}) => {
  const { feature } = useDependencyStatus();
  const [fasterEnabled, setFasterEnabled] = useState(config.faster_transcription);
  useEffect(() => setFasterEnabled(config.faster_transcription), [config.faster_transcription]);
  const [isSwitchingEngine, setIsSwitchingEngine] = useState(false);
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
  const importAvailability = feature('file_import');
  const scanAvailability = feature('folder_scan');
  const modelAvailability = feature(fasterEnabled ? 'faster_model_management' : 'openai_model_management');
  const modelsApi = `/api/models?engine=${transcriptionEngine}`;
  const engineRef = useRef(transcriptionEngine);
  engineRef.current = transcriptionEngine;
  // Folder & Files State (persisted on job where available)
  const [sourceFolderPath, setSourceFolderPath] = useState<string>(
    job.sourceFolderPath || ''
  );
  const [discoveredFiles, setDiscoveredFiles] = useState<DiscoveredMp3File[]>(
    job.discoveredFiles ||
      job.parts.map((p, i) => ({
        relativePath: p.sourceRelativePath || p.name,
        storedName: p.name,
        fileName: p.name,
        folderName: 'Root',
        sizeBytes: p.sizeBytes,
        durationSeconds: p.durationSeconds,
      }))
  );
  const [hasNestedChapters, setHasNestedChapters] = useState<boolean>(
    job.hasNestedChapterFolders ?? false
  );
  const [isScanningFolder, setIsScanningFolder] = useState<boolean>(false);
  const [folderScanError, setFolderScanError] = useState<string | null>(null);
  const [isSourceExpanded, setIsSourceExpanded] = useState(true);
  const [showFilePreview, setShowFilePreview] = useState<boolean>(false);
  const [customPathInput, setCustomPathInput] = useState<string>('');
  const [showPathInput, setShowPathInput] = useState<boolean>(false);

  // Source selection is shared by local and remote importers.
  const [inputMethod, setInputMethod] = useState<Step1InputMethod>(
    job.inputMethod || (job.youtubeUrl ? 'youtube' : 'folder')
  );

  // Workflow State (persisted on job or default to safe workflow)
  const [chapterSource, setChapterSource] = useState<ChapterSourceType>(
    job.chapterSource || 'whisperx'
  );
  const [mergeMethod, setMergeMethod] = useState<AudioMergeMethodType>(
    job.mergeMethod || 'standard'
  );

  // Detected audio formats across discovered files
  const formatsDetected = useMemo(() => {
    if (job.sourceSummary?.formatsDetected?.length) return job.sourceSummary.formatsDetected;
    const exts = new Set<string>();
    discoveredFiles.forEach((f) => {
      const ext = f.fileName.split('.').pop()?.toLowerCase();
      if (ext) exts.add(ext);
    });
    return exts.size > 0 ? Array.from(exts) : ['mp3'];
  }, [discoveredFiles, job.sourceSummary]);

  const compatibility = useMemo(() => stitchCompatibility(discoveredFiles), [discoveredFiles]);
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
  const [defaultOutputFolder, setDefaultOutputFolder] = useState<string>('output');
  const [isOutputWritable, setIsOutputWritable] = useState<boolean>(true);
  const [outputFolderError, setOutputFolderError] = useState<string | null>(null);
  const [showOutputInput, setShowOutputInput] = useState<boolean>(false);
  const [customOutputInput, setCustomOutputInput] = useState<string>('');

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
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);

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

  // Native folder selection input ref
  const folderInputRef = useRef<HTMLInputElement>(null);
  // Native output folder selection input ref
  const outputFolderInputRef = useRef<HTMLInputElement>(null);

  // Natural sort helper for client-side sorting
  const naturalSort = <T,>(items: T[], keyFn: (item: T) => string): T[] => {
    return [...items].sort((a, b) =>
      keyFn(a).localeCompare(keyFn(b), undefined, { numeric: true, sensitivity: 'base' })
    );
  };

  // Load initial hardware, models, and output directory
  useEffect(() => {
    let cancelled = false;
    async function initHardwareAndModels() {
      setIsLoadingModels(true);
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
          setDefaultOutputFolder(outData.defaultOutputFolder);
          setIsOutputWritable(outData.isWritable);
        }
      } catch (err) {
        console.error('Failed to load hardware or models info:', err);
      } finally {
        setIsLoadingModels(false);
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
  const notifyJobUpdate = (updates: Partial<AudiobookJob>) => {
    if (onUpdateJobSettings) {
      onUpdateJobSettings(updates);
    }
    if (updates.selectedModelId) {
      fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected_model: updates.selectedModelId }) })
        .then(response => response.ok ? response.json() : Promise.reject(new Error('Could not save the selected model.')))
        .then(data => onConfigChange?.(data.config))
        .catch(error => console.error(error));
    }
  };

  // ----------------------------------------------------
  // Folder Import Handlers
  // ----------------------------------------------------

  // Trigger native folder browser dialog
  const handleOpenNativeFolderPicker = () => {
    if (!importAvailability.ready) return;
    if (folderInputRef.current) {
      folderInputRef.current.click();
    }
  };

  // Supported audio extensions regex: MP3, M4A, AAC, M4B, OGG, OPUS, FLAC, WAV, AIFF, WMA
  const AUDIO_EXTENSIONS_REGEX = /\.(mp3|m4a|aac|m4b|ogg|oga|opus|flac|wav|aiff|aif|wma|alac)$/i;

  // Handle native folder picker selection (webkitdirectory)

  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadProgressState, setUploadProgressState] = useState('');

  const handleNativeFolderSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!importAvailability.ready) { event.target.value = ''; return; }
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const filesToUpload: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
        if (AUDIO_EXTENSIONS_REGEX.test(fileList[i].name)) {
            filesToUpload.push(fileList[i]);
        }
    }

    if (filesToUpload.length === 0) {
      setFolderScanError('No supported audio files were found in the selected folder.');
      setDiscoveredFiles([]);
      return;
    }

    setIsUploadingFiles(true);
    setUploadProgressState('Preparing upload...');
    
    try {
        const formData = new FormData();
        filesToUpload.forEach(f => formData.append('files', f, f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name));

        setUploadProgressState(`Uploading ${filesToUpload.length} files to internal workspace...`);
        const res = await fetch(`/api/upload-audio?jobId=${job.id}`, {
            method: 'POST',
            body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'Failed to upload files');
        
        // Use the server-side filenames and metadata directly
        const sortedUploadedFiles = naturalSort(data.files, (f: any) => f.originalName);

        const audioFiles: DiscoveredMp3File[] = sortedUploadedFiles.map((f: any) => {
          // Flatten folder name for the UI display, but keep original for sorting context if needed
          const pathParts = f.originalName.split(/[/\\]/);
          const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'Root';
          const chapterGroup = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : undefined;

          return {
            relativePath: f.originalName,
            fileName: pathParts[pathParts.length - 1],
            storedName: f.filename,
            folderName: folderName,
            chapterGroup: chapterGroup,
            sizeBytes: f.size,
            durationSeconds: f.durationSeconds,
            format: f.format,
            codec: f.codec,
            sampleRate: f.sampleRate,
            channels: f.channels,
            isProbed: true,
            streamSignature: f.streamSignature,
          };
        });

        const chapterFolders = new Set<string>();
        audioFiles.forEach(af => {
            if (af.chapterGroup) chapterFolders.add(af.chapterGroup);
        });

        setFolderScanError(null);
        setSourceFolderPath(data.uploadDir); 
        
        setDiscoveredFiles(audioFiles);
        setHasNestedChapters(chapterFolders.size > 0);
        setInputMethod('folder');
        
        notifyJobUpdate({
            inputMethod: 'folder',
            sourceFolderPath: data.uploadDir,
            discoveredFiles: audioFiles,
            hasNestedChapterFolders: chapterFolders.size > 0,
            parts: audioFiles.map((f, idx) => ({
                id: `p-${idx + 1}`,
                name: f.storedName || f.fileName, // App-owned disk filename
                sourceRelativePath: f.relativePath,
                sizeBytes: f.sizeBytes,
                durationSeconds: f.durationSeconds,
                bitrate: f.bitrate || 0,
                order: idx + 1,
            }))
        });

    } catch (e: any) {
        setFolderScanError(e.message || 'Upload failed');
    } finally {
        setIsUploadingFiles(false);
        setUploadProgressState('');
    }
  };


  // Scan folder by path on local filesystem
  const handleScanLocalPath = async (pathToScan: string) => {
    if (!scanAvailability.ready) return;
    setIsScanningFolder(true);
    setFolderScanError(null);
    try {
      const res = await fetch('/api/system/scan-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: pathToScan }),
      });
      const data: FolderScanResult = await res.json();
      if (!res.ok) {
        throw new Error((data as any).error || 'Failed to scan folder');
      }

      if (data.totalFiles === 0) {
        setFolderScanError('No supported audio files (.mp3, .m4a, .m4b, .flac, .ogg, .opus, .wav, etc.) were found in the selected folder.');
        setDiscoveredFiles([]);
        return;
      }

      setSourceFolderPath(data.sourcePath);
      setDiscoveredFiles(data.files);
      setHasNestedChapters(data.hasNestedChapterFolders);
      setInputMethod('folder');

      notifyJobUpdate({
        inputMethod: 'folder',
        sourceFolderPath: data.sourcePath,
        discoveredFiles: data.files,
        hasNestedChapterFolders: data.hasNestedChapterFolders,
        parts: data.files.map((f, idx) => ({
          id: `p-${idx + 1}`,
          name: f.relativePath || f.fileName,
          sourceRelativePath: f.relativePath,
          sizeBytes: f.sizeBytes,
          durationSeconds: f.durationSeconds,
          bitrate: f.bitrate || 0,
          order: idx + 1,
        })),
      });
    } catch (err: any) {
      setFolderScanError(err.message || 'Could not scan specified folder.');
    } finally {
      setIsScanningFolder(false);
    }
  };

  const [libriVoxBusy, setLibriVoxBusy] = useState(false);
  // Remote importers return the same source-job shape used by folder imports.
  const handleYouTubeAudioImported = (updatedJob: AudiobookJob) => {
    setInputMethod(updatedJob.inputMethod || 'youtube');
    setMergeMethod(updatedJob.mergeMethod || 'quick');
    if (updatedJob.sourceFolderPath) setSourceFolderPath(updatedJob.sourceFolderPath);
    if (updatedJob.discoveredFiles) setDiscoveredFiles(updatedJob.discoveredFiles);
    if (updatedJob.chapterSource) setChapterSource(updatedJob.chapterSource);
    if (updatedJob.hasNestedChapterFolders !== undefined) {
      setHasNestedChapters(updatedJob.hasNestedChapterFolders);
    }
    notifyJobUpdate(updatedJob);
  };

  // Reset current source selection to pick a different folder or YouTube video
  const handleResetSource = () => {
    setDiscoveredFiles([]);
    setSourceFolderPath('');
    notifyJobUpdate({
      discoveredFiles: [],
      sourceFolderPath: '',
      youtubeUrl: undefined,
      youtubeVideoInfo: undefined,
      sourceSummary: undefined,
      parts: [],
    });
  };

  // ----------------------------------------------------
  // Output Folder Handlers
  // ----------------------------------------------------

  // Trigger native file explorer to choose an output folder
  const handleOpenNativeOutputFolderPicker = async () => {
    // Browser directory handles expose only a folder name, not its absolute disk path.
    setShowOutputInput(true);
    setCustomOutputInput(outputFolderPath);
    setOutputFolderError('Paste the full output folder path. Browser folder selection cannot provide its disk location.');
  };

  // Handle folder chosen via native file explorer input
  const handleNativeOutputFolderSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    // The root folder chosen by the user in file explorer
    const chosenFolder = fileList[0]?.webkitRelativePath?.split('/')[0] || fileList[0]?.name;
    if (chosenFolder) {
      await handleSetOutputFolder(chosenFolder);
    }
    // Reset file input so selecting the same folder again triggers change event
    event.target.value = '';
  };

  const handleSetOutputFolder = async (newPath: string) => {
    setOutputFolderError(null);
    try {
      const res = await fetch('/api/system/output-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder: newPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'The selected output folder cannot be written to.');
      }
      setOutputFolderPath(data.outputFolder);
      setIsOutputWritable(true);
      setShowOutputInput(false);
      notifyJobUpdate({ outputFolderPath: data.outputFolder });
    } catch (err: any) {
      setOutputFolderError(err.message);
      setIsOutputWritable(false);
    }
  };

  const handleResetDefaultOutput = async () => {
    setOutputFolderError(null);
    try {
      const res = await fetch('/api/system/output-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder: defaultOutputFolder }),
      });
      const data = await res.json();
      if (res.ok) {
        setOutputFolderPath(data.outputFolder);
        setIsOutputWritable(true);
        notifyJobUpdate({ outputFolderPath: data.outputFolder });
      }
    } catch (err) {
      console.error(err);
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
  const isOutputValid = isOutputWritable && !outputFolderError;

  // WhisperX downloads the selected Faster-Whisper model into the app-local cache
  // on first use, so a previous manual model download is not a prerequisite.
  const selectedModel = models.find((m) => m.id === selectedModelId && m.backend === transcriptionEngine);
  const isSelectedModelCompatible = selectedModel
    ? hardware.mode === 'gpu' || !selectedModel.requiresGpu
    : false;
  const isWhisperXValid =
    chapterSource !== 'whisperx' || isSelectedModelCompatible;

  const processAvailability = feature(
    'audio_processing',
    ...(chapterSource === 'whisperx' ? [fasterEnabled ? 'faster_transcription' : 'openai_transcription'] as const : []),
  );
  const canRunStep1 = processAvailability.ready && !isSwitchingEngine && hasSourceFolder && hasAudioFiles && isOutputValid && isWhisperXValid;
  const runButtonLabel = chapterSource === 'existing_files'
    ? 'Prepare audio and chapters'
    : job.status !== 'draft'
    ? 'Re-Run Processing'
    : 'Prepare audiobook';

  // Source summary object for SourceSummary component
  const sourceSummaryData: SourceSummaryData = useMemo(() => {
    return {
      inputMethod,
      sourcePath: inputMethod === 'youtube' ? (job.youtubeUrl || 'YouTube Download') : inputMethod === 'librivox' ? (job.librivox?.projectUrl || sourceFolderPath) : sourceFolderPath,
      totalFiles: discoveredFiles.length,
      totalDurationSeconds: discoveredFiles.reduce((acc, f) => acc + f.durationSeconds, 0),
      totalSizeBytes: discoveredFiles.reduce((acc, f) => acc + f.sizeBytes, 0),
      formatsDetected,
      hasNestedChapters,
      streamCopyCompatible,
      incompatibilityReason: compatibility.reason || undefined,
      chapterWorkflow: chapterSource,
    };
  }, [
    inputMethod,
    job.youtubeUrl,
    job.librivox?.projectUrl,
    sourceFolderPath,
    discoveredFiles,
    formatsDetected,
    hasNestedChapters,
    streamCopyCompatible,
    chapterSource
  ]);

  // Execute Step 1
  const handleExecute = async () => {
    if (!canRunStep1) return;

    await onRunStep1({
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
        sizeBytes: f.sizeBytes,
        durationSeconds: f.durationSeconds,
        bitrate: f.bitrate || 0,
        order: idx + 1,
      })),
    });
  };

  const formatSec = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const rerunnableStageCards: Step1ProcessState['stages'] = chapterSource === 'existing_files'
    ? [{ key: 'generating_waveform', label: 'Create preview and waveform', desc: 'Generate review waveform data.' }, { key: 'extracting_chapters', label: 'Create chapters from files', desc: 'Derive markers from source files.' }]
    : [{ key: 'generating_waveform', label: 'Create preview and waveform', desc: 'Generate review waveform data.' }, { key: 'transcribing_whisper', label: 'Speech recognition', desc: 'Transcribe the prepared audio.' }, { key: 'detecting_chapters', label: 'Detect chapter candidates', desc: 'Generate candidates from the transcript.' }];

  const importFolderButton = (
    <button
      id="btn-import-mp3-folder"
      onClick={() => {
        setIsSourceExpanded(true);
        setInputMethod('folder');
        handleOpenNativeFolderPicker();
      }}
      disabled={!importAvailability.ready || libriVoxBusy}
      title={importAvailability.tooltip}
      className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition-colors cursor-pointer flex items-center space-x-1.5 disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed"
    >
      <FolderOpen className="w-4 h-4" />
      <span>Import Audio Folder</span>
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Hidden native folder input (uses OS native folder-selection dialog) */}
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleNativeFolderSelected}
        style={{ display: 'none' }}
        // @ts-expect-error webkitdirectory is supported in Chromium/Firefox/Safari
        webkitdirectory=""
        directory=""
        multiple
        accept=".mp3,.m4a,.aac,.m4b,.ogg,.oga,.opus,.flac,.wav,.aiff,.aif,.wma,.alac,audio/*"
      />

      {/* Hidden native output folder input (uses OS native file explorer dialog) */}
      <input
        type="file"
        ref={outputFolderInputRef}
        onChange={handleNativeOutputFolderSelected}
        style={{ display: 'none' }}
        // @ts-expect-error webkitdirectory is supported in Chromium/Firefox/Safari
        webkitdirectory=""
        directory=""
      />

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

      {/* Header Banner */}
      <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                1
              </span>
              <h2 className="text-lg font-bold text-stone-900">
                Choose audio and chapter options
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-stone-600 mt-1 max-w-3xl">
              Start by choosing your source audio. Then decide whether SwissMouse should find chapters from speech or use the file structure you already have.
            </p>
          </div>

          <div className="flex items-center justify-end space-x-3 shrink-0">
            {job.status !== 'draft' && (
              <button
                onClick={onNextStep}
                className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 transition-colors cursor-pointer flex items-center space-x-1.5"
              >
                <span>Review chapters</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Real-time Step 1 Processing Feedback Panel */}
      <Step1ProgressPanel
        processingAction={
          <button
            id="btn-run-step1-main"
            onClick={handleExecute}
            disabled={isRunning || !canRunStep1}
            title={processAvailability.tooltip}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-white shadow-sm transition-all cursor-pointer ${
              isRunning || !canRunStep1
                ? 'bg-stone-300 text-stone-500 cursor-not-allowed border border-stone-300'
                : 'bg-amber-600 hover:bg-amber-500 active:scale-98'
            }`}
          >
            {isRunning ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>
                  {runButtonLabel}
                </span>
              </>
            )}
          </button>
        }
        progress={step1Progress && (!step1Progress.jobId || step1Progress.jobId === job.id) ? {
          ...step1Progress,
          isActive: isRunning || step1Progress.isActive,
          ...(step1Progress.rerunStep ? { stages: rerunnableStageCards, totalStages: rerunnableStageCards.length } : {}),
        } : {
          jobId: job.id, isActive: isRunning, stage: job.status === 'draft' ? 'idle' : 'completed', label: 'Ready to process audiobook source', currentTask: job.status === 'draft' ? 'Idle' : 'Individual stages can be rerun.',
          currentStageNumber: 0, totalStages: rerunnableStageCards.length,
          stages: rerunnableStageCards,
          percentage: job.status === 'draft' ? 0 : 100, isDeterminate: true, elapsedSeconds: 0, liveStatusMessage: job.status === 'draft' ? 'Idle' : 'Processing complete.', logs: [], canCancel: false,
        }}
        pipelineSteps={job.pipelineSteps}
        onRerunStep={async step => {
          if (step === 'transcribing_whisper') {
            const response = await fetch(`/api/jobs/${job.id}/step1-settings`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transcriptionSettings: transcriptionOptions, selectedModelId }),
            });
            if (!response.ok) { setFolderScanError((await response.json()).error || 'Could not save transcription settings'); return; }
          }
          await onRerunStep(step);
        }}
        canRerunStep={(step) => canRerunStep(job, step)}
        onCancel={handleCancelStep1}
        onDismissSummary={() => setStep1Progress(null)}
      />

      {/* SECTION 1: Import Audiobook Source */}
      <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-4">
        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${isSourceExpanded ? 'border-b border-stone-100 pb-3' : ''}`}>
          <div className="flex items-center space-x-2">
            <FolderOpen className="w-5 h-5 text-amber-600" />
            <div>
              <h3 className="font-bold text-sm text-stone-900">Import Options</h3>
              <p className="text-xs text-stone-500">
                Import a folder, download from YouTube, or browse LibriVox.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            {!isSourceExpanded && importFolderButton}
            {/* Source switcher */}
            {isSourceExpanded && (
            <div className="flex flex-wrap items-center gap-1 p-1 bg-stone-100 rounded-lg border border-stone-200/80">
              <button
                disabled={libriVoxBusy}
                onClick={() => setInputMethod('folder')}
                className={`flex items-center whitespace-nowrap space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  inputMethod === 'folder'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                <span>Audio Folder</span>
              </button>
              <button
                disabled={libriVoxBusy}
                onClick={() => setInputMethod('youtube')}
                className={`flex items-center whitespace-nowrap space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  inputMethod === 'youtube'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <YouTubeIcon className="w-3.5 h-3.5 text-red-600" />
                <span>From YouTube</span>
              </button>
              <button type="button" onClick={() => setInputMethod('librivox')} className={`flex items-center whitespace-nowrap gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${inputMethod === 'librivox' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600 hover:text-stone-900'}`}>
                <BookOpen className="w-3.5 h-3.5 text-amber-600" /><span>LibriVox</span>
              </button>
            </div>
            )}
            <button
              type="button"
              onClick={() => setIsSourceExpanded(expanded => !expanded)}
              aria-expanded={isSourceExpanded}
              aria-controls="source-configuration"
              aria-label={isSourceExpanded ? 'Collapse import options' : 'Expand import options'}
              className="p-2 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-500"
            >
              {isSourceExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div id="source-configuration" hidden={!isSourceExpanded} className="space-y-4">
          {inputMethod === 'librivox' && <LibriVoxImport job={job} onAudioImported={handleYouTubeAudioImported} onBusyChange={setLibriVoxBusy} />}
          {/* YOUTUBE IMPORT WORKFLOW */}
          {inputMethod === 'youtube' && (
            <div className="space-y-4">
              <YouTubeAudioImport
                job={job}
                onAudioImported={handleYouTubeAudioImported}
                onCancel={() => setInputMethod('folder')}
              />
            </div>
          )}

          {/* LOCAL AUDIO FOLDER WORKFLOW */}
          {inputMethod === 'folder' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-stone-50/80 rounded-xl border border-stone-200">
                <div>
                  <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wider mb-1">
                    Choose an audio folder
                  </h4>
                  <p className="text-xs text-stone-600 max-w-xl leading-relaxed">
                    Select the folder that contains the audio files for one book. SwissMouse reads copies for processing and does not rename, move, or alter the originals.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {['MP3', 'M4A', 'M4B', 'FLAC', 'OGG', 'OPUS', 'WAV', 'AAC', 'AIFF', 'WMA'].map((fmt) => (
                      <span
                        key={fmt}
                        className="px-1.5 py-0.5 rounded bg-white text-stone-600 border border-stone-200 text-[10px] font-mono font-medium"
                      >
                        .{fmt.toLowerCase()}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  {isSourceExpanded && importFolderButton}

                  <button
                    onClick={() => setShowPathInput(!showPathInput)}
                    className="px-3 py-2 rounded-lg text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 transition-colors cursor-pointer"
                  >
                    {showPathInput ? 'Hide path entry' : 'Enter folder path'}
                  </button>
                </div>
              </div>

              {/* Optional path scanner for local desktop filesystem paths. */}
              {showPathInput && (
                <div className="p-3.5 bg-stone-50 rounded-lg border border-stone-200 space-y-2 text-xs">
                  <div className="font-medium text-stone-700">Paste a folder path</div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={customPathInput}
                      onChange={(e) => setCustomPathInput(e.target.value)}
                      placeholder="Example: C:\\Audiobooks\\My Book"
                      className="flex-1 px-3 py-2 bg-white border border-stone-300 rounded-md font-mono text-stone-800 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                    />
                    <button
                      onClick={() => handleScanLocalPath(customPathInput.trim())}
                      disabled={!scanAvailability.ready || isScanningFolder || !customPathInput.trim()}
                      title={scanAvailability.tooltip}
                      className="px-3 py-2 bg-stone-900 text-white rounded-md font-semibold hover:bg-stone-800 disabled:opacity-50 cursor-pointer"
                    >
                      {isScanningFolder ? 'Checking folder...' : 'Check folder'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {isUploadingFiles && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-center space-x-2">
              <Loader2 className="w-4 h-4 shrink-0 animate-spin text-blue-600" />
              <span className="font-medium">{uploadProgressState}</span>
            </div>
          )}
          {/* Inline Folder Validation Message */}
          {folderScanError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="font-medium">{folderScanError}</span>
            </div>
          )}

          {!hasAudioFiles && !folderScanError && inputMethod === 'folder' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>No audio files selected yet. Choose an audio folder to continue.</span>
            </div>
          )}

          {/* Source Summary Card if files discovered */}
          {discoveredFiles.length > 0 && (
            <div className="space-y-3">
              <SourceSummary summary={sourceSummaryData} onResetSource={libriVoxBusy ? undefined : handleResetSource} />

              {/* Naturally Sorted File Preview Accordion */}
              <div className="border border-stone-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowFilePreview(!showFilePreview)}
                  className="w-full px-3.5 py-2.5 bg-stone-50 hover:bg-stone-100 flex items-center justify-between text-xs font-semibold text-stone-700 cursor-pointer"
                >
                  <div className="flex items-center space-x-2">
                    <FileAudio className="w-3.5 h-3.5 text-amber-600" />
                    <span>
                      Audio files in processing order ({discoveredFiles.length} files)
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 text-stone-500">
                    <span>{showFilePreview ? 'Hide Preview' : 'Show Preview'}</span>
                    {showFilePreview ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </div>
                </button>

                {showFilePreview && (
                  <div className="divide-y divide-stone-100 max-h-60 overflow-y-auto bg-white text-xs">
                    {discoveredFiles.map((file, idx) => {
                      const ext = file.fileName.split('.').pop()?.toUpperCase() || 'AUDIO';
                      return (
                        <div
                          key={`${file.relativePath}-${idx}`}
                          className="p-2.5 px-3.5 flex items-center justify-between hover:bg-stone-50/70"
                        >
                          <div className="flex items-center space-x-2.5 min-w-0">
                            <span className="w-5 h-5 rounded bg-stone-100 text-stone-600 font-mono text-[11px] flex items-center justify-center font-bold">
                              {idx + 1}
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-stone-100 text-stone-700 text-[10px] font-mono border border-stone-200">
                              {ext}
                            </span>
                            <div className="truncate">
                              <span className="font-mono text-stone-800 font-medium">{file.fileName}</span>
                              {file.chapterGroup && (
                                <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] border border-amber-200 font-mono">
                                  {file.chapterGroup}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center space-x-3 text-stone-500 font-mono text-[11px] shrink-0">
                            <span>{formatSec(file.durationSeconds)}</span>
                            <span>•</span>
                            <span>{formatBytes(file.sizeBytes)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Preservation Guarantee Note */}
              <div className="flex items-center space-x-2 text-[11px] text-stone-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>
                  Non-destructive: original source audio files are never moved, renamed, or modified on disk.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Output destination is useful, but the safe default keeps it out of the primary flow. */}
      <details className="advanced-disclosure rounded-xl border border-stone-200/80 bg-white shadow-xs">
        <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-5 py-4">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600"><FolderCheck className="h-4 w-4" /></span>
            <span className="min-w-0"><span className="block text-sm font-bold text-stone-900">Save location</span><span className="block truncate text-xs text-stone-500">Using {outputFolderPath}</span></span>
          </span>
          <span className="flex items-center gap-2 text-xs font-semibold text-stone-500">Change <ChevronDown className="disclosure-chevron h-4 w-4" /></span>
        </summary>
        <div className="space-y-4 border-t border-stone-100 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
          <div className="flex items-center space-x-2">
            <FolderCheck className="w-5 h-5 text-amber-600" />
            <div>
              <h3 className="font-bold text-sm text-stone-900">Output Folder</h3>
              <p className="text-xs text-stone-500">
                Destination where merged masters, transcription candidate logs, and final audio exports are written.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            <button
              id="btn-choose-output-folder"
              onClick={handleOpenNativeOutputFolderPicker}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition-colors cursor-pointer flex items-center space-x-1.5"
              title="Open native file explorer to choose an output location"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Choose Output Folder</span>
            </button>

            <button
              id="btn-toggle-output-path"
              onClick={() => setShowOutputInput(!showOutputInput)}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 transition-colors cursor-pointer flex items-center space-x-1.5"
              title="Type or paste a custom directory path"
            >
              <FolderEdit className="w-3.5 h-3.5 text-stone-500" />
              <span>{showOutputInput ? 'Hide Path Input' : 'Enter Path'}</span>
            </button>

            <button
              id="btn-reset-default-output"
              onClick={handleResetDefaultOutput}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 transition-colors cursor-pointer flex items-center space-x-1.5"
              title="Reset output destination to default workspace directory"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to Default</span>
            </button>
          </div>
        </div>

        {/* Selected Output Path Display */}
        <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="space-y-0.5 min-w-0">
            <span className="text-stone-500 font-medium">Selected Output Destination:</span>
            <div className="font-mono font-bold text-stone-900 truncate" title={outputFolderPath}>
              {outputFolderPath}
            </div>
          </div>
          <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 font-medium shrink-0 flex items-center space-x-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Local Directory Verified</span>
          </span>
        </div>

        {/* Optional Custom Output Path Input */}
        {showOutputInput && (
          <div className="p-3.5 bg-stone-50 rounded-lg border border-stone-200 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-stone-700">Enter Local Output Directory Path:</span>
              <span className="text-[11px] text-stone-500">Auto-created if it does not yet exist</span>
            </div>
            <div className="flex items-center space-x-2">
              <input
                id="custom-output-path-input"
                type="text"
                value={customOutputInput}
                onChange={(e) => setCustomOutputInput(e.target.value)}
                placeholder="e.g. output or /home/user/Audiobooks/output or C:\Audiobooks\Output"
                className="flex-1 px-3 py-2 bg-white border border-stone-300 rounded-md font-mono text-stone-800 focus:outline-hidden focus:ring-1 focus:ring-amber-500 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customOutputInput.trim()) {
                    handleSetOutputFolder(customOutputInput.trim());
                  }
                }}
              />
              <button
                id="btn-set-custom-output-folder"
                onClick={() => handleSetOutputFolder(customOutputInput.trim())}
                disabled={!customOutputInput.trim()}
                className="px-3.5 py-2 bg-stone-900 text-white rounded-md font-semibold hover:bg-stone-800 disabled:opacity-50 cursor-pointer text-xs shrink-0"
              >
                Set Output Folder
              </button>
            </div>
            <div className="flex items-center space-x-2 text-stone-500 text-[11px]">
              <span>Quick paths:</span>
              <button
                type="button"
                onClick={() => {
                  setCustomOutputInput('output');
                  handleSetOutputFolder('output');
                }}
                className="underline hover:text-amber-800 cursor-pointer"
              >
                output
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  setCustomOutputInput('output/audiobooks');
                  handleSetOutputFolder('output/audiobooks');
                }}
                className="underline hover:text-amber-800 cursor-pointer"
              >
                output/audiobooks
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  setCustomOutputInput('audiobooks/exports');
                  handleSetOutputFolder('audiobooks/exports');
                }}
                className="underline hover:text-amber-800 cursor-pointer"
              >
                audiobooks/exports
              </button>
            </div>
          </div>
        )}

        {/* Inline Output Validation Error */}
        {outputFolderError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="font-medium">{outputFolderError}</span>
          </div>
        )}
        </div>
      </details>

      {/* Basic Workflow Options: chapter source and audio merge method */}
      <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-3">
        <div className="flex items-center space-x-2 border-b border-stone-100 pb-3">
          <Sliders className="w-5 h-5 text-amber-600" />
          <h3 className="font-bold text-sm text-stone-900">How should chapters be created?</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* Option A: Generate chapters with WhisperX (Default) */}
          <label
            className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
              chapterSource === 'whisperx'
                ? 'bg-amber-50/60 border-amber-500 shadow-xs'
                : 'bg-stone-50/50 border-stone-200 hover:border-stone-300'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="chapterSource"
                    value="whisperx"
                    checked={chapterSource === 'whisperx'}
                    onChange={() => {
                      setChapterSource('whisperx');
                      notifyJobUpdate({ chapterSource: 'whisperx' });
                    }}
                    className="w-4 h-4 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="font-bold text-sm text-stone-900">
                    Find chapters from spoken audio
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-semibold">
                  Default / AI
                </span>
              </div>
              <p className="text-xs text-stone-600 pl-6 leading-relaxed">
                Combines your source files, transcribes speech with your selected Whisper engine, and suggests chapter starts for you to review.
              </p>
              <div className="pl-6 pt-1 text-[11px] text-amber-800 italic">
                Best when files are long parts, chapter boundaries are unclear, or you want speech-based chapter suggestions.
              </div>
            </div>
          </label>

          {/* Option B: Derive chapters from the imported source structure */}
          <label
            className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
              chapterSource === 'existing_files'
                ? 'bg-amber-50/60 border-amber-500 shadow-xs'
                : 'bg-stone-50/50 border-stone-200 hover:border-stone-300'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="chapterSource"
                    value="existing_files"
                    checked={chapterSource === 'existing_files'}
                    onChange={() => {
                      setChapterSource('existing_files');
                      notifyJobUpdate({ chapterSource: 'existing_files' });
                    }}
                    className="w-4 h-4 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="font-bold text-sm text-stone-900">
                    Use files and folders as chapters
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded bg-stone-200 text-stone-700 text-[11px] font-semibold">
                  No transcription
                </span>
              </div>
              <p className="text-xs text-stone-600 pl-6 leading-relaxed">
                Each numbered folder becomes a chapter; files inside are combined in name order. If there are no numbered folders, each audio file becomes a chapter.
              </p>
              <div className="pl-6 pt-1 text-[11px] text-amber-800 italic">
                Best when your files are already separated into the chapters you want.
              </div>
            </div>
          </label>
        </div>

        {/* Audio Merge Method */}
        {(
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Option A: Standard merge (recommended) */}
              <label
                className={`p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                  mergeMethod === 'standard'
                    ? 'bg-amber-50/60 border-amber-500 shadow-xs'
                    : 'bg-stone-50/50 border-stone-200 hover:border-stone-300'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="mergeMethod"
                        value="standard"
                        checked={mergeMethod === 'standard'}
                        onChange={() => {
                          setMergeMethod('standard');
                          notifyJobUpdate({ mergeMethod: 'standard' });
                        }}
                        className="w-4 h-4 text-amber-600 focus:ring-amber-500"
                      />
                      <span className="font-bold text-sm text-stone-900">
                    Prepare audio for reliable timing
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                      Most Reliable
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 pl-6 leading-relaxed">
                    Standardizes audio first for the most accurate timing and best AI chapter detection results.
                  </p>
                </div>
              </label>

              {/* Option B: Quick Merge — stitch audio files directly */}
              <label
                className={`p-4 rounded-xl border-2 transition-all flex flex-col justify-between ${
                  !streamCopyCompatible
                    ? 'opacity-50 bg-stone-100/70 border-stone-200 cursor-not-allowed'
                    : mergeMethod === 'quick'
                    ? 'bg-amber-50/60 border-amber-500 shadow-xs cursor-pointer'
                    : 'bg-stone-50/50 border-stone-200 hover:border-stone-300 cursor-pointer'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="mergeMethod"
                        value="quick"
                        disabled={!streamCopyCompatible}
                        checked={mergeMethod === 'quick'}
                        onChange={() => {
                          if (streamCopyCompatible) {
                            setMergeMethod('quick');
                            notifyJobUpdate({ mergeMethod: 'quick' });
                          }
                        }}
                        className="w-4 h-4 text-amber-600 focus:ring-amber-500 disabled:opacity-40"
                      />
                      <span className="font-bold text-sm text-stone-900">
                    Join compatible files without conversion
                      </span>
                    </div>
                    {!streamCopyCompatible ? (
                      <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-semibold">
                        Unavailable (Stream Parameters)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-semibold">
                        Stream copy
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-600 pl-6 leading-relaxed">
                    Stitches compatible encoded streams without PCM normalization. Analysis/preview decoding and selected chapter processing still run.
                  </p>
                </div>
              </label>
            </div>

            {/* Stream copy incompatibility alert */}
            {!streamCopyCompatible && (
              <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-700 flex items-start space-x-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-semibold text-stone-900">Skip PCM is unavailable:</span> {compatibility.reason}
                </div>
              </div>
            )}

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
        )}
      </div>

      {/* Model management is intentionally secondary to the main import workflow. */}
      <details
        className={`advanced-disclosure bg-white rounded-xl p-5 border transition-all ${
          chapterSource === 'existing_files'
            ? 'opacity-50 border-stone-200 bg-stone-50/40 pointer-events-none'
            : 'border-stone-200/80 shadow-xs'
        } space-y-4`}
      >
        <summary className="mb-4 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
          <span className="flex min-w-0 items-center gap-3"><Sparkles className="h-4 w-4 shrink-0 text-amber-700" /><span className="min-w-0"><span className="block text-sm font-bold text-stone-900">Transcription & model settings</span><span className="block truncate text-xs text-stone-500">{selectedModel?.name || 'Choose a speech model'} · {fasterEnabled ? 'optimized engine' : 'compatibility engine'}</span></span></span>
          <span className="flex items-center gap-2 text-xs font-semibold text-stone-500">Advanced <ChevronDown className="disclosure-chevron h-4 w-4" /></span>
        </summary>
        <label className="flex items-center justify-between gap-4 p-3 rounded-lg border border-emerald-200 bg-emerald-50 cursor-pointer">
          <span>
            <span className="block text-sm font-bold text-stone-900">Faster Transcription</span>
            <span className="block text-xs text-stone-600 mt-0.5">Uses the optimized Faster Whisper engine for faster processing and lower memory usage. Recommended for most systems.</span>
          </span>
          <input type="checkbox" checked={fasterEnabled} disabled={isSwitchingEngine || isRunning} onChange={event => handleFasterTranscriptionChange(event.target.checked)} title="Runs your selected Whisper model using the optimized CTranslate2 engine. Disable this if you experience compatibility problems." className="w-5 h-5 accent-emerald-600 shrink-0" />
        </label>
        <TranscriptionOptions engine={transcriptionEngine} model={selectedModelId}
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
              <p className="text-xs font-semibold text-amber-800">
                {fasterEnabled ? 'Faster Whisper / CTranslate2 models' : 'OpenAI Whisper / PyTorch models'}
              </p>
              <p className="text-xs text-stone-500">
                Available models are listed here; installed models are marked and can be reinstalled or removed. Larger models are usually more accurate but take longer and use more storage.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {chapterSource === 'existing_files' ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded bg-stone-200 text-stone-600">
                Not needed for file-based chapters
              </span>
            ) : (
              <>
                <button
                  onClick={handleRefreshModels}
                  disabled={isRefreshingModels}
                  className="px-2.5 py-1 rounded text-[11px] font-medium bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 transition-colors cursor-pointer flex items-center space-x-1"
                  title="Scan local models directory on disk for downloaded weights"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                  <span>{isRefreshingModels ? 'Checking Disk...' : 'Refresh Models'}</span>
                </button>

              </>
            )}
          </div>
        </div>

        {chapterSource === 'existing_files' ? (
          <div className="p-3 bg-stone-100/70 rounded-lg text-xs text-stone-500 italic">
            Speech recognition is not needed because chapters will come from your folders, files, or existing chapter markers. Audio preparation still runs.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Hardware Detection Summary Card */}
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
              <div className="flex items-center space-x-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${
                    hardware.mode === 'gpu'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-stone-900 text-sm">
                      {backendCapability ? capabilityLabel(backendCapability, transcriptionOptions[transcriptionEngine]?.device) : 'Checking backend capabilities…'}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        hardware.mode === 'gpu'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-stone-200 text-stone-700'
                      }`}
                    >
                      {transcriptionEngine}
                    </span>
                  </div>
                  <p className="text-stone-500 mt-0.5">
                    Hardware:{' '}
                    <span className="font-medium text-stone-800">
                      {hardware.gpuName || hardware.cpuModel || 'Local System Host'}
                    </span>
                    {hardware.vramGb ? ` • ${hardware.vramGb} GB VRAM` : ''}
                  </p>
                </div>
              </div>

              <div className="text-left md:text-right border-t md:border-t-0 border-stone-200 pt-2 md:pt-0">
                <span className="text-stone-500 block text-[11px]">Recommended for this system:</span>
                <span className="font-bold font-mono text-amber-800 uppercase text-xs">
                  {hardware.recommendedModelId}
                </span>
              </div>
            </div>

            {/* Helper Text */}
            <div className="text-xs text-stone-600 bg-amber-50/50 p-3 rounded-lg border border-amber-200/60 flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Recommended based on your detected hardware. You can choose any compatible installed model.
              </span>
            </div>

            {/* Models Table / Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {models.filter(model => model.backend === transcriptionEngine).map((model) => {
                const isSelected = selectedModelId === model.id;
                const isRecommended = hardware.recommendedModelId === model.id;
                const isCompatible = hardware.mode === 'gpu' || !model.requiresGpu;
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
                    className={`p-4 rounded-xl border-2 transition-all flex flex-col justify-between ${
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
                              {model.isInstalled && model.installedFile && (
                                <span className="ml-1 text-stone-400 block sm:inline">
                                  • {model.installedFile}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end space-y-1">
                          {isRecommended && (
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                              ★ Recommended
                            </span>
                          )}
                          {model.requiresGpu ? (
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                hardware.mode === 'gpu'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              Requires NVIDIA GPU
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px] font-medium">
                              CPU & GPU Compatible
                            </span>
                          )}
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
                    <div className="pt-3 border-t border-stone-100 mt-3 flex items-center justify-between text-xs">
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

                      <div className="flex items-center space-x-2">
                        {model.isDownloading ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelDownload(model.id);
                            }}
                            className="px-2.5 py-1 rounded text-xs font-semibold bg-stone-200 hover:bg-stone-300 text-stone-800 transition-colors cursor-pointer flex items-center space-x-1"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancel Download</span>
                          </button>
                        ) : model.isInstalled ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInstallModel(model, true);
                              }}
                              disabled={!modelAvailability.ready}
                              className="px-2.5 py-1 rounded text-xs font-medium text-stone-600 hover:text-stone-950 hover:bg-stone-100 border border-stone-200 transition-colors cursor-pointer flex items-center space-x-1"
                              title={modelAvailability.tooltip || 'Download a fresh copy of this model into the application cache'}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Reinstall</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUninstallModel(model.id);
                              }}
                              className="px-2.5 py-1 rounded text-xs font-medium text-stone-500 hover:text-rose-700 hover:bg-rose-50 border border-stone-200 transition-colors cursor-pointer flex items-center space-x-1"
                              title="Removes only downloaded weights; never touches user audiobooks or settings"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Uninstall</span>
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInstallModel(model);
                            }}
                            disabled={isUnavailableGpu || !modelAvailability.ready}
                            title={modelAvailability.tooltip}
                            className={`px-3 py-1 rounded text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center space-x-1 ${
                              isUnavailableGpu || !modelAvailability.ready
                                ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                                : 'bg-stone-900 hover:bg-stone-800 text-white'
                            }`}
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Install</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </details>

      {/* SECTION 6: Validation Before Continuing & Run Action */}
      <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-4">
        {/* Inline Validation Warnings summary */}
        {!canRunStep1 && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-1">
            <div className="font-bold flex items-center space-x-1.5 text-rose-900">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>Prerequisites missing before running Step 1:</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] pl-1 text-rose-700">
              {!hasSourceFolder && <li>Choose an audio folder, download from YouTube, or import a LibriVox book.</li>}
              {!hasAudioFiles && <li>No supported audio files were found in the selected folder.</li>}
              {!isOutputValid && <li>The selected output folder cannot be written to.</li>}
              {!processAvailability.ready && <li>{processAvailability.tooltip}</li>}
              {chapterSource === 'whisperx' && !selectedModel && (
                <li>Select a compatible Whisper model to continue.</li>
              )}
              {chapterSource === 'whisperx' && selectedModel && !isSelectedModelCompatible && (
                <li>
                  The selected model requires an NVIDIA GPU and cannot run in CPU-only mode. Choose a
                  CPU-compatible model.
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <div className="text-xs text-stone-500">
            <span className="font-semibold text-stone-700">Workflow:</span>{' '}
            {chapterSource === 'existing_files' ? (
              <span className="font-medium text-amber-800">
                Chapters from Source Structure (No Transcription)
              </span>
            ) : (
              <span className="font-medium text-amber-800">
                Whisper Chapter Detection ({mergeMethod === 'quick' ? 'Quick Merge' : 'Standard Merge'} •{' '}
                {selectedModel?.name || 'Whisper Small'})
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {job.status !== 'draft' && (
              <button
                onClick={onNextStep}
                className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 transition-colors cursor-pointer"
              >
                Continue to Review →
              </button>
            )}

            <button
              id="btn-run-step1"
              onClick={handleExecute}
              disabled={isRunning || !canRunStep1}
              title={processAvailability.tooltip}
              className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-white shadow-sm transition-all cursor-pointer ${
                isRunning || !canRunStep1
                  ? 'bg-stone-300 text-stone-500 cursor-not-allowed border border-stone-300'
                  : 'bg-amber-600 hover:bg-amber-500 active:scale-98'
              }`}
            >
              {isRunning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>
                    {runButtonLabel}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
