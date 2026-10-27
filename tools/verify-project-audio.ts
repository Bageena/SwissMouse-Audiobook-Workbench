import fs from 'node:fs/promises';
import path from 'node:path';
import type { AudiobookJob, DiscoveredAudioFile } from '../src/types';
import { checkedPath, pathStamp } from './book-file-operations';
import { within } from './library-filesystem';
import { stitchCompatibility } from '../src/audioFormats';
import type { AudioVerification } from './audio-integrity';

/** Inspect only explicit processing membership. Stage all observations before changing the job. */
export async function verifyProjectAudio(job: AudiobookJob, root: string, probe: (file: string) => Promise<any>, excluded: string[] = [], options: { checkAudio?: (file: string) => Promise<AudioVerification>; progress?: (message: string) => void } = {}) {
  if (!job.parts.length) throw new Error('Add audio to Processing Order before rechecking.');
  const membership = JSON.stringify(job.parts);
  const observations = [];
  for (const part of job.parts) {
    const key = (part.sourceRelativePath || part.name).replace(/\\/g, '/');
    if (path.isAbsolute(key) || key.split('/').includes('..')) throw new Error('A project source is outside its book folder.');
    const file = path.resolve(root, key);
    if (!within(root, file)) throw new Error('A project source is outside its book folder.');
    try {
      await checkedPath(file, excluded);
      const before = await pathStamp(file);
      const info = await fs.stat(file);
      if (!info.isFile()) throw new Error('Not an audio file.');
      const media = await probe(file);
      if (!media.streamSignature || !media.codec || !(media.durationSeconds > 0)) throw new Error('Could not verify an audio stream.');
      options.progress?.(`Checking file ${observations.length + 1}/${job.parts.length}: ${key}`);
      const audioVerification = options.checkAudio ? await options.checkAudio(file) : undefined;
      if (before !== await pathStamp(file)) throw new Error('File changed during verification. Retry when it is no longer being edited.');
      const previous = job.sourceFileStamps?.[key];
      const changed = !!(previous && (previous.sizeBytes !== info.size || previous.modifiedMs !== info.mtimeMs || previous.device !== info.dev || previous.inode !== info.ino))
        || (part.sizeBytes > 0 && part.sizeBytes !== info.size)
        || (part.durationSeconds > 0 && Math.abs(part.durationSeconds - media.durationSeconds) > .01);
      const observed: DiscoveredAudioFile = { relativePath: key, fileName: path.basename(file), folderName: path.basename(path.dirname(file)),
        sizeBytes: info.size, durationSeconds: media.durationSeconds, bitrate: media.bitrate, format: media.format, codec: media.codec,
        sampleRate: media.sampleRate, channels: media.channels, streamSignature: media.streamSignature, isProbed: true, audioVerification };
      observations.push({ key, file, before, observed, changed, stamp: { sizeBytes: info.size, modifiedMs: info.mtimeMs, device: info.dev, inode: info.ino } });
    } catch (error) { throw new Error(`${key}: ${error instanceof Error ? error.message : 'Could not inspect audio.'}`); }
  }
  for (const item of observations) if (item.before !== await pathStamp(item.file)) throw new Error(`${item.key}: File changed during verification. Try again.`);
  if (membership !== JSON.stringify(job.parts)) throw new Error('Processing Order changed during verification. Try again.');
  const measured = new Map(observations.map(item => [item.key, item]));
  const merge = (files: DiscoveredAudioFile[] = []) => {
    const updated = files.map(file => ({ ...file, ...measured.get(file.relativePath.replace(/\\/g, '/'))?.observed }));
    for (const item of observations) if (!updated.some(file => file.relativePath.replace(/\\/g, '/') === item.key)) updated.push(item.observed);
    return updated;
  };
  job.discoveredFiles = merge(job.discoveredFiles);
  job.sourceInventory = merge(job.sourceInventory);
  job.parts = job.parts.map(part => {
    const media = measured.get((part.sourceRelativePath || part.name).replace(/\\/g, '/'))!.observed;
    return { ...part, durationSeconds: media.durationSeconds, sizeBytes: media.sizeBytes, bitrate: media.bitrate || 0 };
  });
  job.sourceFileStamps = { ...job.sourceFileStamps, ...Object.fromEntries(observations.map(item => [item.key, item.stamp])) };
  const issues = observations.flatMap(item => (item.observed.audioVerification?.issues || []).map(message => `${item.key}: ${message}`));
  return { checked: observations.length, changed: observations.some(item => item.changed), issues, ...stitchCompatibility(observations.map(item => item.observed)) };
}
