import type { ModuleManifest } from '../../core/modules';

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
} as const satisfies ModuleManifest;
