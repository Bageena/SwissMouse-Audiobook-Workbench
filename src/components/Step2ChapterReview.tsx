import { ChapterResetDialog } from './ChapterResetDialog';
import { ChapterSuggestions } from './ChapterSuggestions';
import { candidateChapter } from '../utils/chapterSuggestions';
import { PreviewPanel } from './PreviewPanel';
import { chapterActivity, defaultReviewChapters } from '../utils/chapterReviewActivity';
import { createPortal } from 'react-dom';
import { ToolbarPopover } from './ToolbarPopover';
import { readStored, writeStored } from '../utils/libraryWorkspace';
import { ResizableColumns } from './ResizableColumns';
import { DesktopWindow } from './DesktopWorkspace';
import { X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlignedWord, AudiobookJob, ChapterCandidate, ChapterEntry } from '../types';
import { ChapterAudioPlayer, ActiveAudioTrack } from './ChapterAudioPlayer';
import { BulkChapterEditor } from './BulkChapterEditor';
import { cleanChapterTitles, undoChapterTitleCleanup, type TitleCleanupUndo } from '../utils/chapterTitles';
import { planChapterExport } from '../utils/chapterExport';
import { buildAlignedWords, buildTranscriptSearchIndex, searchTranscriptWords, findClosestTranscriptWordIndex, findTranscriptWordIndex, getTranscriptWordsNear, parseTimestampToMs, revealTranscriptWord, transcriptPageOffset } from '../utils/wordAlignment';
import { TranscriptTimingWarning } from './TranscriptTimingWarning';
import { applyChapterNumberFormat, applyDefaultChapterEnds, formatChapterTitle, formatTimestampMs, getSessionChapterNumberFormat, isIncompleteChapter, prepareChapters, validateChapterEntries, type ChapterNumberFormat } from '../utils/chapters';
import { Save, Loader2, Check, Plus, Trash2, AlertTriangle, CheckCircle2, Sparkles, ArrowRight, FileText, Play, Pause, Info, ArrowUp, ArrowDown, GripVertical, Pencil, RotateCcw } from 'lucide-react';

