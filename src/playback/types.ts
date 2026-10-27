export interface PlaybackSegmentStamp {
  id: string;
  signature: string;
  durationSeconds: number;
}

export interface PlaybackSegment extends PlaybackSegmentStamp {
  url: string;
  title: string;
  startSeconds: number;
}

/** A book is one timeline, whether its audio occupies one file or many. */
export interface PlaybackManifest {
  bookId: string;
  signature: string;
  kind: 'source' | 'finalized';
  segments: PlaybackSegment[];
  totalDurationSeconds: number;
  chapters?: { startSeconds: number; title: string }[];
  /** Set only by an export that proved the complete source timeline was retained. */
  sourceTimelineSignature?: string;
}

/** Stored in profile listening data, independently of exported book metadata. */
export interface PlaybackBookmark {
  bookId: string;
  positionSeconds: number;
  segmentId: string;
  segmentOffsetSeconds: number;
  mediaSignature: string;
  mediaKind: PlaybackManifest['kind'];
  totalDurationSeconds: number;
  segments: PlaybackSegmentStamp[];
  completed: boolean;
  updatedAt: string;
  lastPlayedAt: string;
}

export interface PlaybackPosition {
  positionSeconds: number;
  segmentIndex: number;
  offsetSeconds: number;
}

export interface ResolvedBookmark extends PlaybackPosition {
  completed: boolean;
  notice?: string;
}
