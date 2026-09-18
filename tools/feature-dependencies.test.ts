import test from 'node:test';
import assert from 'node:assert/strict';
import { missingDependencies, requiredDependencyIds } from './feature-dependencies';

test('features declare only their actual external requirements', () => {
  assert.deepEqual(requiredDependencyIds(['file_import']), ['ffprobe']);
  assert.deepEqual(requiredDependencyIds(['youtube_conversion']), ['yt_dlp', 'ffmpeg', 'ffprobe']);
  assert.deepEqual(requiredDependencyIds(['audio_processing', 'faster_transcription']), ['ffmpeg', 'ffprobe', 'python', 'faster_whisper', 'ctranslate2']);
});

test('missing dependency resolution treats broken components as unavailable', () => {
  const components = [
    { id: 'ffmpeg', name: 'FFmpeg', status: 'ready' as const },
    { id: 'ffprobe', name: 'FFprobe', status: 'broken' as const },
  ];
  assert.deepEqual(missingDependencies(components, ['audio_processing']).map(item => item.name), ['FFprobe']);
});
