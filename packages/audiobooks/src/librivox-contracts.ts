export type LibriVoxSearchField = 'title' | 'author' | 'genre';
export interface LibriVoxSection {
  id: string; order: number; title: string; url?: string; originalUrl?: string; durationSeconds: number; readers: string[];
  fileName?: string; startSeconds?: number; endSeconds?: number;
}
export interface LibriVoxBook {
  id: string; title: string; authors: string[]; description: string; language: string;
  runtime: string; durationSeconds: number; sectionCount: number; genres: string[];
  projectUrl?: string; archiveUrl?: string; coverUrl?: string; coverThumbnailUrl?: string; sections: LibriVoxSection[];
}
export interface LibriVoxSearchResult { books: LibriVoxBook[]; page: number; hasNext: boolean; skipped: number }
export interface LibriVoxProgress {
  status: 'idle' | 'downloading' | 'completed' | 'cancelled' | 'error';
  section: number; totalSections: number; title: string; bytes: number; sectionBytes: number;
  sectionTotalBytes?: number; error?: string; projectId?: string;
}
