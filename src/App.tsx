import React, { useState, useEffect } from 'react';
import {
  AudiobookJob,
  WorkbenchConfig,
  ChapterEntry,
  AudiobookMetadata,
  ChapterSourceType,
  AudioMergeMethodType,
  OutputAudioFormat,
} from './types';
import { Header } from './components/Header';
import { Step1MergeDetect } from './components/Step1MergeDetect';
import { Step2ChapterReview } from './components/Step2ChapterReview';
import { Step3Metadata } from './components/Step3Metadata';
import { Step4BuildM4b } from './components/Step4BuildM4b';
import { Step5Validate } from './components/Step5Validate';
import { PurgeModal } from './components/PurgeModal';
import { ConfigModal } from './components/ConfigModal';
import { NewJobModal } from './components/NewJobModal';
import { RequirementsModal } from './components/RequirementsModal';
import { LogsDrawer } from './components/LogsDrawer';
import { CheckCircle2, Clock, HardDrive, AlertCircle, Plus, ArrowRight, Trash2 } from 'lucide-react';

export default function App() {
  const [jobs, setJobs] = useState<AudiobookJob[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(localStorage.getItem('workbench_active_job_id'));
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProcessingStep1, setIsProcessingStep1] = useState<boolean>(false);
  const [isBuildingM4b, setIsBuildingM4b] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);

  // Modals
  const [showPurgeModal, setShowPurgeModal] = useState<boolean>(false);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showNewJobModal, setShowNewJobModal] = useState<boolean>(false);
  const [showRequirementsModal, setShowRequirementsModal] = useState<boolean>(false);
  const [showLogsDrawer, setShowLogsDrawer] = useState<boolean>(false);

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
          fetch('/api/jobs'),
          fetch('/api/config'),
        ]);
        const jobsData = await jobsRes.json();
        const cfgData = await cfgRes.json();
        setJobs(jobsData);
        setConfig(cfgData);
        
        // Validate saved jobId exists
        if (currentJobId && !jobsData.find((j: any) => j.id === currentJobId)) {
           setCurrentJobId(null);
           localStorage.removeItem('workbench_active_job_id');
        } else if (currentJobId) {
          const job = jobsData.find((j: any) => j.id === currentJobId);
          if (job) {
             setActiveStep(getStartingStepForJob(job));
          }
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

  const currentJob = jobs.find((j) => j.id === currentJobId) || null;

  // Handler for closing the project
  const handleCloseProject = () => {
    setCurrentJobId(null);
    setActiveStep(1);
  };

  // Handler for opening a project
  const handleOpenProject = (id: string) => {
    setCurrentJobId(id);
    const job = jobs.find(j => j.id === id);
    if (job) {
      setActiveStep(getStartingStepForJob(job));
    }
  };

  // Refresh current job from server
  const refreshCurrentJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (res.ok) {
        const updated = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      }
    } catch (err) {
      console.error('Failed to refresh job:', err);
    }
  };

  // Step 1 Handler
  const handleRunStep1 = async (options?: {
    chapterSource?: ChapterSourceType;
    mergeMethod?: AudioMergeMethodType;
    selectedModelId?: string;
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

  // Purge Handler
  const handlePurge = async (purgeType: 'temp' | 'intermediate' | 'job', confirmation?: string) => {
    if (!currentJob) return;
    const res = await fetch(`/api/jobs/${currentJob.id}/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purgeType, confirmation }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Purge failed');
    await refreshCurrentJob(currentJob.id);
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
    setJobs((prev) => [data, ...prev]);
    setCurrentJobId(data.id);
    setActiveStep(1);
  };

  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);

  // Toggle selection for a job
  const toggleJobSelection = (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    setSelectedJobIds(prev => 
        prev.includes(jobId) 
            ? prev.filter(id => id !== jobId) 
            : [...prev, jobId]
    );
  };

  // Bulk Delete Handler
  const handleDeleteMultiple = async () => {
    const count = selectedJobIds.length;
    if (count === 0) return;

    const confirmMsg = `Are you sure you want to delete ${count} selected project${count > 1 ? 's' : ''}?\n\nThis will permanently remove all project data and Workbench-managed files.`;
    
    if (window.confirm(confirmMsg)) {
        try {
            // Process deletions sequentially or in parallel
            await Promise.all(selectedJobIds.map(id => 
                fetch(`/api/jobs/${id}`, { method: 'DELETE' })
            ));
            
            setJobs(prev => prev.filter(j => !selectedJobIds.includes(j.id)));
            if (currentJobId && selectedJobIds.includes(currentJobId)) {
                setCurrentJobId(null);
                setActiveStep(1);
            }
            setSelectedJobIds([]);
        } catch (err: any) {
            alert(`Bulk Delete Error: ${err.message}`);
        }
    }
  };

  // Delete Job Handler
  const handleDeleteProject = async (e: React.MouseEvent, jobId: string, jobName: string) => {
    e.stopPropagation(); // Don't trigger the "Open Project" click
    
    const confirmMsg = `Are you sure you want to delete the project "${jobName}"?\n\nThis will permanently remove the project data and any files uploaded to the Workbench. Files stored outside of the program folder will not be removed.`;
    
    if (window.confirm(confirmMsg)) {
        try {
            const res = await fetch(`/api/jobs/${jobId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                setJobs(prev => prev.filter(j => j.id !== jobId));
                setSelectedJobIds(prev => prev.filter(id => id !== jobId));
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
    <div className="min-h-screen bg-stone-100 flex flex-col font-sans">
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {currentJob ? (
          <>
            {/* Book Meta & Step Progress Navigation */}
            <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-stone-100 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <h1 className="text-xl font-bold text-stone-900 tracking-tight">
                      {currentJob.name}
                    </h1>
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-stone-100 text-stone-700 uppercase border border-stone-200">
                      {currentJob.status}
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

                <div className="flex flex-col items-end space-y-2">
                    <div className="flex items-center space-x-4 text-xs font-mono text-stone-600">
                        <span className="flex items-center space-x-1.5">
                            <Clock className="w-3.5 h-3.5 text-stone-400" />
                            <span>{formatDuration(currentJob.totalDurationSeconds)}</span>
                        </span>
                        <span>•</span>
                        <span>{currentJob.parts.length} source parts</span>
                        <span>•</span>
                        <span className="flex items-center space-x-1.5">
                            <HardDrive className="w-3.5 h-3.5 text-stone-400" />
                            <span>{(currentJob.totalSizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                        </span>
                    </div>
                    <button 
                        onClick={handleCloseProject}
                        className="text-[11px] font-semibold text-stone-500 hover:text-stone-900 flex items-center space-x-1 cursor-pointer transition-colors"
                    >
                        <span>&larr; Close Project & Return to Dashboard</span>
                    </button>
                </div>
              </div>

              {/* 5 Step Pipeline Navigation Tabs */}
              <nav aria-label="Workbench Steps" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {[
                  { step: 1, label: '1. Staging', desc: 'Import and Workflow' },
                  { step: 2, label: '2. Build Chapters', desc: 'Audit and Edit Chapters' },
                  { step: 3, label: '3. Metadata', desc: 'Edit Metadata & Artwork' },
                  { step: 4, label: '4. Export', desc: 'Preserve audio or convert selected formats' },
                  { step: 5, label: '5. Validate', desc: 'FFprobe container check & playback review' },
                ].map((item) => {
                  const isActive = activeStep === item.step;
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
                      className={`p-3 rounded-lg text-left transition-all cursor-pointer border ${
                        isActive
                          ? 'bg-amber-50/70 border-amber-400 ring-1 ring-amber-400/40'
                          : 'bg-stone-50 border-stone-200/80 hover:bg-stone-100/70'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-bold ${
                            isActive ? 'text-amber-900' : 'text-stone-800'
                          }`}
                        >
                          {item.label}
                        </span>
                        {isCompleted && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                      </div>
                      <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                        {item.desc}
                      </p>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Active Step Content */}
            {activeStep === 1 && (
              <Step1MergeDetect
                job={currentJob}
                config={config}
                onRunStep1={handleRunStep1}
                isRunning={isProcessingStep1}
                onNextStep={() => setActiveStep(2)}
                onUpdateJobSettings={handleUpdateJobSettings}
                onConfigChange={setConfig}
              />
            )}

            {activeStep === 2 && (
              <Step2ChapterReview
                job={currentJob}
                leadInSeconds={config.lead_in_seconds}
                onSaveChapters={handleSaveChapters}
                onNextStep={() => setActiveStep(3)}
              />
            )}

            {activeStep === 3 && (
              <Step3Metadata
                job={currentJob}
                onSaveMetadata={handleSaveMetadata}
                onNextStep={() => setActiveStep(4)}
              />
            )}

            {activeStep === 4 && (
              <Step4BuildM4b
                job={currentJob}
                config={config}
                onBuildM4b={handleBuildM4b}
                isBuilding={isBuildingM4b}
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
          <div className="space-y-6">
            <div className="bg-white rounded-xl p-8 border border-stone-200 shadow-xs">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-stone-900">Audiobook Projects</h2>
                        <p className="text-sm text-stone-500 mt-1">Select an active book to begin processing or create a new project.</p>
                    </div>
                    <div className="flex items-center space-x-3">
                        {selectedJobIds.length > 0 && (
                            <button
                                onClick={handleDeleteMultiple}
                                className="flex items-center space-x-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold rounded-lg cursor-pointer transition-all border border-red-200"
                            >
                                <Trash2 className="w-4 h-4" />
                                <span>Delete {selectedJobIds.length} Selected</span>
                            </button>
                        )}
                        <button
                            onClick={() => setShowNewJobModal(true)}
                            className="flex items-center space-x-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg cursor-pointer transition-all shadow-sm"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Create New Book</span>
                        </button>
                    </div>
                </div>

                {jobs.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {jobs.map((job) => (
                            <div
                                key={job.id}
                                onClick={() => handleOpenProject(job.id)}
                                className={`relative bg-stone-50 hover:bg-white p-5 pt-8 rounded-xl border transition-all hover:shadow-md group cursor-pointer ${
                                    selectedJobIds.includes(job.id) ? 'border-amber-500 ring-1 ring-amber-500/20 bg-amber-50/10' : 'border-stone-200 hover:border-amber-400'
                                }`}
                            >
                                {/* Selection Circle */}
                                <div 
                                    onClick={(e) => toggleJobSelection(e, job.id)}
                                    className={`absolute top-3 left-3 w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center ${
                                        selectedJobIds.includes(job.id) 
                                            ? 'bg-amber-500 border-amber-500' 
                                            : 'bg-white border-stone-300 opacity-0 group-hover:opacity-100 hover:border-amber-400'
                                    }`}
                                >
                                    {selectedJobIds.includes(job.id) && (
                                        <div className="w-2 h-2 bg-white rounded-full shadow-sm" />
                                    )}
                                </div>

                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <h3 className="font-bold text-stone-900 group-hover:text-amber-900 transition-colors">{job.name}</h3>
                                        <p className="text-xs text-stone-500 line-clamp-1">{job.author || 'No Author'} • {job.narrator || 'No Narrator'}</p>
                                    </div>
                                    <div className="flex flex-col items-end space-y-2">
                                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                                            job.status === 'validated' ? 'bg-emerald-100 text-emerald-700' :
                                            job.status === 'draft' ? 'bg-stone-200 text-stone-600' : 'bg-amber-100 text-amber-700'
                                        }`}>
                                            {job.status}
                                        </span>
                                        <button
                                            onClick={(e) => handleDeleteProject(e, job.id, job.name)}
                                            className="p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                            title="Delete project"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-4 flex items-center justify-between text-[11px] text-stone-400 font-mono">
                                    <div className="flex items-center space-x-3">
                                        <span className="flex items-center space-x-1">
                                            <Clock className="w-3 h-3" />
                                            <span>{formatDuration(job.totalDurationSeconds)}</span>
                                        </span>
                                        <span>•</span>
                                        <span>{job.parts.length} files</span>
                                    </div>
                                    <span className="text-amber-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1">
                                        <span>Open</span>
                                        <ArrowRight className="w-3 h-3" />
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="py-20 text-center border-2 border-dashed border-stone-200 rounded-xl">
                        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-400">
                            <HardDrive className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-semibold text-stone-900">No books found</h3>
                        <p className="text-sm text-stone-500 max-w-xs mx-auto mt-2">Get started by creating your first audiobook processing project.</p>
                        <button
                            onClick={() => setShowNewJobModal(true)}
                            className="mt-6 px-4 py-2 bg-stone-900 text-white rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors"
                        >
                            Create Project
                        </button>
                    </div>
                )}
            </div>

            {/* Quick Start / Help Card */}
            <div className="bg-amber-50/50 rounded-xl p-6 border border-amber-200/50 flex items-start space-x-4">
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-amber-900">Single Project Focus</h3>
                    <p className="text-xs text-amber-800/80 mt-1 leading-relaxed max-w-2xl">
                        The Workbench now operates in <strong>Single Project Mode</strong> to ensure that audio imports, WhisperX transcriptions, and metadata tags are always perfectly assigned to the correct book. Select a book from the list above to resume your work, or create a new one to begin a fresh import.
                    </p>
                </div>
            </div>
          </div>
        )}
      </main>

      {/* Logs / Console Bottom Drawer */}
      <LogsDrawer
        logs={currentJob?.logs || []}
        isOpen={showLogsDrawer}
        onClose={() => setShowLogsDrawer(false)}
      />

      {/* Modals */}
      {showPurgeModal && currentJob && (
        <PurgeModal
          job={currentJob}
          onClose={() => setShowPurgeModal(false)}
          onPurge={handlePurge}
        />
      )}

      {showConfigModal && (
        <ConfigModal
          config={config}
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
