/** Built-in backend composition entry while the installed package remains read-only. */
export { createAudiobookProjectService, AudiobookCommandError } from './project-service';
export type { ProjectServices, CreatedProject } from './project-service';
export { applySavedMetadata } from './project-metadata';
export type { EditableProject } from './project-metadata';
export { createAudiobookFileBackend } from './file-backend';
export type { AudiobookFileBackend } from './file-backend';
export { createAudiobookFileState } from './file-ports';
export type { AudiobookFilePorts, FileCommandInput, FileReply } from './file-ports';
export { createAudiobookProcessingBackend } from './processing-backend';
export { createAudiobookProcessingState } from './processing-state';
export type { AudiobookProcessingPorts, ProcessingCommandInput } from './processing-ports';
export { createAudiobookCompletionBackend } from './completion-backend';
export { createAudiobookCompletionState } from './completion-ports';
export type { AudiobookCompletionPorts, CompletionInput, CompletionReply } from './completion-ports';
