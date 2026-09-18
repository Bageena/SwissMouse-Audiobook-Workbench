import React, { useEffect, useMemo, useState } from 'react';
import { AlignedWord, AudiobookJob, ChapterCandidate, ChapterEntry } from '../types';
import { ChapterAudioPlayer, ActiveAudioTrack } from './ChapterAudioPlayer';
import { buildAlignedWords, getTranscriptWordsNear } from '../utils/wordAlignment';
import {
  Check,
  Plus,
  Trash2,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  ChevronDown,
  FileText,
  Volume2,
  Sliders,
  Play,
  Pause,
  Info,
  Scissors,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

interface Step2Props {
  job: AudiobookJob;
  leadInSeconds: number;
  onSaveChapters: (chapters: ChapterEntry[]) => Promise<void>;
  onNextStep: () => void;
}

// Keeps the complete chapter entry intact so this can also back future drag-and-drop.
export const moveChapter = (list: ChapterEntry[], fromIndex: number, toIndex: number): ChapterEntry[] => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) {
    return list;
  }
  const reordered = [...list];
  const [chapter] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, chapter);
  return reordered;
};

export const Step2ChapterReview: React.FC<Step2Props> = ({
  job,
  leadInSeconds,
  onSaveChapters,
  onNextStep,
}) => {
  const [chapters, setChapters] = useState<ChapterEntry[]>(
    job.chapters.length > 0
      ? [...job.chapters]
      : [{ id: 'c1', start: '00:00:00.000', title: 'Chapter 1' }]
  );

  const [candidates, setCandidates] = useState<ChapterCandidate[]>([...job.candidates]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importCsvText, setImportCsvText] = useState('');

  // Audio preview playback state
  const [activeTrack, setActiveTrack] = useState<ActiveAudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [wordUpdateNotification, setWordUpdateNotification] = useState<string | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [transcriptOffset, setTranscriptOffset] = useState(0);
  const transcriptPageSize = 1200;
  const transcriptWords = job.transcriptWords || [];
  const matchingTranscriptWords = useMemo(() => {
    const query = transcriptSearch.trim().toLowerCase();
    return query ? transcriptWords.filter(word => word.word.toLowerCase().includes(query)) : transcriptWords;
  }, [transcriptWords, transcriptSearch]);
  const visibleTranscriptWords = matchingTranscriptWords.slice(transcriptOffset, transcriptOffset + transcriptPageSize);

  useEffect(() => setTranscriptOffset(0), [transcriptSearch, job.id]);

  useEffect(() => {
    if (!activeTrack) return;
    const wordId = `transcript-word-${Math.round(activeTrack.seconds * 1000)}`;
    document.getElementById(wordId)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeTrack?.seconds]);

  // Helper: Format seconds to HH:MM:SS.mmm
  const formatTs = (seconds: number): string => {
    const s = Math.max(0, seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
  };

  // Helper: Parse HH:MM:SS.mmm to milliseconds
  const parseMs = (ts: string): number => {
    const match = ts.trim().match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (!match) return -1;
    const [, hrs, mins, secs, ms] = match;
    let totalMs = (parseInt(hrs, 10) * 3600 + parseInt(mins, 10) * 60 + parseInt(secs, 10)) * 1000;
    if (ms) {
      totalMs += parseInt((ms + "000").slice(0, 3), 10);
    }
    return totalMs;
  };

  // Validation checker
  const validateChaptersList = (list: ChapterEntry[]): string | null => {
    if (list.length === 0) return 'Chapter list is empty.';

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row.title.trim()) return `Row ${i + 1}: Title cannot be blank.`;
      const ms = parseMs(row.start);
      if (ms === -1) return `Row ${i + 1}: Invalid timestamp '${row.start}'. Must be HH:MM:SS.mmm`;
    }

    const firstMs = parseMs(list[0].start);
    if (firstMs < 0) {
      return 'First chapter has an invalid start timestamp.';
    }

    const totalDurationMs = Math.round(job.totalDurationSeconds * 1000);
    if (firstMs >= totalDurationMs) {
      return 'First chapter start exceeds audio total duration.';
    }

    for (let i = 1; i < list.length; i++) {
      const prevMs = parseMs(list[i - 1].start);
      const currMs = parseMs(list[i].start);
      if (currMs <= prevMs) {
        return `Row ${i + 1} (${list[i].title}): Timestamp ${list[i].start} must be greater than previous row (${list[i - 1].start}).`;
      }
      if (currMs >= totalDurationMs) {
        return `Row ${i + 1} (${list[i].title}): Exceeds audio total duration.`;
      }
    }

    return null;
  };

  const syncPlayerToChapter = (chapter: ChapterEntry, index: number) => {
    const ms = parseMs(chapter.start);
    if (ms === -1) return;
    const seconds = ms / 1000;
    const matched = candidates.find(
      candidate => candidate.candidate_start === chapter.start || candidate.proposed_title.toLowerCase() === chapter.title.toLowerCase()
    );
    const nearbyWords = getTranscriptWordsNear(transcriptWords, seconds);

    setActiveTrack({
      id: chapter.id || `chap-${index}`,
      chapterIndex: index,
      title: chapter.title || `Chapter ${index + 1}`,
      start: chapter.start,
      seconds,
      snippetText: matched
        ? `${matched.context_before ? matched.context_before + ' ' : ''}${matched.matched_text}${matched.context_after ? ' ' + matched.context_after : ''}`
        : undefined,
      contextBefore: matched?.context_before || '',
      matchedText: matched?.matched_text || chapter.title,
      contextAfter: matched?.context_after || '',
      words: nearbyWords.length > 0 ? nearbyWords : matched?.words,
      sourceType: 'chapter',
    });
  };

  // Update a single chapter field
  const handleUpdateChapter = (index: number, field: 'start' | 'title', val: string) => {
    const updated = [...chapters];
    updated[index] = { ...updated[index], [field]: val };
    setChapters(updated);
    if (field === 'start') syncPlayerToChapter(updated[index], index);
    else if (activeTrack?.chapterIndex === index) {
      setActiveTrack(prev => prev ? { ...prev, title: val } : null);
    }
    setSaveSuccess(false);
    setValidationError(validateChaptersList(updated));
  };

  // Add a new blank chapter
  const handleAddChapter = () => {
    const last = chapters[chapters.length - 1];
    let nextStart = '00:10:00.000';
    if (last) {
      const lastMs = parseMs(last.start);
      nextStart = formatTs((lastMs + 600000) / 1000);
    }
    const newChapter = {
      id: `c-${Date.now()}`,
      start: nextStart,
      title: `Chapter ${chapters.length + 1}`,
    };
    const updated = [...chapters, newChapter];
    setChapters(updated);
    syncPlayerToChapter(newChapter, updated.length - 1);
    setSaveSuccess(false);
    setValidationError(validateChaptersList(updated));
  };

  // Remove chapter
  const handleRemoveChapter = (index: number) => {
    if (chapters.length <= 1) {
      alert('You must have at least one chapter.');
      return;
    }
    const updated = chapters.filter((_, i) => i !== index);
    setChapters(updated);
    setSaveSuccess(false);
    setValidationError(validateChaptersList(updated));
  };

  const handleMoveChapter = (fromIndex: number, toIndex: number) => {
    const updated = moveChapter(chapters, fromIndex, toIndex);
    if (updated === chapters) return;
    setChapters(updated);
    setSaveSuccess(false);
    setValidationError(validateChaptersList(updated));
  };

  // Adjust timestamp by offset seconds (+1s, -1s, etc.)
  const handleNudgeTimestamp = (index: number, secondsOffset: number) => {
    const currentMs = parseMs(chapters[index].start);
    if (currentMs === -1) return;
    const newSeconds = Math.max(0, (currentMs / 1000) + secondsOffset);
    handleUpdateChapter(index, 'start', formatTs(newSeconds));
  };

  // Accept candidate directly into active chapter list
  const handleAcceptCandidate = (candidate: ChapterCandidate) => {
    // Check if already in chapters
    const exists = chapters.some(c => c.start === candidate.candidate_start);
    if (exists) {
      alert('A chapter at this timestamp already exists.');
      return;
    }

    const newChapter: ChapterEntry = {
      id: `c-${Date.now()}`,
      start: candidate.candidate_start,
      title: candidate.proposed_title,
      notes: candidate.notes,
    };

    // Insert sorted
    const combined = [...chapters, newChapter].sort((a, b) => parseMs(a.start) - parseMs(b.start));
    setChapters(combined);
    
    // Mark candidate as approved
    setCandidates(prev =>
      prev.map(c => c.candidate_id === candidate.candidate_id ? { ...c, status: 'approved' } : c)
    );
    setSaveSuccess(false);
    setValidationError(validateChaptersList(combined));
  };

  // Toggle audio preview for a chapter entry
  const handleToggleChapterPlay = (chapter: ChapterEntry, index: number) => {
    const trackId = chapter.id || `chap-${index}`;
    if (activeTrack?.id === trackId && isPlaying) {
      setIsPlaying(false);
    } else {
      syncPlayerToChapter(chapter, index);
      setIsPlaying(true);
    }
  };

  // Toggle audio preview for a detected candidate
  const handleToggleCandidatePlay = (candidate: ChapterCandidate) => {
    const ms = parseMs(candidate.candidate_start);
    const seconds = ms === -1 ? 0 : ms / 1000;
    const snippet = `${candidate.context_before ? candidate.context_before + ' ' : ''}${candidate.matched_text}${candidate.context_after ? ' ' + candidate.context_after : ''}`;

    const trackId = `cand-${candidate.candidate_id}`;
    if (activeTrack?.id === trackId && isPlaying) {
      setIsPlaying(false);
    } else {
      setActiveTrack({
        id: trackId,
        title: candidate.proposed_title,
        start: candidate.candidate_start,
        seconds,
        snippetText: snippet,
        contextBefore: candidate.context_before,
        matchedText: candidate.matched_text,
        contextAfter: candidate.context_after,
        words: candidate.words,
        sourceType: 'candidate',
      });
      setIsPlaying(true);
    }
  };

  // Update chapter timestamp when user clicks any word in the player/transcribe view
  const handleWordTimestampSelect = (timestamp: string, word: string, seconds: number) => {
    let targetIdx = activeTrack?.chapterIndex;

    // If active track is candidate, look for chapter matching either candidate start or candidate title
    if (targetIdx === undefined && activeTrack) {
      targetIdx = chapters.findIndex(
        c => c.start === activeTrack.start || c.title.toLowerCase() === activeTrack.title.toLowerCase()
      );
    }

    if (targetIdx !== undefined && targetIdx >= 0) {
      handleUpdateChapter(targetIdx, 'start', timestamp);
      const chapterTitle = chapters[targetIdx].title;
      setWordUpdateNotification(
        `✓ Snapped ${chapterTitle} start timestamp to ${timestamp} from clicked word "${word}"`
      );
      setTimeout(() => setWordUpdateNotification(null), 4000);

    } else if (activeTrack?.sourceType === 'candidate') {
      // Update candidate start timestamp so when clicked "+ Add" it carries the clicked word boundary
      setCandidates(prev =>
        prev.map(c =>
          `cand-${c.candidate_id}` === activeTrack.id
            ? { ...c, candidate_start: timestamp }
            : c
        )
      );
      setWordUpdateNotification(
        `✓ Snapped candidate start to ${timestamp} from clicked word "${word}"`
      );
      setTimeout(() => setWordUpdateNotification(null), 4000);
      setActiveTrack(prev => (prev ? { ...prev, start: timestamp, seconds } : null));
    }
  };

  const handleTranscriptWordSelect = (word: AlignedWord) => {
    let targetIdx = 0;
    chapters.forEach((chapter, index) => {
      if (parseMs(chapter.start) / 1000 <= word.startSeconds) targetIdx = index;
    });
    handleUpdateChapter(targetIdx, 'start', word.start);
    setIsPlaying(true);
    setWordUpdateNotification(`✓ Snapped ${chapters[targetIdx]?.title || 'chapter'} to ${word.start} from actual transcript word "${word.word}"`);
    setTimeout(() => setWordUpdateNotification(null), 4000);
  };

  // Save changes
  const handleSave = async () => {
    const err = validateChaptersList(chapters);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    setIsSaving(true);
    try {
      await onSaveChapters(chapters);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      setValidationError(e.message || 'Failed to save chapters');
    } finally {
      setIsSaving(false);
    }
  };

  // Import CSV text handler
  const handleImportSubmit = () => {
    try {
      const lines = importCsvText.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length < 2) {
        alert('CSV must contain a header and at least one entry.');
        return;
      }
      const imported: ChapterEntry[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(".*?"|[^",\s]+)(?:\s*,\s*)(".*?"|.+)$/);
        if (!match) continue;
        const start = match[1].replace(/^"|"$/g, '').trim();
        const title = match[2].replace(/^"|"$/g, '').trim();
        imported.push({
          id: `imp-${i}-${Date.now()}`,
          start,
          title,
        });
      }

      if (imported.length === 0) {
        alert('No valid chapter lines found.');
        return;
      }

      // If first chapter start is negative or invalid, default to 00:00:00.000
      if (parseMs(imported[0].start) < 0) {
        imported[0].start = '00:00:00.000';
      }

      setChapters(imported);
      setShowImportModal(false);
      setImportCsvText('');
      setValidationError(validateChaptersList(imported));
      setSaveSuccess(false);
    } catch (e: any) {
      alert('Error parsing CSV: ' + e.message);
    }
  };

  const currentError = validationError || validateChaptersList(chapters);

  return (
    <div className="space-y-6">
      {!!job.existingChapters?.length && <details className="border rounded-lg p-4 bg-white">
        <summary>View chapters already in the source file ({job.existingChapters.length})</summary>
        <p className="text-sm">Only the chapter list you review and save below will be exported.</p>
        {job.existingChapters.map(c => <p className="text-sm" key={c.id}>{c.start} — {c.title}</p>)}
        <button className="underline text-sm" title="Replace the current review list with chapters read from the source file" onClick={() => setChapters(job.existingChapters!.map(c => ({...c})))}>Use these chapters as my starting point</button>
      </details>}
      {/* Step Header Banner */}
      <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                2
              </span>
              <h2 className="text-lg font-bold text-stone-900">
                Review chapter starts and names
              </h2>
            </div>
            <p className="text-sm text-stone-600 mt-1 max-w-3xl">
              Check each chapter start and title before exporting. Click a word in the transcript to set a precise start time, or edit the list directly. Chapters organize the recording; they never cut out audio.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              id="btn-save-chapters"
              onClick={handleSave}
              disabled={isSaving}
              className={`flex items-center space-x-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-all cursor-pointer ${
                saveSuccess
                  ? 'bg-emerald-600'
                  : 'bg-amber-600 hover:bg-amber-500 active:scale-98'
              }`}
            >
              {isSaving ? (
                <span>Saving...</span>
              ) : saveSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Chapters saved</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save chapter list</span>
                </>
              )}
            </button>

            <button
              id="btn-next-build"
              onClick={() => {
                if (currentError) {
                  alert(currentError);
                  return;
                }
                handleSave().then(() => onNextStep());
              }}
              disabled={!!currentError}
              className="flex items-center space-x-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold bg-stone-900 hover:bg-stone-800 text-stone-100 disabled:opacity-40 transition-colors cursor-pointer"
            >
              <span>Save and add book details</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Validation Alert if errors exist */}
        {currentError && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-center space-x-2 text-red-700 text-xs font-medium">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>Fix this before continuing: {currentError}</span>
          </div>
        )}
      </div>

      {/* Word Snapping Notification Toast/Banner */}
      {wordUpdateNotification && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 flex items-center justify-between text-emerald-900 text-xs font-medium shadow-xs animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{wordUpdateNotification}</span>
          </div>
          <button
            onClick={() => setWordUpdateNotification(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold px-1.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Interactive Chapter Audio Audition Player */}
      <ChapterAudioPlayer
        activeTrack={activeTrack}
        isPlaying={isPlaying}
        onPlay={(track) => {
          setActiveTrack(track);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onStop={() => {
          setIsPlaying(false);
          setActiveTrack(null);
        }}
        onWordClick={handleWordTimestampSelect}
        totalDurationSeconds={job.totalDurationSeconds}
        audioSrc={`/api/jobs/${job.id}/audio-preview`}
      />

      {/* Main Split Workbench: Left transcript, Right Chapters Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col (5 cols): complete persisted WhisperX transcript */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden flex flex-col h-[750px]">
            <div className="p-4 border-b border-stone-200 bg-stone-50/70 flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-amber-600" />
                  <h3 className="font-semibold text-sm text-stone-900">
                    Transcript ({matchingTranscriptWords.length.toLocaleString()} words)
                  </h3>
                </div>
                <p className="text-xs text-stone-500 mt-0.5 font-mono">
                  Click a word to preview that moment and set the nearest chapter start
                </p>
              </div>

              <input
                value={transcriptSearch}
                onChange={(event) => setTranscriptSearch(event.target.value)}
                placeholder="Find a word…"
                className="w-36 px-2 py-1 text-xs rounded border border-stone-300 bg-white"
              />
            </div>

            <div className="flex flex-wrap content-start gap-1 overflow-y-auto flex-1 p-3 text-xs leading-relaxed">
              {visibleTranscriptWords.map((word, index) => {
                const isHeading = candidates.some(candidate => word.startSeconds >= parseMs(candidate.candidate_start) / 1000 && word.startSeconds <= parseMs(candidate.candidate_end) / 1000);
                const isActive = Math.abs((activeTrack?.seconds ?? -1) - word.startSeconds) < 0.001;
                return (
                  <button
                    id={`transcript-word-${Math.round(word.startSeconds * 1000)}`}
                    key={`${word.startSeconds}-${index}`}
                    type="button"
                    onClick={() => handleTranscriptWordSelect(word)}
                    title={`Listen from ${word.start}; use it to place a chapter start`}
                    className={`px-1 py-0.5 rounded cursor-pointer transition-colors ${isActive ? 'bg-amber-500 text-stone-950 font-bold' : isHeading ? 'bg-amber-100 text-amber-950 font-semibold ring-1 ring-amber-300' : 'text-stone-700 hover:bg-stone-200'}`}
                  >
                    {word.word}
                  </button>
                );
              })}
              {visibleTranscriptWords.length === 0 && <p className="p-6 text-stone-500">No saved word-level transcript is available yet. Complete Step 1 once to create it.</p>}
            </div>
            {matchingTranscriptWords.length > transcriptPageSize && (
              <div className="px-3 py-2 border-t border-stone-200 bg-stone-50 flex items-center justify-between text-[11px] text-stone-600">
                <span>Words {transcriptOffset + 1}–{Math.min(transcriptOffset + transcriptPageSize, matchingTranscriptWords.length)} of {matchingTranscriptWords.length}</span>
                <div className="flex gap-1">
                  <button type="button" disabled={transcriptOffset === 0} onClick={() => setTranscriptOffset(Math.max(0, transcriptOffset - transcriptPageSize))} className="px-2 py-1 border rounded bg-white disabled:opacity-40">Earlier</button>
                  <button type="button" disabled={transcriptOffset + transcriptPageSize >= matchingTranscriptWords.length} onClick={() => setTranscriptOffset(transcriptOffset + transcriptPageSize)} className="px-2 py-1 border rounded bg-white disabled:opacity-40">Later</button>
                </div>
              </div>
            )}

            {/* Retained candidate controls are hidden: the transcript above is now the review source. */}
            {false && <div className="divide-y divide-stone-100 overflow-y-auto flex-1 p-3 space-y-3">
              {candidates.map((cand) => {
                const isAdded = chapters.some(c => c.start === cand.candidate_start);
                const confNum = parseFloat(cand.confidence) || 0.9;
                const isCandActive = activeTrack?.id === `cand-${cand.candidate_id}`;
                const isCandPlaying = isCandActive && isPlaying;

                return (
                  <div
                    key={cand.candidate_id}
                    className={`p-3.5 rounded-lg border transition-all text-xs ${
                      isCandPlaying
                        ? 'bg-amber-50/70 border-amber-400 shadow-xs'
                        : isAdded
                        ? 'bg-emerald-50/40 border-emerald-200/80'
                        : 'bg-white border-stone-200 hover:border-amber-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60">
                          {cand.candidate_start}
                        </span>
                        <span className="font-semibold text-stone-800">
                          {cand.proposed_title}
                        </span>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <button
                          id={`btn-listen-cand-${cand.candidate_id}`}
                          onClick={() => handleToggleCandidatePlay(cand)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center space-x-1 transition-all cursor-pointer ${
                            isCandPlaying
                              ? 'bg-amber-500 text-stone-950 font-bold shadow-xs animate-pulse ring-1 ring-amber-400'
                              : isCandActive
                              ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                              : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                          }`}
                          title={`Listen to candidate preview at ${cand.candidate_start}`}
                        >
                          {isCandPlaying ? (
                            <>
                              <Pause className="w-3 h-3 fill-current" />
                              <span>Listening</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current" />
                              <span>Listen</span>
                            </>
                          )}
                        </button>

                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                            confNum >= 0.95
                              ? 'bg-emerald-100 text-emerald-800'
                              : confNum >= 0.85
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-stone-100 text-stone-700'
                          }`}
                          title="Speech-recognition confidence score"
                        >
                          {(confNum * 100).toFixed(0)}% conf
                        </span>

                        {isAdded ? (
                          <span className="inline-flex items-center text-emerald-700 font-medium text-[11px]">
                            <Check className="w-3.5 h-3.5 mr-0.5" /> Added
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAcceptCandidate(cand)}
                            className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium text-[11px] cursor-pointer"
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Context Quote with clickable words */}
                    {(() => {
                      const ms = parseMs(cand.candidate_start);
                      const baseSec = ms === -1 ? 0 : ms / 1000;
                      const { words, matchedStartIndex, matchedEndIndex } = buildAlignedWords(
                        cand.context_before,
                        cand.matched_text,
                        cand.context_after,
                        baseSec
                      );

                      return (
                        <div className="bg-stone-50 rounded p-2 border border-stone-100 text-stone-600 mt-2 text-[11px] leading-relaxed">
                          <div className="text-[10px] text-stone-400 font-mono flex items-center justify-between pb-1 mb-1 border-b border-stone-200/50">
                            <span>Transcription Segment:</span>
                            <span className="text-amber-700 font-sans font-medium">Click word to snap</span>
                          </div>
                          <div className="flex flex-wrap gap-1 items-baseline">
                            {words.map((w, idx) => {
                              const isMatched = idx >= matchedStartIndex && idx <= matchedEndIndex;
                              return (
                                <button
                                  key={`${w.start}-${idx}`}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleWordTimestampSelect(w.start, w.word, w.startSeconds);
                                    setActiveTrack({
                                      id: `cand-${cand.candidate_id}`,
                                      title: cand.proposed_title,
                                      start: w.start,
                                      seconds: w.startSeconds,
                                      snippetText: `${cand.context_before} ${cand.matched_text} ${cand.context_after}`,
                                      contextBefore: cand.context_before,
                                      matchedText: cand.matched_text,
                                      contextAfter: cand.context_after,
                                      words: cand.words,
                                      sourceType: 'candidate',
                                    });
                                  }}
                                  className={`cursor-pointer px-1 py-0.5 rounded transition-all text-[11px] ${
                                    isMatched
                                      ? 'font-bold text-amber-900 bg-amber-100/90 hover:bg-amber-300 border border-amber-300/80 shadow-2xs'
                                      : 'text-stone-700 hover:bg-stone-200 hover:text-stone-950'
                                  }`}
                                  title={`Click to snap timestamp to ${w.start} ("${w.word}")`}
                                >
                                  {w.word}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {cand.notes && (
                      <div className="mt-1 text-[10px] text-stone-400 italic">
                        {cand.notes}
                      </div>
                    )}
                  </div>
                );
              })}

              {candidates.length === 0 && (
                <div className="p-8 text-center text-stone-400 text-xs">
                  No candidates generated yet. Run Step 1 to detect chapter markers.
                </div>
              )}
            </div>}
          </div>
        </div>

        {/* Right Col (7 cols): Active Editable Chapters Table */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden flex flex-col h-[750px]">
            {/* Table Action Bar */}
            <div className="p-4 border-b border-stone-200 bg-stone-50/70 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-stone-800" />
                  <h3 className="font-semibold text-sm text-stone-900">
                    Chapters to export ({chapters.length})
                  </h3>
                </div>
                <p className="text-xs text-stone-500 mt-0.5 font-mono">
                  {job.name}-chapters.csv
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  id="btn-import-csv"
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center space-x-1 px-2.5 py-1 text-xs rounded border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 shadow-2xs font-medium cursor-pointer"
                  title="Paste a chapter list from a CSV file"
                >
                  <Upload className="w-3.5 h-3.5 text-stone-500" />
                  <span>Paste CSV</span>
                </button>

                <a
                  href={`/api/jobs/${job.id}/export/chapters-csv`}
                  download
                  className="flex items-center space-x-1 px-2.5 py-1 text-xs rounded border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 shadow-2xs font-medium"
                  title="Download this chapter list as a CSV file"
                >
                  <Download className="w-3.5 h-3.5 text-stone-500" />
                  <span>Download CSV</span>
                </a>

                <button
                  id="btn-add-chapter-row"
                  onClick={handleAddChapter}
                  className="flex items-center space-x-1 px-2.5 py-1 text-xs rounded bg-stone-900 hover:bg-stone-800 text-stone-100 font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add chapter</span>
                </button>
              </div>
            </div>

            {/* Validation Rule Hints */}
            <div className="px-4 py-2 bg-amber-50/60 border-b border-amber-100 text-[11px] text-amber-900 flex items-center justify-between">
              <span>
                Chapter starts must be in time order. The first chapter starts at 00:00:00.000.
              </span>
              <span className="font-mono text-stone-500">Lead-in: {leadInSeconds}s</span>
            </div>

            {/* Chapters Table */}
            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 uppercase tracking-wider font-semibold">
                    <th className="py-2 px-2 w-8">#</th>
                    <th className="py-2 px-1 w-14 text-center">Listen</th>
                    <th className="py-2 px-2 w-36">Start (HH:MM:SS.mmm)</th>
                    <th className="py-2 px-2">Chapter Title</th>
                    <th className="py-2 px-2 w-28 text-right">Nudge</th>
                    <th className="py-2 px-1 w-20 text-center">Move</th>
                    <th className="py-2 px-1 w-10 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {chapters.map((chap, idx) => {
                    const isFirst = idx === 0;
                    const chapMs = parseMs(chap.start);
                    const isValidTime = chapMs !== -1;
                    const isNonNegative = isValidTime && chapMs >= 0;
                    const isThisTrack = activeTrack?.id === (chap.id || `chap-${idx}`);
                    const isThisPlaying = isThisTrack && isPlaying;
                    
                    return (
                      <tr
                        key={chap.id || idx}
                        className={`hover:bg-stone-50 transition-colors ${
                          isThisPlaying
                            ? 'bg-amber-50/80 ring-1 ring-amber-300'
                            : !isNonNegative
                            ? 'bg-red-50/50'
                            : ''
                        }`}
                      >
                        <td className="py-2 px-2 font-mono text-stone-400 font-semibold">
                          {idx + 1}
                        </td>

                        <td className="py-2 px-1 text-center">
                          <button
                            id={`btn-play-chapter-${idx}`}
                            onClick={() => handleToggleChapterPlay(chap, idx)}
                            className={`w-7 h-7 rounded-md inline-flex items-center justify-center transition-all cursor-pointer ${
                              isThisPlaying
                                ? 'bg-amber-500 text-stone-950 font-bold shadow-xs animate-pulse ring-2 ring-amber-400'
                                : isThisTrack
                                ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                                : 'bg-stone-100 text-stone-700 hover:bg-amber-100 hover:text-amber-900'
                            }`}
                            title={
                              isThisPlaying
                                ? `Pause preview of ${chap.title}`
                                : `Listen to ${chap.title} at ${chap.start} to verify accuracy`
                            }
                          >
                            {isThisPlaying ? (
                              <Pause className="w-3.5 h-3.5 fill-current" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                          </button>
                        </td>

                        <td className="py-2 px-2">
                          <div className="space-y-0.5">
                            <input
                              type="text"
                              value={chap.start}
                              onChange={(e) => handleUpdateChapter(idx, 'start', e.target.value)}
                              className={`w-full px-2 py-1 font-mono rounded text-xs border ${
                                isNonNegative
                                  ? 'bg-white border-stone-300 text-stone-900 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                                  : 'bg-red-50 border-red-300 text-red-700'
                              }`}
                              placeholder="00:00:00.000"
                            />
                          </div>
                        </td>

                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={chap.title}
                            onChange={(e) => handleUpdateChapter(idx, 'title', e.target.value)}
                            className="w-full px-2 py-1 rounded text-xs border border-stone-300 bg-white text-stone-900 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                            placeholder="Chapter title"
                          />
                        </td>

                        <td className="py-2 px-2 text-right">
                          <div className="flex items-center justify-end space-x-1">
                            <button
                              onClick={() => handleNudgeTimestamp(idx, -1)}
                              disabled={chapMs <= 0}
                              className="px-1.5 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-700 font-mono text-[10px] disabled:opacity-30 cursor-pointer"
                              title="Nudge 1 second earlier"
                            >
                              -1s
                            </button>
                            <button
                              onClick={() => handleNudgeTimestamp(idx, 1)}
                              className="px-1.5 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-700 font-mono text-[10px] cursor-pointer"
                              title="Nudge 1 second later"
                            >
                              +1s
                            </button>
                          </div>
                        </td>

                        <td className="py-2 px-1 text-center">
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              onClick={() => handleMoveChapter(idx, idx - 1)}
                              disabled={isFirst}
                              className="p-1 text-stone-400 hover:text-amber-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                              title="Move Up"
                              aria-label={`Move ${chap.title || `chapter ${idx + 1}`} up`}
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleMoveChapter(idx, idx + 1)}
                              disabled={idx === chapters.length - 1}
                              className="p-1 text-stone-400 hover:text-amber-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                              title="Move Down"
                              aria-label={`Move ${chap.title || `chapter ${idx + 1}`} down`}
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                        <td className="py-2 px-1 text-center">
                          <button
                            onClick={() => handleRemoveChapter(idx)}
                            className="p-1 text-stone-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                            title="Remove Chapter"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Small information text at the bottom stating these are the chapters that will be used */}
            <div className="px-4 py-3 bg-stone-50/90 border-t border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-stone-600">
              <div className="flex items-center space-x-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-medium text-stone-700">
                  These are the chapters that will be used.
                </span>
              </div>
              <div className="flex items-center space-x-2 text-[11px] text-stone-400 font-mono">
                <span>Full audio preserved: 00:00:00 to {formatTs(job.totalDurationSeconds)}</span>
                <span>{chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Import CSV Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-stone-900">
                Import Chapter CSV ({job.name}-chapters.csv)
              </h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-stone-400 hover:text-stone-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-stone-600">
              Paste the CSV content with <code>start</code> and <code>title</code> headers (e.g. from your spreadsheet or text editor).
            </p>

            <textarea
              rows={8}
              value={importCsvText}
              onChange={(e) => setImportCsvText(e.target.value)}
              placeholder={`start,title\n00:00:00.000,Chapter 1: The Beginning\n00:14:22.500,Chapter 2: The Departure\n00:43:10.200,Chapter 3: Across the Sea`}
              className="w-full font-mono text-xs p-3 border border-stone-300 rounded-lg bg-stone-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            />

            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 rounded text-xs border border-stone-300 text-stone-700 hover:bg-stone-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                className="px-3 py-1.5 rounded text-xs bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer"
              >
                Apply CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
