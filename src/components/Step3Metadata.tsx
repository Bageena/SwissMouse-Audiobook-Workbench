import { createPortal } from 'react-dom';
import { MetadataMemberships } from './MetadataMemberships';
import { extendedMetadata } from '../utils/extendedMetadata';
import { ResizableRegion } from './ResizableRegion';
import { DesktopWindow } from './DesktopWorkspace';
import { AdaptiveButton } from './AdaptiveButton';
import { CoverFrame } from './CoverFrame';
import { ResizableColumns } from './ResizableColumns';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { AudiobookJob, AudiobookMetadata, CoverArtInfo } from '../types';
import { CoverGenerator } from './CoverGenerator';
import { alphabetical, quickAddCategory, normalizeQuickTag, quickTagKey, type QuickAddTarget } from '../utils/metadataQuickAdd';
import { metadataPeople } from '../utils/metadataPeople';
import { planChapterExport } from '../utils/chapterExport';
import { Image, Upload, Link2, FolderSearch, CheckCircle2, AlertCircle, Save, FileDown, ArrowRight, Sparkles, Info, Trash2, BookOpen, Mic, User, Library, Tag, Calendar, Globe, Hash, RotateCcw, Play, FilePenLine } from 'lucide-react';

interface Step3MetadataProps {
  actionHost?: HTMLElement | null;
  quickTags: string[];
  onAddQuickTag: (tag: string) => Promise<void>;
  mode?: 'import' | 'review' | 'file-review';
  onImportAction?: (metadata: AudiobookMetadata, process: boolean, writeSource: boolean) => Promise<void>;
  onCancelImport?: () => Promise<void>;
  onFinishFileReview?: (metadata: AudiobookMetadata) => Promise<void>;
  onOrganizeLibrary?: (metadata: AudiobookMetadata) => Promise<string>;
  job: AudiobookJob;
  onSaveMetadata: (metadata: AudiobookMetadata) => Promise<void>;
  onWriteAudioMetadata?: (metadata: AudiobookMetadata) => Promise<string>;
  onUpdateJson: (metadata: AudiobookMetadata) => Promise<string[]>;
  onMoveExportFolder: (metadata: AudiobookMetadata) => Promise<string>;
  onPersistDraft: (jobId: string, metadata: AudiobookMetadata) => Promise<void>;
  draftMetadata?: AudiobookMetadata;
  onDraftChange?: (jobId: string, metadata: AudiobookMetadata) => void;
  onNextStep: () => void;
  onRerunMetadata?: () => Promise<void>;
  isRerunning?: boolean;
}

const COMMON_LANGUAGES = [
  { code: 'eng', label: 'English (eng)' },
  { code: 'spa', label: 'Spanish (spa)' },
  { code: 'fra', label: 'French (fra)' },
  { code: 'deu', label: 'German (deu)' },
  { code: 'ita', label: 'Italian (ita)' },
  { code: 'jpn', label: 'Japanese (jpn)' },
  { code: 'zho', label: 'Chinese (zho)' },
];

