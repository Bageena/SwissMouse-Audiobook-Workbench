import { ArrowRight } from 'lucide-react';
import { WorkflowLayout, workflowPages } from './components/WorkflowNavigation';
import { resetPageLayout } from './utils/desktopLayout';
import { ProjectOverview } from './components/ProjectOverview';
import { ThemeBackground } from './components/ThemeBackground';
import { readSharedTheme, saveSharedTheme } from './utils/sharedAppearance';
import { readApiJson } from './utils/apiResponse';
import { canReviewChapters } from './utils/pipelineRerun';
import { ActivityPanel } from './components/ActivityPanel';
import { readStored, writeStored } from './utils/libraryWorkspace';
import { useState, useEffect, useRef, useMemo } from 'react';
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
import { audiobookModule } from './modules/builtins';
import { AsyncState } from './components/AsyncState';
import type { LibraryTransferMode } from './components/MoveToLibrary';
import { CleanupModal, CleanupType } from './components/CleanupModal';
import { ConfigModal } from './components/ConfigModal';
import { RequirementsModal } from './components/RequirementsModal';
import { LogsDrawer } from './components/LogsDrawer';
import { QUICK_ADD_CATEGORIES, cleanQuickTags } from './utils/metadataQuickAdd';
import { chapterReviewChanged } from './utils/chapterReviewDraft';
import { stopQuickPlayback } from './playback/QuickPlaybackController';
import { CustomTheme, ThemeDiscoveryResponse, DEFAULT_THEME, getStoredTheme, isAppTheme, persistTheme } from './theme';
import type { JobLog } from './types';

const { BookFiles, LibraryManager, Step1MergeDetect, Step2ChapterReview, Step3Metadata, Step4Export, Step5Validate } = audiobookModule.screens;

