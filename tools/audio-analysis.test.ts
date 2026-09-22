import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { PcmAnalysis, ensureAnalysis, readManifest, waveformSlice } from './audio-analysis';
import { makePreview } from './audio-engine';
import { clampViewport, followViewport, waveformTime, waveformZooms } from '../src/utils/waveform';

function fixture(t: any) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-waveform-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('streaming analysis handles split samples, silence, RMS changes and partial final windows', async t => {
  const directory = fixture(t), audio = path.join(directory, 'preview.wav');
  fs.writeFileSync(audio, 'signature fixture');
  const pcm = Buffer.alloc(1600 * 2 * 2 + 800 * 2);
  for (let i = 1600; i < 3200; i++) pcm.writeInt16LE(16384, i * 2);
  const collector = new PcmAnalysis(audio);
  for (let i = 0; i < pcm.length; i += 113) collector.push(pcm.subarray(i, i + 113));
  const m = await collector.finish();
  assert.equal(m.duration, 0.25);
  const features = fs.readFileSync(m.directory + '/features.bin');
  assert.equal(features.length, 60);
  assert.equal(features.readFloatLE(8), 1);
  assert.ok(Math.abs(features.readFloatLE(12) - 0.1) < 1e-6);
  assert.equal(features.readFloatLE(20), 0.5);
  assert.equal(features.readFloatLE(24), 0.5);
  assert.equal(features.readFloatLE(28), 0);
  assert.equal(features.readFloatLE(36), 0.5);
  assert.equal(features.readFloatLE(56), -0.5);
  assert.ok(Math.abs(features.readFloatLE(52) - 0.05) < 1e-6);
  const slice = await waveformSlice(audio, 0, 0.25, 100);
  assert.deepEqual(slice.peaks, [0, 0.5, 0]);
  assert.equal(fs.readFileSync(m.directory + '/level-1.bin').readFloatLE(), 0.5);
});
test('LOD and viewport responses remain bounded for multi-hour books and reuse cached generations', async t => {
  const directory = fixture(t), audio = path.join(directory, 'preview.wav'); fs.writeFileSync(audio, 'fixture');
  const collector = new PcmAnalysis(audio);
  // Build a representative sparse eight-hour cache without creating gigabytes of PCM.
  collector.push(Buffer.alloc(3200)); const m = await collector.finish();
  const levels = [];
  for (let count = 288000, step = 0.1, i = 0; ; count = Math.ceil(count / 4), step *= 4, i++) {
    const buffer = Buffer.alloc(count * 4); buffer.writeFloatLE(0.75, Math.floor(count / 2) * 4);
    fs.writeFileSync(m.directory + `/level-${i}.bin`, buffer); levels.push({ step, count }); if (count <= 1) break;
  }
  fs.writeFileSync(audio + '.analysis.json', JSON.stringify({ ...m, duration: 28800, levels }));
  for (const duration of [...waveformZooms.slice(0, -1), 28800]) {
    const data = await waveformSlice(audio, 0, duration, 800);
    assert.ok(data.peaks.length <= 3201);
    assert.equal(readManifest(audio).directory, m.directory);
  }
  assert.equal(clampViewport(28500, 600, 28800), 28200);
});
test('preview conversion collects the same PCM once, cache survives reopening and invalidates on replacement', async t => {
  const directory = fixture(t), source = path.join(directory, 'source.wav'), audio = path.join(directory, 'preview.wav');
  const ffmpeg = process.env.TEST_FFMPEG || 'ffmpeg';
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.35', source], { windowsHide: true });
  await makePreview(ffmpeg, source, audio);
  const cached = readManifest(audio); assert.ok(cached);
  const initial = await waveformSlice(audio, 0, 1, 800);
  assert.equal((await ensureAnalysis(audio)).directory, cached.directory);
  fs.unlinkSync(audio + '.analysis.json');
  const [a, b] = await Promise.all([ensureAnalysis(audio), ensureAnalysis(audio)]);
  assert.equal(a.directory, b.directory);
  assert.deepEqual((await waveformSlice(audio, 0, 1, 800)).peaks, initial.peaks);
  assert.ok(Math.abs(a.duration - 0.35) < 0.001);
  await makePreview(ffmpeg, source, audio);
  assert.notEqual(readManifest(audio).directory, a.directory);
  const stat = fs.statSync(audio); fs.utimesSync(audio, stat.atime, new Date(stat.mtimeMs + 2000));
  assert.equal(readManifest(audio), null);
  assert.notEqual((await ensureAnalysis(audio)).directory, a.directory);
});
test('RF64 PCM backfill and malformed previews', async t => {
  const directory = fixture(t), audio = path.join(directory, 'rf64.wav');
  const ffmpeg = process.env.TEST_FFMPEG || 'ffmpeg';
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.25', '-c:a', 'pcm_s16le', '-rf64', 'always', audio], { windowsHide: true });
  assert.equal((await ensureAnalysis(audio)).duration, 0.25);
  fs.writeFileSync(audio, 'broken preview');
  await assert.rejects(ensureAnalysis(audio), /PCM WAV/);
});
test('waveform failure does not fail preview creation and records a diagnostic', async t => {
  const directory = fixture(t), source = path.join(directory, 'source.wav'), audio = path.join(directory, 'preview.wav');
  const ffmpeg = process.env.TEST_FFMPEG || 'ffmpeg';
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.1', source], { windowsHide: true });
  fs.mkdirSync(audio + '.analysis.json'); // Force publication failure, without breaking audio output.
  const messages: string[] = [];
  await makePreview(ffmpeg, source, audio, undefined, message => messages.push(message));
  assert.ok(fs.statSync(audio).size > 3200);
  assert.ok(messages.some(m => m.includes('Waveform analysis failed')));
});
test('viewport transforms preserve seek and marker positions with zoom, boundaries and stable follow', () => {
  assert.equal(waveformZooms[3], 300);
  assert.equal(waveformZooms.at(-1), Infinity);
  assert.equal(waveformTime(400, 800, 100, 300), 250);
  assert.equal(waveformTime(-20, 800, 100, 300), 100);
  assert.equal(waveformTime(900, 800, 100, 300), 400);
  assert.equal(followViewport(260, 0, 300, 10000), 0);
  assert.equal(followViewport(280, 0, 300, 10000), 220);
  assert.equal(followViewport(30, 100, 300, 10000), 0);
  assert.equal(clampViewport(300, 10000, 10000), 0);
});
