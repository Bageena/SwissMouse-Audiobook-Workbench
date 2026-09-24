import React, { useState, useEffect, useRef } from 'react';
import { AudiobookJob, AudiobookMetadata, CoverArtInfo } from '../types';
import { CoverGenerator } from './CoverGenerator';
import {
  Image,
  Upload,
  Link2,
  FolderSearch,
  CheckCircle2,
  AlertCircle,
  Save,
  ArrowRight,
  Sparkles,
  Info,
  Trash2,
  BookOpen,
  Mic,
  User,
  Library,
  Tag,
  Calendar,
  Building,
  Globe,
  Hash,
  FileText,
  ShieldAlert,
  HelpCircle,
  RotateCcw,
} from 'lucide-react';

interface Step3MetadataProps {
  job: AudiobookJob;
  onSaveMetadata: (metadata: AudiobookMetadata) => Promise<void>;
  onNextStep: () => void;
  onRerunMetadata?: () => Promise<void>;
  isRerunning?: boolean;
}

export const GOODREADS_POPULAR_TAGS = [
  'Fiction',
  'Non-Fiction',
  'Fantasy',
  'Science Fiction',
  'Mystery & Thriller',
  'Romance',
  'Historical Fiction',
  'Young Adult',
  'Biography & Memoir',
  'History',
  'Classics',
  'Horror',
  'Crime',
  'Self-Help',
  'Philosophy',
  'Dystopian',
  'Adventure',
  'Paranormal',
  'Psychology',
  'Humor',
  'Graphic Novels',
  'Poetry',
  'Contemporary',
  'Business',
  'Audiobook',
];

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
  job,
  onSaveMetadata,
  onNextStep,
  onRerunMetadata,
  isRerunning = false,
}) => {
  // Initialize state from existing job metadata or fallback to job fields
  const [formData, setFormData] = useState<AudiobookMetadata>(() => {
    if (job.metadataDraft || job.metadata) {
      return { ...(job.metadataDraft || job.metadata)! };
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
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [tagInput, setTagInput] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [authorInput, setAuthorInput] = useState<string>('');
  const [narratorInput, setNarratorInput] = useState<string>('');
  const lastSavedDraft = useRef(JSON.stringify(formData));
  const [showCoverGenerator, setShowCoverGenerator] = useState(false);
  const draftTimer = useRef<number>();
  const draftWrite = useRef<Promise<void>>(Promise.resolve());

  const persistDraft = (metadata: AudiobookMetadata) => {
    const write = draftWrite.current.catch(() => {}).then(async () => {
      const response = await fetch(`/api/jobs/${job.id}/metadata-draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata }),
      });
      if (!response.ok) throw new Error('Could not save the cover draft. Please try again.');
      lastSavedDraft.current = JSON.stringify(metadata);
    });
    draftWrite.current = write;
    return write;
  };

  const handleGeneratedCover = async (cover: CoverArtInfo) => {
    window.clearTimeout(draftTimer.current);
    const metadata = { ...formData, cover };
    await persistDraft(metadata);
    setFormData(metadata);
    setShowCoverGenerator(false);
    setScanMessage({ type: 'success', text: 'Generated cover saved to your draft. Save book details to include it in your next export.' });
  };

  const authorsList = formData.author ? formData.author.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const narratorsList = formData.narrator ? formData.narrator.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const handleAddAuthor = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = authorsList;
    if (!current.includes(trimmed)) {
      const updated = [...current, trimmed].join(', ');
      setFormData((prev) => ({ ...prev, author: updated }));
    }
    setAuthorInput('');
  };

  const handleRemoveAuthor = (name: string) => {
    const updated = authorsList.filter((a) => a !== name).join(', ');
    setFormData((prev) => ({ ...prev, author: updated }));
  };

  const handleAddNarrator = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = narratorsList;
    if (!current.includes(trimmed)) {
      const updated = [...current, trimmed].join(', ');
      setFormData((prev) => ({ ...prev, narrator: updated }));
    }
    setNarratorInput('');
  };

  const handleRemoveNarrator = (name: string) => {
    const updated = narratorsList.filter((n) => n !== name).join(', ');
    setFormData((prev) => ({ ...prev, narrator: updated }));
  };

  // Keep synced if job changes
  useEffect(() => {
    const storedMetadata = job.metadataDraft || job.metadata;
    if (storedMetadata) {
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

  // Scan local folder for cover image (cover.jpg, cover.png, etc.)
  const handleScanLocalFolder = async () => {
    setIsScanningLocal(true);
    setScanMessage(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/scan-cover`, {
        method: 'POST',
      });
      const data = await res.json();
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
    if (!formData.cover && job.id) {
      handleScanLocalFolder();
    }
  }, [job.id]);

  // Handle image file upload (drag & drop or file dialog)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file (.jpg, .jpeg, .png, .webp).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      // Probe image dimensions
      const img = new window.Image();
      img.onload = () => {
        const newCover: CoverArtInfo = {
          source: 'upload',
          url: result,
          filename: file.name,
          mimeType: file.type,
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
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  // Handle URL cover fetch
  const handleFetchCoverUrl = () => {
    const trimmed = coverUrlInput.trim();
    if (!trimmed) return;

    setIsLoadingUrl(true);
    setScanMessage(null);

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
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
      setIsLoadingUrl(false);
      setScanMessage({
        type: 'error',
        text: 'Failed to load image from URL. Please ensure the link directly points to an image (JPG/PNG).',
      });
    };
    img.src = trimmed;
  };

  // Tag / Genre management
  const handleAddGenre = (genreToAdd: string) => {
    const trimmed = genreToAdd.trim();
    if (!trimmed) return;
    if (!formData.genres.includes(trimmed)) {
      setFormData((prev) => ({ ...prev, genres: [...prev.genres, trimmed] }));
    }
    setTagInput('');
  };

  const handleRemoveGenre = (genreToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      genres: prev.genres.filter((g) => g !== genreToRemove),
    }));
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

  return (
    <div className="space-y-6">
      {showCoverGenerator && <CoverGenerator metadata={formData} onCancel={() => setShowCoverGenerator(false)} onUse={handleGeneratedCover} />}
      {/* Step Header Banner */}
      <div className={`relative bg-white rounded-xl p-5 pb-12 border shadow-xs ${job.pipelineSteps?.metadata_processing?.status === 'stale' ? 'border-orange-300' : job.pipelineSteps?.metadata_processing?.status === 'failed' ? 'border-red-300' : 'border-stone-200/80'}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                3
              </span>
              <h2 className="text-lg font-bold text-stone-900">
                Add book details and cover art
              </h2>
            </div>
            <p className="text-sm text-stone-600 mt-1 max-w-3xl">
              Add the information players and library apps use to identify your book. Fields are optional unless marked required. SwissMouse uses common Audiobookshelf-compatible tags and checks them after export.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              id="btn-save-metadata"
              onClick={() => handleSubmit()}
              disabled={isSaving}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-500 shadow-sm transition-all cursor-pointer active:scale-98 disabled:bg-stone-400"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Saving Metadata...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save book details</span>
                </>
              )}
            </button>

            <button
              type="button"
              id="btn-proceed-to-step4"
              onClick={onNextStep}
              className="flex items-center space-x-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold bg-stone-900 hover:bg-stone-800 text-stone-100 transition-colors cursor-pointer"
            >
              <span>Choose export options</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {saveSuccess && (
          <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center space-x-2 text-emerald-800 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Book details saved. They will be included in your next export.
            </span>
          </div>
        )}
        {onRerunMetadata && (
          <button
            type="button"
            onClick={onRerunMetadata}
            disabled={isRerunning || !job.metadata || !job.chapters.length}
            title="Rerun this step"
            aria-label="Rerun metadata processing"
            className="absolute bottom-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRerunning && job.pipelineSteps?.metadata_processing?.status === 'running' ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* Main Grid: Cover Art Left, Metadata Fields Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 Cols): Cover Art Management */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center space-x-2">
                <Image className="w-4 h-4 text-amber-700" />
                <h3 className="font-bold text-sm text-stone-900">Cover art</h3>
              </div>
              {formData.cover && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                  {formData.cover.source} source
                </span>
              )}
            </div>

            {/* Visual Cover Preview Display */}
            <div className="flex flex-col items-center">
              <div className="relative w-56 h-56 rounded-lg overflow-hidden border-2 border-stone-200 bg-stone-100 shadow-md group">
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

            <button type="button" onClick={() => setShowCoverGenerator(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100">
              <Sparkles className="h-4 w-4" />Generate Cover
            </button>

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
            <div className="space-y-4 pt-2 border-t border-stone-100">
              {/* Option 1: Local Folder Detection */}
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-stone-800">
                    <FolderSearch className="w-3.5 h-3.5 text-amber-700" />
                    <span>Find a cover in the source folder</span>
                  </div>
                  <span className="text-[10px] text-stone-400 font-mono">
                    cover.jpg / cover.png
                  </span>
                </div>
                <p className="text-[11px] text-stone-500">
                  Search the selected audio folder for an image named{' '}
                  <code className="font-mono text-stone-700 bg-stone-200/70 px-1 py-0.5 rounded">
                    cover.*
                  </code>{' '}
                  in the audiobook source folder.
                </p>
                <button
                  type="button"
                  id="btn-scan-local-cover"
                  onClick={handleScanLocalFolder}
                  disabled={isScanningLocal}
                  className="w-full flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded bg-white border border-stone-300 hover:bg-stone-100 text-stone-700 text-xs font-semibold shadow-2xs transition cursor-pointer disabled:opacity-60"
                >
                  <FolderSearch className={`w-3.5 h-3.5 ${isScanningLocal ? 'animate-spin' : ''}`} />
                  <span>
                    {isScanningLocal ? 'Looking for cover art...' : 'Find cover art in folder'}
                  </span>
                </button>
              </div>

              {/* Option 2: Web Link */}
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-2">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-stone-800">
                  <Link2 className="w-3.5 h-3.5 text-amber-700" />
                  <span>Use an image web link</span>
                </div>
                <div className="flex space-x-2">
                  <input
                    type="url"
                    id="input-cover-weblink"
                    value={coverUrlInput}
                    onChange={(e) => setCoverUrlInput(e.target.value)}
                    placeholder="https://example.com/cover.jpg"
                    className="flex-1 bg-white border border-stone-300 rounded px-2.5 py-1.5 text-xs text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
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
                  Paste a direct image link, for example from Audible, Goodreads, or Open Library.
                </p>
              </div>

              {/* Option 3: File Upload */}
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-2">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-stone-800">
                  <Upload className="w-3.5 h-3.5 text-amber-700" />
                  <span>Upload a cover image</span>
                </div>
                <label className="flex flex-col items-center justify-center p-3 border-2 border-dashed border-stone-300 rounded-lg bg-white hover:bg-stone-50 cursor-pointer transition">
                  <Upload className="w-5 h-5 text-stone-400 mb-1" />
                  <span className="text-xs font-semibold text-stone-700">
                    Click to browse or drop cover here
                  </span>
                  <span className="text-[10px] text-stone-400 mt-0.5">
                    JPG, PNG, WEBP (Minimum recommended 600×600)
                  </span>
                  <input
                    type="file"
                    id="input-cover-upload"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (7 Cols): Standard Audiobookshelf Metadata Fields */}
        <div className="lg:col-span-7 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Section 1: Book & Author Identity */}
            <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-4">
              <div className="flex items-center space-x-2 border-b border-stone-100 pb-3">
                <BookOpen className="w-4 h-4 text-amber-700" />
                <h3 className="font-bold text-sm text-stone-900">
                  Book title and contributors
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Title */}
                <div className="md:col-span-2">
                  <label
                    htmlFor="meta-title"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Title <span className="text-rose-500">*</span>
                  </label>
                  <input
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
                  <input
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
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      id="meta-author"
                      type="text"
                      value={authorInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.includes(',')) {
                          const parts = val.split(',');
                          parts.slice(0, -1).forEach((part) => handleAddAuthor(part));
                          setAuthorInput(parts[parts.length - 1]);
                        } else {
                          setAuthorInput(val);
                        }
                      }}
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
                      placeholder={authorsList.length === 0 ? "Type author name and press Enter or comma..." : "Add another author..."}
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
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      id="meta-narrator"
                      type="text"
                      value={narratorInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.includes(',')) {
                          const parts = val.split(',');
                          parts.slice(0, -1).forEach((part) => handleAddNarrator(part));
                          setNarratorInput(parts[parts.length - 1]);
                        } else {
                          setNarratorInput(val);
                        }
                      }}
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
                      placeholder={narratorsList.length === 0 ? "Type narrator name and press Enter or comma..." : "Add another narrator..."}
                      className="flex-1 min-w-[140px] bg-transparent border-none text-xs text-stone-900 focus:outline-none placeholder:text-stone-400"
                    />
                  </div>

                  <div className="pt-1 flex items-center text-[11px] text-stone-500">
                    <span>💡 Tip: Type a name and press <kbd className="px-1 py-0.5 bg-stone-100 border border-stone-200 rounded text-[10px] font-mono font-semibold text-stone-700">Enter</kbd> or type a comma <code className="px-1 py-0.5 bg-stone-100 border border-stone-200 rounded text-[10px] font-mono text-stone-700">,</code> to add multiple authors or narrators.</span>
                  </div>

                </div>
              </div>
            </div>

            {/* Section 2: Series & Tagging */}
            <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-4">
              <div className="flex items-center space-x-2 border-b border-stone-100 pb-3">
                <Library className="w-4 h-4 text-amber-700" />
                <h3 className="font-bold text-sm text-stone-900">
                  Series & Taxonomy
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Series Name */}
                <div className="md:col-span-2">
                  <label
                    htmlFor="meta-series"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Series Name
                  </label>
                  <input
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
                  <input
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

                {/* Genres / Tags */}
                <div className="md:col-span-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-1.5 text-xs font-bold text-stone-700">
                      <Tag className="w-3.5 h-3.5 text-stone-400" />
                      <span>Genres & Subject Tags</span>
                      <span className="text-[11px] text-stone-500 font-normal">
                        ({formData.genres.length} selected)
                      </span>
                    </label>
                    <span className="text-[11px] text-stone-500">
                      Goodreads & Audiobookshelf compatible
                    </span>
                  </div>

                  {/* Active genre chips */}
                  <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2.5 bg-stone-50 border border-stone-200 rounded-lg">
                    {formData.genres.map((g) => (
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
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {formData.genres.length === 0 && (
                      <span className="text-xs text-stone-400 italic py-0.5">
                        No tags added yet. Choose from the popular tags below or add a custom tag.
                      </span>
                    )}
                  </div>

                  {/* Custom tag add input & Tag search input */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Add Custom Tag */}
                    <div className="flex space-x-1.5">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddGenre(tagInput);
                          }
                        }}
                        placeholder="Add custom tag (e.g. Space Opera)..."
                        className="flex-1 bg-stone-50/50 border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddGenre(tagInput)}
                        disabled={!tagInput.trim()}
                        className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow-2xs transition cursor-pointer"
                      >
                        + Add
                      </button>
                    </div>

                    {/* Filter Goodreads Tags */}
                    <div className="relative">
                      <input
                        type="text"
                        value={tagFilter}
                        onChange={(e) => setTagFilter(e.target.value)}
                        placeholder="Filter 25 popular Goodreads tags..."
                        className="w-full bg-stone-50/50 border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      {tagFilter && (
                        <button
                          type="button"
                          onClick={() => setTagFilter('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-xs"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Popular Goodreads 25-Tag Chip Cloud */}
                  <div className="p-3 bg-stone-50/70 border border-stone-200/80 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-stone-500 font-medium">
                      <span>Popular Book Tags (Goodreads-inspired • 25 tags):</span>
                      <span>Click to toggle</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {GOODREADS_POPULAR_TAGS.filter((tg) =>
                        tg.toLowerCase().includes(tagFilter.toLowerCase().trim())
                      ).map((tg) => {
                        const active = formData.genres.includes(tg);
                        return (
                          <button
                            key={tg}
                            type="button"
                            onClick={() =>
                              active ? handleRemoveGenre(tg) : handleAddGenre(tg)
                            }
                            className={`text-xs px-2.5 py-1 rounded-full cursor-pointer transition-all border font-medium ${
                              active
                                ? 'bg-amber-600 border-amber-600 text-white shadow-2xs'
                                : 'bg-white hover:bg-stone-100 border-stone-300 text-stone-700'
                            }`}
                          >
                            {active ? `✓ ${tg}` : `+ ${tg}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: Publishing, Language & Standard IDs */}
            <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-4">
              <div className="flex items-center space-x-2 border-b border-stone-100 pb-3">
                <Building className="w-4 h-4 text-amber-700" />
                <h3 className="font-bold text-sm text-stone-900">
                  Publication details and identifiers
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Publisher */}
                <div>
                  <label
                    htmlFor="meta-publisher"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Publisher
                  </label>
                  <input
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

                {/* Published Year */}
                <div>
                  <label
                    htmlFor="meta-year"
                    className="flex items-center space-x-1.5 text-xs font-bold text-stone-700 mb-1"
                  >
                    <Calendar className="w-3.5 h-3.5 text-stone-400" />
                    <span>Published Year</span>
                  </label>
                  <input
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
                  <select
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

                {/* ASIN */}
                <div>
                  <label
                    htmlFor="meta-asin"
                    className="flex items-center space-x-1.5 text-xs font-bold text-stone-700 mb-1"
                  >
                    <Hash className="w-3.5 h-3.5 text-stone-400" />
                    <span>ASIN (Audible / Amazon)</span>
                  </label>
                  <input
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
                  <input
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

                {/* Copyright info */}
                <div>
                  <label
                    htmlFor="meta-copyright"
                    className="block text-xs font-bold text-stone-700 mb-1"
                  >
                    Copyright Notice
                  </label>
                  <input
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
              </div>

              {/* Classification flags: Abridged & Explicit */}
              <div className="pt-2 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center space-x-4">
                  <span className="text-xs font-bold text-stone-700">Work Edition:</span>
                  <label className="flex items-center space-x-2 text-xs text-stone-700 cursor-pointer">
                    <input
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
                    <input
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

                <div className="flex items-center space-x-4">
                  <span className="text-xs font-bold text-stone-700">Advisory:</span>
                  <label className="flex items-center space-x-2 text-xs text-stone-700 cursor-pointer">
                    <input
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
                    <input
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

            {/* Section 4: Synopsis / Description */}
            <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-amber-700" />
                  <h3 className="font-bold text-sm text-stone-900">
                    Book summary
                  </h3>
                </div>
                <span className="text-[11px] text-stone-400 font-mono">
                  {formData.description ? formData.description.length : 0} chars
                </span>
              </div>

              <div>
                <textarea
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
            </div>

            {/* Bottom Form Actions */}
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (job.metadata) setFormData({ ...job.metadata });
                }}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded-lg transition cursor-pointer"
              >
                Discard unsaved changes
              </button>
              <button
                type="submit"
                id="btn-save-metadata-bottom"
                disabled={isSaving}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-sm transition-all cursor-pointer active:scale-98 disabled:bg-stone-400"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? 'Saving...' : 'Save book details'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
