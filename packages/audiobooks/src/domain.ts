import type { CoverDesign } from './cover-design';
export type HeadingType = 'numbered_chapter' | 'numbered_section' | 'front_matter' | 'chapter_like' | 'section_divider' | 'back_matter' | 'music_transition';


export interface ChapterEntry {
  parentChapterStart?: string;
  timingSource?: 'transcript' | 'recheck' | 'source';
  transcriptWordIndex?: number;
  headingType?: HeadingType;
  chapterNumber?: number;
  recovered?: boolean;
  id: string;
  start: string; // HH:MM:SS.mmm; blank only while a generated placeholder is incomplete
  end?: string; // HH:MM:SS.mmm
  title: string;
  notes?: string;
  isMissing?: boolean;
  startManuallyEdited?: boolean;
  endManuallyEdited?: boolean;
  titleManuallyEdited?: boolean;
  manuallyInserted?: boolean;
}


export interface CoverArtInfo {
  source: 'local' | 'upload' | 'url' | 'generated';
  design?: CoverDesign;
  url: string; // Data URL or remote/local URL
  filename?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export interface MetadataMembership { id: string; name: string; sequence?: string; addedAt?: string }

export interface AudiobookMetadata {
  collections?: MetadataMembership[];
  additionalSeries?: MetadataMembership[];
  seriesAddedAt?: string;
  title: string;
  subtitle?: string;
  author: string; // Stored in Artist tag
  narrator: string; // Stored in Composer tag per Audiobookshelf standard
  authors?: string[]; // Preserve people whose names contain commas.
  narrators?: string[];
  series?: string; // Stored in Series/Album
  seriesSequence?: string; // Stored in Series-Part / Track
  edition?: string;
  genres: string[]; // Book genres, separate from subject tags
  tags?: string[]; // Audiobookshelf subject tags
  publishedYear?: string; // Release Year (e.g. 2024)
  releaseDate?: string; // Full date if available (YYYY-MM-DD)
  publisher?: string;
  language: string; // e.g. 'eng', 'en', 'spa'
  isbn?: string;
  asin?: string;
  description?: string; // Synopsis / Summary
  abridged: boolean;
  explicit: boolean;
  copyright?: string;
  cover?: CoverArtInfo | null;
}


export type RerunnablePipelineStep = 'generating_waveform' | 'transcribing_whisper' | 'detecting_chapters' | 'extracting_chapters' | 'metadata_processing';
export type PipelineResultStep = 'chapter_detection' | 'chapter_review' | 'export' | 'validation';
export type PipelineStepStatus = 'current' | 'running' | 'stale' | 'failed';
export interface PipelineStepState {
  status: PipelineStepStatus;
  hasOutput: boolean;
  error?: string;
  updatedAt?: string;
}
