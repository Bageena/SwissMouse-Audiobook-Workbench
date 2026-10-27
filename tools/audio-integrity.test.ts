import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PacketTimeline, checkSourceAudio } from './audio-integrity';
import { prepareMaster } from './source-audio';

test('timeline detects missing timestamps, backward DTS, gaps, overlaps and empty streams', () => {
  const inspect = (lines: string[]) => { const timeline = new PacketTimeline(); lines.forEach(line => timeline.read(line)); return timeline.finish(); };
  assert.deepEqual(inspect(['pts_time=-0.02|dts_time=-0.02|duration_time=0.02', 'pts_time=0|dts_time=0|duration_time=0.02']), { packetCount: 2, encodedDurationSeconds: .04 });
  assert.throws(() => inspect(['pts_time=N/A|dts_time=0|duration_time=.02']), /missing or invalid/);
  assert.throws(() => inspect(['dts_time=0|duration_time=.02']), /missing or invalid/);
  assert.throws(() => inspect(['pts_time=0|dts_time=1|duration_time=.02', 'pts_time=.02|dts_time=0|duration_time=.02']), /DTS moves backward/);
  assert.throws(() => inspect(['pts_time=0|dts_time=0|duration_time=.02', 'pts_time=.3|dts_time=.3|duration_time=.02']), /gap/);
  assert.throws(() => inspect(['pts_time=0|dts_time=0|duration_time=.5', 'pts_time=.1|dts_time=.1|duration_time=.02']), /overlap/);
  assert.throws(() => inspect([]), /No readable/);
});

test('real full checks decode WAV and MP3; direct joining uses the same packet checks', async () => {
  const base = path.resolve('.tmp'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'integrity-'));
  const ffmpeg = process.env.TEST_FFMPEG || 'ffmpeg', ffprobe = process.env.TEST_FFPROBE || 'ffprobe';
  try {
    for (const ext of ['wav', 'mp3']) {
      const file = path.join(root, `one.${ext}`);
      execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1:sample_rate=44100', file], { windowsHide: true });
      const second = path.join(root, `two.${ext}`); await fs.copyFile(file, second);
      const before = await fs.readFile(file);
      const report = await checkSourceAudio(ffmpeg, ffprobe, file);
      assert.equal(report.decoding, 'passed'); assert.equal(report.timestamps, 'passed');
      assert.deepEqual(report.issues, []); assert.ok(report.packetCount! > 0); assert.ok(report.encodedDurationSeconds! >= .9);
      await prepareMaster(ffmpeg, ffprobe, [file, second], path.join(root, `join-${ext}`), 'quick');
      assert.deepEqual(await fs.readFile(file), before);
    }
    const bad = path.join(root, 'broken.wav'); await fs.writeFile(bad, 'not audio');
    const failure = await checkSourceAudio(ffmpeg, ffprobe, bad);
    assert.equal(failure.decoding, 'failed'); assert.equal(failure.timestamps, 'failed'); assert.equal(failure.issues.length, 2);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