interface Step2Props {
  actionHost?: HTMLElement | null;
  job: AudiobookJob;
  onSaveChapters: (chapters: ChapterEntry[]) => Promise<void>;
  draftChapters?: ChapterEntry[];
  onDraftChange: (jobId: string, chapters: ChapterEntry[], hasEdits: boolean) => void;
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
  actionHost,
  job,
  onSaveChapters,
  draftChapters,
  onDraftChange,
  onNextStep,
}) => {
  const transcriptWords = job.transcriptWords || [];
  const sourceChapters = (draftChapters || job.chapters).length > 0
    ? [...(draftChapters || job.chapters)]
    : [{ id: 'c1', start: '00:00:00.000', title: 'Chapter 1', headingType: 'numbered_chapter' as const, chapterNumber: 1 }];
  const [chapterNumberFormat, setChapterNumberFormat] = useState<ChapterNumberFormat>(() => getSessionChapterNumberFormat(job.id));
  const [chapters, setChapters] = useState<ChapterEntry[]>(() =>
    applyChapterNumberFormat(prepareChapters(sourceChapters, job.totalDurationSeconds, chapterNumberFormat), chapterNumberFormat).map(chapter => ({
      ...chapter,
      transcriptWordIndex: chapter.timingSource === 'recheck' || chapter.timingSource === 'source' ? undefined : chapter.transcriptWordIndex ?? findClosestTranscriptWordIndex(
        transcriptWords,
        Math.max(0, parseTimestampToMs(chapter.start)) / 1000,
      ),
    }))
  );

  const [candidates, setCandidates] = useState<ChapterCandidate[]>(job.candidates.map(candidate => ({
    ...candidate,
    transcriptWordIndex: candidate.timingSource === 'recheck' || candidate.timingSource === 'source' ? undefined : candidate.transcriptWordIndex ?? findClosestTranscriptWordIndex(
      transcriptWords,
      Math.max(0, parseTimestampToMs(candidate.candidate_start)) / 1000,
    ),
  })));
  const baseline = useMemo(() => defaultReviewChapters(job), [job]);
  const [savedNumberFormat, setSavedNumberFormat] = useState(chapterNumberFormat);
  const savedDisplayChapters = useMemo(() => {
    const source = job.chapters.length ? job.chapters : [{ id: 'c1', start: '00:00:00.000', title: 'Chapter 1', headingType: 'numbered_chapter' as const, chapterNumber: 1 }];
    return applyChapterNumberFormat(prepareChapters(source, job.totalDurationSeconds, savedNumberFormat), savedNumberFormat);
  }, [job.chapters, job.totalDurationSeconds, savedNumberFormat]);
  // The note is a live list of pending edits, not a history of already saved work.
  const activity = useMemo(() => chapterActivity(savedDisplayChapters, chapters), [savedDisplayChapters, chapters]);
  const [resetRequested, setResetRequested] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [titleCleanupUndo, setTitleCleanupUndo] = useState<TitleCleanupUndo>([]);
  const [bulkEditUndo, setBulkEditUndo] = useState<TitleCleanupUndo>([]);
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [editorPosition] = useState(() => readStored<{ chapterId?: string; search?: string; offset?: number; transcriptScroll?: number; chapterScroll?: number; selectedIds?: string[] }>(`swissmouse-chapter-position-${job.id}`, {}, true) || {});
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(() => new Set(Array.isArray(editorPosition.selectedIds) ? editorPosition.selectedIds.filter(id => chapters.some(chapter => chapter.id === id)) : []));
  const currentSelection = useMemo(() => new Set(chapters.filter(chapter => selectedChapterIds.has(chapter.id)).map(chapter => chapter.id)), [chapters, selectedChapterIds]);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const hasUnsavedChanges = activity.length > 0;
  useEffect(() => { onDraftChange(job.id, chapters, hasUnsavedChanges); }, [job.id, chapters, hasUnsavedChanges, onDraftChange]);
  const [draggedChapterId, setDraggedChapterId] = useState<string | null>(null);

  // Audio preview playback state
  const [activeTrack, setActiveTrack] = useState<ActiveAudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const [editingChapterId, setEditingChapterId] = useState<string | null>(typeof editorPosition.chapterId === 'string' && chapters.some(chapter => chapter.id === editorPosition.chapterId) ? editorPosition.chapterId : null);
  const editingChapterIndex = chapters.findIndex(chapter => chapter.id === editingChapterId);
  const editingChapter = chapters[editingChapterIndex];
  const [wordUpdateNotification, setWordUpdateNotification] = useState<string | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState(typeof editorPosition.search === 'string' ? editorPosition.search : '');
  const [transcriptOffset, setTranscriptOffset] = useState(Number.isInteger(editorPosition.offset) && editorPosition.offset! >= 0 ? editorPosition.offset! : 0);
  const [transcriptSelection, setTranscriptSelection] = useState<{ wordIndex: number; requestId: number } | null>(null);
  const selectedTranscriptWordIndex = transcriptSelection?.wordIndex ?? null;
  const transcriptWordRefs = useRef(new Map<number, HTMLButtonElement>());
  const transcriptPane = useRef<HTMLDivElement>(null);
  const chapterPane = useRef<HTMLDivElement>(null);
  const positionRef = useRef(editorPosition);
  useEffect(() => {
    positionRef.current = { ...positionRef.current, chapterId: editingChapterId || undefined, search: transcriptSearch, offset: transcriptOffset, selectedIds: [...selectedChapterIds] };
    writeStored(`swissmouse-chapter-position-${job.id}`, positionRef.current, true);
  }, [job.id, editingChapterId, transcriptSearch, transcriptOffset, selectedChapterIds]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (transcriptPane.current) transcriptPane.current.scrollTop = Math.max(0, Number(editorPosition.transcriptScroll) || 0);
      if (chapterPane.current) chapterPane.current.scrollTop = Math.max(0, Number(editorPosition.chapterScroll) || 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [job.id]);
  const rememberPane = (pane: 'transcriptScroll' | 'chapterScroll', value: number) => {
    positionRef.current = { ...positionRef.current, [pane]: value };
    writeStored(`swissmouse-chapter-position-${job.id}`, positionRef.current, true);
  };
  const seekRevision = useRef(0);
  const selectedTimelineTime = useRef<number | null>(null);
  const transcriptPageSize = 1200;
  const transcriptSearchIndex = useMemo(() => buildTranscriptSearchIndex(transcriptWords), [transcriptWords]);
  const matchingTranscriptWords = useMemo(() => searchTranscriptWords(transcriptSearchIndex, transcriptSearch), [transcriptSearchIndex, transcriptSearch]);
  useEffect(() => { const maxOffset = Math.max(0, Math.floor((matchingTranscriptWords.length - 1) / transcriptPageSize) * transcriptPageSize); if (transcriptOffset > maxOffset) setTranscriptOffset(maxOffset); }, [matchingTranscriptWords.length, transcriptOffset]);
  const visibleTranscriptWords = matchingTranscriptWords.slice(transcriptOffset, transcriptOffset + transcriptPageSize);
  const headingWordIndexes = useMemo(() => {
    const indexes = new Set<number>();
    for (const candidate of candidates) {
      const start = findTranscriptWordIndex(transcriptWords, parseTimestampToMs(candidate.candidate_start) / 1000);
      const end = findTranscriptWordIndex(transcriptWords, parseTimestampToMs(candidate.candidate_end) / 1000 + 0.000001);
      for (let i = start; i < end; i++) indexes.add(i);
    }
    return indexes;
  }, [transcriptWords, candidates]);

  useEffect(() => {
    setTranscriptSelection(null);
  }, [job.id]);

  useEffect(() => {
    if (selectedTranscriptWordIndex === null) return;
    const element = transcriptWordRefs.current.get(selectedTranscriptWordIndex);
    if (element && transcriptPane.current) revealTranscriptWord(transcriptPane.current, element);
  }, [transcriptSelection, transcriptOffset, transcriptSearch]);

  const formatTs = (seconds: number): string => formatTimestampMs(seconds * 1000);
  const parseMs = parseTimestampToMs;

  const validateChaptersList = (list: ChapterEntry[]): string | null => validateChapterEntries(list, job.totalDurationSeconds);

  const navigateToTranscriptWord = (transcriptWordIndex: number, preserveSearch = false) => {
    if (transcriptWordIndex < 0 || transcriptWordIndex >= transcriptWords.length) return;
    // Chapter navigation uses the complete persisted transcript. A search filter
    // may exclude the target, so clear it before rendering the destination page.
    if (preserveSearch && transcriptSearch.trim()) {
      const matchIndex = matchingTranscriptWords.findIndex(entry => entry.transcriptWordIndex === transcriptWordIndex);
      if (matchIndex >= 0) setTranscriptOffset(transcriptPageOffset(matchIndex, transcriptPageSize));
    } else {
      setTranscriptSearch('');
      setTranscriptOffset(transcriptPageOffset(transcriptWordIndex, transcriptPageSize));
    }
    setTranscriptSelection(previous => previous?.wordIndex === transcriptWordIndex ? previous : ({
      wordIndex: transcriptWordIndex,
      requestId: (previous?.requestId ?? 0) + 1,
    }));
  };

  const resolveTranscriptWordIndex = (seconds: number, preferredIndex?: number) => {
    if (preferredIndex !== undefined && preferredIndex >= 0 && preferredIndex < transcriptWords.length) return preferredIndex;
    return findClosestTranscriptWordIndex(transcriptWords, seconds);
  };

  const syncPlayerToChapter = (chapter: ChapterEntry, index: number, timestamp = chapter.start, preserveSearch = false) => {
    setEditingChapterId(chapter.id);
    const ms = parseMs(timestamp);
    if (ms === -1) return;
    const seconds = ms / 1000;
    const matched = candidates.find(
      candidate => candidate.candidate_start === chapter.start || candidate.proposed_title.toLowerCase() === chapter.title.toLowerCase()
    );
    const exactCandidate = candidates.find(candidate => candidate.candidate_start === chapter.start);
    const transcriptWordIndex = resolveTranscriptWordIndex(
      seconds,
      timestamp === chapter.start ? chapter.transcriptWordIndex ?? exactCandidate?.transcriptWordIndex : undefined,
    );
    navigateToTranscriptWord(transcriptWordIndex, preserveSearch);
    selectedTimelineTime.current = seconds;
    const nearbyWords = getTranscriptWordsNear(transcriptWords, seconds);

    setActiveTrack({
      id: chapter.id || `chap-${index}`,
      seekRevision: ++seekRevision.current,
      chapterIndex: index,
      title: chapter.title || `Chapter ${index + 1}`,
      start: timestamp,
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
  const handleUpdateChapter = (index: number, field: 'start' | 'end' | 'title', val: string, selectedWordIndex?: number, preserveSearch = false) => {
    if (!chapters[index]) return;
    const updated = [...chapters];
    const timestampMs = field === 'start' ? parseMs(val) : -1;
    updated[index] = {
      ...updated[index],
      [field]: val,
      ...(field === 'start' ? { startManuallyEdited: true, isMissing: updated[index].isMissing ? timestampMs < 0 : false } : {}),
      ...(field === 'end' ? { endManuallyEdited: true } : {}),
      ...(field === 'title' ? { titleManuallyEdited: true } : {}),
      ...(field === 'start' && timestampMs >= 0
        ? { transcriptWordIndex: resolveTranscriptWordIndex(timestampMs / 1000, selectedWordIndex) }
        : {}),
    };
    const recalculated = field === 'start' && timestampMs >= 0 ? applyDefaultChapterEnds(updated, job.totalDurationSeconds) : updated;
    setChapters(recalculated);
    if (field === 'start' && timestampMs >= 0) syncPlayerToChapter(recalculated[index], index, val, preserveSearch);
    else if (field === 'end' && parseMs(val) >= 0) syncPlayerToChapter(recalculated[index], index, val);
    else if (field === 'title' && activeTrack?.id === updated[index].id) {
      setActiveTrack(prev => prev ? { ...prev, title: val } : null);
    }
    setSaveSuccess(false);
    setValidationError(validateChaptersList(recalculated));
  };

  const handleCleanTitles = (undo = false) => {
    const result = undo ? { chapters: undoChapterTitleCleanup(chapters, titleCleanupUndo), undo: [] } : cleanChapterTitles(chapters);
    if (!undo && !result.undo.length) return;
    setChapters(result.chapters);
    setTitleCleanupUndo(result.undo);
    setSaveSuccess(false);
    setActiveTrack(current => {
      const chapter = result.chapters.find(item => item.id === current?.id);
      return current && chapter ? { ...current, title: chapter.title } : current;
    });
    setValidationError(validateChaptersList(result.chapters));
  };

  const handleBulkApply = (updated: ChapterEntry[], changes: TitleCleanupUndo) => {
    if (!changes.length) return;
    setChapters(updated);
    setBulkEditUndo(changes);
    setShowBulkEditor(false);
    setSaveSuccess(false);
    setActiveTrack(current => {
      const chapter = updated.find(item => item.id === current?.id);
      return current && chapter ? { ...current, title: chapter.title } : current;
    });
    setValidationError(validateChaptersList(updated));
  };

  const handleUndoBulkEdit = () => {
    const updated = undoChapterTitleCleanup(chapters, bulkEditUndo);
    setChapters(updated);
    setBulkEditUndo([]);
    setSaveSuccess(false);
    setActiveTrack(current => {
      const chapter = updated.find(item => item.id === current?.id);
      return current && chapter ? { ...current, title: chapter.title } : current;
    });
    setValidationError(validateChaptersList(updated));
  };

  const selectMissingChapter = (chapter: ChapterEntry, index: number) => {
    setEditingChapterId(chapter.id);
    if (activeTrack) return; // Keep a position the user has already located.
    let before = index - 1, after = index + 1;
    while (before >= 0 && parseMs(chapters[before].start) < 0) before--;
    while (after < chapters.length && parseMs(chapters[after].start) < 0) after++;
    const beforeMs = before >= 0 ? parseMs(chapters[before].start) : 0;
    const afterMs = after < chapters.length ? parseMs(chapters[after].start) : beforeMs;
    const fraction = after < chapters.length ? (index - before) / (after - before) : 0;
    const previewMs = Math.round(beforeMs + (afterMs - beforeMs) * fraction);
    syncPlayerToChapter(chapter, index, formatTimestampMs(previewMs));
    setIsPlaying(false);
  };

  const selectChapterForEditing = (chapter: ChapterEntry, index: number) => {
    if (isIncompleteChapter(chapter)) selectMissingChapter(chapter, index);
    else if (!activeTrack) syncPlayerToChapter(chapter, index);
    else setEditingChapterId(chapter.id);
  };

  // Explicit player captures use the actual media position, including playback.
  const handleAddChapter = (seconds?: number) => {
    if (seconds !== undefined && !Number.isFinite(seconds)) return;
    const last = chapters[chapters.length - 1];
    let nextStart = '00:10:00.000';
    if (seconds !== undefined) {
      nextStart = formatTimestampMs(seconds * 1000);
    } else if (selectedTimelineTime.current !== null) {
      nextStart = formatTimestampMs(Math.round(selectedTimelineTime.current * 1000));
    } else if (last) {
      const lastMs = parseMs(last.start);
      nextStart = formatTimestampMs(Math.min(Math.max(0, lastMs + 600000), Math.round(job.totalDurationSeconds * 1000) - 1));
    }
    const newStartMs = parseMs(nextStart);
    if (chapters.some(chapter => parseMs(chapter.start) === newStartMs)) {
      setValidationError('A chapter already starts at the selected timeline position. Choose another position.');
      return;
    }
    const insertAt = chapters.findIndex(chapter => parseMs(chapter.start) > newStartMs);
    const index = insertAt < 0 ? chapters.length : insertAt;
    const newChapter = {
      id: `c-${Date.now()}`,
      start: nextStart,
      title: formatChapterTitle(index + 1, chapterNumberFormat),
      chapterNumber: index + 1,
      manuallyInserted: true,
      transcriptWordIndex: resolveTranscriptWordIndex(parseMs(nextStart) / 1000),
    };
    const updated = applyDefaultChapterEnds([...chapters.slice(0, index), newChapter, ...chapters.slice(index)], job.totalDurationSeconds);
    setChapters(updated);
    syncPlayerToChapter(newChapter, index);
    setSaveSuccess(false);
    setValidationError(validateChaptersList(updated));
  };

  // Remove chapter
  const handleRemoveChapter = (index: number) => {
    if (chapters.length <= 1) {
      alert('You must have at least one chapter.');
      return;
    }
    const updated = applyDefaultChapterEnds(chapters.filter((_, i) => i !== index), job.totalDurationSeconds);
    if (chapters[index].id === editingChapterId) setEditingChapterId(null);
    setChapters(updated);
    setSaveSuccess(false);
    setValidationError(validateChaptersList(updated));
  };

  const handleMoveChapter = (fromIndex: number, toIndex: number) => {
    const moved = moveChapter(chapters, fromIndex, toIndex);
    if (moved === chapters) return;
    const updated = applyDefaultChapterEnds(moved, job.totalDurationSeconds);
    setChapters(updated);
    setSaveSuccess(false);
    setValidationError(validateChaptersList(updated));
  };

  const handleChapterDragStart = (event: React.DragEvent<HTMLButtonElement>, chapterId: string) => {
    setDraggedChapterId(chapterId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', chapterId);
  };

  const handleChapterDrop = (event: React.DragEvent<HTMLTableRowElement>, toIndex: number) => {
    event.preventDefault();
    const chapterId = event.dataTransfer.getData('text/plain') || draggedChapterId;
    const fromIndex = chapters.findIndex(chapter => chapter.id === chapterId);
    if (fromIndex !== -1) handleMoveChapter(fromIndex, toIndex);
    setDraggedChapterId(null);
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

    const newChapter = { ...candidateChapter(candidate, `c-${Date.now()}-${candidate.candidate_id}`), manuallyInserted: true };

    // Insert sorted
    const combined = prepareChapters(
      [...chapters.filter(chapter => !chapter.isMissing), newChapter].sort((a, b) => parseMs(a.start) - parseMs(b.start)),
      job.totalDurationSeconds,
      chapterNumberFormat,
    );
    setChapters(applyChapterNumberFormat(combined, chapterNumberFormat));
    
    // Mark candidate as approved
    setCandidates(prev =>
      prev.map(c => c.candidate_id === candidate.candidate_id ? { ...c, status: 'approved' } : c)
    );
    setSaveSuccess(false);
    setValidationError(validateChaptersList(combined));
  };

  // Toggle audio preview for a chapter entry
  const handleToggleChapterPlay = (chapter: ChapterEntry, index: number) => {
    setEditingChapterId(chapter.id);
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
    const transcriptWordIndex = resolveTranscriptWordIndex(seconds, candidate.transcriptWordIndex);
    const snippet = `${candidate.context_before ? candidate.context_before + ' ' : ''}${candidate.matched_text}${candidate.context_after ? ' ' + candidate.context_after : ''}`;

    const trackId = `cand-${candidate.candidate_id}`;
    if (activeTrack?.id === trackId && isPlaying) {
      setIsPlaying(false);
    } else {
      navigateToTranscriptWord(transcriptWordIndex);
      setActiveTrack({
        id: trackId,
        seekRevision: ++seekRevision.current,
        title: candidate.proposed_title,
        start: candidate.candidate_start,
        seconds: candidate.suggestionOnly ? Math.max(0, seconds - 3) : seconds,
        stopSeconds: candidate.suggestionOnly ? Math.min(job.totalDurationSeconds, Math.max(seconds + 8, parseMs(candidate.candidate_end) / 1000 + 4)) : undefined,
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
  const handleWordTimestampSelect = (timestamp: string, word: string, seconds: number, wordIndex?: number) => {
    const transcriptWordIndex = resolveTranscriptWordIndex(seconds, wordIndex);
    navigateToTranscriptWord(transcriptWordIndex, true);
    selectedTimelineTime.current = seconds;
    // A stable editor selection is the only mutation target. Playback position,
    // bulk checkboxes, duplicate titles and stale row indexes cannot choose it.
    const targetIdx = chapters.findIndex(chapter => chapter.id === editingChapterId);
    if (targetIdx >= 0) {
      handleUpdateChapter(targetIdx, 'start', timestamp, transcriptWordIndex, true);
      setWordUpdateNotification(`✓ Set ${chapters[targetIdx].title} start to ${timestamp} from "${word}"`);
    } else {
      setActiveTrack({ id: 'transcript-preview', title: 'Transcript preview', start: timestamp, seconds,
        seekRevision: ++seekRevision.current, sourceType: 'transcript' });
      setWordUpdateNotification('Previewing this word. Select a chapter in the editor to change its start.');
    }
    setIsPlaying(true);
    setTimeout(() => setWordUpdateNotification(null), 4000);
  };

  const handleTranscriptWordSelect = (word: AlignedWord, transcriptWordIndex: number) => {
    handleWordTimestampSelect(word.start, word.word, word.startSeconds, transcriptWordIndex);
  };

  // Save changes
  const handleSave = async () => {
    const err = validateChaptersList(chapters);
    if (err) {
      setValidationError(err);
      return false;
    }
    setValidationError(null);
    setIsSaving(true);
    try {
      await onSaveChapters(chapters);
      setSavedNumberFormat(chapterNumberFormat);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      return true;
    } catch (e: any) {
      setValidationError(e.message || 'Failed to save chapters');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const currentError = validationError || validateChaptersList(chapters);
  const cutPlan = useMemo(() => {
    try { return planChapterExport(chapters, job.totalDurationSeconds); }
    catch { return null; } // Invalid chapter ranges are explained by the editor validation.
  }, [chapters, job.totalDurationSeconds]);
  const cuts = cutPlan?.cuts || [];
  const leadingCut = cuts.find(cut => cut.afterIndex === -1);
  const handleSetChapterTimestamp = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const index = chapters.findIndex(chapter => chapter.id === editingChapterId);
    if (index < 0) return;
    handleUpdateChapter(index, 'start', formatTimestampMs(seconds * 1000), undefined, true);
  };

  const handleResetChapters = () => {
    if (!resetRequested || !baseline?.length || isSaving) return;
    setResetRequested(false);
    const restored = applyChapterNumberFormat(prepareChapters(baseline.map(chapter => ({ ...chapter })), job.totalDurationSeconds, chapterNumberFormat), chapterNumberFormat);
    setChapters(restored);
    setIsPlaying(false); setActiveTrack(null); setEditingChapterId(null);
    setSelectedChapterIds(new Set()); setTitleCleanupUndo([]); setBulkEditUndo([]);
    setShowBulkEditor(false); setSaveSuccess(false); setValidationError(validateChaptersList(restored));
  };

  const nextAction = <div className="flex flex-wrap items-center justify-end gap-3">
            <button type="button"
              id="btn-next-build"
              onClick={async () => {
                if (currentError) {
                  alert(currentError);
                  return;
                }
                if (await handleSave()) onNextStep();
              }}
              disabled={!!currentError}
              className="paper-action-dark inline-flex items-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-40"
            >Continue to Review Metadata<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
  </div>;

  return (
    <div className="processing-stage space-y-4">
      {resetRequested && <ChapterResetDialog onConfirm={handleResetChapters} onClose={() => setResetRequested(false)} />}
      {actionHost && createPortal(nextAction, actionHost)}
      {(!actionHost || currentError) && <div>
        {!actionHost && nextAction}

        {/* Validation Alert if errors exist */}
        {currentError && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-center space-x-2 text-red-700 text-xs font-medium">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>Fix this before continuing: {currentError}</span>
          </div>
        )}
      </div>}

      {/* Word Snapping Notification Toast/Banner */}
      {wordUpdateNotification && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 flex items-center justify-between text-emerald-900 text-xs font-medium shadow-xs animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{wordUpdateNotification}</span>
          </div>
          <button
            onClick={() => setWordUpdateNotification(null)}
            aria-label="Dismiss chapter update"
            className="text-emerald-700 hover:text-emerald-950 font-bold px-1.5 cursor-pointer"
          ><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      )}

      <PreviewPanel id="chapter-review-workflow" title="Workflow">
        <p className="mb-2 text-xs font-semibold" aria-live="polite">{chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}</p>
        <ol aria-label="Chapter edit activity" className="max-h-48 overflow-y-auto space-y-1 text-xs">
          {activity.length ? activity.slice(-12).reverse().map((event, index) => <li key={`${event.at}:${index}`}>{event.message}</li>) : <li className="text-stone-600">No unsaved chapter edits.</li>}
        </ol>
        <div className="mt-3 border-t border-stone-300/60 pt-2 space-y-1 text-xs" aria-live="polite">
          <p>{isSaving ? 'Saving changes…' : hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}</p>
          <p className="font-semibold">Editing: {editingChapter?.title || 'No chapter selected'}</p>
        </div>
      </PreviewPanel>

      {/* Interactive Chapter Audio Audition Player */}
      <DesktopWindow id="chapter-player" title="Interactive Audio Player"><ChapterAudioPlayer
        activeTrack={activeTrack}
        transcriptWords={transcriptWords}
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
        timestampTarget={editingChapter ? editingChapter.title || 'Selected chapter' : undefined}
        selectedChapterId={editingChapter?.id}
        onSetTimestamp={handleSetChapterTimestamp}
        onAddChapter={handleAddChapter}
        onWordClick={handleWordTimestampSelect}
        totalDurationSeconds={job.totalDurationSeconds}
        audioSrc={`/api/jobs/${job.id}/audio-preview`}
        waveformSrc={(job.previewPath || job.retainedWaveform) && job.generateWaveform && job.waveformReady ? `/api/jobs/${job.id}/waveform` : undefined}
        chapterMarkers={chapters.map((chapter, index) => ({ id: chapter.id || `chap-${index}`, title: chapter.title, seconds: parseMs(chapter.start) / 1000 })).filter(marker => marker.seconds >= 0)}
        onChapterMarker={id => {
          const index = chapters.findIndex((chapter, i) => (chapter.id || `chap-${i}`) === id);
          if (index >= 0) {
            selectedTimelineTime.current = parseMs(chapters[index].start) / 1000;
            handleToggleChapterPlay(chapters[index], index);
          }
        }}
        onSeek={seconds => { selectedTimelineTime.current = seconds; navigateToTranscriptWord(resolveTranscriptWordIndex(seconds), true); }}
        onPlaybackTime={seconds => { selectedTimelineTime.current = seconds; if (!transcriptSearch) navigateToTranscriptWord(resolveTranscriptWordIndex(seconds)); }}
      /></DesktopWindow>

      {/* Main Split Workbench: Left transcript, Right Chapters Editor */}
      <ResizableColumns storageKey="chapters" initialRatio={42} label="Resize transcript and chapter editor">
        {/* Left Col (5 cols): complete persisted WhisperX transcript */}
        <DesktopWindow id="transcript" title="Transcript"><div className="processing-panel processing-transcript desktop-fill min-w-0 space-y-4">
          <TranscriptTimingWarning segments={job.transcriptSegments} />
          <ChapterSuggestions candidates={candidates} chapters={chapters}
            playingId={isPlaying && activeTrack?.id.startsWith('cand-') ? Number(activeTrack.id.slice(5)) : undefined}
            onPlay={handleToggleCandidatePlay} onAccept={handleAcceptCandidate} />
          <div className="bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden flex flex-col h-[750px]">
            <div className="workspace-panel-header p-4 pr-11 border-b border-stone-200 bg-stone-50/70 flex flex-wrap gap-3 items-center justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-amber-600" />
                  <h3 className="workspace-panel-title font-semibold text-sm text-stone-900">
                    Transcript ({matchingTranscriptWords.length.toLocaleString()} words)
                  </h3>
                </div>
                <p className="text-xs text-stone-500 mt-0.5 font-mono">
                  {editingChapter ? `Editing ${editingChapter.title}: click a word to set its start` : 'Select a chapter to edit its start. Word clicks preview audio until then.'}
                </p>
              </div>

              <input
                value={transcriptSearch}
                onChange={(event) => {
                  setTranscriptSearch(event.target.value);
                  setTranscriptOffset(0);
                }}
                placeholder="Find words or a phrase…"
                aria-label="Search transcript"
                className="w-44 px-2 py-1 text-xs rounded border border-stone-300 bg-white"
              />
            </div>

            <div ref={transcriptPane} onScroll={event => rememberPane('transcriptScroll', event.currentTarget.scrollTop)} className="flex flex-wrap content-start gap-1 overflow-y-auto flex-1 p-3 text-xs leading-relaxed">
              {visibleTranscriptWords.map(({ word, transcriptWordIndex }) => {
                const isHeading = headingWordIndexes.has(transcriptWordIndex);
                const isActive = selectedTranscriptWordIndex === transcriptWordIndex;
                return (
                  <button
                    id={`transcript-word-${transcriptWordIndex}`}
                    key={transcriptWordIndex}
                    ref={(element) => {
                      if (element) transcriptWordRefs.current.set(transcriptWordIndex, element);
                      else transcriptWordRefs.current.delete(transcriptWordIndex);
                    }}
                    type="button"
                    onClick={() => handleTranscriptWordSelect(word, transcriptWordIndex)}
                    title={editingChapter ? `Set ${editingChapter.title} start to ${word.start}` : `Listen from ${word.start}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={`px-1 py-0.5 rounded cursor-pointer transition-colors ${isActive ? 'transcript-word-active font-bold' : isHeading ? 'transcript-word-heading font-semibold ring-1' : 'text-stone-700 hover:bg-stone-200'}`}
                  >
                    {word.word}
                  </button>
                );
              })}
              {visibleTranscriptWords.length === 0 && <p className="p-6 text-stone-500">{transcriptWords.length ? 'No words or phrases match your search.' : job.transcription ? 'No timed words were returned. Expand the missing timestamps notice above to review the saved segment text.' : 'No saved word-level transcript is available yet. Complete Step 1 once to create it.'}</p>}
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
                  {job.chapterSource === 'whisperx' ? 'No candidates generated yet. Run chapter detection to suggest markers.' : 'Automatic chapter detection is off for this workflow. Edit your chapter list directly; generating a transcript does not replace it.'}
                </div>
              )}
            </div>}
          </div>
        </div></DesktopWindow>

        {/* Right Col (7 cols): Active Editable Chapters Table */}
        <DesktopWindow id="chapter-editor" title="Chapter Editor"><div className="processing-panel processing-chapter-editor desktop-fill min-w-0 space-y-4">
          <div className="bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden flex flex-col h-[750px]">
            {/* Table Action Bar */}
            <div className="workspace-panel-header p-4 pr-11 border-b border-stone-200 bg-stone-50/70 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-stone-800" />
                  <h3 className="workspace-panel-title font-semibold text-sm text-stone-900">
                    Chapter Editor
                  </h3>
                </div>
              </div>

              <div className="chapter-editor-tools flex flex-wrap items-center gap-2" role="toolbar" aria-label="Chapter tools">
                <button id="btn-save-chapters" type="button" aria-label={isSaving ? 'Saving chapter list' : saveSuccess ? 'Chapters saved' : 'Save chapter list'}
                  title={isSaving ? 'Saving chapter list...' : saveSuccess ? 'Chapters saved' : 'Save chapter list'} disabled={isSaving} onClick={handleSave}>
                  {isSaving ? <Loader2 className="animate-spin" aria-hidden="true" /> : saveSuccess ? <Check aria-hidden="true" /> : <Save aria-hidden="true" />}
                </button>
                <button type="button" aria-label="Reset to default chapters" title={baseline?.length ? 'Reset to the original detected or source chapters' : 'No original chapter list is available. Run chapter creation to establish one.'}
                  disabled={isSaving || !baseline?.length} onClick={() => setResetRequested(true)}><RotateCcw aria-hidden="true" /></button>
                <button id="btn-add-chapter-row" type="button" aria-label="Add Chapter" title="Add Chapter" onClick={() => handleAddChapter()}><Plus aria-hidden="true" /></button>
                <button type="button" aria-label="Remove selected chapter" title={editingChapter ? `Remove ${editingChapter.title}` : 'Select a chapter to remove'}
                  disabled={isSaving || !editingChapter || chapters.length <= 1} onClick={() => handleRemoveChapter(editingChapterIndex)}><Trash2 aria-hidden="true" /></button>
                <button type="button" aria-label="Nudge selected chapter one second earlier" title="Nudge selected chapter 1 second earlier"
                  disabled={!editingChapter || parseMs(editingChapter.start) <= 0} onClick={() => handleNudgeTimestamp(editingChapterIndex, -1)}><span aria-hidden="true">-1s</span></button>
                <button type="button" aria-label="Nudge selected chapter one second later" title="Nudge selected chapter 1 second later"
                  disabled={!editingChapter || isIncompleteChapter(editingChapter)} onClick={() => handleNudgeTimestamp(editingChapterIndex, 1)}><span aria-hidden="true">+1s</span></button>
                <button type="button" aria-label="Move selected chapter up" title="Move selected chapter up"
                  disabled={!editingChapter || editingChapterIndex === 0} onClick={() => handleMoveChapter(editingChapterIndex, editingChapterIndex - 1)}><ArrowUp aria-hidden="true" /></button>
                <button type="button" aria-label="Move selected chapter down" title="Move selected chapter down"
                  disabled={!editingChapter || editingChapterIndex === chapters.length - 1} onClick={() => handleMoveChapter(editingChapterIndex, editingChapterIndex + 1)}><ArrowDown aria-hidden="true" /></button>
                {!!job.existingChapters?.length && <ToolbarPopover label="Original chapters" icon={<FileText className="h-4 w-4" />}>
                  <p className="font-semibold">Original chapters ({job.existingChapters.length})</p>
                  <p className="mt-2 text-xs">Only the chapter list you review and save will be exported.</p>
                  <div className="my-3 max-h-64 overflow-y-auto space-y-1">
                    {job.existingChapters.map(c => <p className="text-xs" key={c.id}>{c.start} — {c.title}</p>)}
                  </div>
                  <button type="button" disabled={isSaving} className="text-xs underline" title="Replace the current review list with chapters read from the source file"
                    onClick={() => setChapters(applyChapterNumberFormat(prepareChapters(job.existingChapters!.map(c => ({
          ...c,
          transcriptWordIndex: resolveTranscriptWordIndex(Math.max(0, parseMs(c.start)) / 1000, c.transcriptWordIndex),
        })), job.totalDurationSeconds, chapterNumberFormat), chapterNumberFormat))}>Use these chapters as my starting point</button>
                </ToolbarPopover>}
                <button type="button" id="btn-clean-chapter-titles" aria-label="Auto Clean Titles" onClick={() => handleCleanTitles()} disabled={isSaving || !chapters.length}
                  title="Auto Clean Titles — Removes unnecessary whitespace and applies MLA style capitalization to chapter titles."><Sparkles aria-hidden="true" /></button>
                {titleCleanupUndo.length > 0 && <button type="button" aria-label="Undo title cleanup" onClick={() => handleCleanTitles(true)} disabled={isSaving}
                  title="Restore cleaned titles without undoing later chapter edits. Save the chapter list to keep your changes."><RotateCcw aria-hidden="true" /></button>}
                <button type="button" aria-label="Bulk Edit" title="Bulk Edit" onClick={() => setShowBulkEditor(true)} disabled={isSaving || !chapters.length}><Pencil aria-hidden="true" /></button>
                {bulkEditUndo.length > 0 && <button type="button" aria-label="Undo Last Bulk Edit" title="Undo Last Bulk Edit" onClick={handleUndoBulkEdit} disabled={isSaving}><RotateCcw aria-hidden="true" /></button>}
                <label className="flex items-center gap-1 text-xs text-stone-600">
                  <select
                    aria-label="Chapter number format"
                    value={chapterNumberFormat}
                    onChange={(event) => {
                      const format = event.target.value as ChapterNumberFormat;
                      setChapterNumberFormat(format);
                      try { sessionStorage.setItem(`swissmouse_chapter_numbers_${job.id}`, format); } catch { /* Keep in-memory choice. */ }
                      setChapters(current => applyChapterNumberFormat(current, format));
                      setActiveTrack(current => {
                        if (!current || current.chapterIndex === undefined) return current;
                        const source = chapters.find(chapter => chapter.id === current.id) || chapters[current.chapterIndex];
                        if (!source) return current;
                        const chapter = applyChapterNumberFormat([source], format)[0];
                        return { ...current, title: chapter.title };
                      });
                      setSaveSuccess(false);
                    }}
                    className="rounded border border-stone-300 bg-white px-2 py-1"
                  >
                    <option value="numerical">Numeric</option>
                    <option value="roman">Roman</option>
                    <option value="written">Written</option>
                  </select>
                </label>
              </div>
            </div>

            {!!cuts.length && <div role="status" className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs font-medium text-sky-900">
              Export will remove {cutPlan!.removedSeconds.toFixed(3)} seconds of audio across {cuts.length} {cuts.length === 1 ? 'cut' : 'cuts'}. Blue chapter rows mark where audio is removed.
            </div>}

            {/* Chapters Table */}
            <div ref={chapterPane} onScroll={event => rememberPane('chapterScroll', event.currentTarget.scrollTop)} className="overflow-auto min-h-0 flex-1 px-3 pb-3">
              <table role="table" aria-label="Chapters to export" className="processing-chapter-table chapter-explorer-table w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 uppercase tracking-wider font-semibold">
                    <th className="chapter-grip-column"><span className="sr-only">Reorder</span></th>
                    <th className="chapter-play-column"><span className="sr-only">Play</span></th>
                    <th className="chapter-number-column">#</th>
                    <th className="chapter-time-column">Start time</th>
                    <th className="chapter-time-column">End time</th>
                    <th>Chapter name</th>
                    <th className="chapter-select-column"><span className="sr-only">Bulk select</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {leadingCut && <tr className="bg-sky-100 text-sky-900"><td colSpan={7} className="border-y border-sky-300 px-3 py-2 font-medium">Cut in export: {((leadingCut.endMs - leadingCut.startMs) / 1000).toFixed(3)} seconds before {chapters[0].title} ({formatTimestampMs(leadingCut.startMs)} to {formatTimestampMs(leadingCut.endMs)}).</td></tr>}
                  {chapters.map((chap, idx) => {
                    const chapMs = parseMs(chap.start);
                    const endMs = parseMs(chap.end || '');
                    const isValidTime = chapMs !== -1;
                    const isNonNegative = isValidTime && chapMs >= 0;
                    const nextValidStart = chapters.slice(idx + 1).map(item => parseMs(item.start)).find(value => value >= 0);
                    const isValidEnd = endMs > chapMs && (nextValidStart === undefined || endMs < nextValidStart) && endMs <= Math.round(job.totalDurationSeconds * 1000);
                    const isIncomplete = isIncompleteChapter(chap);
                    const isThisPlaying = activeTrack?.id === (chap.id || `chap-${idx}`) && isPlaying;
                    const cutBefore = cuts.find(cut => cut.beforeIndex === idx);
                    const cutAfter = cuts.find(cut => cut.afterIndex === idx);
                    const isCutRow = !!cutBefore || !!cutAfter;
                    
                    return (
                      <React.Fragment key={chap.id || idx}>
                      <tr
                        aria-selected={editingChapterId === chap.id}
                        tabIndex={0}
                        onKeyDown={event => {
                          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault(); selectChapterForEditing(chap, idx);
                          }
                        }}
                        onClick={event => {
                          if (!(event.target as HTMLElement).closest('input, button')) selectChapterForEditing(chap, idx);
                        }}
                        onFocus={event => {
                          if (!(event.target as HTMLElement).closest('input[type="checkbox"], button[draggable]')) setEditingChapterId(chap.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(event) => handleChapterDrop(event, idx)}
                        className={`processing-chapter-row transition-colors ${draggedChapterId === chap.id ? 'opacity-50' : ''} ${editingChapterId === chap.id ? 'ring-2 ring-inset ring-amber-500' : ''} ${
                          isIncomplete || !isValidEnd
                            ? 'bg-red-50/70'
                            : isCutRow
                            ? 'bg-sky-50 hover:bg-sky-100 border-l-4 border-sky-400'
                            : editingChapterId === chap.id
                            ? 'bg-amber-50/80 ring-1 ring-amber-300'
                            : 'hover:bg-stone-50'
                        }`}
                      >
                        <td className="py-2 px-1 text-center">
                          <button
                            type="button"
                            draggable
                            onDragStart={(event) => handleChapterDragStart(event, chap.id)}
                            onDragEnd={() => setDraggedChapterId(null)}
                            className="inline-flex cursor-grab touch-none items-center justify-center rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-amber-700 active:cursor-grabbing"
                            title={`Drag to reorder ${chap.title || `chapter ${idx + 1}`}`}
                            aria-label={`Drag to reorder ${chap.title || `chapter ${idx + 1}`}`}
                          >
                            <GripVertical className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </td>
                        <td className="py-2 px-1 text-center">
                          <button type="button" id={`btn-play-chapter-${idx}`}
                            aria-label={`${isIncomplete ? 'Locate' : isThisPlaying ? 'Pause' : 'Play'} ${chap.title || `chapter ${idx + 1}`}`}
                            title={isIncomplete ? `Locate ${chap.title} using the player, then Set Chapter Start` : `${isThisPlaying ? 'Pause' : 'Play'} ${chap.title} at ${chap.start}`}
                            aria-pressed={isThisPlaying}
                            onClick={() => isIncomplete ? selectMissingChapter(chap, idx) : handleToggleChapterPlay(chap, idx)}
                            className={`inline-flex w-6 items-center justify-center rounded ${isThisPlaying ? 'bg-amber-500 text-stone-950' : 'text-stone-700 hover:bg-amber-100'}`}>
                            {isThisPlaying ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
                          </button>
                        </td>
                        <td className="py-2 px-2 font-mono text-stone-400 font-semibold">
                          <button type="button" aria-label={`Edit ${chap.title || `chapter ${idx + 1}`}`}
                            onClick={() => selectChapterForEditing(chap, idx)}
                            aria-pressed={editingChapterId === chap.id} className="rounded px-1 py-1 hover:bg-amber-100">
                            {idx + 1}
                          </button>
                        </td>

                        <td data-label="Start" className="py-2 px-2">
                          <div className="space-y-0.5">
                            <input
                              type="text"
                              value={chap.start}
                              aria-label={`Start of ${chap.title || `chapter ${idx + 1}`}`}
                              onFocus={() => isIncomplete ? selectMissingChapter(chap, idx) : syncPlayerToChapter(chap, idx)}
                              onChange={(e) => handleUpdateChapter(idx, 'start', e.target.value)}
                              className={`w-full px-2 py-1 font-mono rounded text-xs border ${
                                isNonNegative
                                  ? cutBefore ? 'bg-sky-50 border-sky-400 text-sky-950 focus:border-sky-600 focus:ring-1 focus:ring-sky-600' : 'bg-white border-stone-300 text-stone-900 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                                  : 'bg-red-50 border-red-300 text-red-700'
                              }`}
                              placeholder="00:00:00.000"
                              aria-invalid={!isNonNegative}
                            />
                            {isIncomplete && <span className="block text-[10px] font-semibold text-red-700">Missing timestamp</span>}
                          </div>
                        </td>

                        <td data-label="End" className="py-2 px-2">
                          <input
                            type="text"
                            value={chap.end || ''}
                            aria-label={`End of ${chap.title || `chapter ${idx + 1}`}`}
                            onFocus={() => { if (chap.end) syncPlayerToChapter(chap, idx, chap.end); }}
                            onChange={(e) => handleUpdateChapter(idx, 'end', e.target.value)}
                            className={`w-full px-2 py-1 font-mono rounded text-xs border ${
                              isValidEnd
                                ? cutAfter ? 'bg-sky-50 border-sky-400 text-sky-950 focus:border-sky-600 focus:ring-1 focus:ring-sky-600' : 'bg-white border-stone-300 text-stone-900 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                                : 'bg-red-50 border-red-300 text-red-700'
                            }`}
                            placeholder={isIncomplete ? 'Assign start first' : '00:00:00.000'}
                            disabled={isIncomplete}
                            aria-invalid={!isValidEnd}
                          />
                        </td>

                        <td data-label="Chapter title" className="py-2 px-2">
                          <input
                            type="text"
                            value={chap.title}
                            aria-label={`Title of chapter ${idx + 1}`}
                            onChange={(e) => handleUpdateChapter(idx, 'title', e.target.value)}
                            className="w-full px-2 py-1 rounded text-xs border border-stone-300 bg-white text-stone-900 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                            placeholder="Chapter title"
                          />
                          {chap.headingType === 'music_transition' && <span className="block text-[10px] text-amber-800 mt-0.5" title={chap.notes}>Musical transition · Review suggested start</span>}
                        </td>

                        <td className="py-2 px-1 text-center"><input type="checkbox" checked={currentSelection.has(chap.id)}
                          aria-label={`Select ${chap.title || `chapter ${idx + 1}`} for bulk editing`}
                          onChange={event => { const checked = event.target.checked; setSelectedChapterIds(previous => { const next = new Set(previous); if (checked) next.add(chap.id); else next.delete(chap.id); return next; }); }} /></td>
                      </tr>
                      {cutAfter && <tr className="bg-sky-100 text-sky-900"><td colSpan={7} className="border-y border-sky-300 px-3 py-2 font-medium">
                        Cut in export: {((cutAfter.endMs - cutAfter.startMs) / 1000).toFixed(3)} seconds {cutAfter.beforeIndex < chapters.length ? `between ${chap.title} and ${chapters[cutAfter.beforeIndex].title}` : `after ${chap.title}`} will be removed ({formatTimestampMs(cutAfter.startMs)} to {formatTimestampMs(cutAfter.endMs)}).
                      </td></tr>}
                      </React.Fragment>
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
                <span>Source timeline: 00:00:00 to {formatTs(job.totalDurationSeconds)}. Only included chapter ranges are exported.</span>
                <span>{chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}</span>
              </div>
            </div>
          </div>
        </div>
        </DesktopWindow>
      </ResizableColumns>

      {showBulkEditor && <BulkChapterEditor chapters={chapters} selectedIds={currentSelection}
        onApply={handleBulkApply} onClose={() => setShowBulkEditor(false)} />}

    </div>
  );
};
