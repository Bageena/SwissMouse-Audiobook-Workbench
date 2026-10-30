import { useState, useEffect, useRef } from 'react';
import type { AudiobookJob, LibraryBook, WorkbenchConfig, ChapterEntry, AudiobookMetadata, ChapterSourceType, AudioMergeMethodType, OutputAudioFormat, RerunnablePipelineStep } from '../../types';
import type { LibraryTransferMode } from '../../components/MoveToLibrary';
import type { CleanupType } from '../../components/CleanupModal';
import { readApiJson } from '../../utils/apiResponse';
import { readStored, writeStored } from '../../utils/libraryWorkspace';
import { QUICK_ADD_CATEGORIES, cleanQuickTags } from '../../utils/metadataQuickAdd';
import { chapterReviewChanged } from '../../utils/chapterReviewDraft';
import { stopQuickPlayback } from '../../playback/QuickPlaybackController';
import { rememberedAudiobookStep } from '../../../packages/audiobooks/src/session-view';
import { createAudiobookEditController } from '../../../packages/audiobooks/src/edit-controller';
import { createLegacyAudiobookWorkspaceClient } from '../../../packages/audiobooks/src/legacy-workspace-client';
import { audiobookClient } from '../../../packages/audiobooks/src/client-service';

const workspaceApi = createLegacyAudiobookWorkspaceClient((input, init) => fetch(input, init), readApiJson);

/** Temporary built-in composition adapter for the existing screens and domain types.
 * Session/transport are being moved to the independent Audiobooks package.
 * This hook is not part of the public host SDK or the installed read-only proof.
 */
