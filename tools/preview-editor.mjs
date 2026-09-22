// Isolated manual UI regression fixture. Build first, then run with Node.
// No production jobs, configuration, or audio are read or modified.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { discoverCustomThemes } from './custom-themes.ts';

const root = path.resolve(import.meta.dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(root, 'audio-test-editor-'));
const audioPath = path.join(fixtureRoot, 'preview.wav');
execFileSync(path.join(root, 'runtime/bin/ffmpeg.exe'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=16000:duration=180', audioPath], { windowsHide: true });
const timestamp = seconds => new Date(seconds * 1000).toISOString().slice(11, 23);
const job = {
  id: 'editor-fixture', name: 'Chapter Editor QA', status: 'transcribed', createdAt: new Date().toISOString(),
  totalDurationSeconds: 180, totalSizeBytes: 5760044, parts: [], candidates: [],
  sourceFormat: 'wav', sourceCodec: 'pcm_s16le', sourceBitrate: 256,
  mergedMp3: { filename: 'preview.wav', duration: 180, sizeBytes: 5760044, bitrate: 256 },
  chapters: [
    { id: 'c1', start: timestamp(0), title: 'Chapter One', chapterNumber: 1, headingType: 'numbered_chapter' },
    { id: 'c2', start: timestamp(40), title: 'Chapter Two', chapterNumber: 2, headingType: 'numbered_chapter' },
    { id: 'c3', start: timestamp(90), title: 'My custom title', chapterNumber: 3, titleManuallyEdited: true },
  ],
  transcriptWords: Array.from({ length: 720 }, (_, i) => ({ word: `word${i}`, start: timestamp(i / 4), startSeconds: i / 4, endSeconds: i / 4 + 0.2 })),
  logs: [{ timestamp: '12:00:00', level: 'INFO', message: 'Isolated editor preview fixture' }],
};
const app = express();
app.use(express.json());
app.get('/api/jobs', (_, res) => res.json([job]));
app.get('/api/jobs/:id', (_, res) => res.json(job));
app.post('/api/jobs/:id/chapters', (req, res) => { job.chapters = req.body.chapters; res.json({ status: 'ok', job }); });
app.get('/api/jobs/:id/audio-preview', (_, res) => res.sendFile(audioPath));
app.get('/api/jobs/:id/waveform', (req, res) => {
  const start = Number(req.query.start || 0), duration = Number(req.query.duration || 180), pixels = Math.min(4096, Number(req.query.pixels || 800));
  res.json({ start, duration: 180, step: duration / pixels, peaks: Array.from({ length: pixels }, (_, i) => 0.2 + Math.abs(Math.sin(i)) * 0.6) });
});
app.get('/api/config', (_, res) => res.json({ faster_transcription: true, whisper_profile: 'turbo', lead_in_seconds: 1.5, m4b_settings: { bitrate_stereo: '96k', bitrate_mono: '64k', sample_rate: 44100 } }));
app.get('/api/themes', (_, res) => res.json({ ...discoverCustomThemes(path.join(root, 'themes')), directory: path.join(root, 'themes') }));
app.get('/api/requirements/status', (_, res) => res.json({ components: [{ id: 'ffmpeg', status: 'installed' }, { id: 'ffprobe', status: 'installed' }], statusColor: 'green', summaryMessage: 'Fixture tools ready', hardware: { cpuModel: 'Test CPU', os: 'Windows', arch: 'x64', hasNvidiaGpu: false, recommendationSummary: 'Fixture hardware' } }));
app.get('/api/requirements/install-progress', (_, res) => res.json({ isActive: false, logs: [] }));
app.use(express.static(path.join(root, 'dist')));
app.get('*', (_, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.listen(3108, '127.0.0.1', () => console.log(`Editor fixture: http://127.0.0.1:3108 (${fixtureRoot})`));