export default function App() {
  const [jobs, setJobs] = useState<AudiobookJob[]>([]);
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [libraryScanning, setLibraryScanning] = useState(false);
  const [libraryScanWarning, setLibraryScanWarning] = useState('');
  const [currentJobId, setCurrentJobId] = useState<string | null>(localStorage.getItem('workbench_active_job_id'));
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [chapterReviewActionHost, setChapterReviewActionHost] = useState<HTMLDivElement | null>(null);
  const [metadataReviewActionHost, setMetadataReviewActionHost] = useState<HTMLDivElement | null>(null);
  const [convertActionHost, setConvertActionHost] = useState<HTMLDivElement | null>(null);
  const [processReadiness, setProcessReadiness] = useState<{ jobId: string; valid: boolean } | null>(null);
  const [reviewFilesOpen, setReviewFilesOpen] = useState(false);
  const [legacyImportMode, setLegacyImportMode] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const chapterDraftRef = useRef<{ jobId: string; chapters: ChapterEntry[]; hasEdits?: boolean } | null>(null);
  const metadataDraftRef = useRef<{ jobId: string; metadata: AudiobookMetadata } | null>(null);
  const metadataDraftWriteRef = useRef<Promise<void>>(Promise.resolve());
  const quickTagWriteRef = useRef<Promise<void>>(Promise.resolve());
  const navigationGenerationRef = useRef(0);
  const navigationPreparationRef = useRef<Promise<boolean> | null>(null);
  const ratingWritesRef = useRef(new Map<string, Promise<void>>());
  const ratingVersionsRef = useRef(new Map<string, number>());
  const savedRatingsRef = useRef(new Map<string, number | null>());
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const [theme, setTheme] = useState<string>(getStoredTheme);
  const themePreferenceRevision = useRef(0);
  const pendingThemeWrites = useRef(0);
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [themeWarnings, setThemeWarnings] = useState<string[]>([]);
  const [isReloadingThemes, setIsReloadingThemes] = useState(false);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [startupError, setStartupError] = useState('');
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [isProcessingStep1, setIsProcessingStep1] = useState<boolean>(false);
  const [isBuildingM4b, setIsBuildingM4b] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [libraryPlayerJob, setLibraryPlayerJob] = useState<AudiobookJob | null>(null);
  const [libraryPlayRequest, setLibraryPlayRequest] = useState(0);
  const libraryPlayGeneration = useRef(0);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportProgressMessage, setExportProgressMessage] = useState('');
  const [isValidating, setIsValidating] = useState<boolean>(false);

  // Modals
  const [showPurgeModal, setShowPurgeModal] = useState<boolean>(false);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showRequirementsModal, setShowRequirementsModal] = useState<boolean>(false);
  const [showLogsDrawer, setShowLogsDrawer] = useState<boolean>(false);
  const [showActivity, setShowActivity] = useState(false);
  const [masterLogs, setMasterLogs] = useState<JobLog[]>([]);
  const [clientLogs, setClientLogs] = useState<JobLog[]>([]);
  const technicalLogs = useMemo(() => [...new Map([...masterLogs, ...clientLogs].map(entry => [`${entry.timestamp}|${entry.level}|${entry.message}`, entry])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), [masterLogs, clientLogs]);
  const logClientFailure = (message: string) => {
    const entry: JobLog = { timestamp: new Date().toISOString(), level: 'ERROR', message: `[Project audio check] ${message}` };
    setClientLogs(previous => [...previous.slice(-199), entry]);
    void fetch('/api/logs/client', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch(() => {});
  };

  // Helper to determine the starting step based on job status
  const getStartingStepForJob = (job: AudiobookJob): 1 | 2 | 3 | 4 | 5 => {
    if (job.status === 'draft') return 1;
    if (job.status === 'transcribed' || job.status === 'merged') return 2;
    if (job.status === 'metadata_ready') return 3;
    if (job.status === 'built') return 4;
    if (job.status === 'validated') return 5;
    return 1;
  };

  const rememberedStep = (job: AudiobookJob) => {
    const value = readStored<number>(`swissmouse-book-step-${job.id}`, 0, true);
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value as 1 | 2 | 3 | 4 | 5 : getStartingStepForJob(job);
  };
  useEffect(() => { if (currentJobId && !isLoading) { writeStored(`swissmouse-book-view-${currentJobId}`, reviewFilesOpen ? 'files' : 'workflow', true); if (!reviewFilesOpen) writeStored(`swissmouse-book-step-${currentJobId}`, activeStep, true); } }, [currentJobId, activeStep, isLoading, reviewFilesOpen]);

  useEffect(() => {
    if (!currentJobId || isLoading) return;
    const key = `swissmouse-workspace-scroll-${currentJobId}-${reviewFilesOpen ? 'files' : activeStep}`;
    const raw = readStored<number>(key, 0, true);
    const y = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const frame = requestAnimationFrame(() => window.scrollTo(0, y));
    const save = () => writeStored(key, window.scrollY, true);
    window.addEventListener('scroll', save, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', save); };
  }, [currentJobId, activeStep, reviewFilesOpen, isLoading]);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    async function loadInitialData() {
      setIsLoading(true); setStartupError('');
      try {
        const [jobsRes, cfgRes] = await Promise.all([
          fetch('/api/library?limit=50'),
          fetch('/api/config'),
        ]);
        const jobsData = await readApiJson(jobsRes, 'Load library');
        const cfgData = await readApiJson(cfgRes, 'Load settings');
        if (!jobsRes.ok || !Array.isArray(jobsData)) throw new Error(jobsData.error || 'Could not load the library. Check that SwissMouse is running and try again.');
        if (!cfgRes.ok || !cfgData || typeof cfgData !== 'object') throw new Error(cfgData?.error || 'Could not load settings. Check that SwissMouse is running and try again.');
        if (cancelled) return;
        setLibraryBooks(jobsData);
        setConfig(cfgData);
        const scanResponse = await fetch('/api/library/scan-status');
        const scan = await scanResponse.json();
        setLibraryScanning(scan.scanning);
        setLibraryScanWarning((scan.warnings || []).join(' '));
        
        // Validate saved jobId exists
        if (currentJobId) {
          const response = await fetch(`/api/jobs/${currentJobId}`);
          if (response.ok) { const job = await response.json(); setJobs([job]); setReviewFilesOpen(!!job.importPending || readStored<string>(`swissmouse-book-view-${job.id}`, '', true) === 'files'); setActiveStep(rememberedStep(job)); setLegacyImportMode(job.status === 'draft' && !job.sourceFolderPath); }
          else { setLibraryPlayerJob(currentJob);
      setLibraryPlayRequest(0);
      setCurrentJobId(null); localStorage.removeItem('workbench_active_job_id'); }
        }
      } catch (err) {
        console.error('Failed to load initial data:', err);
        if (!cancelled) setStartupError(err instanceof Error ? err.message : 'Could not start SwissMouse. Check that the server is running.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadInitialData();
    return () => { cancelled = true; };
  }, [startupAttempt]);

  useEffect(() => {
    if (!libraryScanning) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch('/api/library/scan-status');
        const scan = await response.json();
        if (!scan.scanning) {
          setLibraryScanning(false); setLibraryScanWarning((scan.warnings || []).join(' '));
          const books = await fetch('/api/library?limit=50');
          if (books.ok) setLibraryBooks(await books.json());
        }
      } catch { setLibraryScanning(false); setLibraryScanWarning('Could not read scan status. Refresh to retry.'); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [libraryScanning]);

  // Persist active job ID
  useEffect(() => {
    if (currentJobId) {
      localStorage.setItem('workbench_active_job_id', currentJobId);
    } else {
      localStorage.removeItem('workbench_active_job_id');
    }
  }, [currentJobId]);

  const reloadCustomThemes = async () => {
    const revision = themePreferenceRevision.current;
    setIsReloadingThemes(true);
    try {
      const response = await fetch('/api/themes');
      if (!response.ok) throw new Error('Could not scan the custom themes folder.');
      const discovery: ThemeDiscoveryResponse = await response.json();
      setCustomThemes(discovery.themes);
      setThemeWarnings(discovery.warnings);
      let selected = getStoredTheme();
      try { selected = await saveSharedTheme(selected, true); }
      catch (error) { setThemeWarnings(previous => [...previous, error instanceof Error ? error.message : 'Could not load shared appearance.']); }
      if (revision !== themePreferenceRevision.current) return;
      const customTheme = discovery.themes.find(candidate => candidate.id === selected);
      if (isAppTheme(selected)) {
        setTheme(selected);
        persistTheme(selected);
      } else if (customTheme) {
        setTheme(selected);
        persistTheme(selected, customTheme);
      } else {
        setTheme(DEFAULT_THEME);
        persistTheme(DEFAULT_THEME);
      }
    } catch (error) {
      console.error('Failed to load custom themes:', error);
      setThemeWarnings([error instanceof Error ? error.message : 'Could not load custom themes.']);
      if (!isAppTheme(getStoredTheme())) {
        setTheme(DEFAULT_THEME);
        persistTheme(DEFAULT_THEME);
      }
    } finally {
      setIsReloadingThemes(false);
      setAppearanceLoaded(true);
    }
  };

  useEffect(() => { void reloadCustomThemes(); }, []);

  const handleThemeChange = (nextTheme: string) => {
    themePreferenceRevision.current++;
    pendingThemeWrites.current++;
    const customTheme = customThemes.find(candidate => candidate.id === nextTheme);
    setTheme(nextTheme);
    persistTheme(nextTheme, customTheme);
    void saveSharedTheme(nextTheme).catch(error => {
      setThemeWarnings(previous => [...previous, error instanceof Error ? error.message : 'Could not save shared appearance.']);
    }).finally(() => { pendingThemeWrites.current--; });
  };

  useEffect(() => {
    if (!appearanceLoaded) return;
    let stopped = false;
    let checking = false;
    const synchronize = async () => {
      if (checking || pendingThemeWrites.current || document.visibilityState === 'hidden') return;
      checking = true;
      const revision = themePreferenceRevision.current;
      try {
        const selected = await readSharedTheme();
        if (stopped || revision !== themePreferenceRevision.current || pendingThemeWrites.current || !selected || selected === getStoredTheme()) return;
        const customTheme = customThemes.find(candidate => candidate.id === selected);
        if (!isAppTheme(selected) && !customTheme) return;
        setTheme(selected);
        persistTheme(selected, customTheme);
      } catch { /* Keep the cached theme while the local server is unavailable. */ }
      finally { checking = false; }
    };
    const refresh = () => { void synchronize(); };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [appearanceLoaded, customThemes]);

  const handleOpenThemesFolder = async () => {
    const response = await fetch('/api/themes/open-folder', { method: 'POST' });
    if (!response.ok) throw new Error('Could not open the custom themes folder.');
  };

  const currentJob = jobs.find((j) => j.id === currentJobId) || null;
  const currentJobRef = useRef(currentJob);
  currentJobRef.current = currentJob;

  const withSavedRating = (job: AudiobookJob): AudiobookJob => savedRatingsRef.current.has(job.id)
    ? { ...job, personalRating: savedRatingsRef.current.get(job.id)! }
    : job;

  const handleRatingChange = (bookId: string, rating: number | null): Promise<void> => {
    const version = (ratingVersionsRef.current.get(bookId) || 0) + 1;
    ratingVersionsRef.current.set(bookId, version);
    const write = (ratingWritesRef.current.get(bookId) || Promise.resolve()).catch(() => {}).then(async () => {
      const response = await fetch(`/api/jobs/${encodeURIComponent(bookId)}/personal-rating`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save your rating.');
      if (result.bookId !== bookId || result.rating !== rating) throw new Error('The saved rating did not match this book. Please try again.');
      // Writes remain bound to their original book, even if its selector has unmounted.
      if (ratingVersionsRef.current.get(bookId) !== version) return;
      savedRatingsRef.current.set(bookId, result.rating);
      setJobs(previous => previous.map(job => job.id === bookId ? { ...job, personalRating: result.rating } : job));
      setLibraryBooks(previous => previous.map(book => book.id === bookId ? { ...book, personalRating: result.rating } : book));
    });
    ratingWritesRef.current.set(bookId, write);
    void write.finally(() => { if (ratingWritesRef.current.get(bookId) === write) ratingWritesRef.current.delete(bookId); }).catch(() => {});
    return write;
  };

  const flushMetadataBeforeNavigation = async (jobId: string) => {
    // The child editor's debounce may not have fired yet. Read its current draft
    // again after each write so typing during a slow save is included as well.
    let draft = metadataDraftRef.current;
    if (draft?.jobId !== jobId) { await metadataDraftWriteRef.current; return; }
    while (draft?.jobId === jobId) {
      const metadata = draft.metadata;
      await handlePersistMetadataDraft(jobId, metadata);
      draft = metadataDraftRef.current;
      if (draft?.jobId !== jobId || draft.metadata === metadata) return;
    }
  };

  const prepareToLeaveBook = (): Promise<boolean> => {
    if (navigationPreparationRef.current) return navigationPreparationRef.current;
    const leavingJob = currentJobRef.current;
    const prepare = (async () => {
      let chapterDraft = chapterDraftRef.current;
      if (leavingJob && chapterDraft?.jobId === leavingJob.id && (chapterDraft.hasEdits ?? chapterReviewChanged(chapterDraft.chapters, leavingJob.chapters))) {
        if (!window.confirm('Save your chapter edits before switching books?\n\nCancel keeps this book open with your edits.')) return false;
        while (chapterDraft?.jobId === leavingJob.id) {
          const chapters = chapterDraft.chapters;
          await handleSaveChapters(chapters);
          chapterDraft = chapterDraftRef.current;
          if (chapterDraft?.chapters === chapters) break;
        }
      }
      await stopQuickPlayback();
      if (leavingJob) await flushMetadataBeforeNavigation(leavingJob.id);
      if (leavingJob) await ratingWritesRef.current.get(leavingJob.id);
      return true;
    })();
    navigationPreparationRef.current = prepare;
    void prepare.finally(() => { if (navigationPreparationRef.current === prepare) navigationPreparationRef.current = null; }).catch(() => {});
    return prepare;
  };

  // Handler for closing the project
  const handleCloseProject = async () => {
    if (currentJob?.importPending) { await handleCancelImport(); return; }
    const generation = ++navigationGenerationRef.current;
    setNavigationError(null);
    try {
      if (!await prepareToLeaveBook() || generation !== navigationGenerationRef.current) return;
      setLibraryPlayerJob(currentJob);
      setLibraryPlayRequest(0);
      setCurrentJobId(null);
      setLegacyImportMode(false);
      setReviewFilesOpen(false);
      setActiveStep(1);
    } catch (error) {
      if (generation === navigationGenerationRef.current) setNavigationError(error instanceof Error ? error.message : 'Could not save this book before switching.');
    }
  };

  // Handler for opening a project
  const handleOpenProject = async (id: string, bookFiles = false) => {
    ++libraryPlayGeneration.current;
    const generation = ++navigationGenerationRef.current;
    setNavigationError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('Could not open this book. Refresh the library and try again.');
      const loaded = await response.json() as AudiobookJob;
      if (generation !== navigationGenerationRef.current || !await prepareToLeaveBook() || generation !== navigationGenerationRef.current) return;
      const previousView = readStored<string>(`swissmouse-book-view-${loaded.id}`, '', true);
      setReviewFilesOpen(!!loaded.importPending || previousView === 'files' || (previousView !== 'workflow' && bookFiles));
      setJobs([withSavedRating(loaded)]);
      setCurrentJobId(id);
      setActiveStep(rememberedStep(loaded));
      setLegacyImportMode(loaded.status === 'draft' && !loaded.sourceFolderPath);
    } catch (error) {
      if (generation === navigationGenerationRef.current) setNavigationError(error instanceof Error ? error.message : 'Could not open this book.');
    }
  };

  // Refresh current job from server
  const refreshCurrentJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (res.ok) {
        const updated = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === jobId ? withSavedRating(updated) : j)));
        setLibraryBooks(prev => prev.map(book => book.id === jobId ? { ...(updated.libraryBook || book), ...(savedRatingsRef.current.has(jobId) ? { personalRating: savedRatingsRef.current.get(jobId)! } : {}) } : book));
      }
    } catch (err) {
      console.error('Failed to refresh job:', err);
    }
  };

  // The Settings terminal combines every project's saved activity with the
  // section streams, including work performed while no project is open.
  useEffect(() => {
    if (!showLogsDrawer && !showActivity) return;
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
  }, [showLogsDrawer, showActivity]);

  // Step 1 Handler
  const handleRunStep1 = async (options?: {
    generateWaveform?: boolean;
    generateTranscript?: boolean;
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
      if (options?.mergeMethod === 'skip') setActiveStep(2);
    } catch (err: any) {
      await refreshCurrentJob(currentJob.id);
      setShowLogsDrawer(true);
    } finally {
      setIsProcessingStep1(false);
    }
  };

  const handleRerunStep = async (step: RerunnablePipelineStep, settings?: { transcriptionSettings?: AudiobookJob['transcriptionSettings']; selectedModelId?: string }): Promise<void> => {
    if (!currentJob) return;
    if (currentJob.pipelineSteps?.[step]?.hasOutput && !window.confirm('This step has already been completed. Are you sure you want to rerun it?')) return;
    setIsProcessingStep1(true);
    try {
      if (settings) {
        const saved = await fetch(`/api/jobs/${currentJob.id}/step1-settings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
        });
        if (!saved.ok) throw new Error((await saved.json()).error || 'Could not save transcription settings');
      }
      const start = async (confirmReplaceManualChapters: boolean) => {
        const response = await fetch(`/api/jobs/${currentJob.id}/rerun/${step}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmReplaceManualChapters }),
        });
        const data = await response.json();
        return { response, data };
      };
      let { response, data } = await start(false);
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
      // Detection/extraction replaced the saved chapter list. Do not reopen
      // the editor with the draft retained from before this successful run.
      if ((step === 'detecting_chapters' || step === 'extracting_chapters') && chapterDraftRef.current?.jobId === currentJob.id) {
        chapterDraftRef.current = null;
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
      const response = await fetch(`/api/jobs/${currentJob.id}/step1-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save source settings.');
      await refreshCurrentJob(currentJob.id);
    } catch (err) {
      console.error('Failed to update job settings:', err);
      throw err;
    }
  };

  const handleSourceLoaded = async (updated?: AudiobookJob) => {
    if (!currentJob) return;
    if (updated && !updated.parts.length) {
      metadataDraftRef.current = null;
      await refreshCurrentJob(currentJob.id);
      return;
    }
    const response = await fetch(`/api/jobs/${currentJob.id}/inspect-import`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not read source metadata.');
    if (currentJobRef.current?.id !== currentJob.id) return;
    metadataDraftRef.current = null;
    setJobs(previous => previous.map(job => job.id === currentJob.id ? withSavedRating(data) : job));
    setImportError(null);
  };

  const handleStartImport = async () => {
    const generation = ++navigationGenerationRef.current;
    setImportError(null);
    setNavigationError(null);
    try {
      if (!await prepareToLeaveBook() || generation !== navigationGenerationRef.current) return;
      const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New book', importPending: true, parts: [] }) });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || 'Could not start import.');
      if (generation !== navigationGenerationRef.current) return;
      setJobs([job]);
      setCurrentJobId(job.id);
      setLegacyImportMode(false);
      setActiveStep(1);
    } catch (error: any) { setImportError(error.message || 'Could not start import.'); }
  };

  const handleCancelImport = async () => {
    if (!currentJob) return;
    if (!currentJob.importPending) { await handleCloseProject(); return; }
    const generation = ++navigationGenerationRef.current;
    try {
      await stopQuickPlayback();
      await metadataDraftWriteRef.current.catch(() => {});
      if (generation !== navigationGenerationRef.current) return;
      const response = await fetch(`/api/jobs/${currentJob.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not cancel import.');
      if (generation !== navigationGenerationRef.current) return;
      metadataDraftRef.current = null;
      setJobs([]);
      setLibraryPlayerJob(currentJob);
      setLibraryPlayRequest(0);
      setCurrentJobId(null);
      setLegacyImportMode(false);
      setImportError(null);
    } catch (error: any) { setImportError(error.message || 'Could not cancel import.'); }
  };

  const handleFinishImport = async (metadata: AudiobookMetadata, process: boolean, writeSource: boolean) => {
    if (!currentJob) return;
    if (process) {
      const readinessResponse = await fetch('/api/jobs/' + encodeURIComponent(currentJob.id) + '/book-files');
      const readinessData = await readinessResponse.json();
      if (!readinessResponse.ok || readinessData.readiness?.status !== 'Ready') throw new Error(readinessData.error || readinessData.readiness?.issues?.[0] || 'Add valid audio to Processing Order before continuing.');
    }
    const generation = ++navigationGenerationRef.current;
    await stopQuickPlayback();
    await metadataDraftWriteRef.current.catch(() => {});
    const response = await fetch(`/api/jobs/${currentJob.id}/finish-import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata, process, writeSource, expectedRevision: currentJob.metadataRevision || 0 }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not finish import.');
    if (generation !== navigationGenerationRef.current) return;
    metadataDraftRef.current = null;
    setJobs([withSavedRating(data.job)]);
    setLegacyImportMode(false);
    const libraryResponse = await fetch('/api/library?limit=50');
    if (libraryResponse.ok) setLibraryBooks(await libraryResponse.json());
    if (generation !== navigationGenerationRef.current) return;
    if (process) { setActiveStep(1); setReviewFilesOpen(false); }
    else setLibraryPlayerJob(currentJob);
      setLibraryPlayRequest(0);
      setCurrentJobId(null);
  };

  const handleFinishFileReview = async (metadata: AudiobookMetadata) => {
    await handleSaveMetadata(metadata);
    setReviewFilesOpen(false);
  };

  const handleOrganizeLibrary = async (metadata: AudiobookMetadata): Promise<string> => {
    if (!currentJob) return '';
    await handleSaveMetadata(metadata);
    const endpoint = `/api/jobs/${currentJob.id}/organize-library`;
    const previewResponse = await fetch(endpoint);
    const preview = await previewResponse.json();
    if (!previewResponse.ok) throw new Error(preview.error || 'Could not plan the Library folder.');
    if (preview.alreadyOrganized) return 'This book already uses the configured Library folder pattern.';
    const action = preview.finishedOnly
      ? 'SwissMouse will organize the surviving M4B. The original source will still be marked missing.'
      : 'SwissMouse will move this book and its associated sidecars into the Library, create its folders, and verify the transferred files. Shared or ambiguous files will stay in place.';
    if (!window.confirm(`Organize this book in the Library?\n\n${preview.source}\n→ ${preview.target}\n\n${action} No audio processing will run.`)) return 'Library organization cancelled.';
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: preview.source, target: preview.target }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not organize the Library folder.');
    setJobs(previous => previous.map(job => job.id === result.job.id ? withSavedRating(result.job) : job));
    await refreshCurrentJob(result.job.id);
    const libraryResponse = await fetch('/api/library?limit=50');
    if (libraryResponse.ok) setLibraryBooks(await libraryResponse.json());
    return `Book moved to ${result.target}.${result.warning ? ` ${result.warning}` : ''}`;
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
    if (chapterDraftRef.current?.jobId === currentJob.id && chapterDraftRef.current.chapters === chapters) chapterDraftRef.current = null;
  };

  // Step 3 Handler: Audiobook Metadata & Cover Art
  const handlePersistMetadataDraft = (jobId: string, metadata: AudiobookMetadata): Promise<void> => {
    const expectedRevision = (jobsRef.current.find(job => job.id === jobId) || jobs.find(job => job.id === jobId))?.metadataRevision || 0;
    const write = metadataDraftWriteRef.current.catch(() => {}).then(async () => {
      const response = await fetch(`/api/jobs/${jobId}/metadata-draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata, expectedRevision }),
      });
      if (!response.ok) throw new Error('Could not save the metadata draft.');
    });
    metadataDraftWriteRef.current = write;
    return write;
  };

  const handleSaveMetadata = async (metadata: AudiobookMetadata) => {
    if (!currentJob) return;
    await metadataDraftWriteRef.current.catch(() => {});
    const res = await fetch(`/api/jobs/${currentJob.id}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata, expectedRevision: currentJob.metadataRevision || 0 }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save metadata');
    }
    setJobs(previous => previous.map(job => job.id === currentJob.id ? withSavedRating(data.job) : job));
    if (data.libraryBook) setLibraryBooks(previous => previous.map(book => book.id === currentJob.id ? data.libraryBook : book));
    if (metadataDraftRef.current?.jobId === currentJob.id) metadataDraftRef.current = null;
  };

  const handleUpdateMetadataJson = async (metadata: AudiobookMetadata): Promise<string[]> => {
    if (!currentJob) return [];
    await metadataDraftWriteRef.current.catch(() => {});
    const response = await fetch(`/api/jobs/${currentJob.id}/metadata-json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata, expectedRevision: currentJob.metadataRevision || 0 }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update metadata.json.');
    await refreshCurrentJob(currentJob.id);
    if (metadataDraftRef.current?.jobId === currentJob.id) metadataDraftRef.current = null;
    return result.written;
  };

  const handleMoveExportFolder = async (metadata: AudiobookMetadata): Promise<string> => {
    if (!currentJob) return '';
    await handleSaveMetadata(metadata);
    const previewResponse = await fetch(`/api/jobs/${currentJob.id}/export-folder-move`);
    const preview = await previewResponse.json();
    if (!previewResponse.ok) throw new Error(preview.error || 'Could not plan the folder move.');
    if (!preview.moves.length) return 'Exported folder already matches the current book details.';
    const description = preview.moves.map((move: { from: string; to: string }) => `${move.from}\n→ ${move.to}`).join('\n\n');
    if (!window.confirm(`Move the exported audiobook folder${preview.moves.length === 1 ? '' : 's'} to match the saved metadata?\n\n${description}\n\nOnly associated files will move. Other files and nonempty folders stay in place.`)) return 'Folder move cancelled.';
    const response = await fetch(`/api/jobs/${currentJob.id}/export-folder-move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmedMoves: preview.moves }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not move the export folder.');
    await refreshCurrentJob(currentJob.id);
    return `Moved ${result.moved.length} exported folder${result.moved.length === 1 ? '' : 's'} to the updated library location.`;
  };

  // Step 4 Handler: Build Chaptered Audio Package (M4B, M4A, MP3, FLAC, Opus, WAV)
  const handleBuildM4b = async (outputFormats: OutputAudioFormat[] = ['m4b'], convert = false, cue = true, bitrates: Partial<Record<OutputAudioFormat,number>> = {}, zipOriginals = false) => {
    if (!currentJob) return;
    setExportJobId(currentJob.id);
    setExportError(null);
    setIsBuildingM4b(true);
    setExportProgressMessage('');
    const controller = new AbortController();
    let polling = false;
    const poll = window.setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(`/api/jobs/${currentJob.id}/export-progress`, { signal: controller.signal });
        if (response.ok) {
          const progress = await response.json();
          if (!controller.signal.aborted) setExportProgressMessage(progress.message || '');
          if (!controller.signal.aborted) setJobs(previous => previous.map(job => job.id === currentJob.id ? { ...job, exports: progress.exports } : job));
        }
      } catch { /* The build request reports failures; polling never queues more requests. */ }
      finally { polling = false; }
    }, 1000);
    const stopPolling = () => { window.clearInterval(poll); controller.abort(); };
    try {
      const draft = chapterDraftRef.current;
      if (draft?.jobId === currentJob.id && (draft.hasEdits ?? chapterReviewChanged(draft.chapters, currentJob.chapters))) {
        await handleSaveChapters(draft.chapters);
      }
      const build = async (confirmedOverwritePaths?: string[]) => {
        const response = await fetch(`/api/jobs/${currentJob.id}/build-m4b`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputFormats, convert, cue, bitrates, zipOriginals, overwriteExisting: !!confirmedOverwritePaths, confirmedOverwritePaths }),
        });
        return { response, data: await response.json() };
      };
      let { response: res, data } = await build();
      if (data.requiresOverwriteConfirmation && Array.isArray(data.existingFiles)) {
        const names = data.existingFiles.map((file: string) => `• ${file}`).join('\n');
        if (!window.confirm(`The following exported audiobook file${data.existingFiles.length === 1 ? '' : 's'} already exist${data.existingFiles.length === 1 ? 's' : ''}:\n\n${names}\n\nReplace ${data.existingFiles.length === 1 ? 'it' : 'them'} with a new export? The existing file${data.existingFiles.length === 1 ? '' : 's'} will be kept if conversion fails.`)) return;
        ({ response: res, data } = await build(data.existingFiles));
      }
      if (!res.ok) throw new Error(data.error || 'Build failed');
      stopPolling();
      setIsBuildingM4b(false);
      await refreshCurrentJob(currentJob.id);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      setExportError(message);
      console.error('Audio export failed:', err);
      stopPolling();
      setIsBuildingM4b(false);
      await refreshCurrentJob(currentJob.id);
      setShowLogsDrawer(true);
    } finally {
      stopPolling();
      setIsBuildingM4b(false);
    }
  };

  // Step 5 Handler: Validate Output
  const handleValidate = async () => {
    if (!currentJob) return;
    setIsValidating(true);
    try {
      await flushMetadataBeforeNavigation(currentJob.id);
      const res = await fetch(`/api/jobs/${currentJob.id}/validate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Validation failed');
      await refreshCurrentJob(currentJob.id);
    } catch (err: any) {
      await refreshCurrentJob(currentJob.id);
      setShowLogsDrawer(true);
      throw err;
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
    if (data.config.inbox_folder !== config?.inbox_folder || data.config.library_folder !== config?.library_folder) await handleRefreshLibrary();
  };

  const handleAddQuickTag = (tag: string) => {
    const write = quickTagWriteRef.current.catch(() => {}).then(async () => {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Could not load Quick Tags.');
      const latest = await response.json() as WorkbenchConfig;
      const current = latest.quick_tags || [...QUICK_ADD_CATEGORIES];
      const next = cleanQuickTags([...current, tag]);
      if (next.length !== current.length) await handleSaveConfig({ ...latest, quick_tags: next });
    });
    quickTagWriteRef.current = write;
    return write;
  };

  const handleSaveLibraryMetadata = async (changes: { id: string; fields: Partial<AudiobookMetadata> }[]) => {
    const response = await fetch('/api/library/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save library metadata.');
    const changed = new Map((data.books as LibraryBook[]).map(book => [book.id, book]));
    setLibraryBooks(current => current.map(book => changed.get(book.id) || book));
    if (currentJobId && changed.has(currentJobId)) await refreshCurrentJob(currentJobId);
    if (data.jsonFailures?.length) throw new Error(`Book details were saved, but metadata.json could not be updated: ${data.jsonFailures.join('; ')}`);
  };

  const handleWriteProjectAudioMetadata = async (metadata: AudiobookMetadata): Promise<string> => {
    if (!currentJob) return '';
    await handleSaveMetadata(metadata);
    const result = await handleWriteLibraryAudioMetadata([currentJob.id]);
    await refreshCurrentJob(currentJob.id);
    if (result.failures.length) throw new Error(result.failures.join('; '));
    return `Metadata written to ${result.written.length} audio file(s). Audio and chapters were preserved.`;
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

  const handleRelinkLibraryBook = async (id: string): Promise<string | null> => {
    let book = libraryBooks.find(book => book.id === id);
    if (!book) {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load the source information.');
      book = result.libraryBook;
    }
    const picked = await fetch((book?.sourceFileCount || 0) > 1 ? '/api/system/pick-audio-folder' : '/api/system/pick-audio-file', { method: 'POST' });
    const selection = await picked.json();
    if (!picked.ok) throw new Error(selection.error || 'Could not open the file browser.');
    if (!selection.path) return null;
    const relink = (confirmSameRecording = false) => fetch(`/api/jobs/${encodeURIComponent(id)}/source-file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: selection.path, relink: true, confirmSameRecording }) });
    let response = await relink();
    let result = await response.json();
    if (result.code === 'RELINK_CONFIRM_IDENTITY') {
      if (!window.confirm(result.error)) return null;
      response = await relink(true);
      result = await response.json();
    }
    if (result.code === 'RELINK_DIFFERENT_RECORDING') {
      if (window.confirm(`${result.error}\n\nOpen Import Book to add this recording separately?`)) await handleStartImport();
      return null;
    }
    if (!response.ok) throw new Error(result.error || 'Could not relink the source.');
    setLibraryBooks(current => current.map(book => book.id === id ? result.book : book));
    setJobs(previous => previous.map(job => job.id === id ? withSavedRating(result.job) : job));
    return selection.path;
  };

  const handleOpenLibraryFolder = async (id: string): Promise<void> => {
    const response = await fetch(`/api/library/${encodeURIComponent(id)}/open-folder`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not open the book folder.');
  };

  const handleRefreshLibrary = async () => {
    setLibraryScanning(true);
    try {
      const response = await fetch('/api/library/refresh', { method: 'POST', headers: { 'X-SwissMouse-Catalog':'1' } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not refresh the library.');
      setLibraryBooks(result.books); setLibraryScanWarning((result.warnings || []).join(' '));
      if (currentJobId) await refreshCurrentJob(currentJobId);
    } finally { setLibraryScanning(false); }
  };

  const handleFinishProcessing = async (location: 'current' | 'inbox' | 'library', target: string): Promise<string> => {
    if (!currentJob) return '';
    const response=await fetch(`/api/jobs/${currentJob.id}/finish`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location,target})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Could not finish this book.');
    setJobs(previous=>previous.map(job=>job.id===result.job.id?withSavedRating(result.job):job));
    return result.warning || `Finished${location==='library'?' in Library':location==='inbox'?' in Inbox':' in current location'}. Temporary PCM cleared; waveform and transcript retained.`;
  };

  const handleMoveInboxToLibrary = async (id: string, mode: LibraryTransferMode, allowUnchecked = false) => {
    const endpoint = allowUnchecked ? `/api/library/${encodeURIComponent(id)}/send-to-library` : `/api/jobs/${encodeURIComponent(id)}/move-to-library`;
    const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ mode }), headers: { 'Content-Type':'application/json', 'X-SwissMouse-Catalog':'1' } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not move the book to Library.');
    setJobs(previous => previous.map(job => job.id === id ? withSavedRating(result.job) : job));
    setLibraryBooks(result.books);
    setLibraryScanWarning(result.warning || '');
    return result.warning as string | undefined;
  };

  const handleUpdateLibraryJson = async (ids: string[]) => {
    const written: string[] = [];
    const failures: string[] = [];
    for (const id of ids) {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/metadata-json`, { method: 'POST' });
      const result = await response.json();
      written.push(...(result.written || []));
      if (!response.ok) failures.push(result.error || `Could not update metadata.json for ${id}.`);
    }
    return { written, failures };
  };

  const handleMoveLibraryFolders = async (ids: string[]) => {
    const plans: { id: string; moves: { jobId: string; from: string; to: string }[] }[] = [];
    const failures: string[] = [];
    for (const id of ids) {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/export-folder-move`);
      const result = await response.json();
      if (!response.ok) failures.push(result.error || `Could not plan folder move for ${id}.`);
      else if (result.moves.length && !plans.some(plan => JSON.stringify(plan.moves) === JSON.stringify(result.moves))) plans.push({ id, moves: result.moves });
    }
    if (!plans.length) return { moved: [], failures, cancelled: false };
    const details = plans.flatMap(plan => plan.moves.map(move => `${move.from}\n→ ${move.to}`)).join('\n\n');
    const folderCount = plans.reduce((count, plan) => count + plan.moves.length, 0);
    if (!window.confirm(`Move ${folderCount} exported book folder${folderCount === 1 ? '' : 's'} to match their saved metadata?\n\n${details}\n\nOnly associated files will move. Other files and nonempty folders stay in place.`)) return { moved: [], failures, cancelled: true };
    const moved: string[] = [];
    for (const plan of plans) {
      const response = await fetch(`/api/jobs/${encodeURIComponent(plan.id)}/export-folder-move`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmedMoves: plan.moves }),
      });
      const result = await response.json();
      if (response.ok) moved.push(...result.moved.map((move: { to: string }) => move.to));
      else failures.push(result.error || `Could not move folder for ${plan.id}.`);
    }
    return { moved, failures, cancelled: false };
  };

  // Bulk Delete Handler
  const handleDeleteMultiple = async (ids: string[]) => {
    const count = ids.length;
    if (count === 0) return;

    const confirmMsg = `Remove ${count} selected project${count > 1 ? 's' : ''} and their working files?\n\nSaved edits and working data will be removed. Audio in Inbox, Library, and external folders is kept and may be rediscovered on Refresh.`;
    
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
                setLibraryPlayerJob(currentJob);
      setLibraryPlayRequest(0);
      setCurrentJobId(null);
                setActiveStep(1);
            }
        } catch (err: any) {
            throw new Error(`Bulk Delete Error: ${err.message}`);
        }
    } else return false;
  };

  // Delete Job Handler
  const handleDeleteProject = async (jobId: string, jobName: string) => {
    
    const confirmMsg = `Remove the project "${jobName}" and its working files?\n\nSaved edits and files uploaded to the Workbench will be removed. Audio in Inbox, Library, and external folders is kept and may be rediscovered on Refresh.`;
    
    if (window.confirm(confirmMsg)) {
        try {
            const res = await fetch(`/api/jobs/${jobId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                setJobs(prev => prev.filter(j => j.id !== jobId));
                setLibraryBooks(prev => prev.filter(book => book.id !== jobId));
                if (currentJobId === jobId) {
                    setLibraryPlayerJob(currentJob);
      setLibraryPlayRequest(0);
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

  if (startupError || isLoading || !config) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
        <AsyncState kind={startupError ? 'error' : 'loading'} title={startupError ? 'Could not start SwissMouse' : 'Starting SwissMouse…'} message={startupError || undefined} onRetry={() => setStartupAttempt(value => value + 1)} />
      </div>
    );
  }

  const handleRecheckProjectAudio = async () => {
            try {
            if (!currentJob) throw new Error('Open a project first.');
            await flushMetadataBeforeNavigation(currentJob.id);
            const response = await fetch(`/api/jobs/${encodeURIComponent(currentJob.id)}/book-files/verify-audio`, { method: 'POST' });
            const result = await readApiJson(response, 'Recheck project audio');
            if (!response.ok) throw new Error(result.error || 'Could not recheck project audio.');
            if (!result.job || !Array.isArray(result.job.parts) || typeof result.checked !== 'number') throw new Error('Recheck project audio returned an unexpected response. Restart SwissMouse and try again.');
            setJobs(previous => previous.map(job => job.id === result.job.id ? withSavedRating(result.job) : job));
            if (result.issues?.length) throw new Error(`Full audio check found ${result.issues.length} decoding or timestamp issue${result.issues.length === 1 ? '' : 's'} across ${result.checked} files. Per-file details are recorded in the terminal log. Use PCM normalization.`);
            return `Full check passed for ${result.checked} audio file${result.checked === 1 ? '' : 's'}: decoding and timestamps verified. ${result.compatible ? 'Compatible for joining without conversion.' : result.reason}${result.changed ? ' Source changes detected; processing needs to be rerun.' : ''}`;
            } catch (error) {
              logClientFailure(`Project ${currentJob?.id || 'unknown'}: ${error instanceof Error ? error.message : String(error)}`);
              throw error;
            }
          };

  const workspaceHeader = (
      <Header
        ambientGlow={config?.player_ambient_glow !== false}
        currentJob={currentJob}
        libraryPlayerJob={libraryPlayerJob}
        playRequest={libraryPlayRequest}
        onRatingChange={handleRatingChange}
        onCloseProject={handleCloseProject}
        onOpenNewJob={() => void handleStartImport()}
        onOpenSettings={() => setShowConfigModal(true)}
        onResetPageLayout={() => resetPageLayout(!currentJob ? 'library' : currentJob.importPending || legacyImportMode || reviewFilesOpen ? 'files' : `step-${activeStep}`)}
        onOpenPurge={() => setShowPurgeModal(true)}
        onOpenRequirements={() => setShowRequirementsModal(true)}
        onToggleLogs={() => setShowLogsDrawer(!showLogsDrawer)}
        showLogs={showLogsDrawer}
        onToggleActivity={() => setShowActivity(value => !value)}
          busy={isProcessingStep1 || isBuildingM4b || isValidating}
          onShowLogs={() => setShowLogsDrawer(true)}
          onRecheckAudio={handleRecheckProjectAudio}
        showActivity={showActivity}
      />
  );

  return (
    <div className="app-shell min-h-screen flex flex-col font-sans">
      <ThemeBackground enabled={theme === 'cheese' || customThemes.some(item => item.id === theme && item.extends === 'cheese')} />
      {/* Top Header */}
      <div id="workspace-header-host" className="workspace-header-host" />

      <ActivityPanel exportJobId={exportJobId} onRefresh={handleRefreshLibrary} open={showActivity} onClose={() => setShowActivity(false)} job={currentJob} scanning={libraryScanning} scanWarning={libraryScanWarning} building={isBuildingM4b} validating={isValidating} exportMessage={exportProgressMessage} exportError={exportError} logs={technicalLogs} onLogs={() => setShowLogsDrawer(true)} onReview={step => { setReviewFilesOpen(false); setLegacyImportMode(false); setActiveStep(step); }} />
      {/* Main Workspace */}
      <main className={`flex-1 w-full mx-auto px-3 sm:px-5 lg:px-7 py-4 sm:py-6 space-y-5 ${currentJob ? 'max-w-[1480px]' : 'max-w-none'}`}>
        {importError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{importError}</p>}
        {navigationError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{navigationError}</p>}
        <WorkflowLayout header={workspaceHeader} key={currentJob?.id || 'library'} job={currentJob} files={!!currentJob && (currentJob.importPending || legacyImportMode || reviewFilesOpen)} activeStep={activeStep}
          onNavigate={page => {
          if (!currentJob) return;
          const generation = ++navigationGenerationRef.current;
          void flushMetadataBeforeNavigation(currentJob.id).then(() => {
            if (generation !== navigationGenerationRef.current) return;
            setNavigationError(null);
            setLegacyImportMode(false);
            setReviewFilesOpen(page === 'files');
            if (page !== 'files') setActiveStep(page);
          }).catch(error => setNavigationError(error instanceof Error ? error.message : 'Could not save the current draft.'));
        }}>
        {currentJob && (currentJob.importPending || legacyImportMode || reviewFilesOpen) ? (
          <BookFiles key={currentJob.id} job={currentJob} config={config} onUpdateJobSettings={handleUpdateJobSettings}
            onContinue={async () => {
              const metadata = metadataDraftRef.current?.jobId === currentJob.id ? metadataDraftRef.current.metadata : currentJob.metadataDraft || currentJob.metadata;
              if (currentJob.importPending) await handleFinishImport(metadata, true, false);
              else { await handleSaveMetadata(metadata); setLegacyImportMode(false); }
              setReviewFilesOpen(false); setActiveStep(1);
            }}
            onImported={async updated => { if (currentJob.importPending && !currentJob.parts.length) await handleSourceLoaded(updated); else await refreshCurrentJob(currentJob.id); }}
            onChanged={async updated => {
              setJobs(previous => previous.map(item => item.id === updated.id ? withSavedRating(updated) : item));
              const response = await fetch('/api/library?limit=50'); if (response.ok) setLibraryBooks(await response.json());
            }}>
            {currentJob.parts.length > 0 && <Step3Metadata key={currentJob.id} mode={currentJob.importPending ? 'import' : 'file-review'} job={currentJob} quickTags={config?.quick_tags || [...QUICK_ADD_CATEGORIES]} onAddQuickTag={handleAddQuickTag} onSaveMetadata={handleSaveMetadata} onWriteAudioMetadata={handleWriteProjectAudioMetadata} onUpdateJson={handleUpdateMetadataJson} onMoveExportFolder={handleMoveExportFolder} onPersistDraft={handlePersistMetadataDraft} draftMetadata={metadataDraftRef.current?.jobId === currentJob.id ? metadataDraftRef.current.metadata : undefined} onDraftChange={(jobId, metadata) => { metadataDraftRef.current = { jobId, metadata }; setJobs(previous => JSON.stringify(previous.find(job => job.id === jobId)?.metadataDraft) === JSON.stringify(metadata) ? previous : previous.map(job => job.id === jobId ? { ...job, metadataDraft: metadata } : job)); }} onNextStep={() => {}} onImportAction={handleFinishImport} onCancelImport={handleCancelImport} onFinishFileReview={handleFinishFileReview} onOrganizeLibrary={handleOrganizeLibrary} />}
          </BookFiles>
        ) : currentJob ? (
          <>
            <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
              {activeStep === 2 && <div ref={setChapterReviewActionHost} className="justify-self-end md:col-start-3 md:row-start-1" />}
              {activeStep === 3 && <div ref={setMetadataReviewActionHost} className="justify-self-end md:col-start-3 md:row-start-1" />}
              {activeStep === 4 && <div ref={setConvertActionHost} className="justify-self-end md:col-start-3 md:row-start-1" />}
              <h1 className="page-title-label justify-self-center inline-block text-xl font-bold md:col-start-2">{workflowPages[activeStep - 1].label}</h1>
              {activeStep === 1 && <div className="flex items-center justify-self-end gap-3">
                <svg role="img" aria-label={processReadiness?.jobId === currentJob.id && processReadiness.valid ? 'Processing settings are valid' : 'Processing settings need attention'} viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`process-readiness shrink-0 ${processReadiness?.jobId === currentJob.id && processReadiness.valid ? 'text-emerald-700' : 'text-red-700'}`} style={{ filter: 'drop-shadow(0 3px 2px rgb(48 38 20 / 0.28))' }}>
                  <circle cx="16" cy="16" r="13" />
                  {processReadiness?.jobId === currentJob.id && processReadiness.valid ? <path d="m10 16 4 4 8-9" /> : <path d="m11 11 10 10m0-10L11 21" />}
                </svg>
                <button type="button" disabled={isProcessingStep1 || !canReviewChapters(currentJob)} onClick={() => setActiveStep(2)} title={canReviewChapters(currentJob) ? 'Review chapter starts and names' : 'Run the selected workflow below to prepare chapter review'} className="paper-action-dark inline-flex items-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-40">Continue to Review Chapters<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              </div>}
            </div>
            <ProjectOverview key={currentJob.id} job={currentJob} />

            {/* Active Step Content */}
            {activeStep === 1 && (
              <Step1MergeDetect
                key={currentJob.id}
                onReadinessChange={setProcessReadiness}
                job={currentJob}
                config={config}
                onRunStep1={handleRunStep1}
                onRerunStep={handleRerunStep}
                isRunning={isProcessingStep1}
                onUpdateJobSettings={handleUpdateJobSettings}
                onConfigChange={setConfig}
              />
            )}

            {activeStep === 2 && (
              <Step2ChapterReview
                key={currentJob.id}
                actionHost={chapterReviewActionHost}
                job={currentJob}
                onSaveChapters={handleSaveChapters}
                draftChapters={chapterDraftRef.current?.jobId === currentJob.id ? chapterDraftRef.current.chapters : undefined}
                onDraftChange={(jobId, chapters, hasEdits) => { chapterDraftRef.current = { jobId, chapters, hasEdits }; }}
                onNextStep={() => setActiveStep(3)}
              />
            )}

            {activeStep === 3 && (
              <Step3Metadata
                actionHost={metadataReviewActionHost}
                job={currentJob}
                quickTags={config?.quick_tags || [...QUICK_ADD_CATEGORIES]} onAddQuickTag={handleAddQuickTag} onSaveMetadata={handleSaveMetadata}
                onWriteAudioMetadata={handleWriteProjectAudioMetadata} onUpdateJson={handleUpdateMetadataJson}
                onMoveExportFolder={handleMoveExportFolder}
                onPersistDraft={handlePersistMetadataDraft}
                draftMetadata={metadataDraftRef.current?.jobId === currentJob.id ? metadataDraftRef.current.metadata : undefined}
                onDraftChange={(jobId, metadata) => { metadataDraftRef.current = { jobId, metadata }; setJobs(previous => JSON.stringify(previous.find(job => job.id === jobId)?.metadataDraft) === JSON.stringify(metadata) ? previous : previous.map(job => job.id === jobId ? { ...job, metadataDraft: metadata } : job)); }}
                onRerunMetadata={() => handleRerunStep('metadata_processing')}
                isRerunning={isProcessingStep1}
                onNextStep={() => setActiveStep(4)}
              />
            )}

            {activeStep === 4 && (
              <Step4Export
                actionHost={convertActionHost}
                job={currentJob}
                config={config}
                onBuildM4b={handleBuildM4b}
                pendingChapterChanges={chapterDraftRef.current?.jobId === currentJob.id && (chapterDraftRef.current.hasEdits ?? chapterReviewChanged(chapterDraftRef.current.chapters, currentJob.chapters))}
                isBuilding={isBuildingM4b}
                progressMessage={exportProgressMessage}
                error={exportError}
                onNextStep={runCheck => { setActiveStep(5); if (runCheck) void handleValidate().catch(() => {}); }}
              />
            )}

            {activeStep === 5 && (
              <Step5Validate
                job={currentJob}
                onNavigate={step => setActiveStep(step as 1 | 2 | 3 | 4 | 5)}
                onValidate={handleValidate}
                isValidating={isValidating}
                onFinish={handleFinishProcessing}
              />
            )}
          </>
        ) : (
          <LibraryManager
            catalog
            books={libraryBooks}
            onPlay={async id => {
              const generation = ++libraryPlayGeneration.current;
              try {
                const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
                if (!response.ok) throw new Error("Could not load this book for playback.");
                const book = await response.json() as AudiobookJob;
                if (generation !== libraryPlayGeneration.current) return;
                await stopQuickPlayback();
                if (generation !== libraryPlayGeneration.current) return;
                setLibraryPlayerJob(book); setLibraryPlayRequest(value => value + 1); setNavigationError(null);
              } catch (error) { if (generation === libraryPlayGeneration.current) setNavigationError(error instanceof Error ? error.message : "Could not play this book."); }
            }}
            scanning={libraryScanning}
            scanWarning={libraryScanWarning}
            onOpen={async id => { await handleOpenProject(id, true); }}
            onSave={handleSaveLibraryMetadata}
            onWriteAudioMetadata={handleWriteLibraryAudioMetadata}
            onUpdateJson={handleUpdateLibraryJson}
            onMoveFolders={handleMoveLibraryFolders}
            onRelink={handleRelinkLibraryBook}
            onMoveToLibrary={(id, mode) => handleMoveInboxToLibrary(id, mode, true)}
            onOpenFolder={handleOpenLibraryFolder}
            onRefresh={() => handleRefreshLibrary()}
            onDelete={handleDeleteProject}
            onDeleteMany={handleDeleteMultiple}
          />
        )}
        </WorkflowLayout>
      </main>

      {/* Technical log follows the workspace so it never covers its controls. */}
      <LogsDrawer
        logs={technicalLogs}
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
          onRebuilt={async () => {
            const [response, status] = await Promise.all([fetch('/api/library?limit=50'), fetch('/api/library/scan-status')]);
            if (!response.ok) throw new Error('Could not reload Library Manager. Use Refresh to retry.');
            setLibraryBooks(await response.json());
            if (status.ok) setLibraryScanWarning(((await status.json()).warnings || []).join(' '));
            if (currentJobId) await refreshCurrentJob(currentJobId);
          }}
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
