// Isolated browser QA fixture: no production jobs or live catalog requests.
// Build first, then: node --import tsx tools/preview-librivox.mjs
import express from 'express';
import path from 'node:path';
import { discoverCustomThemes } from './custom-themes.ts';
const root = path.resolve(import.meta.dirname, '..');
const job = { id: 'librivox-fixture', name: 'LibriVox import QA', status: 'draft', parts: [], chapters: [], candidates: [], logs: [], totalDurationSeconds: 0, totalSizeBytes: 0, inputMethod: 'librivox', chapterSource: 'whisperx', metadata: { title: 'My edited title', author: '', narrator: '', genres: [], language: '', abridged: false, explicit: false } };
const book = { id: '52', title: 'Letters & Two Brides — Unicode: Honoré, 日本語', authors: ['Honoré de Balzac'], description: 'A multi-reader fixture. <img src=x onerror=alert(1)> is displayed as text, never HTML.', language: 'English', runtime: '9:09:20', durationSeconds: 32960, sectionCount: 2, genres: ['Epistolary Fiction'], projectUrl: 'https://librivox.org/letters-of-two-brides-by-honore-de-balzac/', sections: [
  { id: '1', order: 1, title: 'Letter 1 — A long source title retained for chapter review', url: 'https://archive.org/download/mock/one.mp3', durationSeconds: 10, readers: ['Reader A'] },
  { id: '2', order: 2, title: 'Letter 2', url: 'https://archive.org/download/mock/two.mp3', durationSeconds: 10, readers: ['Reader B', 'Reader C'] },
] };
let progress = { status: 'idle', section: 0, totalSections: 2, title: '', bytes: 0, sectionBytes: 0 };
let timer;
const app = express(); app.use(express.json());
app.get('/api/jobs', (_, res) => res.json([job]));
app.get('/api/jobs/:id', (_, res) => res.json(job));
app.post('/api/jobs/:id/step1-settings', (req, res) => { Object.assign(job, req.body); res.json({ status: 'ok' }); });
app.get('/api/librivox/search', (req, res) => {
  console.log('Fixture search', req.query);
  if (req.query.q === 'error') return res.status(429).json({ error: 'LibriVox is rate limiting requests. Please try again later.' });
  const page = Number(req.query.page || 1);
  res.json({ books: req.query.q === 'none' ? [] : [{ ...book, id: page === 1 ? '52' : '53', title: page === 1 ? book.title : 'Second page book', sections: [] }], page, hasNext: page === 1, skipped: 0 });
});
app.get('/api/librivox/books/:id', (_, res) => res.json(book));
app.get('/api/librivox/import/:id', (_, res) => res.json(progress));
app.post('/api/librivox/import/:id/cancel', (_, res) => { clearInterval(timer); progress.status = 'cancelled'; res.json({ status: 'ok' }); });
app.post('/api/librivox/import/:id', (req, res) => {
  const replace = req.body.replaceMetadata;
  progress = { status: 'downloading', section: 1, totalSections: 2, title: 'Letter 1', bytes: 0, sectionBytes: 0 };
  timer = setInterval(() => {
    progress.bytes += 1024 * 1024; progress.sectionBytes += 1024 * 1024;
    if (progress.bytes >= 4 * 1024 * 1024) { progress.section = 2; progress.title = 'Letter 2'; }
    if (progress.bytes >= 8 * 1024 * 1024) {
      clearInterval(timer); progress.status = 'completed';
      job.parts = [1, 2].map(i => ({ id: 'p' + i, name: '0000' + i + '-section.mp3', order: i, durationSeconds: 10, sizeBytes: 4 * 1024 * 1024, bitrate: 64 }));
      job.discoveredFiles = job.parts.map(p => ({ relativePath: p.name, fileName: p.name, folderName: 'LibriVox Import', format: 'mp3', codec: 'mp3', sampleRate: 44100, channels: 1, isProbed: true, ...p }));
      job.sourceFolderPath = 'Fixture downloads'; job.librivox = book; job.mergeMethod = 'standard';
      job.metadata.author = book.authors.join('; '); job.metadata.narrator = 'Reader A; Reader B; Reader C';
      if (replace) job.metadata.title = book.title;
    }
  }, 1000);
  res.json({ status: 'started' });
});
app.get('/api/config', (_, res) => res.json({ faster_transcription: true, whisper_profile: 'turbo', lead_in_seconds: 1.5, m4b_settings: { bitrate_stereo: '96k', bitrate_mono: '64k', sample_rate: 44100 } }));
app.get('/api/themes', (_, res) => res.json({ ...discoverCustomThemes(path.join(root, 'themes')), directory: path.join(root, 'themes') }));
app.get('/api/requirements/status', (_, res) => res.json({ components: [{ id: 'ffmpeg', name: 'FFmpeg', status: 'ready' }, { id: 'ffprobe', name: 'FFprobe', status: 'ready' }], statusColor: 'green', summaryMessage: 'Fixture tools ready', hardware: { cpuModel: 'Test CPU', os: 'Windows', arch: 'x64', hasNvidiaGpu: false, recommendationSummary: 'Fixture hardware' } }));
app.get('/api/requirements/install-progress', (_, res) => res.json({ isActive: false, logs: [] }));
app.get('/api/whisper/models', (_, res) => res.json([]));
app.get('/api/system/output-folder', (_, res) => res.json({ outputFolder: 'Fixture output', isWritable: true }));
app.get('/api/system/step1-progress', (_, res) => res.json({ isActive: false }));
app.get('/api/tools/yt-dlp/status', (_, res) => res.json({ status: 'not_installed', version: '', ffmpegAvailable: true, ffprobeAvailable: true }));
app.use(express.static(path.join(root, 'dist')));
app.get('*', (_, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.listen(3110, '127.0.0.1', () => console.log('LibriVox UI fixture: http://127.0.0.1:3110'));