export const Step3Metadata: React.FC<Step3MetadataProps> = ({
  actionHost,
  quickTags,
  onAddQuickTag,
  mode = 'review',
  onImportAction,
  onCancelImport,
  onFinishFileReview,
  onOrganizeLibrary,
  job,
  onSaveMetadata,
  onUpdateJson,
  onWriteAudioMetadata,
  onPersistDraft,
  draftMetadata,
  onDraftChange,
  onNextStep,
  onRerunMetadata,
  isRerunning = false,
}) => {
  // Initialize state from existing job metadata or fallback to job fields
  const [formData, setFormData] = useState<AudiobookMetadata>(() => {
    if (draftMetadata || job.metadataDraft || job.metadata) {
      return { ...(draftMetadata || job.metadataDraft || job.metadata)! };
    }
    return {
      title: job.name || '',
      subtitle: '',
      author: job.author || '',
      narrator: job.narrator || '',
      series: '',
      seriesSequence: '',
      genres: ['Audiobook'],
      publishedYear: new Date().getFullYear().toString(),
      releaseDate: '',
      publisher: '',
      language: 'eng',
      isbn: '',
      asin: '',
      description: '',
      abridged: false,
      explicit: false,
      copyright: '',
      cover: null,
    };
  });

  const [coverUrlInput, setCoverUrlInput] = useState<string>('');
  const [isScanningLocal, setIsScanningLocal] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [writeSource, setWriteSource] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [jsonMessage, setJsonMessage] = useState('');
  const [folderMessage, setFolderMessage] = useState('');
  const [tagInput, setTagInput] = useState<string>('');
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(0);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [tagError, setTagError] = useState('');
  const [genreInput, setGenreInput] = useState<string>('');
  const [quickAddTarget, setQuickAddTarget] = useState<QuickAddTarget>('genres');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [authorInput, setAuthorInput] = useState<string>('');
  const [narratorInput, setNarratorInput] = useState<string>('');
  const lastSavedDraft = useRef(JSON.stringify(job.metadataDraft || job.metadata || (draftMetadata ? null : formData)));
  const latestFormData = useRef(formData);
  latestFormData.current = formData;
  useEffect(() => { onDraftChange?.(job.id, formData); }, [job.id, formData, onDraftChange]);
  const [metadataExpanded, setMetadataExpanded] = useState(true);
  const [coverSourceTab, setCoverSourceTab] = useState<'upload' | 'web'>('upload');
  const [showCoverGenerator, setShowCoverGenerator] = useState(false);
  const draftTimer = useRef<number>();
  const draftWrite = useRef<Promise<void>>(Promise.resolve());
  const coverReadRequest = useRef(0);
  const dragDepth = useRef(0);
  const [isDraggingCover, setIsDraggingCover] = useState(false);
  const metadataWasProcessed = job.pipelineSteps?.metadata_processing?.hasOutput
    ?? ['metadata_ready', 'built', 'validated'].includes(job.status);

  const persistDraft = (metadata: AudiobookMetadata) => {
    const write = draftWrite.current.catch(() => {}).then(async () => {
      await onPersistDraft(job.id, metadata);
      lastSavedDraft.current = JSON.stringify(metadata);
    });
    draftWrite.current = write;
    return write;
  };

  const handleGeneratedCover = async (cover: CoverArtInfo) => {
    ++coverReadRequest.current;
    setIsLoadingUrl(false);
    window.clearTimeout(draftTimer.current);
    const metadata = { ...formData, cover };
    await persistDraft(metadata);
    setFormData(metadata);
    setShowCoverGenerator(false);
    setScanMessage({ type: 'success', text: 'Generated cover saved to your draft. Save book details to include it in your next export.' });
  };

  const authorsList = metadataPeople(formData, 'author');
  const narratorsList = metadataPeople(formData, 'narrator');

  const handleAddAuthor = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = authorsList;
    if (!current.includes(trimmed)) {
      const updated = [...current, trimmed].join(', ');
      setFormData((prev) => ({ ...prev, author: updated, authors: [...current, trimmed] }));
    }
    setAuthorInput('');
  };

  const handleRemoveAuthor = (name: string) => {
    const updated = authorsList.filter((a) => a !== name).join(', ');
    setFormData((prev) => ({ ...prev, author: updated, authors: authorsList.filter(author => author !== name) }));
  };

  const handleAddNarrator = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = narratorsList;
    if (!current.includes(trimmed)) {
      const updated = [...current, trimmed].join(', ');
      setFormData((prev) => ({ ...prev, narrator: updated, narrators: [...current, trimmed] }));
    }
    setNarratorInput('');
  };

  const handleRemoveNarrator = (name: string) => {
    const updated = narratorsList.filter((n) => n !== name).join(', ');
    setFormData((prev) => ({ ...prev, narrator: updated, narrators: narratorsList.filter(narrator => narrator !== name) }));
  };

  // Keep synced if job changes
  useEffect(() => {
    const storedMetadata = job.metadataDraft || job.metadata;
    if (storedMetadata && (!draftMetadata || JSON.stringify(draftMetadata) === JSON.stringify(storedMetadata)) && JSON.stringify(latestFormData.current) === lastSavedDraft.current) {
      setFormData({ ...storedMetadata });
      lastSavedDraft.current = JSON.stringify(storedMetadata);
    }
  }, [job.id, job.metadata, job.metadataDraft]);

  // Keep unsaved book details and uploaded cover art across app restarts.
  useEffect(() => {
    const serialized = JSON.stringify(formData);
    if (serialized === lastSavedDraft.current) return;
    draftTimer.current = window.setTimeout(async () => {
      try {
        await persistDraft(formData);
      } catch {
        // The next edit retries; the explicit Save button still reports failures.
      }
    }, 750);
    return () => window.clearTimeout(draftTimer.current);
  }, [formData, job.id]);

  // Switching screens unmounts this editor before the debounce can fire.
  // Flush the latest value, while the parent keeps it available immediately.
  useEffect(() => () => {
    window.clearTimeout(draftTimer.current);
    const latest = latestFormData.current;
    if (JSON.stringify(latest) !== lastSavedDraft.current) void persistDraft(latest).catch(() => {});
  }, [job.id]);

  // Scan local folder for cover image (cover.jpg, cover.png, etc.)
  const handleScanLocalFolder = async () => {
    const request = coverReadRequest.current;
    setIsScanningLocal(true);
    setScanMessage(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/scan-cover`, {
        method: 'POST',
      });
      const data = await res.json();
      if (request !== coverReadRequest.current) return;
      if (data.found && data.cover) {
        setFormData((prev) => ({ ...prev, cover: data.cover }));
        setScanMessage({
          type: 'success',
          text: data.message || `Detected local cover '${data.cover.filename}' in folder.`,
        });
      } else {
        setScanMessage({
          type: 'info',
          text: data.message || 'No image named cover.jpg/png/webp was found in the local folder.',
        });
      }
    } catch (err: any) {
      setScanMessage({
        type: 'error',
        text: `Error scanning local folder: ${err.message}`,
      });
    } finally {
      setIsScanningLocal(false);
    }
  };

  // Automatically check for local cover on mount if none is set
  useEffect(() => {
    if (formData.cover === undefined && job.id) {
      handleScanLocalFolder();
    }
  }, [job.id]);

  // Browse and drop use the same image loader and draft update.
  const loadCoverFile = (file?: File) => {
    if (!file) return;
    const request = ++coverReadRequest.current;
    setIsLoadingUrl(false);

    if (!file.type.startsWith('image/')) {
      setScanMessage({ type: 'error', text: 'Please choose a valid image file (.jpg, .jpeg, .png, .webp).' });
      return;
    }

    setScanMessage(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      if (request !== coverReadRequest.current) return;
      const result = event.target?.result as string;
      // Probe image dimensions
      const img = new window.Image();
      img.onload = () => {
        if (request !== coverReadRequest.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context || canvas.width * canvas.height > 40000000) { setScanMessage({ type: 'error', text: 'Cover image is too large to export. Choose a smaller image.' }); return; }
        context.drawImage(img, 0, 0);
        const normalized = /^image\/(png|jpeg)$/.test(file.type) ? result : canvas.toDataURL('image/png');
        const newCover: CoverArtInfo = {
          source: 'upload',
          url: normalized,
          filename: normalized === result ? file.name : file.name.replace(/\.[^.]+$/, '') + '.png',
          mimeType: normalized === result ? file.type : 'image/png',
          width: img.naturalWidth,
          height: img.naturalHeight,
          sizeBytes: file.size,
        };
        setFormData((prev) => ({ ...prev, cover: newCover }));
        setScanMessage({
          type: 'success',
          text: `Loaded uploaded cover '${file.name}' (${img.naturalWidth}×${img.naturalHeight}px).`,
        });
      };
      img.onerror = () => {
        if (request === coverReadRequest.current) setScanMessage({ type: 'error', text: `Could not open '${file.name}' as a cover image.` });
      };
      img.src = result;
    };
    reader.onerror = () => {
      if (request === coverReadRequest.current) setScanMessage({ type: 'error', text: `Could not read '${file.name}'. Please try again.` });
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    loadCoverFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleCoverDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDraggingCover(false);
    loadCoverFile(event.dataTransfer.files?.[0]);
  };

  // Handle URL cover fetch
  const handleFetchCoverUrl = () => {
    const trimmed = coverUrlInput.trim();
    if (!trimmed) return;
    const request = ++coverReadRequest.current;

    setIsLoadingUrl(true);
    setScanMessage(null);

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (request !== coverReadRequest.current) return;
      const newCover: CoverArtInfo = {
        source: 'url',
        url: trimmed,
        filename: trimmed.split('/').pop()?.split('?')[0] || 'remote_cover.jpg',
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
      setFormData((prev) => ({ ...prev, cover: newCover }));
      setIsLoadingUrl(false);
      setCoverUrlInput('');
      setScanMessage({
        type: 'success',
        text: `Successfully loaded remote cover (${img.naturalWidth}×${img.naturalHeight}px).`,
      });
    };
    img.onerror = () => {
      if (request !== coverReadRequest.current) return;
      setIsLoadingUrl(false);
      setScanMessage({
        type: 'error',
        text: 'Failed to load image from URL. Please ensure the link directly points to an image (JPG/PNG).',
      });
    };
    img.src = trimmed;
  };

  // Manual fields and quick add use the field the user chose.
  const handleAddGenre = (genreToAdd: string) => {
    const trimmed = genreToAdd.trim();
    if (!trimmed) return;
    setFormData(prev => quickAddCategory(prev, trimmed, 'genres'));
    setGenreInput('');
  };

  const tagSuggestions = tagInput.trim()
    ? quickTags.filter(tag => quickTagKey(tag).includes(quickTagKey(tagInput)) && !(formData.tags || []).some(selected => quickTagKey(selected) === quickTagKey(tag)))
      .sort((a, b) => Number(!quickTagKey(a).startsWith(quickTagKey(tagInput))) - Number(!quickTagKey(b).startsWith(quickTagKey(tagInput))) || a.localeCompare(b)).slice(0, 8)
    : [];

  const handleAddTag = (value: string) => {
    const trimmed = normalizeQuickTag(value);
    if (!trimmed) return;
    setTagError('');
    const existing = quickTags.find(tag => quickTagKey(tag) === quickTagKey(trimmed));
    const display = existing || trimmed;
    setFormData(prev => quickAddCategory(prev, display, 'tags'));
    if (!existing) void onAddQuickTag(display).catch(error => setTagError(error instanceof Error ? error.message : 'Could not save Quick Tag.'));
    setTagInput('');
    setShowTagSuggestions(false);
  };

  const handleRemoveGenre = (genreToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      genres: prev.genres.filter((g) => g !== genreToRemove),
    }));
  };

  const handleRemoveTag = (value: string) => setFormData(prev => ({ ...prev, tags: (prev.tags || []).filter(tag => tag !== value) }));

  const downloadAudiobookshelfMetadata = () => {
    let chapters = job.chapters;
    try { chapters = planChapterExport(job.chapters, job.totalDurationSeconds).chapters as typeof job.chapters; }
    catch { chapters = []; }
    const blob = new Blob([JSON.stringify(extendedMetadata(formData, chapters, job.id), null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'exmetadata.json';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Form submit
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      window.clearTimeout(draftTimer.current);
      await draftWrite.current.catch(() => {});
      await onSaveMetadata(formData);
      lastSavedDraft.current = JSON.stringify(formData);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      alert(`Failed to save metadata: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportAction = async (process: boolean) => {
    if (!onImportAction) return;
    setIsSaving(true);
    const savedBeforeAction = lastSavedDraft.current;
    try {
      window.clearTimeout(draftTimer.current);
      await draftWrite.current.catch(() => {});
      lastSavedDraft.current = JSON.stringify(formData);
      await onImportAction(formData, process, writeSource);
    } catch (error: any) { lastSavedDraft.current = savedBeforeAction; alert(error.message || 'Could not finish import.'); }
    finally { setIsSaving(false); }
  };

  const handleWriteAudioMetadata = async () => {
    if (!onWriteAudioMetadata) return;
    setIsSaving(true); setFolderMessage('');
    try {
      window.clearTimeout(draftTimer.current);
      await draftWrite.current.catch(() => {});
      setFolderMessage(await onWriteAudioMetadata(formData));
      lastSavedDraft.current = JSON.stringify(formData);
    } catch (error) { setFolderMessage(error instanceof Error ? error.message : 'Could not write metadata to audio.'); }
    finally { setIsSaving(false); }
  };

  const handleUpdateJson = async () => {
    setIsSaving(true);
    setJsonMessage('');
    try {
      window.clearTimeout(draftTimer.current);
      await draftWrite.current.catch(() => {});
      const paths = await onUpdateJson(formData);
      lastSavedDraft.current = JSON.stringify(formData);
      setJsonMessage(`Updated exmetadata.json beside ${paths.length} audiobook folder${paths.length === 1 ? '' : 's'}.`);
    } catch (error: any) { setJsonMessage(error.message || 'Could not update exmetadata.json.'); }
    finally { setIsSaving(false); }
  };

  const handleFileReviewAction = async (organize: boolean) => {
    setIsSaving(true);
    setFolderMessage('');
    try {
      window.clearTimeout(draftTimer.current);
      await draftWrite.current.catch(() => {});
      if (organize) setFolderMessage(await onOrganizeLibrary?.(formData) || 'Library folder is already organized.');
      else await onFinishFileReview?.(formData);
      lastSavedDraft.current = JSON.stringify(formData);
    } catch (error: any) { setFolderMessage(error.message || 'Could not save the project.'); }
    finally { setIsSaving(false); }
  };

  const unifiedLayout = mode !== 'import';

  const nextAction = mode === 'review' ? <div className="flex justify-end">
    <button id="btn-proceed-to-step4" type="button" onClick={onNextStep}
      className="paper-action-dark inline-flex items-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white shadow-sm">
      Continue to export<ArrowRight className="h-4 w-4" aria-hidden="true" />
    </button>
  </div> : null;

  return (<>
    {nextAction && (actionHost ? createPortal(nextAction, actionHost) : nextAction)}
    <DesktopWindow id="metadata" title="Metadata" kind="group"><div data-collapsed={unifiedLayout && !metadataExpanded} className={unifiedLayout ? 'metadata-unified workspace-panel processing-panel processing-metadata min-w-0 rounded-xl border border-stone-200 bg-white shadow-sm' : 'processing-stage processing-metadata space-y-6'}>
      {showCoverGenerator && <CoverGenerator metadata={formData} onCancel={() => setShowCoverGenerator(false)} onUse={handleGeneratedCover} />}
      {unifiedLayout && <header className={`workspace-panel-header workspace-toolbar flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${metadataExpanded ? 'border-b border-stone-200' : 'workspace-panel-header-collapsed'}`}><button type="button" aria-expanded={metadataExpanded} aria-controls="metadata-fields" onClick={() => setMetadataExpanded(value => !value)} className="workspace-header-toggle flex items-center gap-3"><h2 className={`workspace-panel-title text-sm font-bold ${metadataExpanded ? '' : 'workspace-panel-title-flat'}`}>Metadata</h2></button>{metadataExpanded && <div className="processing-actions adaptive-actions ml-auto flex flex-wrap items-center gap-3">
            <AdaptiveButton
              type="button"
              id="btn-save-metadata"
              icon={<Save />} label={isSaving ? 'Saving Metadata...' : 'Save book details'} slotClassName="metadata-icon-action" tone="primary"
              onClick={() => handleSubmit()}
              disabled={isSaving}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-500 shadow-sm transition-all cursor-pointer active:scale-98 disabled:bg-stone-400"
            />


            <AdaptiveButton
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h5M13 2l6 6v2M13 2v6h6" /><path d="M13 12h7l2 2v8H12V12Z" /><path d="M15 12v4h4v-4M15 22v-4h4v4" /></svg>}
              label="Rebuild exmetadata.json"
              description="Rebuild exmetadata.json from these book details. Existing metadata.json is preserved when Audiobookshelf compatibility is off."
              slotClassName="metadata-icon-action"
              onClick={() => void handleUpdateJson()}
              disabled={isSaving || !((job.exports || []).some(item => item.status === 'success') || job.outputM4b?.fullPath || Object.keys(job.exportedFiles || {}).length || job.parts.length)}
            />




            {onWriteAudioMetadata && <AdaptiveButton type="button" icon={<FilePenLine />} label="Write metadata to file"
              description="Save these details and write tags and selected artwork to the audio files without re-encoding."
              slotClassName="metadata-icon-action" disabled={isSaving || !formData.title.trim() || !job.parts.length}
              onClick={() => void handleWriteAudioMetadata()} />}

            <AdaptiveButton
              icon={<FileDown />}
              label="Download exmetadata.json"
              description="SwissMouse saves exmetadata.json beside the audiobook. Download an additional copy here."
              slotClassName="metadata-icon-action"
              onClick={downloadAudiobookshelfMetadata}
            />

              <AdaptiveButton
                type="button"
                icon={<RotateCcw />} label="Discard unsaved changes" slotClassName="metadata-icon-action"
                onClick={() => {
                  if (job.metadata) setFormData({ ...job.metadata });
                }}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded-lg transition cursor-pointer"
              />


          </div>}<button type="button" aria-label={metadataExpanded ? 'Collapse metadata' : 'Expand metadata'} aria-expanded={metadataExpanded} aria-controls="metadata-fields" onClick={() => setMetadataExpanded(value => !value)} className={`workspace-header-toggle inline-flex h-8 w-8 shrink-0 items-center justify-center ${metadataExpanded ? '' : 'ml-auto'}`}>{metadataExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></header>}
      {unifiedLayout && <div className="px-4">{saveSuccess && <p role="status" className="py-2 text-xs text-emerald-800">Book details saved.</p>}{jsonMessage && <p role="status" className="py-2 text-xs">{jsonMessage}</p>}{folderMessage && <p role="status" className="py-2 text-xs">{folderMessage}</p>}</div>}
      {!unifiedLayout && <>
      <div className="relative pb-12">
        <div className="flex justify-end">
          {mode !== 'import' && <div className="processing-actions adaptive-actions flex flex-wrap items-center gap-3">
            <AdaptiveButton
              type="button"
              id="btn-save-metadata"
              icon={<Save />} label={isSaving ? 'Saving Metadata...' : 'Save book details'} slotClassName="metadata-icon-action" tone="primary"
              onClick={() => handleSubmit()}
              disabled={isSaving}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-500 shadow-sm transition-all cursor-pointer active:scale-98 disabled:bg-stone-400"
            />


            <AdaptiveButton
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h5M13 2l6 6v2M13 2v6h6" /><path d="M13 12h7l2 2v8H12V12Z" /><path d="M15 12v4h4v-4M15 22v-4h4v4" /></svg>}
              label="Rebuild exmetadata.json"
              description="Rebuild exmetadata.json from these book details. Existing metadata.json is preserved when Audiobookshelf compatibility is off."
              slotClassName="metadata-icon-action"
              onClick={() => void handleUpdateJson()}
              disabled={isSaving || !((job.exports || []).some(item => item.status === 'success') || job.outputM4b?.fullPath || Object.keys(job.exportedFiles || {}).length || job.parts.length)}
            />





          </div>}
        </div>

        {saveSuccess && (
          <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center space-x-2 text-emerald-800 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Book details saved. The SwissMouse exmetadata.json was updated, and the details will be included in the next export.
            </span>
          </div>
        )}
        {jsonMessage && <p role="status" className="mt-3 text-xs text-stone-700">{jsonMessage}</p>}
        {folderMessage && <p role="status" className="mt-3 text-xs text-stone-700">{folderMessage}</p>}
        {['review'].includes(mode) && onRerunMetadata && (
          <button
            type="button"
            onClick={onRerunMetadata}
            disabled={isRerunning || !job.metadata || !job.chapters.length}
            title={metadataWasProcessed ? 'Rerun this step' : 'Run this step'}
            aria-label={`${metadataWasProcessed ? 'Rerun' : 'Run'} metadata processing`}
            className="absolute bottom-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {metadataWasProcessed ? <RotateCcw className={`h-3.5 w-3.5 ${isRerunning && job.pipelineSteps?.metadata_processing?.status === 'running' ? 'animate-spin' : ''}`} /> : <Play className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      </>}
      {/* Main Grid: Cover Art Left, Metadata Fields Right */}
      <form id="metadata-fields" hidden={unifiedLayout && !metadataExpanded} onSubmit={handleSubmit} className={`space-y-4 ${unifiedLayout ? 'p-4' : ''}`}>
      <ResizableColumns storageKey="metadata" initialRatio={42} label="Resize cover art and metadata fields">
        {/* Left Column: Cover art and publication details */}
        <div className="metadata-cover-column min-w-0 space-y-5">
          <DesktopWindow id="metadata-cover" title="Cover art" homeWindow="metadata"><ResizableRegion enabled={unifiedLayout} storageKey="metadata-cover" label="cover art"><div className={unifiedLayout ? 'metadata-section cover-controls p-3 space-y-5' : 'metadata-section cover-controls bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-5'}>
            <div className="workspace-panel-header flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center space-x-2">
                <Image className="w-4 h-4 text-amber-700" />
                <h3 className="workspace-panel-title font-bold text-sm text-stone-900">Cover art</h3>
              </div>
            </div>

            {/* Visual Cover Preview Display */}
            <div className="flex flex-col items-center">
              <CoverFrame>
              <div className="cover-art-frame-content relative w-56 h-56 overflow-hidden group">
                {formData.cover?.url ? (
                  <img
                    src={formData.cover.url}
                    alt="Audiobook Cover"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-stone-400 p-4 text-center">
                    <BookOpen className="w-12 h-12 stroke-1 text-stone-300 mb-2" />
                    <span className="text-xs font-medium text-stone-500">
                      No cover art selected
                    </span>
                    <span className="text-[11px] text-stone-400 mt-1">
                      Generate a cover, find one in the source folder, upload one, or paste an image link
                    </span>
                  </div>
                )}

                {formData.cover && (
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, cover: null }))}
                    className="absolute top-2 right-2 bg-rose-600 text-white p-1.5 rounded-full shadow hover:bg-rose-700 transition cursor-pointer opacity-90 hover:opacity-100"
                    title="Remove this cover image"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              </CoverFrame>

              {formData.cover && (
                <div className="mt-3 text-center space-y-0.5">
                  <p className="text-xs font-semibold text-stone-800 truncate max-w-[240px]">
                    {formData.cover.filename || 'Cover Image'}
                  </p>
                  <p className="text-[11px] text-stone-500 font-mono">
                    {formData.cover.width && formData.cover.height
                      ? `${formData.cover.width} × ${formData.cover.height} px • `
                      : ''}
                    {formData.cover.sizeBytes
                      ? `${(formData.cover.sizeBytes / 1024).toFixed(1)} KB`
                      : 'Web Reference'}
                  </p>
                  {formData.cover.width && formData.cover.height && (
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold mt-1 ${
                        Math.abs(formData.cover.width - formData.cover.height) < 5
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {Math.abs(formData.cover.width - formData.cover.height) < 5
                        ? '✓ Ideal 1:1 Square Ratio'
                        : 'Rectangular (Square is recommended)'}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Notification messages */}
            {scanMessage && (
              <div
                className={`p-3 rounded-lg text-xs flex items-start space-x-2 ${
                  scanMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : scanMessage.type === 'info'
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {scanMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : scanMessage.type === 'info' ? (
                  <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <span>{scanMessage.text}</span>
              </div>
            )}

            {/* Cover Sources */}
            <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-3">
              <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 pb-2">
              <div role="tablist" aria-label="Cover image source" className="flex flex-wrap gap-2">
                {(['upload', 'web'] as const).map((tab, index) => <button key={tab} type="button" role="tab" id={`cover-source-tab-${tab}`} aria-controls={`cover-source-panel-${tab}`} aria-selected={coverSourceTab === tab} tabIndex={coverSourceTab === tab ? 0 : -1}
                  onClick={() => setCoverSourceTab(tab)}
                  onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index; setCoverSourceTab(next ? 'web' : 'upload'); (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus(); } }}
                  aria-label={tab === 'upload' ? 'Browse or drop cover' : 'Web link'} title={tab === 'upload' ? 'Browse or drop cover' : 'Web link'} className="cover-action inline-flex items-center gap-1.5 rounded border border-stone-300 px-3 py-2 text-xs font-semibold" aria-pressed={coverSourceTab === tab}>
                  {tab === 'upload' ? <Upload className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}<span className="cover-action-label">{tab === 'upload' ? 'Browse or drop cover' : 'Web link'}</span>
                </button>)}
              </div>
                <button
                  type="button"
                  id="btn-scan-local-cover"
                  aria-label={isScanningLocal ? 'Looking for cover art...' : 'Scan folder'}
                  title="Search the selected audio folder for an image named cover.* in the audiobook source folder."
                  onClick={handleScanLocalFolder}
                  disabled={isScanningLocal}
                  className="cover-action inline-flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded bg-white border border-stone-300 hover:bg-stone-100 text-stone-700 text-xs font-semibold shadow-2xs transition cursor-pointer disabled:opacity-60"
                >
                  <FolderSearch className={`w-3.5 h-3.5 ${isScanningLocal ? 'animate-spin' : ''}`} />
                  <span className="cover-action-label">
                    {isScanningLocal ? 'Looking for cover art...' : 'Scan folder'}
                  </span>
                </button>

            <button type="button" onClick={() => setShowCoverGenerator(true)} aria-label="Generate Cover" title="Generate Cover" className="cover-action inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100">
              <Sparkles className="h-4 w-4" /><span className="cover-action-label">Generate Cover</span>
            </button>

              </div>
              <div role="tabpanel" id="cover-source-panel-upload" aria-labelledby="cover-source-tab-upload" hidden={coverSourceTab !== 'upload'}>
                <label
                  onDragEnter={event => { event.preventDefault(); dragDepth.current++; setIsDraggingCover(true); }}
                  onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
                  onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setIsDraggingCover(false); }}
                  onDrop={handleCoverDrop}
                  className={`flex flex-col items-center justify-center p-3 border-2 border-dashed rounded-lg cursor-pointer transition ${isDraggingCover ? 'border-amber-500 bg-amber-50' : 'border-stone-300 bg-white hover:bg-stone-50'}`}
                >
                  <Upload className="w-5 h-5 text-stone-400 mb-1" />
                  <span className="text-xs font-semibold text-stone-700">
                    Click to browse or drop cover here
                  </span>
                  <span className="text-[10px] text-stone-400 mt-0.5">
                    JPG, PNG, WEBP (Minimum recommended 600×600)
                  </span>
                  <input form="metadata-fields"
                    type="file"
                    id="input-cover-upload"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <div role="tabpanel" id="cover-source-panel-web" aria-labelledby="cover-source-tab-web" hidden={coverSourceTab !== 'web'}>
                <div className="flex space-x-2">
                  <input form="metadata-fields"
                    type="url"
                    id="input-cover-weblink"
                    aria-label="Cover image web link"
                    value={coverUrlInput}
                    onChange={(e) => setCoverUrlInput(e.target.value)}
                    placeholder="https://example.com/cover.jpg"
                    className="min-w-0 flex-1 bg-white border border-stone-300 rounded px-2.5 py-1.5 text-xs text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={handleFetchCoverUrl}
                    disabled={isLoadingUrl || !coverUrlInput.trim()}
                    className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded text-xs font-semibold transition cursor-pointer disabled:bg-stone-300"
                  >
                    {isLoadingUrl ? 'Loading...' : 'Use image'}
                  </button>
                </div>
                <p className="text-[10px] text-stone-400">
                  Paste a direct link to an image file.
                </p>

              </div>
            </div>
          </div></ResizableRegion></DesktopWindow>

          <div className="metadata-publication-layout">
        <DesktopWindow id="metadata-publication" variant="compact" title="Publication" homeWindow="metadata"><div className="metadata-section p-3 space-y-4">
          <header className="workspace-panel-header"><h4 className="workspace-panel-title text-xs font-bold text-stone-800">Publication</h4></header>
          <div className="metadata-publication-fields grid grid-cols-1 gap-4">
{/* Publisher */}
                <div>
                  <label
                    htmlFor="meta-publisher"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Publisher
                  </label>
                  <input form="metadata-fields"
                    id="meta-publisher"
                    type="text"
                    value={formData.publisher || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, publisher: e.target.value }))
                    }
                    placeholder="e.g. Macmillan Audio"
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                {/* Publication Year */}
                <div>
                  <label
                    htmlFor="meta-year"
                    className="flex items-center space-x-1.5 text-xs font-bold text-stone-700 mb-1"
                  >
                    <Calendar className="w-3.5 h-3.5 text-stone-400" />
                    <span>Publication Year</span>
                  </label>
                  <input form="metadata-fields"
                    id="meta-year"
                    type="text"
                    value={formData.publishedYear || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        publishedYear: e.target.value,
                      }))
                    }
                    placeholder="e.g. 1965"
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                {/* Language */}
                <div>
                  <label
                    htmlFor="meta-language"
                    className="flex items-center space-x-1.5 text-xs font-bold text-stone-700 mb-1"
                  >
                    <Globe className="w-3.5 h-3.5 text-stone-400" />
                    <span>Language</span>
                  </label>
                  <select form="metadata-fields"
                    id="meta-language"
                    value={formData.language}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, language: e.target.value }))
                    }
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {COMMON_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>

                          </div>
              <div className="pt-2 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex flex-col items-start gap-2">
                  <span className="text-xs font-bold text-stone-700">Work Edition:</span>
                  <label className="flex items-center space-x-2 text-xs text-stone-700 cursor-pointer">
                    <input form="metadata-fields"
                      type="radio"
                      name="abridged"
                      checked={!formData.abridged}
                      onChange={() =>
                        setFormData((prev) => ({ ...prev, abridged: false }))
                      }
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    <span className="font-medium">Unabridged</span>
                  </label>
                  <label className="flex items-center space-x-2 text-xs text-stone-700 cursor-pointer">
                    <input form="metadata-fields"
                      type="radio"
                      name="abridged"
                      checked={formData.abridged}
                      onChange={() =>
                        setFormData((prev) => ({ ...prev, abridged: true }))
                      }
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    <span>Abridged</span>
                  </label>
                </div>


              </div>
{/* Copyright info */}
                <div>
                  <label
                    htmlFor="meta-copyright"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Copyright Notice
                  </label>
                  <input form="metadata-fields"
                    id="meta-copyright"
                    type="text"
                    value={formData.copyright || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, copyright: e.target.value }))
                    }
                    placeholder="e.g. © 1965 Frank Herbert"
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
        </div></DesktopWindow>
            <div className="metadata-identifiers-column min-w-0">
        <DesktopWindow id="metadata-identifiers" variant="compact" title="Identifiers" homeWindow="metadata"><div className="metadata-section p-3 space-y-4">
          <header className="workspace-panel-header"><h4 className="workspace-panel-title text-xs font-bold text-stone-800">Identifiers</h4></header>
          <div className="metadata-identifiers-fields grid grid-cols-1 gap-3">
{/* ASIN */}
                <div>
                  <label
                    htmlFor="meta-asin"
                    className="flex items-center space-x-1.5 text-xs font-bold text-stone-700 mb-1"
                  >
                    <Hash className="w-3.5 h-3.5 text-stone-400" />
                    <span>ASIN</span>
                  </label>
                  <input form="metadata-fields"
                    id="meta-asin"
                    type="text"
                    value={formData.asin || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, asin: e.target.value }))
                    }
                    placeholder="e.g. B000R34YKC"
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs font-mono text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                {/* ISBN */}
                <div>
                  <label
                    htmlFor="meta-isbn"
                    className="flex items-center space-x-1.5 text-xs font-bold text-stone-700 mb-1"
                  >
                    <Hash className="w-3.5 h-3.5 text-stone-400" />
                    <span>ISBN</span>
                  </label>
                  <input form="metadata-fields"
                    id="meta-isbn"
                    type="text"
                    value={formData.isbn || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, isbn: e.target.value }))
                    }
                    placeholder="e.g. 9780441013593"
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs font-mono text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                          </div>
        </div></DesktopWindow>

            </div>
          </div>
        </div>

        {/* Right Column (7 Cols): Standard Audiobookshelf Metadata Fields */}
        <div className="min-w-0 space-y-5">
          <div className="space-y-5">
            {/* Section 1: Book & Author Identity */}
            <DesktopWindow id="metadata-identity" title="Book title and contributors" homeWindow="metadata"><ResizableRegion enabled={unifiedLayout} storageKey="metadata-identity" label="book title and contributors"><div className={unifiedLayout ? 'metadata-section p-3 space-y-4' : 'metadata-section bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-4'}>
              <div className="workspace-panel-header flex items-center space-x-2 border-b border-stone-100 pb-3">
                <BookOpen className="w-4 h-4 text-amber-700" />
                <h3 className="workspace-panel-title font-bold text-sm text-stone-900">
                  Book title and contributors
                </h3>
              </div>

              <div className="metadata-field-grid grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Title */}
                <div className="md:col-span-2">
                  <label
                    htmlFor="meta-title"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Title <span className="text-rose-500">*</span>
                  </label>
                  <input form="metadata-fields"
                    id="meta-title"
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, title: e.target.value }))
                    }
                    placeholder="e.g. The Example Book"
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                {/* Subtitle */}
                <div className="md:col-span-2">
                  <label
                    htmlFor="meta-subtitle"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Subtitle
                  </label>
                  <input form="metadata-fields"
                    id="meta-subtitle"
                    type="text"
                    value={formData.subtitle || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, subtitle: e.target.value }))
                    }
                    placeholder="e.g. Book 1 of a series"
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                {/* Author(s) */}
                <div>
                  <label
                    htmlFor="meta-author"
                    className="flex items-center space-x-1.5 text-xs font-bold text-stone-700 mb-1"
                  >
                    <User className="w-3.5 h-3.5 text-stone-400" />
                    <span>Author(s)</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5 min-h-[38px] p-2 bg-stone-50/50 border border-stone-300 rounded-lg focus-within:ring-1 focus-within:ring-amber-500 focus-within:border-amber-500">
                    {authorsList.map((authorName) => (
                      <span
                        key={authorName}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs"
                        title="Author credit"
                      >
                        <User className="w-3 h-3 text-amber-700 shrink-0" />
                        <span>{authorName}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAuthor(authorName)}
                          className="text-amber-700 hover:text-rose-700 cursor-pointer ml-0.5 text-xs font-bold"
                          title={`Remove ${authorName}`}
                        ><X className="h-4 w-4" aria-hidden="true" /></button>
                      </span>
                    ))}
                    <input form="metadata-fields"
                      id="meta-author"
                      type="text"
                      value={authorInput}
                      onChange={(e) => setAuthorInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddAuthor(authorInput);
                        } else if (e.key === 'Backspace' && !authorInput && authorsList.length > 0) {
                          handleRemoveAuthor(authorsList[authorsList.length - 1]);
                        }
                      }}
                      onBlur={() => {
                        if (authorInput.trim()) {
                          handleAddAuthor(authorInput);
                        }
                      }}
                      placeholder={authorsList.length === 0 ? "Type author name and press Enter..." : "Add another author..."}
                      className="flex-1 min-w-[140px] bg-transparent border-none text-xs text-stone-900 focus:outline-none placeholder:text-stone-400"
                    />
                  </div>
                </div>

                {/* Narrator(s) - HIGHLIGHTED: Mapped to Composer Tag! */}
                <div>
                  <label
                    htmlFor="meta-narrator"
                    className="flex items-center justify-between text-xs font-bold text-stone-700 mb-1"
                  >
                    <span className="flex items-center space-x-1.5">
                      <Mic className="w-3.5 h-3.5 text-amber-700" />
                      <span>Narrator(s)</span>
                    </span>
                    <span className="text-[10px] font-mono text-amber-800 bg-amber-100/80 px-1.5 py-0.2 rounded border border-amber-300">
                      Mapped to Composer
                    </span>
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5 min-h-[38px] p-2 bg-stone-50/50 border border-amber-300/80 rounded-lg focus-within:ring-1 focus-within:ring-amber-500 focus-within:border-amber-500">
                    {narratorsList.map((narratorName) => (
                      <span
                        key={narratorName}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs"
                        title="Narrator credit"
                      >
                        <Mic className="w-3 h-3 text-amber-700 shrink-0" />
                        <span>{narratorName}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveNarrator(narratorName)}
                          className="text-amber-700 hover:text-rose-700 cursor-pointer ml-0.5 text-xs font-bold"
                          title={`Remove ${narratorName}`}
                        ><X className="h-4 w-4" aria-hidden="true" /></button>
                      </span>
                    ))}
                    <input form="metadata-fields"
                      id="meta-narrator"
                      type="text"
                      value={narratorInput}
                      onChange={(e) => setNarratorInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddNarrator(narratorInput);
                        } else if (e.key === 'Backspace' && !narratorInput && narratorsList.length > 0) {
                          handleRemoveNarrator(narratorsList[narratorsList.length - 1]);
                        }
                      }}
                      onBlur={() => {
                        if (narratorInput.trim()) {
                          handleAddNarrator(narratorInput);
                        }
                      }}
                      placeholder={narratorsList.length === 0 ? "Type narrator name and press Enter..." : "Add another narrator..."}
                      className="flex-1 min-w-[140px] bg-transparent border-none text-xs text-stone-900 focus:outline-none placeholder:text-stone-400"
                    />
                  </div>

                  <div className="pt-1 flex items-center text-[11px] text-stone-500">
                    <span>Type one name and press <kbd className="px-1 py-0.5 bg-stone-100 border border-stone-200 rounded text-[10px] font-mono font-semibold text-stone-700">Enter</kbd> to add it. Commas within a name are preserved.</span>
                  </div>

                </div>
              </div>
            </div></ResizableRegion></DesktopWindow>

            {/* Section 2: Series & Tagging */}
            <DesktopWindow id="metadata-taxonomy" title="Series & Taxonomy" homeWindow="metadata"><ResizableRegion enabled={unifiedLayout} storageKey="metadata-taxonomy" label="series and taxonomy"><div className={unifiedLayout ? 'metadata-section p-3 space-y-4' : 'metadata-section bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-4'}>
              <div className="workspace-panel-header flex items-center space-x-2 border-b border-stone-100 pb-3">
                <Library className="w-4 h-4 text-amber-700" />
                <h3 className="workspace-panel-title font-bold text-sm text-stone-900">
                  Series & Taxonomy
                </h3>
              </div>

              <div className="metadata-field-grid grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Series Name */}
                <div className="md:col-span-2">
                  <label
                    htmlFor="meta-series"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Series Name
                  </label>
                  <input form="metadata-fields"
                    id="meta-series"
                    type="text"
                    value={formData.series || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, series: e.target.value }))
                    }
                    placeholder="e.g. Series name"
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                {/* Series Sequence / # */}
                <div>
                  <label
                    htmlFor="meta-series-sequence"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Volume / Part #
                  </label>
                  <input form="metadata-fields"
                    id="meta-series-sequence"
                    type="text"
                    value={formData.seriesSequence || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        seriesSequence: e.target.value,
                      }))
                    }
                    placeholder="e.g. 1 or 2.5"
                    className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div className="md:col-span-3 space-y-4">
                  <MetadataMemberships kind="collections" value={formData.collections} author={formData.author} authors={formData.authors} jobId={job.id} onChange={collections=>setFormData(previous=>({...previous,collections}))} />
                  <MetadataMemberships kind="additionalSeries" value={formData.additionalSeries} author={formData.author} authors={formData.authors} jobId={job.id} onChange={additionalSeries=>setFormData(previous=>({...previous,additionalSeries}))} />
                </div>
                {/* Genres and Tags */}
                <div className="md:col-span-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-1.5 text-xs font-bold text-stone-700">
                      <Tag className="w-3.5 h-3.5 text-stone-400" />
                      <span>Genres and Tags</span>
                    </label>
                  </div>
                  <div data-category="genres" data-active={quickAddTarget === 'genres'} onClick={() => setQuickAddTarget('genres')} className={`metadata-category-target rounded-lg p-2 transition ${quickAddTarget === 'genres' ? 'bg-amber-50 ring-2 ring-amber-400' : 'bg-stone-50 ring-1 ring-stone-200'}`}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label htmlFor="manual-genre" className="text-xs font-semibold text-stone-700">Genres</label>
                      <button type="button" onClick={() => setQuickAddTarget('genres')} aria-pressed={quickAddTarget === 'genres'} className="metadata-quick-add-target text-[11px] font-semibold text-amber-800">{quickAddTarget === 'genres' ? 'Quick Add target' : 'Use Quick Add for Genres'}</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2.5 bg-white border border-amber-200 rounded-lg">
                    {alphabetical(formData.genres).map((g) => (
                      <span
                        key={g}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs"
                      >
                        <span>{g}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveGenre(g)}
                          className="text-amber-700 hover:text-rose-700 cursor-pointer ml-1 text-xs font-bold"
                          title={`Remove ${g}`}
                        ><X className="h-4 w-4" aria-hidden="true" /></button>
                      </span>
                    ))}
                    {formData.genres.length === 0 && (
                      <span className="text-xs text-stone-400 italic py-0.5">
                        No genres yet. Add a genre or choose one below.
                      </span>
                    )}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <input form="metadata-fields" id="manual-genre" type="text" value={genreInput} onFocus={() => setQuickAddTarget('genres')} onChange={e => setGenreInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddGenre(genreInput); } }} placeholder="Add a genre" className="min-w-0 flex-1 bg-stone-50/50 border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-800" />
                      <button type="button" onClick={() => handleAddGenre(genreInput)} disabled={!genreInput.trim()} className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white rounded-lg text-xs font-semibold">+ Add</button>
                    </div>
                  </div>
                  <div data-category="tags" data-active={quickAddTarget === 'tags'} onClick={() => setQuickAddTarget('tags')} className={`metadata-category-target rounded-lg p-2 transition ${quickAddTarget === 'tags' ? 'bg-sky-50 ring-2 ring-sky-400' : 'bg-stone-50 ring-1 ring-stone-200'}`}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label htmlFor="manual-tag" className="text-xs font-semibold text-stone-700">Tags</label>
                      <button type="button" onClick={() => setQuickAddTarget('tags')} aria-pressed={quickAddTarget === 'tags'} className="metadata-quick-add-target text-[11px] font-semibold text-sky-800">{quickAddTarget === 'tags' ? 'Quick Add target' : 'Use Quick Add for Tags'}</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2.5 bg-white border border-stone-200 rounded-lg">
                      {alphabetical(formData.tags || []).map(tag => <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-800"><span>{tag}</span><button type="button" onClick={() => handleRemoveTag(tag)} title={`Remove ${tag}`} className="ml-1 font-bold text-stone-500 hover:text-rose-700"><X className="h-4 w-4" aria-hidden="true" /></button></span>)}
                      {!(formData.tags || []).length && <span className="py-0.5 text-xs italic text-stone-400">No tags yet. Add a tag or choose one below.</span>}
                    </div>
                  </div>
                  <div className="metadata-field-grid grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative flex space-x-1.5">
                      <input form="metadata-fields"
                        id="manual-tag"
                        type="text"
                        value={tagInput}
                        onFocus={() => setQuickAddTarget('tags')}
                        onChange={(e) => { setTagInput(e.target.value); setTagSuggestionIndex(0); setShowTagSuggestions(true); }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown' && tagSuggestions.length) { e.preventDefault(); setTagSuggestionIndex(index => (index + 1) % tagSuggestions.length); }
                          else if (e.key === 'ArrowUp' && tagSuggestions.length) { e.preventDefault(); setTagSuggestionIndex(index => (index - 1 + tagSuggestions.length) % tagSuggestions.length); }
                          else if (e.key === 'Escape') setShowTagSuggestions(false);
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddTag(showTagSuggestions && tagSuggestions.length ? tagSuggestions[tagSuggestionIndex] : tagInput);
                          }
                        }}
                        placeholder="Add a tag..."
                        role="combobox"
                        aria-expanded={showTagSuggestions && tagSuggestions.length > 0}
                        aria-controls="tag-suggestions"
                        aria-activedescendant={showTagSuggestions && tagSuggestions.length ? `tag-suggestion-${tagSuggestionIndex}` : undefined}
                        className="min-w-0 flex-1 bg-stone-50/50 border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      {showTagSuggestions && tagSuggestions.length > 0 && <div id="tag-suggestions" role="listbox" className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-stone-300 bg-white p-1 shadow-lg">{tagSuggestions.map((tag, index) => <button key={tag} id={`tag-suggestion-${index}`} role="option" aria-selected={index === tagSuggestionIndex} type="button" onMouseDown={event => event.preventDefault()} onClick={() => handleAddTag(tag)} className={`block w-full rounded px-2 py-1.5 text-left text-xs ${index === tagSuggestionIndex ? 'bg-amber-50 text-amber-900' : 'text-stone-800 hover:bg-stone-50'}`}>{tag}</button>)}</div>}
                      <button
                        type="button"
                        onClick={() => handleAddTag(tagInput)}
                        disabled={!tagInput.trim()}
                        className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow-2xs transition cursor-pointer"
                      >
                        + Add
                      </button>
                    </div>
                    {tagError && <p role="alert" className="text-xs text-rose-700">{tagError}</p>}

                    {/* Filter Quick Add choices */}
                    <div className="relative">
                      <input form="metadata-fields"
                        type="text"
                        value={tagFilter}
                        onChange={(e) => setTagFilter(e.target.value)}
                        placeholder="Filter quick add choices..."
                        className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      {tagFilter && (
                        <button
                          type="button"
                          onClick={() => setTagFilter('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-xs"
                        ><X className="h-4 w-4" aria-hidden="true" /></button>
                      )}
                    </div>
                  </div>

                  {/* Alphabetical quick add choices */}
                  <details className="p-3 bg-stone-50/70 border border-stone-200/80 rounded-lg space-y-2">
                    <summary className="cursor-pointer text-[11px] text-stone-500 font-medium">
                      <span>Quick Add ({quickTags.length} choices)</span>
                      <span className="float-right">Adding to {quickAddTarget === 'genres' ? 'Genres' : 'Tags'}</span>
                    </summary>

                    <div className="flex flex-wrap gap-1.5">
                      {quickTags.filter((tg) =>
                        tg.toLowerCase().includes(tagFilter.toLowerCase().trim())
                      ).map((tg) => {
                        const isGenre = formData.genres.some(g => g.toLowerCase() === tg.toLowerCase());
                        const isTag = (formData.tags || []).some(tag => tag.toLowerCase() === tg.toLowerCase());
                        const active = isGenre || isTag;
                        const selectedHere = quickAddTarget === 'genres' ? isGenre : isTag;
                        return (
                          <button
                            key={tg}
                            type="button"
                            onClick={() => setFormData(prev => quickAddCategory(prev, tg, quickAddTarget))}
                            aria-pressed={selectedHere}
                            title={selectedHere ? `${tg} already selected as ${isGenre ? 'Genre' : 'Tag'}` : active ? `Move ${tg} to ${quickAddTarget === 'genres' ? 'Genres' : 'Tags'}` : `Add ${tg} to ${quickAddTarget === 'genres' ? 'Genres' : 'Tags'}`}
                            className={`text-xs px-2.5 py-1 rounded-full cursor-pointer transition-all border font-medium ${
                              isGenre
                                ? 'bg-amber-600 border-amber-600 text-white shadow-2xs'
                                : isTag
                                ? 'bg-sky-600 border-sky-600 text-white shadow-2xs'
                                : 'bg-white hover:bg-stone-100 border-stone-300 text-stone-700'
                            }`}
                          >
                            {active ? `✓ ${tg} · ${isGenre ? 'Genre' : 'Tag'}` : `+ ${tg}`}
                          </button>
                        );
                      })}
                    </div>
                  </details>
                </div>
                <div className="md:col-span-3 border-t border-stone-100 pt-3">
                  <p className="mb-2 text-xs font-bold text-stone-700">Content Advisory</p>
                <div className="flex items-center space-x-4">
                  <span className="text-xs font-bold text-stone-700">Advisory:</span>
                  <label className="flex items-center space-x-2 text-xs text-stone-700 cursor-pointer">
                    <input form="metadata-fields"
                      type="radio"
                      name="explicit"
                      checked={!formData.explicit}
                      onChange={() =>
                        setFormData((prev) => ({ ...prev, explicit: false }))
                      }
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    <span className="font-medium text-emerald-700">Clean</span>
                  </label>
                  <label className="flex items-center space-x-2 text-xs text-stone-700 cursor-pointer">
                    <input form="metadata-fields"
                      type="radio"
                      name="explicit"
                      checked={formData.explicit}
                      onChange={() =>
                        setFormData((prev) => ({ ...prev, explicit: true }))
                      }
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <span className="text-rose-700 font-medium">Explicit Content</span>
                  </label>
                </div>
                </div>
              </div>
            </div></ResizableRegion></DesktopWindow>

          </div>
        </div>
      </ResizableColumns>
      <ResizableRegion enabled={unifiedLayout} storageKey="metadata-details" label="book details"><section className={unifiedLayout ? 'metadata-section p-3 space-y-6' : 'metadata-section rounded-xl border border-stone-200/80 bg-white p-5 shadow-xs space-y-6'}>
        <DesktopWindow id="metadata-description" title="Description" homeWindow="metadata"><div className="space-y-3">
              <div className="workspace-panel-header flex items-center justify-between">
                <h4 className="workspace-panel-title text-xs font-bold text-stone-800">Description</h4>
                <span className="text-[11px] text-stone-400 font-mono">
                  {formData.description ? formData.description.length : 0} chars
                </span>
              </div>

              <div>
                <textarea form="metadata-fields"
                  id="meta-description"
                  rows={4}
                  value={formData.description || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Write a short synopsis or summary for library apps and players..."
                  className="w-full bg-stone-50/50 border border-stone-300 rounded-lg p-3 text-xs text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500 leading-relaxed font-sans"
                />
                <p className="text-[10px] text-stone-400 mt-1">
                  Saved as the book description in compatible audiobook apps.
                </p>
              </div>
        </div></DesktopWindow>
      </section></ResizableRegion>
            {/* Bottom Form Actions */}
            <div className="processing-actions adaptive-actions flex items-center justify-end space-x-3 pt-2">

              {['review'].includes(mode) && <AdaptiveButton
                type="submit"
                id="btn-save-metadata-bottom"
                icon={<Save />} label={isSaving ? 'Saving...' : 'Save book details'} slotClassName="metadata-icon-action" tone="primary"
                disabled={isSaving}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-sm transition-all cursor-pointer active:scale-98 disabled:bg-stone-400"
              />}
            </div>
      </form>
      {mode === 'import' && <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-4">
        <label className="flex items-center gap-2 text-sm text-stone-700"><input form="metadata-fields" type="checkbox" checked={writeSource} onChange={event => setWriteSource(event.target.checked)} /> Write metadata to source audio file(s)</label>
        <p className="text-xs text-stone-500">Optional. Supported text tags are updated without re-encoding audio; SwissMouse keeps the full book record separately.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void onCancelImport?.()} disabled={isSaving} className="rounded-lg border border-stone-300 px-4 py-2 text-sm">Cancel</button>
          <button type="button" onClick={() => void handleImportAction(false)} disabled={isSaving || !job.parts.length || !formData.title.trim()} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Finish</button>
          <button type="button" onClick={() => void handleImportAction(true)} disabled={isSaving || !job.parts.length || !formData.title.trim()} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 disabled:opacity-40">Process Book →</button>
        </div>
      </div>}
      {mode === 'file-review' && metadataExpanded && <div className="border-t border-stone-200 p-4 space-y-3">
        <p className="text-xs text-stone-600">Keep this book without running audio processing, or organize its current folder using the Library pattern in Settings. SwissMouse shows the destination before moving files.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void handleFileReviewAction(false)} disabled={isSaving || !formData.title.trim()} className="paper-action-dark rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Save and close</button>
          <button type="button" onClick={() => void handleFileReviewAction(true)} disabled={isSaving || !formData.title.trim()} className="rounded-lg border border-amber-600 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-40">Organize Library folder</button>
        </div>
      </div>}
    </div>
    </DesktopWindow></>
  );
};
