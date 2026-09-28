import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspect, writeAudioMetadata } from './audio-engine';

const binary = (name: string) => process.env[`TEST_${name.toUpperCase()}`] || path.resolve('runtime/bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`);

test('writing exported audio metadata preserves encoded audio and reads back the new fields', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-metadata-'));
  const ffmpeg = binary('ffmpeg');
  const ffprobe = binary('ffprobe');
  try {
    for (const format of ['mp3', 'm4b', 'm4a', 'flac', 'ogg', 'opus', 'wav'] as const) {
      const file = path.join(directory, `book.${format}`);
      const codec = { mp3: 'libmp3lame', m4b: 'aac', m4a: 'aac', flac: 'flac', ogg: 'libvorbis', opus: 'libopus', wav: 'pcm_s16le' }[format];
      const chapterFile = path.join(directory, 'chapters.ffmeta');
      const coverFile = path.join(directory, 'cover.jpg');
      if (format === 'm4b') fs.writeFileSync(chapterFile, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=First\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Second\n');
      if (format === 'm4b') execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=0.1', '-frames:v', '1', '-y', coverFile], { windowsHide: true });
      execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...(format === 'm4b' ? ['-i', chapterFile, '-i', coverFile, '-map', '0:a:0', '-map', '2:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic', '-map_metadata', '1', '-map_chapters', '1'] : []), '-c:a', codec, '-metadata', 'title=Old title', '-metadata', 'artist=Old author', '-y', file], { windowsHide: true });
      const before = inspect(ffprobe, file);
      const result = await writeAudioMetadata({ ffmpeg, ffprobe, file, format, tags: { title: 'New title', artist: 'New author', composer: 'New narrator', genre: 'Science Fiction' } }).catch(error => { throw new Error(`${format}: ${error.message}`); });
      const read = inspect(ffprobe, file);
      const tags = Object.fromEntries(Object.entries(read.tags).map(([key, value]) => [key.toLowerCase(), value]));
      assert.equal(tags.title, 'New title');
      assert.equal(tags.artist, 'New author');
      assert.equal(tags.genre, 'Science Fiction');
      assert.deepEqual(read.chapters, before.chapters);
      assert.equal(Boolean(read.artwork), Boolean(before.artwork));
      assert.ok(result.sizeBytes > 0);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
