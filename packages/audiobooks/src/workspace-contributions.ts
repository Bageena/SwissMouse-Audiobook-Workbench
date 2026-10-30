
export type WorkflowStep = 1 | 2 | 3 | 4 | 5;
export const audiobookWorkflow = [
  { step: 1, id: 'audiobooks.process', label: 'Process audio', description: 'Prepare audio and find chapters' },
  { step: 2, id: 'audiobooks.chapters', label: 'Review chapters', description: 'Check names and timing' },
  { step: 3, id: 'audiobooks.metadata', label: 'Review Metadata', description: 'Verify final book details' },
  { step: 4, id: 'audiobooks.export', label: 'Convert', description: 'Create your audiobook' },
  { step: 5, id: 'audiobooks.validate', label: 'Final check', description: 'Confirm the finished file' },
] as const;

export const audiobookManifest = {
  id: 'audiobooks', name: 'Audiobooks', contractVersion: 1,
  resourceKinds: ['core.work', 'core.recording', 'core.file'],
  workspaces: [
    { id: 'audiobooks.library', label: 'Library', description: 'Browse Inbox and Library' },
    { id: 'audiobooks.files', label: 'Book Files', description: 'Files and book details' },
    ...audiobookWorkflow,
  ],
} as const;

/** Legacy IDs are deliberately retained so customized layouts reopen unchanged. */
const parents = [
  ['library-navigation', 'Library navigation'], ['library-books', 'Library books'],
  ['project-navigation', 'Project navigation'], ['project-overview', 'Project Overview'],
  ['add-files', 'Add Files'], ['panel-Processing Order', 'Processing Order'],
  ['processing-progress', 'Audio processing'], ['processing-output', 'Output'],
  ['processing-options', 'Audio and Chapters'], ['transcription-settings', 'Transcription and model settings'],
  ['processing-readiness', 'Workflow'], ['chapter-review-workflow', 'Chapter review workflow'],
  ['chapter-player', 'Interactive Audio Player'], ['transcript', 'Transcript'], ['chapter-editor', 'Chapter Editor'],
  ['final-check-workflow', 'Final check workflow'], ['conversion-workflow', 'Conversion workflow'],
  ['metadata', 'Metadata'], ['export', 'Convert'], ['final-check', 'Final check'],
] as const;
const children = [
  ['chapter-creation', 'Chapter Creation', 'processing-options'], ['audio-preparation', 'Audio Preparation', 'processing-options'],
  ['metadata-cover', 'Cover art', 'metadata'], ['metadata-identity', 'Book title and contributors', 'metadata'],
  ['metadata-taxonomy', 'Series & Taxonomy', 'metadata'], ['metadata-description', 'Description', 'metadata'],
  ['metadata-publication', 'Publication', 'metadata'], ['metadata-identifiers', 'Identifiers', 'metadata'],
  ['metadata-rights', 'Rights', 'metadata'], ['chapter-waveform', 'Waveform', 'chapter-player'],
  ['interactive-transcription', 'Interactive Transcription Window', 'chapter-player'],
] as const;
export const audiobookPanels = [
  ...parents.map(([id, name]) => ({ id, name, role: 'parent' as const, module: 'audiobooks',
    ...(id === 'project-navigation' ? { constraints: { minimumWidth: 56, minimumHeight: 48 } } : {}) })),
  ...children.map(([id, name, defaultParent]) => ({ id, name, role: 'child' as const, defaultParent, module: 'audiobooks' })),
];