export function useAudiobookWorkspace({ setConfig, loadConfig, cleanupShared, pickAudio, handleSaveConfig, onShowLogs, onClientFailure }: {
  setConfig: (config: WorkbenchConfig) => void;
  loadConfig: (signal?: AbortSignal, context?: 'startup' | 'quick-tags') => Promise<WorkbenchConfig>;
  cleanupShared: (type: string, confirmation?: string) => Promise<{ jobs?: AudiobookJob[]; message: string }>;
  pickAudio: (folder: boolean) => Promise<{ path?: string }>;
  handleSaveConfig: (config: WorkbenchConfig) => Promise<WorkbenchConfig>;
  onShowLogs: () => void;
  onClientFailure: (message: string) => void;
}) {
  const [jobs, setJobs] = useState<AudiobookJob[]>([]);
  const [libraryBooks, setLibraryBooks] = useState<LibraryBook[]>([]);
  const [libraryScanning, setLibraryScanning] = useState(false);
  const [libraryScanWarning, setLibraryScanWarning] = useState('');
  const [currentJobId, setCurrentJobId] = useState<string | null>(localStorage.getItem('workbench_active_job_id'));
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [chapterReviewActionHost, setChapterReviewActionHost] = useState<HTMLDivElement | null>(null);
  const [metadataReviewActionHost, setMetadataReviewActionHost] = useState<HTMLDivElement | null>(null);
  const [convertActionHost, setConvertActionHost] = useState<HTMLDivElement | null>(null);
  const [processReadiness, setProcessReadiness] = useState<{ jobId: string; valid: boolean } | null>(null);
  const [reviewFilesOpen, setReviewFilesOpen] = useState(false);
  const [legacyImportMode, setLegacyImportMode] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const quickTagWriteRef = useRef<Promise<void>>(Promise.resolve());
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const [edit] = useState(() => createAudiobookEditController<AudiobookMetadata, ChapterEntry>({
    revision: id => jobsRef.current.find(job => job.id === id)?.metadataRevision || 0,
    writeDraft: audiobookClient.saveMetadataDraft,
    writeRating: audiobookClient.saveRating,
    ratingSaved: (id, rating) => {
      setJobs(previous => previous.map(job => job.id === id ? { ...job, personalRating: rating } : job));
      setLibraryBooks(previous => previous.map(book => book.id === id ? { ...book, personalRating: rating } : book));
    },
  }));
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [startupError, setStartupError] = useState('');
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [isProcessingStep1, setIsProcessingStep1] = useState<boolean>(false);
  const [isBuildingM4b, setIsBuildingM4b] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const playbackRead = useRef<AbortController | null>(null);
  useEffect(() => () => { edit.cancelReads(); playbackRead.current?.abort(); }, [edit]);
  const exportPolling = useRef<(() => void) | null>(null);
  useEffect(() => () => { exportPolling.current?.(); }, []);
  const [libraryPlayerJob, setLibraryPlayerJob] = useState<AudiobookJob | null>(null);
  const [libraryPlayRequest, setLibraryPlayRequest] = useState(0);
  const libraryPlayGeneration = useRef(0);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportProgressMessage, setExportProgressMessage] = useState('');
  const [isValidating, setIsValidating] = useState<boolean>(false);

  const rememberedStep = (job: AudiobookJob) => rememberedAudiobookStep(job, key => readStored<unknown>(key, 0, true));
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
    const controller = new AbortController();
    async function loadInitialData() {
      setIsLoading(true); setStartupError('');
      try {
        const [jobsRes, cfgData] = await Promise.all([
          workspaceApi.libraryPage(controller.signal, 'Load library'),
          loadConfig(controller.signal),
        ]);
        const jobsData = jobsRes.data;
        if (!jobsRes.response.ok || !Array.isArray(jobsData)) throw new Error(jobsData.error || 'Could not load the library. Check that SwissMouse is running and try again.');
        if (cancelled) return;
        setLibraryBooks(jobsData);
        setConfig(cfgData);
        const scan = await workspaceApi.scanStatus(controller.signal);
        if (cancelled) return;
        setLibraryScanning(scan.scanning);
        setLibraryScanWarning((scan.warnings || []).join(' '));

        // Validate saved jobId exists
        if (currentJobId) {
          const job = await audiobookClient.loadBook<AudiobookJob>(currentJobId, { signal: controller.signal, allowUnavailable: true });
          if (cancelled) return;
          if (job) { setJobs([job]); setReviewFilesOpen(!!job.importPending || readStored<string>(`swissmouse-book-view-${job.id}`, '', true) === 'files'); setActiveStep(rememberedStep(job)); setLegacyImportMode(job.status === 'draft' && !job.sourceFolderPath); }
          else { setLibraryPlayerJob(currentJob); setLibraryPlayRequest(0); setCurrentJobId(null); localStorage.removeItem('workbench_active_job_id'); }
        }
      } catch (err) {
        console.error('Failed to load initial data:', err);
        if (!cancelled) setStartupError(err instanceof Error ? err.message : 'Could not start SwissMouse. Check that the server is running.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadInitialData();
    return () => { cancelled = true; controller.abort(); };
  }, [startupAttempt]);

  useEffect(() => {
    if (!libraryScanning) return;
    const controller = new AbortController();
    let stopped = false, polling = false;
    const timer = window.setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const scan = await workspaceApi.scanStatus(controller.signal);
        if (stopped) return;
        if (!scan.scanning) {
          const books = await workspaceApi.libraryPage(controller.signal);
          if (stopped) return;
          setLibraryScanning(false); setLibraryScanWarning((scan.warnings || []).join(' '));
          if (books.response.ok) setLibraryBooks(books.data);
        }
      } catch { if (!stopped) { setLibraryScanning(false); setLibraryScanWarning('Could not read scan status. Refresh to retry.'); } }
      finally { polling = false; }
    }, 1000);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); };
  }, [libraryScanning]);

  // Persist active job ID
  useEffect(() => {
    if (currentJobId) {
      localStorage.setItem('workbench_active_job_id', currentJobId);
    } else {
      localStorage.removeItem('workbench_active_job_id');
    }
  }, [currentJobId]);

  const currentJob = jobs.find((j) => j.id === currentJobId) || null;
  const currentJobRef = useRef(currentJob);
  currentJobRef.current = currentJob;

  const withSavedRating = <T extends { id: string; personalRating?: number | null; metadataDraft?: AudiobookMetadata }>(job: T): T => edit.withCurrentDraft(edit.withSavedRating(job));
  const handleRatingChange = edit.saveRating;
  const flushMetadataBeforeNavigation = edit.flushDraft;
  const prepareToLeaveBook = () => {
    const leavingJob = currentJobRef.current;
    return edit.prepareToLeave({
      id: leavingJob?.id,
      chaptersChanged: draft => draft.hasEdits ?? chapterReviewChanged(draft.chapters, leavingJob!.chapters),
      confirmChapters: () => window.confirm('Save your chapter edits before switching books?\n\nCancel keeps this book open with your edits.'),
      saveChapters: handleSaveChapters,
      stopPlayback: stopQuickPlayback,
    });
  };

  // Handler for closing the project
  const handleCloseProject = async () => {
    if (currentJob?.importPending) { await handleCancelImport(); return; }
    const generation = edit.beginNavigation();
    setNavigationError(null);
    try {
      if (!await prepareToLeaveBook() || !edit.isCurrentNavigation(generation)) return;
      setLibraryPlayerJob(currentJob);
      setLibraryPlayRequest(0);
      setCurrentJobId(null);
      setLegacyImportMode(false);
      setReviewFilesOpen(false);
      setActiveStep(1);
    } catch (error) {
      if (edit.isCurrentNavigation(generation)) setNavigationError(error instanceof Error ? error.message : 'Could not save this book before switching.');
    }
  };

  // Handler for opening a project
  const handleOpenProject = async (id: string, bookFiles = false) => {
    ++libraryPlayGeneration.current;
    playbackRead.current?.abort();
    const generation = edit.beginNavigation();
    setNavigationError(null);
    try {
      const loaded = (await audiobookClient.loadBook<AudiobookJob>(id, { signal: edit.navigationSignal() }))!;
      if (!edit.isCurrentNavigation(generation) || !await prepareToLeaveBook() || !edit.isCurrentNavigation(generation)) return;
      const previousView = readStored<string>(`swissmouse-book-view-${loaded.id}`, '', true);
      setReviewFilesOpen(!!loaded.importPending || previousView === 'files' || (previousView !== 'workflow' && bookFiles));
      setJobs([withSavedRating(loaded)]);
      setCurrentJobId(id);
      setActiveStep(rememberedStep(loaded));
      setLegacyImportMode(loaded.status === 'draft' && !loaded.sourceFolderPath);
    } catch (error) {
      if (edit.isCurrentNavigation(generation)) setNavigationError(error instanceof Error ? error.message : 'Could not open this book.');
    }
  };

  // Refresh current job from server
  const refreshCurrentJob = async (jobId: string) => {
    try {
      const updated = await audiobookClient.loadBook<AudiobookJob>(jobId, { allowUnavailable: true });
      if (updated) {
        setJobs((prev) => prev.map((j) => (j.id === jobId ? withSavedRating(updated) : j)));
        setLibraryBooks(prev => prev.map(book => book.id === jobId ? withSavedRating(updated.libraryBook || book) : book));
      }
    } catch (err) {
      console.error('Failed to refresh job:', err);
    }
  };

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
      const data = await workspaceApi.startProcessing(currentJob.id, options || {});

      if (data.status === 'started') {
         // Wait for the background process to finish by polling
         while (true) {
            await new Promise(r => setTimeout(r, 1000));
            const { response, data: prog } = await workspaceApi.pipelineProgress();
            if (response.ok) {
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
      onShowLogs();
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
        await workspaceApi.saveSettings(currentJob.id, settings, 'Could not save transcription settings');
      }
      const start = (confirmed: boolean) => workspaceApi.rerun(currentJob.id, step, confirmed);
      let { response, data } = await start(false);
      if (response.status === 409 && data.requiresConfirmation) {
        const accepted = window.confirm(data.error);
        if (!accepted) return;
        ({ response, data } = await start(true));
      }
      if (!response.ok) throw new Error(data.error || 'Step failed');
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 600));
        const { response, data: progress } = await workspaceApi.pipelineProgress();
        if (!response.ok) continue;
        if (!progress.isActive) {
          if (progress.error) throw new Error(progress.error);
          break;
        }
      }
      // Detection/extraction replaced the saved chapter list. Do not reopen
      // the editor with the draft retained from before this successful run.
      if ((step === 'detecting_chapters' || step === 'extracting_chapters') && edit.chapterDraft?.jobId === currentJob.id) {
        edit.chapterDraft = null;
      }
    } catch (error) {
      console.error('Step failed:', error);
      onShowLogs();
    } finally {
      await refreshCurrentJob(currentJob.id);
      setIsProcessingStep1(false);
    }
  };

  const handleUpdateJobSettings = async (settings: Partial<AudiobookJob>) => {
    if (!currentJob) return;
    try {
      await workspaceApi.saveSettings(currentJob.id, settings);
      await refreshCurrentJob(currentJob.id);
    } catch (err) {
      console.error('Failed to update job settings:', err);
      throw err;
    }
  };

  const handleSourceLoaded = async (updated?: AudiobookJob) => {
    if (!currentJob) return;
    if (updated && !updated.parts.length) {
      edit.metadataDraft = null;
      await refreshCurrentJob(currentJob.id);
      return;
    }
    const data = await workspaceApi.inspectImport(currentJob.id);
    if (currentJobRef.current?.id !== currentJob.id) return;
    edit.metadataDraft = null;
    setJobs(previous => previous.map(job => job.id === currentJob.id ? withSavedRating(data) : job));
    setImportError(null);
  };

  const handleStartImport = async () => {
    const generation = edit.beginNavigation();
    setImportError(null);
    setNavigationError(null);
    try {
      if (!await prepareToLeaveBook() || !edit.isCurrentNavigation(generation)) return;
      const job = await workspaceApi.startImport();
      if (!edit.isCurrentNavigation(generation)) return;
      setJobs([job]);
      setCurrentJobId(job.id);
      setLegacyImportMode(false);
      setActiveStep(1);
    } catch (error: any) { setImportError(error.message || 'Could not start import.'); }
  };

  const handleCancelImport = async () => {
    if (!currentJob) return;
    if (!currentJob.importPending) { await handleCloseProject(); return; }
    const generation = edit.beginNavigation();
    try {
      await stopQuickPlayback();
      await edit.settleDraft();
      if (!edit.isCurrentNavigation(generation)) return;
      await workspaceApi.removeProject(currentJob.id, 'Could not cancel import.');
      if (!edit.isCurrentNavigation(generation)) return;
      edit.metadataDraft = null;
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
      const { response, data: readinessData } = await workspaceApi.bookReadiness(currentJob.id);
      if (!response.ok || readinessData.readiness?.status !== 'Ready') throw new Error(readinessData.error || readinessData.readiness?.issues?.[0] || 'Add valid audio to Processing Order before continuing.');
    }
    const generation = edit.beginNavigation();
    await stopQuickPlayback();
    await edit.settleDraft();
    const data = await workspaceApi.finishImport(currentJob.id, metadata, process, writeSource, currentJob.metadataRevision || 0);
    if (!edit.isCurrentNavigation(generation)) return;
    edit.metadataDraft = null;
    setJobs([withSavedRating(data.job)]);
    setLegacyImportMode(false);
    const libraryResponse = await workspaceApi.libraryPage();
    if (libraryResponse.response.ok) setLibraryBooks(libraryResponse.data);
    if (!edit.isCurrentNavigation(generation)) return;
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
    const preview = await workspaceApi.organizePlan(currentJob.id);
    if (preview.alreadyOrganized) return 'This book already uses the configured Library folder pattern.';
    const action = preview.finishedOnly
      ? 'SwissMouse will organize the surviving M4B. The original source will still be marked missing.'
      : 'SwissMouse will move this book and its associated sidecars into the Library, create its folders, and verify the transferred files. Shared or ambiguous files will stay in place.';
    if (!window.confirm(`Organize this book in the Library?\n\n${preview.source}\n→ ${preview.target}\n\n${action} No audio processing will run.`)) return 'Library organization cancelled.';
    const result = await workspaceApi.organize(currentJob.id, preview.source, preview.target);
    setJobs(previous => previous.map(job => job.id === result.job.id ? withSavedRating(result.job) : job));
    await refreshCurrentJob(result.job.id);
    const libraryResponse = await workspaceApi.libraryPage();
    if (libraryResponse.response.ok) setLibraryBooks(libraryResponse.data);
    return `Book moved to ${result.target}.${result.warning ? ` ${result.warning}` : ''}`;
  };

  // Step 2 Handler
  const handleSaveChapters = async (chapters: ChapterEntry[]) => {
    if (!currentJob) return;
    await audiobookClient.saveChapters(currentJob.id, chapters);
    await refreshCurrentJob(currentJob.id);
    if (edit.chapterDraft?.jobId === currentJob.id && edit.chapterDraft.chapters === chapters) edit.chapterDraft = null;
  };

  // Step 3 Handler: Audiobook Metadata & Cover Art
  const handlePersistMetadataDraft = edit.saveDraft;

  const handleSaveMetadata = async (metadata: AudiobookMetadata, selection?: import('../../../packages/sdk/suggestions').PickerSelection) => {
    if (!currentJob) return;
    await edit.settleDraft();
    const data = await audiobookClient.saveMetadata<AudiobookJob, LibraryBook>(currentJob.id, metadata, currentJob.metadataRevision || 0,selection);
    edit.metadataSaved(currentJob.id, metadata);
    setJobs(previous => previous.map(job => job.id === currentJob.id ? withSavedRating(data.job) : job));
    if (data.libraryBook) setLibraryBooks(previous => previous.map(book => book.id === currentJob.id ? withSavedRating(data.libraryBook!) : book));
    return {historyPending:!!data.historyPending};
  };

  const handleUpdateMetadataJson = async (metadata: AudiobookMetadata): Promise<string[]> => {
    if (!currentJob) return [];
    await edit.settleDraft();
    const written = await audiobookClient.updateMetadataJson(currentJob.id, metadata, currentJob.metadataRevision || 0);
    await refreshCurrentJob(currentJob.id);
    edit.metadataSaved(currentJob.id, metadata);
    return written;
  };

  const handleMoveExportFolder = async (metadata: AudiobookMetadata): Promise<string> => {
    if (!currentJob) return '';
    await handleSaveMetadata(metadata);
    const { response: planStatus, data: preview } = await workspaceApi.folderMovePlan(currentJob.id);
    if (!planStatus.ok) throw new Error(preview.error || 'Could not plan the folder move.');
    if (!preview.moves.length) return 'Exported folder already matches the current book details.';
    const description = preview.moves.map((move: { from: string; to: string }) => `${move.from}\n→ ${move.to}`).join('\n\n');
    if (!window.confirm(`Move the exported audiobook folder${preview.moves.length === 1 ? '' : 's'} to match the saved metadata?\n\n${description}\n\nOnly associated files will move. Other files and nonempty folders stay in place.`)) return 'Folder move cancelled.';
    const { response, data: result } = await workspaceApi.moveExportFolder(currentJob.id, preview.moves);
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
        const { response, data: progress } = await workspaceApi.exportProgress(currentJob.id, controller.signal);
        if (response.ok) {
          if (!controller.signal.aborted) setExportProgressMessage(progress.message || '');
          if (!controller.signal.aborted) setJobs(previous => previous.map(job => job.id === currentJob.id ? { ...job, exports: progress.exports } : job));
        }
      } catch { /* The build request reports failures; polling never queues more requests. */ }
      finally { polling = false; }
    }, 1000);
    const stopPolling = () => { window.clearInterval(poll); controller.abort(); if (exportPolling.current === stopPolling) exportPolling.current = null; };
    exportPolling.current = stopPolling;
    try {
      const draft = edit.chapterDraft;
      if (draft?.jobId === currentJob.id && (draft.hasEdits ?? chapterReviewChanged(draft.chapters, currentJob.chapters))) {
        await handleSaveChapters(draft.chapters);
      }
      const build = (confirmedOverwritePaths?: string[]) => workspaceApi.build(currentJob.id, { outputFormats, convert, cue, bitrates, zipOriginals, overwriteExisting: !!confirmedOverwritePaths, confirmedOverwritePaths });
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
      onShowLogs();
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
      await workspaceApi.validate(currentJob.id);
      await refreshCurrentJob(currentJob.id);
    } catch (err: any) {
      await refreshCurrentJob(currentJob.id);
      onShowLogs();
      throw err;
    } finally {
      setIsValidating(false);
    }
  };

  // Storage Cleanup Handler
  const handleCleanup = async (cleanupType: CleanupType, confirmation?: string) => {
    const isProjectCleanup = cleanupType.startsWith('project-');
    if (isProjectCleanup && !currentJob) throw new Error('Open a book before choosing a book-specific cleanup option.');
    const data = isProjectCleanup ? await workspaceApi.purgeProject(currentJob!.id, cleanupType.replace('project-', ''), confirmation) : await cleanupShared(cleanupType, confirmation);
    if (Array.isArray(data.jobs)) setJobs(data.jobs);
    else if (currentJob) await refreshCurrentJob(currentJob.id);
    alert(data.message);
  };

  const handleAddQuickTag = (tag: string) => {
    const write = quickTagWriteRef.current.catch(() => {}).then(async () => {
      const latest = await loadConfig(undefined, 'quick-tags');
      const current = latest.quick_tags || [...QUICK_ADD_CATEGORIES];
      const next = cleanQuickTags([...current, tag]);
      if (next.length !== current.length) await handleSaveConfig({ ...latest, quick_tags: next });
    });
    quickTagWriteRef.current = write;
    return write;
  };

  const handleSaveLibraryMetadata = async (changes: { id: string; fields: Partial<AudiobookMetadata> }[]) => {
    const data = await workspaceApi.saveLibraryMetadata(changes);
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
      const { response, data: result } = await workspaceApi.writeAudioMetadata(id);
      written.push(...(result.written || []));
      failures.push(...(result.failures || (response.ok ? [] : [result.error || 'Could not write audio metadata.'])));
    }
    return { written, failures };
  };

  const handleRelinkLibraryBook = async (id: string): Promise<string | null> => {
    let book = libraryBooks.find(book => book.id === id);
    if (!book) {
      const result = await workspaceApi.sourceInformation(id);
      book = result.libraryBook;
    }
    const selection = await pickAudio((book?.sourceFileCount || 0) > 1);
    if (!selection.path) return null;
    const relink = (confirmed = false) => workspaceApi.relinkSource(id, selection.path, confirmed);
    let { response, data: result } = await relink();
    if (result.code === 'RELINK_CONFIRM_IDENTITY') {
      if (!window.confirm(result.error)) return null;
      ({ response, data: result } = await relink(true));
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
    await workspaceApi.openFolder(id);
  };

  const handleRefreshLibrary = async () => {
    setLibraryScanning(true);
    try {
      const result = await workspaceApi.refreshLibrary();
      setLibraryBooks(result.books); setLibraryScanWarning((result.warnings || []).join(' '));
      if (currentJobId) await refreshCurrentJob(currentJobId);
    } finally { setLibraryScanning(false); }
  };

  const handleFinishProcessing = async (location: 'current' | 'inbox' | 'library', target: string): Promise<string> => {
    if (!currentJob) return '';
    const result = await workspaceApi.finish(currentJob.id, location, target);
    setJobs(previous=>previous.map(job=>job.id===result.job.id?withSavedRating(result.job):job));
    return result.warning || `Finished${location==='library'?' in Library':location==='inbox'?' in Inbox':' in current location'}. Temporary PCM cleared; waveform and transcript retained.`;
  };

  const handleMoveInboxToLibrary = async (id: string, mode: LibraryTransferMode, allowUnchecked = false) => {
    const result = await workspaceApi.moveToLibrary(id, mode, allowUnchecked);
    setJobs(previous => previous.map(job => job.id === id ? withSavedRating(result.job) : job));
    setLibraryBooks(result.books);
    setLibraryScanWarning(result.warning || '');
    return result.warning as string | undefined;
  };

  const handleUpdateLibraryJson = async (ids: string[]) => {
    const written: string[] = [];
    const failures: string[] = [];
    for (const id of ids) {
      const { response, data: result } = await workspaceApi.writeSavedMetadataJson(id);
      written.push(...(result.written || []));
      if (!response.ok) failures.push(result.error || `Could not update metadata.json for ${id}.`);
    }
    return { written, failures };
  };

  const handleMoveLibraryFolders = async (ids: string[]) => {
    const plans: { id: string; moves: { jobId: string; from: string; to: string }[] }[] = [];
    const failures: string[] = [];
    for (const id of ids) {
      const { response, data: result } = await workspaceApi.folderMovePlan(id);
      if (!response.ok) failures.push(result.error || `Could not plan folder move for ${id}.`);
      else if (result.moves.length && !plans.some(plan => JSON.stringify(plan.moves) === JSON.stringify(result.moves))) plans.push({ id, moves: result.moves });
    }
    if (!plans.length) return { moved: [], failures, cancelled: false };
    const details = plans.flatMap(plan => plan.moves.map(move => `${move.from}\n→ ${move.to}`)).join('\n\n');
    const folderCount = plans.reduce((count, plan) => count + plan.moves.length, 0);
    if (!window.confirm(`Move ${folderCount} exported book folder${folderCount === 1 ? '' : 's'} to match their saved metadata?\n\n${details}\n\nOnly associated files will move. Other files and nonempty folders stay in place.`)) return { moved: [], failures, cancelled: true };
    const moved: string[] = [];
    for (const plan of plans) {
      const { response, data: result } = await workspaceApi.moveExportFolder(plan.id, plan.moves);
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
              await workspaceApi.removeProject(id, `Could not delete ${id}.`);
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
            await workspaceApi.removeProject(jobId);
                setJobs(prev => prev.filter(j => j.id !== jobId));
                setLibraryBooks(prev => prev.filter(book => book.id !== jobId));
                if (currentJobId === jobId) {
                    setLibraryPlayerJob(currentJob);
      setLibraryPlayRequest(0);
      setCurrentJobId(null);
                    setActiveStep(1);
                }
        } catch (err: any) {
            alert(`Delete Error: ${err.message}`);
        }
    }
  };

  const handleRecheckProjectAudio = async () => {
            try {
            if (!currentJob) throw new Error('Open a project first.');
            await flushMetadataBeforeNavigation(currentJob.id);
            const result = await workspaceApi.verifyAudio(currentJob.id);
            if (!result.job || !Array.isArray(result.job.parts) || typeof result.checked !== 'number') throw new Error('Recheck project audio returned an unexpected response. Restart SwissMouse and try again.');
            setJobs(previous => previous.map(job => job.id === result.job.id ? withSavedRating(result.job) : job));
            if (result.issues?.length) throw new Error(`Full audio check found ${result.issues.length} decoding or timestamp issue${result.issues.length === 1 ? '' : 's'} across ${result.checked} files. Per-file details are recorded in the terminal log. Use PCM normalization.`);
            return `Full check passed for ${result.checked} audio file${result.checked === 1 ? '' : 's'}: decoding and timestamps verified. ${result.compatible ? 'Compatible for joining without conversion.' : result.reason}${result.changed ? ' Source changes detected; processing needs to be rerun.' : ''}`;
            } catch (error) {
              onClientFailure(`Project ${currentJob?.id || 'unknown'}: ${error instanceof Error ? error.message : String(error)}`);
              throw error;
            }
          };

  const handleLibraryRebuilt = async () => {
    const [page, status] = await Promise.all([workspaceApi.libraryPage(), workspaceApi.scanStatus()]);
    if (!page.response.ok) throw new Error('Could not reload Library Manager. Use Refresh to retry.');
    setLibraryBooks(page.data);
    setLibraryScanWarning((status.warnings || []).join(' '));
    if (currentJobId) await refreshCurrentJob(currentJobId);
  };
  const handleBookFilesChanged = async (updated: AudiobookJob) => {
    setJobs(previous => previous.map(item => item.id === updated.id ? withSavedRating(updated) : item));
    const page = await workspaceApi.libraryPage();
    if (page.response.ok) setLibraryBooks(page.data);
  };
  const handleContinueFromFiles = async () => {
    if (!currentJob) return;
    const metadata = edit.metadataDraft?.jobId === currentJob.id ? edit.metadataDraft.metadata : currentJob.metadataDraft || currentJob.metadata;
    if (currentJob.importPending) await handleFinishImport(metadata, true, false);
    else { await handleSaveMetadata(metadata); setLegacyImportMode(false); }
    setReviewFilesOpen(false); setActiveStep(1);
  };
  const handleNavigate = (page: 'files' | 1 | 2 | 3 | 4 | 5) => {
    if (!currentJob) return;
    const generation = edit.beginNavigation();
    void flushMetadataBeforeNavigation(currentJob.id).then(() => {
      if (!edit.isCurrentNavigation(generation)) return;
      setNavigationError(null); setLegacyImportMode(false); setReviewFilesOpen(page === 'files');
      if (page !== 'files') setActiveStep(page);
    }).catch(error => { if (edit.isCurrentNavigation(generation)) setNavigationError(error instanceof Error ? error.message : 'Could not save the current draft.'); });
  };
  const handlePlayLibraryBook = async (id: string) => {
    const generation = ++libraryPlayGeneration.current;
    playbackRead.current?.abort();
    const controller = new AbortController();
    playbackRead.current = controller;
    try {
      const book = (await audiobookClient.loadBook<AudiobookJob>(id, { signal: controller.signal, failure: 'Could not load this book for playback.' }))!;
      if (generation !== libraryPlayGeneration.current) return;
      await stopQuickPlayback();
      if (generation !== libraryPlayGeneration.current) return;
      setLibraryPlayerJob(book); setLibraryPlayRequest(value => value + 1); setNavigationError(null);
    } catch (error) { if (generation === libraryPlayGeneration.current) setNavigationError(error instanceof Error ? error.message : 'Could not play this book.'); }
  };
  const handleMetadataDraftChange = (jobId: string, metadata: AudiobookMetadata) => {
    edit.metadataDraft = { jobId, metadata };
    setJobs(previous => JSON.stringify(previous.find(job => job.id === jobId)?.metadataDraft) === JSON.stringify(metadata) ? previous : previous.map(job => job.id === jobId ? { ...job, metadataDraft: metadata } : job));
  };
  return {
    libraryBooks, libraryScanning, libraryScanWarning, activeStep, setActiveStep,
    chapterReviewActionHost, setChapterReviewActionHost, metadataReviewActionHost, setMetadataReviewActionHost, convertActionHost,
    setConvertActionHost, processReadiness, setProcessReadiness, reviewFilesOpen, setReviewFilesOpen,
    legacyImportMode, setLegacyImportMode, importError, navigationError, edit,
    handleNavigate, handlePlayLibraryBook, handleMetadataDraftChange, isProcessingStep1, isBuildingM4b,
    exportError, libraryPlayerJob, libraryPlayRequest, exportJobId, exportProgressMessage,
    isValidating, currentJob, handleRatingChange, handleCloseProject, handleOpenProject,
    refreshCurrentJob, handleRunStep1, handleRerunStep, handleUpdateJobSettings, handleSourceLoaded,
    handleStartImport, handleCancelImport, handleFinishImport, handleFinishFileReview, handleOrganizeLibrary,
    handleSaveChapters, handlePersistMetadataDraft, handleSaveMetadata, handleUpdateMetadataJson, handleMoveExportFolder,
    handleBuildM4b, handleValidate, handleAddQuickTag, handleSaveLibraryMetadata, handleWriteProjectAudioMetadata,
    handleWriteLibraryAudioMetadata, handleRelinkLibraryBook, handleOpenLibraryFolder, handleRefreshLibrary, handleFinishProcessing,
    handleMoveInboxToLibrary, handleUpdateLibraryJson, handleMoveLibraryFolders, handleDeleteMultiple, handleDeleteProject,
    handleRecheckProjectAudio, handleBookFilesChanged, handleContinueFromFiles, isLoading, startupError,
    setStartupAttempt, handleCleanup, handleLibraryRebuilt,prepareToLeaveBook,
  };
}
