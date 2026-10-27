import type { PlaybackBookmark, PlaybackManifest, PlaybackPosition, ResolvedBookmark } from './types';

const bounded = (value: number, maximum: number) => Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), maximum);

/** Exact boundaries belong to the next file; the book end belongs to the final file. */
export function locatePosition(manifest: PlaybackManifest, positionSeconds: number): PlaybackPosition {
  const position = bounded(positionSeconds, manifest.totalDurationSeconds);
  let index = manifest.segments.findIndex(segment => position < segment.startSeconds + segment.durationSeconds);
  if (index < 0) index = Math.max(0, manifest.segments.length - 1);
  const segment = manifest.segments[index];
  return { positionSeconds: position, segmentIndex: index,
    offsetSeconds: segment ? bounded(position - segment.startSeconds, segment.durationSeconds) : 0 };
}

export function createBookmark(manifest: PlaybackManifest, positionSeconds: number, completed = false,
  now = new Date().toISOString()): PlaybackBookmark {
  const position = locatePosition(manifest, completed ? manifest.totalDurationSeconds : positionSeconds);
  return {
    bookId: manifest.bookId, positionSeconds: position.positionSeconds,
    segmentId: manifest.segments[position.segmentIndex]?.id || '', segmentOffsetSeconds: position.offsetSeconds,
    mediaSignature: manifest.signature, mediaKind: manifest.kind, totalDurationSeconds: manifest.totalDurationSeconds,
    segments: manifest.segments.map(({ id, signature, durationSeconds }) => ({ id, signature, durationSeconds })),
    completed, updatedAt: now, lastPlayedAt: now,
  };
}

/** Never treat a similar total duration as proof that two recordings share a timeline. */
export function resolveBookmark(manifest: PlaybackManifest, bookmark?: PlaybackBookmark | null): ResolvedBookmark {
  const beginning = (notice?: string): ResolvedBookmark => ({ ...locatePosition(manifest, 0), completed: false, ...(notice ? { notice } : {}) });
  if (!bookmark) return beginning();
  if (bookmark.bookId !== manifest.bookId) return beginning('This bookmark belongs to a different book. Playback starts at the beginning.');
  if (!Number.isFinite(bookmark.positionSeconds) || !Number.isFinite(bookmark.segmentOffsetSeconds) ||
      bookmark.positionSeconds < 0 || bookmark.segmentOffsetSeconds < 0 || !Array.isArray(bookmark.segments) ||
      !bookmark.segments.every(segment => segment && typeof segment.id === 'string' && typeof segment.signature === 'string' &&
        Number.isFinite(segment.durationSeconds) && segment.durationSeconds > 0)) {
    return beginning('The saved listening position could not be read. Playback starts at the beginning.');
  }
  const sameTimeline = bookmark.mediaSignature === manifest.signature;
  const retainedSourceTimeline = bookmark.mediaKind === 'source' && manifest.kind === 'finalized' &&
    manifest.sourceTimelineSignature === bookmark.mediaSignature &&
    Math.abs(bookmark.totalDurationSeconds - manifest.totalDurationSeconds) <= 0.15;
  if (sameTimeline || retainedSourceTimeline) {
    // Keep completed progress visible; Play explicitly starts a new listen at zero.
    return { ...locatePosition(manifest, bookmark.completed ? manifest.totalDurationSeconds : bookmark.positionSeconds), completed: bookmark.completed,
      ...(retainedSourceTimeline ? { notice: 'Your listening position was carried over to the finalized audiobook.' } : {}) };
  }

  if (bookmark.mediaKind === manifest.kind && !bookmark.completed) {
    const previous = bookmark.segments.filter(segment => segment.id === bookmark.segmentId);
    const candidates = manifest.segments.map((segment, index) => ({ segment, index })).filter(({ segment }) =>
      segment.id === bookmark.segmentId && previous.length === 1 && segment.signature === previous[0].signature &&
      segment.durationSeconds === previous[0].durationSeconds && bookmark.segmentOffsetSeconds < segment.durationSeconds);
    if (candidates.length === 1) {
      const { segment, index } = candidates[0];
      return { positionSeconds: segment.startSeconds + bookmark.segmentOffsetSeconds, segmentIndex: index,
        offsetSeconds: bookmark.segmentOffsetSeconds, completed: false,
        notice: 'The book’s audio order or files changed. Resuming at your saved position in the unchanged audio file.' };
    }
  }
  return beginning('The book’s audio changed, so the saved listening position could not be matched safely. Playback starts at the beginning.');
}
