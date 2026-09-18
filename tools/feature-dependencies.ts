import type { BaseRequirementItem } from '../src/types';

export type FeatureId =
  | 'file_import'
  | 'folder_scan'
  | 'audio_processing'
  | 'faster_transcription'
  | 'openai_transcription'
  | 'faster_model_management'
  | 'openai_model_management'
  | 'youtube_inspection'
  | 'youtube_import'
  | 'youtube_conversion'
  | 'audio_export'
  | 'output_validation';

/**
 * Single source of truth for external requirements. UI controls and API routes
 * both resolve their readiness through this map.
 */
export const featureRequirements: Record<FeatureId, string[]> = {
  file_import: ['ffprobe'],
  folder_scan: ['ffprobe'],
  audio_processing: ['ffmpeg', 'ffprobe'],
  faster_transcription: ['python', 'faster_whisper', 'ctranslate2'],
  openai_transcription: ['python', 'openai_whisper', 'pytorch'],
  // Model files are separate from inference runtimes. Faster model downloads
  // use the private Python downloader; OpenAI model weights use direct HTTPS.
  faster_model_management: ['python'],
  openai_model_management: [],
  youtube_inspection: ['yt_dlp'],
  youtube_import: ['yt_dlp', 'ffprobe'],
  youtube_conversion: ['yt_dlp', 'ffmpeg', 'ffprobe'],
  audio_export: ['ffmpeg', 'ffprobe'],
  output_validation: ['ffprobe'],
};

export type DependencyStatus = Pick<BaseRequirementItem, 'id' | 'name' | 'status'>;

export function requiredDependencyIds(features: FeatureId[]): string[] {
  return [...new Set(features.flatMap(feature => featureRequirements[feature]))];
}

export function missingDependencies(components: DependencyStatus[], features: FeatureId[]): DependencyStatus[] {
  const required = new Set(requiredDependencyIds(features));
  const byId = new Map(components.map(component => [component.id, component]));
  return [...required].map(id => byId.get(id) || { id, name: id, status: 'missing' as const })
    .filter(component => component.status !== 'ready');
}

export function missingRequirementsTooltip(missing: DependencyStatus[]): string | undefined {
  return missing.length ? `Missing requirements: ${missing.map(item => item.name).join(', ')}` : undefined;
}
