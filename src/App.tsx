import React, { useState, useEffect } from 'react';
import {
  AudiobookJob,
  LibraryBook,
  WorkbenchConfig,
  ChapterEntry,
  AudiobookMetadata,
  ChapterSourceType,
  AudioMergeMethodType,
  OutputAudioFormat,
  RerunnablePipelineStep,
} from './types';
import { Header } from './components/Header';
import { Step1MergeDetect } from './components/Step1MergeDetect';
import { Step2ChapterReview } from './components/Step2ChapterReview';
import { Step3Metadata } from './components/Step3Metadata';
import { Step4Export } from './components/Step4Export';
import { Step5Validate } from './components/Step5Validate';
import { CleanupModal, CleanupType } from './components/CleanupModal';
import { ConfigModal } from './components/ConfigModal';
import { NewJobModal } from './components/NewJobModal';
import { RequirementsModal } from './components/RequirementsModal';
import { LogsDrawer } from './components/LogsDrawer';
import { LibraryManager } from './components/LibraryManager';
import { CheckCircle2, Clock, HardDrive } from 'lucide-react';
import { CustomTheme, ThemeDiscoveryResponse, applyTheme, getStoredTheme, isAppTheme, persistTheme } from './theme';
import type { JobLog } from './types';

export default function App() {
  const [jobs, setJobs] = useState<AudiobookJob[]>([]);
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(localStorage.getItem('workbench_active_job_id'));
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [theme, setTheme] = useState<string>(getStoredTheme);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [themeWarnings, setThemeWarnings] = useState<string[]>([]);
  const [isReloadingThemes, setIsReloadingThemes] = useState(false);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProcessingStep1, setIsProcessingStep1] = useState<boolean>(false);
  const [isBuildingM4b, setIsBuildingM4b] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState<boolean>(false);

  // Modals
  const [showPurgeModal, setShowPurgeModal] = useState<boolean>(false);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showNewJobModal, setShowNewJobModal] = useState<boolean>(false);
  const [showRequirementsModal, setShowRequirementsModal] = useState<boolean>(false);
  const [showLogsDrawer, setShowLogsDrawer] = useState<boolean>(false);
  const [masterLogs, setMasterLogs] = useState<JobLog[]>([]);

  // Helper to determine the starting step based on job status
  const getStartingStepForJob = (job: AudiobookJob): 1 | 2 | 3 | 4 | 5 => {
    if (job.status === 'draft') return 1;
    if (job.status === 'transcribed' || job.status === 'merged') return 2;
    if (job.status === 'metadata_ready') return 3;
    if (job.status === 'built') return 4;
    if (job.status === 'validated') return 5;
    return 1;
  };

  // Initial fetch
  useEffect(() => {
    async function loadInitialData() {
      try {
        const [jobsRes, cfgRes] = await Promise.all([
          fetch('/api/library'),
          fetch('/api/config'),
        ]);
        const jobsData = await jobsRes.json();
        const cfgData = await cfgRes.json();
        setLibraryBooks(jobsData);
        setConfig(cfgData);
        
        // Validate saved jobId exists
        if (currentJobId && !jobsData.find((j: any) => j.id === currentJobId)) {
           setCurrentJobId(null);
           localStorage.removeItem('workbench_active_job_id');
        } else if (currentJobId) {
          const response = await fetch(`/api/jobs/${currentJobId}`);
          if (response.ok) { const job = await response.json(); setJobs([job]); setActiveStep(getStartingStepForJob(job)); }
        }
      } catch (err) {
        console.error('Failed to load initial data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadInitialData();
  }, []);

  // Persist active job ID
  useEffect(() => {
    if (currentJobId) {
      localStorage.setItem('workbench_active_job_id', currentJobId);
    } else {
      localStorage.removeItem('workbench_active_job_id');
    }
  }, [currentJobId]);

  const reloadCustomThemes = async () => {
    setIsReloadingThemes(true);
    try {
      const response = await fetch('/api/themes');
      if (!response.ok) throw new Error('Could not scan the custom themes folder.');
      const discovery: ThemeDiscoveryResponse = await response.json();
      setCustomThemes(discovery.themes);
      setThemeWarnings(discovery.warnings);
      const selected = getStoredTheme();
      const customTheme = discovery.themes.find(candidate => candidate.id === selected);
      if (isAppTheme(selected)) {
        setTheme(selected);
        applyTheme(selected);
      } else if (customTheme) {
        setTheme(selected);
        applyTheme(selected, customTheme);
      } else {
        setTheme('light');
        persistTheme('light');
      }
    } catch (error) {
      console.error('Failed to load custom themes:', error);
      setThemeWarnings([error instanceof Error ? error.message : 'Could not load custom themes.']);
      if (!isAppTheme(getStoredTheme())) {
        setTheme('light');
        persistTheme('light');
      }
    } finally {
      setIsReloadingThemes(false);
    }
  };

  useEffect(() => { void reloadCustomThemes(); }, []);

  const handleThemeChange = (nextTheme: string) => {
    const customTheme = customThemes.find(candidate => candidate.id === nextTheme);
    setTheme(nextTheme);
    persistTheme(nextTheme, customTheme);
  };

  const handleOpenThemesFolder = async () => {
    const response = await fetch('/api/themes/open-folder', { method: 'POST' });
    if (!response.ok) throw new Error('Could not open the custom themes folder.');
  };

  const currentJob = jobs.find((j) => j.id === currentJobId) || null;

  // Handler for closing the project
  const handleCloseProject = () => {
    setCurrentJobId(null);
    setActiveStep(1);
  };

  // Handler for opening a project
  const handleOpenProject = async (id: string) => {
    const job = jobs.find(j => j.id === id);
    if (job) { setCurrentJobId(id); setActiveStep(getStartingStepForJob(job)); return; }
    const response = await fetch(`/api/jobs/${id}`);
    if (response.ok) { const loaded = await response.json() as AudiobookJob; setJobs([loaded]); setCurrentJobId(id); setActiveStep(getStartingStepForJob(loaded)); }
  };

  // Refresh current job from server
  const refreshCurrentJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (res.ok) {
        const updated = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
        setLibraryBooks(prev => prev.map(book => book.id === jobId ? { ...book, name: updated.name, status: updated.status, metadataUpdatedAt: updated.metadataUpdatedAt, metadata: { ...updated.metadata, cover: undefined }, coverUrl: updated.metadata?.cover?.url?.startsWith('data:') ? `/api/library/${encodeURIComponent(jobId)}/cover?v=${encodeURIComponent(updated.metadataUpdatedAt || updated.createdAt)}` : updated.metadata?.cover?.url } : book));
      }
    } catch (err) {
      console.error('Failed to refresh job:', err);
    }
  };

  // The Settings terminal combines every project's saved activity with the
  // section streams, including work performed while no project is open.
  useEffect(() => {
    if (!showLogsDrawer) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch('/api/logs');
        if (response.ok && !stopped) setMasterLogs(await response.json());
      } catch (error) { console.error('Failed to read technical logs:', error); }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 750);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [showLogsDrawer]);

  // Step 1 Handler
  const handleRunStep1 = async (options?: {
    chapterSource?: ChapterSourceType;
    mergeMethod?: AudioMergeMethodType;
    selectedModelId?: string;
    transcriptionSettings?: AudiobookJob['transcriptionSettings'];
    sourceFolderPath?: string;
    outputFolderPath?: string;
    parts?: any[];
  }) => {
    if (!currentJob) return;
    setIsProcessingStep1(true);
    try {
      const res = await fetch(`/api/jobs/${currentJob.id}/process-step1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Step 1 failed');
      
      if (data.status === 'started') {
         // Wait for the background process to finish by polling
         while (true) {
            await new Promise(r => setTimeout(r, 1000));
            const pRes = await fetch('/api/step1/progress');
            if (pRes.ok) {
               const prog = await pRes.json();
               if (!prog.isActive) {
                   if (prog.error) {
                       throw new Error(prog.error);
                   }
                   break;
               }
            }
         }
      }

      await refreshCurrentJob(currentJob.id);
      // Wait for the user to manually click 'Continue to Review' if they are on Step 1
    } catch (err: any) {
      await refreshCurrentJob(currentJob.id);
      setShowLogsDrawer(true);
    } finally {
      setIsProcessingStep1(false);
    }
  };

  const handleRerunStep = async (step: RerunnablePipelineStep, confirmed = false): Promise<void> => {
    if (!currentJob) return;
    setIsProcessingStep1(true);
    try {
      const start = async (confirmReplaceManualChapters: boolean) => {
        const response = await fetch(`/api/jobs/${currentJob.id}/rerun/${step}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmReplaceManualChapters }),
        });
        const data = await response.json();
        return { response, data };
      };
      let { response, data } = await start(confirmed);
      if (response.status === 409 && data.requiresConfirmation) {
        const accepted = window.confirm(data.error);
        if (!accepted) return;
        ({ response, data } = await start(true));
      }
      if (!response.ok) throw new Error(data.error || 'Step failed');
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 600));
        const progressResponse = await fetch('/api/step1/progress');
        if (!progressResponse.ok) continue;
        const progress = await progressResponse.json();
        if (!progress.isActive) {
          if (progress.error) throw new Error(progress.error);
          break;
        }
      }
    } catch (error) {
      console.error('Step failed:', error);
      setShowLogsDrawer(true);
    } finally {
      await refreshCurrentJob(currentJob.id);
      setIsProcessingStep1(false);
    }
  };

  const handleUpdateJobSettings = async (settings: Partial<AudiobookJob>) => {
    if (!currentJob) return;
    try {
      await fetch(`/api/jobs/${currentJob.id}/step1-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      await refreshCurrentJob(currentJob.id);
    } catch (err) {
      console.error('Failed to update job settings:', err);
    }
  };

  // Step 2 Handler
  const handleSaveChapters = async (chapters: ChapterEntry[]) => {
    if (!currentJob) return;
    const res = await fetch(`/api/jobs/${currentJob.id}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapters }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save chapters');
    }
    await refreshCurrentJob(currentJob.id);
  };

  // Step 3 Handler: Audiobook Metadata & Cover Art
  const handleSaveMetadata = async (metadata: AudiobookMetadata) => {
    if (!currentJob) return;
    const res = await fetch(`/api/jobs/${currentJob.id}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save metadata');
    }
    await refreshCurrentJob(currentJob.id);
  };

  // Step 4 Handler: Build Chaptered Audio Package (M4B, M4A, MP3, FLAC, Opus, WAV)
  const handleBuildM4b = async (outputFormats: OutputAudioFormat[] = ['m4b'], convert = false, cue = true, bitrates: Partial<Record<OutputAudioFormat,number>> = {}) => {
    if (!currentJob) return;
    setExportError(null);
    setIsBuildingM4b(true);
    const poll = window.setInterval(() => refreshCurrentJob(currentJob.id), 1000);
    try {
      const res = await fetch(`/api/jobs/${currentJob.id}/build-m4b`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFormats, convert, cue, bitrates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Build failed');
      await refreshCurrentJob(currentJob.id);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      setExportError(message);
      console.error('Audio export failed:', err);
      await refreshCurrentJob(currentJob.id);
      setShowLogsDrawer(true);
    } finally {
      window.clearInterval(poll);
      setIsBuildingM4b(false);
    }
  };

  // Step 5 Handler: Validate Output
  const handleValidate = async () => {
    if (!currentJob) return;
    setIsValidating(true);
    try {
      const res = await fetch(`/api/jobs/${currentJob.id}/validate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Validation failed');
      await refreshCurrentJob(currentJob.id);
    } catch (err: any) {
      await refreshCurrentJob(currentJob.id);
      setShowLogsDrawer(true);
    } finally {
      setIsValidating(false);
    }
  };

  // Storage Cleanup Handler
  const handleCleanup = async (cleanupType: CleanupType, confirmation?: string) => {
    const isProjectCleanup = cleanupType.startsWith('project-');
    if (isProjectCleanup && !currentJob) throw new Error('Open a book before choosing a book-specific cleanup option.');
    const res = await fetch(isProjectCleanup ? `/api/jobs/${currentJob!.id}/purge` : '/api/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isProjectCleanup
        ? { purgeType: cleanupType.replace('project-', ''), confirmation }
        : { cleanupType, confirmation }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Cleanup failed');
    if (Array.isArray(data.jobs)) setJobs(data.jobs);
    else if (currentJob) await refreshCurrentJob(currentJob.id);
    alert(data.message);
  };

  // Config Update Handler
  const handleSaveConfig = async (newConfig: WorkbenchConfig) => {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Config update failed');
    setConfig(data.config);
  };

  // Create Job Handler
  const handleCreateJob = async (jobData: any) => {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jobData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Create job failed');
    setJobs([data]);
    const libraryResponse = await fetch('/api/library');
    if (libraryResponse.ok) setLibraryBooks(await libraryResponse.json());
    setCurrentJobId(data.id);
    setActiveStep(1);
  };

  const handleSaveLibraryMetadata = async (changes: { id: string; fields: Partial<AudiobookMetadata> }[]) => {
    const response = await fetch('/api/library/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save library metadata.');
    const changed = new Map((data.books as LibraryBook[]).map(book => [book.id, book]));
    setLibraryBooks(current => current.map(book => changed.get(book.id) || book));
    if (currentJobId && changed.has(currentJobId)) await refreshCurrentJob(currentJobId);
  };

  const handleWriteLibraryAudioMetadata = async (ids: string[]) => {
    const written: string[] = [];
    const failures: string[] = [];
    for (const id of ids) {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}/write-audio-metadata`, { method: 'POST' });
      const result = await response.json();
      written.push(...(result.written || []));
      failures.push(...(result.failures || (response.ok ? [] : [result.error || 'Could not write audio metadata.'])));
    }
    return { written, failures };
  };

  // Bulk Delete Handler
  const handleDeleteMultiple = async (ids: string[]) => {
    const count = ids.length;
    if (count === 0) return;

    const confirmMsg = `Are you sure you want to delete ${count} selected project${count > 1 ? 's' : ''}?\n\nThis will permanently remove all project data and Workbench-managed files.`;
    
    if (window.confirm(confirmMsg)) {
        try {
            // Process deletions sequentially or in parallel
            for (const id of ids) {
              const response = await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
              if (!response.ok) throw new Error((await response.json()).error || `Could not delete ${id}.`);
            }
            
            setJobs(prev => prev.filter(j => !ids.includes(j.id)));
            setLibraryBooks(prev => prev.filter(book => !ids.includes(book.id)));
            if (currentJobId && ids.includes(currentJobId)) {
                setCurrentJobId(null);
                setActiveStep(1);
            }
        } catch (err: any) {
            alert(`Bulk Delete Error: ${err.message}`);
        }
    }
  };

  // Delete Job Handler
  const handleDeleteProject = async (jobId: string, jobName: string) => {
    
    const confirmMsg = `Are you sure you want to delete the project "${jobName}"?\n\nThis will permanently remove the project data and any files uploaded to the Workbench. Files stored outside of the program folder will not be removed.`;
    
    if (window.confirm(confirmMsg)) {
        try {
            const res = await fetch(`/api/jobs/${jobId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                setJobs(prev => prev.filter(j => j.id !== jobId));
                setLibraryBooks(prev => prev.filter(book => book.id !== jobId));
                if (currentJobId === jobId) {
                    setCurrentJobId(null);
                    setActiveStep(1);
                }
            } else {
                const data = await res.json();
                throw new Error(data.error || 'Delete failed');
            }
        } catch (err: any) {
            alert(`Delete Error: ${err.message}`);
        }
    }
  };

  const formatDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  const statusLabel = (status: AudiobookJob['status']) => ({
    draft: 'Getting started',
    merged: 'Ready to review',
    transcribed: 'Ready to review',
    metadata_ready: 'Details saved',
    built: 'Exported',
    validated: 'Complete',
  }[status] || status.replaceAll('_', ' '));

  if (isLoading || !config) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-stone-600 text-sm font-medium">
            Starting SwissMouse...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen flex flex-col font-sans">
      {/* Top Header */}
      <Header
        jobs={jobs}
        currentJob={currentJob}
        onSelectJob={handleOpenProject}
        onCloseProject={handleCloseProject}
        onOpenNewJob={() => setShowNewJobModal(true)}
        onOpenSettings={() => setShowConfigModal(true)}
        onOpenPurge={() => setShowPurgeModal(true)}
        onOpenRequirements={() => setShowRequirementsModal(true)}
        onToggleLogs={() => setShowLogsDrawer(!showLogsDrawer)}
        showLogs={showLogsDrawer}
      />

      {/* Main Workspace */}
      <main className={`flex-1 w-full mx-auto px-3 sm:px-5 lg:px-7 py-4 sm:py-6 space-y-5 ${currentJob ? 'max-w-[1480px]' : 'max-w-none'}`}>
        {currentJob ? (
          <>
            {/* Book Meta & Step Progress Navigation */}
            <section className="workspace-overview rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 border-b border-stone-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-xl font-bold tracking-tight text-stone-950">
                      {currentJob.name}
                    </h1>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${currentJob.status === 'validated' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                      {statusLabel(currentJob.status)}
                    </span>
                  </div>
                  {(currentJob.author || currentJob.narrator) && (
                    <p className="text-xs text-stone-500 mt-0.5">
                      {currentJob.author && <span>By {currentJob.author}</span>}
                      {currentJob.author && currentJob.narrator && <span> • </span>}
                      {currentJob.narrator && <span>Narrated by {currentJob.narrator}</span>}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-stone-500">
                        <span className="flex items-center space-x-1.5">
                            <Clock className="w-3.5 h-3.5 text-stone-400" />
                            <span>{formatDuration(currentJob.totalDurationSeconds)}</span>
                        </span>
                        <span>{currentJob.parts.length} source parts</span>
                        <span className="flex items-center space-x-1.5">
                            <HardDrive className="w-3.5 h-3.5 text-stone-400" />
                            <span>{(currentJob.totalSizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                        </span>
                </div>
              </div>

              <nav aria-label="Audiobook creation steps" className="step-nav -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible">
                {[
                  { step: 1, label: 'Add audio', desc: 'Choose files and find chapters' },
                  { step: 2, label: 'Review chapters', desc: 'Check names and timing' },
                  { step: 3, label: 'Book details', desc: 'Cover, author, and description' },
                  { step: 4, label: 'Export', desc: 'Create your audiobook' },
                  { step: 5, label: 'Final check', desc: 'Confirm the finished file' },
                ].map((item) => {
                  const isActive = activeStep === item.step;
                  const isStale = (item.step === 2 && currentJob.staleSteps?.some(step => step === 'chapter_detection' || step === 'chapter_review'))
                    || (item.step === 4 && currentJob.staleSteps?.includes('export'))
                    || (item.step === 5 && currentJob.staleSteps?.includes('validation'));
                  const isCompleted =
                    (item.step === 1 && currentJob.status !== 'draft') ||
                    (item.step === 2 && currentJob.chapters.length > 0 && currentJob.status !== 'draft') ||
                    (item.step === 3 && (!!currentJob.metadata || currentJob.status === 'metadata_ready' || currentJob.status === 'built' || currentJob.status === 'validated')) ||
                    (item.step === 4 && (currentJob.status === 'built' || currentJob.status === 'validated')) ||
                    (item.step === 5 && currentJob.status === 'validated');

                  return (
                    <button
                      key={item.step}
                      id={`tab-step-${item.step}`}
                      onClick={() => setActiveStep(item.step as 1 | 2 | 3 | 4 | 5)}
                      className={`min-w-[168px] rounded-xl border p-3 text-left transition-all lg:min-w-0 ${
                        isStale
                          ? 'bg-orange-50 border-orange-300 ring-1 ring-orange-300/40'
                          : isActive
                          ? 'bg-stone-900 border-stone-900 text-white shadow-sm'
                          : 'bg-stone-50 border-stone-200 hover:bg-white hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-xs font-bold"><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${isActive ? 'bg-white/15 text-white' : 'bg-white text-stone-500 ring-1 ring-stone-200'}`}>{item.step}</span>{item.label}</span>
                        {isStale ? (
                          <span className="text-[9px] font-bold uppercase text-orange-700">Needs rerun</span>
                        ) : isCompleted && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                      </div>
                      <p className={`mt-1 text-[11px] ${isActive ? 'text-stone-300' : 'text-stone-500'}`}>
                        {item.desc}
                      </p>
                    </button>
                  );
                })}
              </nav>
            </section>

            {/* Active Step Content */}
            {activeStep === 1 && (
              <Step1MergeDetect
                job={currentJob}
                config={config}
                onRunStep1={handleRunStep1}
                onRerunStep={handleRerunStep}
                isRunning={isProcessingStep1}
                onNextStep={() => setActiveStep(2)}
                onUpdateJobSettings={handleUpdateJobSettings}
                onConfigChange={setConfig}
              />
            )}

            {activeStep === 2 && (
              <Step2ChapterReview
                key={currentJob.id}
                job={currentJob}
                onSaveChapters={handleSaveChapters}
                onNextStep={() => setActiveStep(3)}
              />
            )}

            {activeStep === 3 && (
              <Step3Metadata
                job={currentJob}
                onSaveMetadata={handleSaveMetadata}
                onRerunMetadata={() => handleRerunStep('metadata_processing')}
                isRerunning={isProcessingStep1}
                onNextStep={() => setActiveStep(4)}
              />
            )}

            {activeStep === 4 && (
              <Step4Export
                job={currentJob}
                config={config}
                onBuildM4b={handleBuildM4b}
                isBuilding={isBuildingM4b}
                error={exportError}
                onNextStep={() => setActiveStep(5)}
              />
            )}

            {activeStep === 5 && (
              <Step5Validate
                job={currentJob}
                onValidate={handleValidate}
                isValidating={isValidating}
              />
            )}
          </>
        ) : (
          <LibraryManager
            books={libraryBooks}
            onOpen={handleOpenProject}
            onAdd={() => setShowNewJobModal(true)}
            onSave={handleSaveLibraryMetadata}
            onWriteAudioMetadata={handleWriteLibraryAudioMetadata}
            onDelete={handleDeleteProject}
            onDeleteMany={handleDeleteMultiple}
          />
        )}
      </main>

      {/* Technical log follows the workspace so it never covers its controls. */}
      <LogsDrawer
        logs={masterLogs}
        isOpen={showLogsDrawer}
        onClose={() => setShowLogsDrawer(false)}
      />

      {/* Modals */}
      {showPurgeModal && (
        <CleanupModal
          job={currentJob}
          onClose={() => setShowPurgeModal(false)}
          onCleanup={handleCleanup}
        />
      )}

      {showConfigModal && (
        <ConfigModal
          config={config}
          theme={theme}
          customThemes={customThemes}
          themeWarnings={themeWarnings}
          isReloadingThemes={isReloadingThemes}
          onThemeChange={handleThemeChange}
          onReloadThemes={reloadCustomThemes}
          onOpenThemesFolder={handleOpenThemesFolder}
          onClose={() => setShowConfigModal(false)}
          onSaveConfig={handleSaveConfig}
        />
      )}

      {showNewJobModal && (
        <NewJobModal
          onClose={() => setShowNewJobModal(false)}
          onCreateJob={handleCreateJob}
        />
      )}

      {showRequirementsModal && (
        <RequirementsModal
          onClose={() => setShowRequirementsModal(false)}
        />
      )}
    </div>
  );
}
