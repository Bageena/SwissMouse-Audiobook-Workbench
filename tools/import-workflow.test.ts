import { readProjectState, writeProjectState, rejectProjectWrites } from './project-store-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { inspect } from './audio-engine';
import { waitForTestServer } from './test-fixtures.mjs';

test('a tagged M4B can finish in the library or continue to processing without reimport', async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'import-workflow-test-'));
  const bin = path.join(root, 'runtime', 'bin');
  const sourceDir = path.join(root, 'source');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(sourceDir);
  const binaryName = (name: string) => process.platform === 'win32' ? `${name}.exe` : name;
  const tool = (name: string, configured?: string) => {
    const candidate = configured || path.resolve('runtime/bin', binaryName(name));
    return fs.existsSync(candidate) ? path.resolve(candidate) : execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
  };
  const ffmpeg = tool('ffmpeg', process.env.TEST_FFMPEG);
  const ffprobe = tool('ffprobe', process.env.TEST_FFPROBE);
  for (const [name, sourceTool] of [['ffmpeg', ffmpeg], ['ffprobe', ffprobe]]) {
    const destination = path.join(bin, binaryName(name));
    try { fs.linkSync(sourceTool, destination); }
    catch { fs.copyFileSync(sourceTool, destination); }
  }
  const source = path.join(sourceDir, 'Finished book.m4b');
  const cover = path.join(sourceDir, 'cover.png');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', cover], { windowsHide: true });
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-i', cover, '-map', '0:a:0', '-map', '1:v:0', '-c:a', 'aac', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic', '-metadata', 'title=Embedded title', '-metadata', 'album=Embedded album', '-metadata', 'artist=Embedded author', '-metadata', 'composer=Embedded narrator', '-f', 'mp4', source], { windowsHide: true });
  const initialBytes = fs.readFileSync(source);
  const port = 42000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const exportFault = path.join(root, 'fail-export-setup');
  const preload = path.join(root, 'export-fault.cjs');
  fs.writeFileSync(preload, `const fs = require('node:fs'); const original = fs.mkdtempSync;
    fs.mkdtempSync = function(prefix, ...args) {
      if (String(prefix).includes('.swissmouse-export-') && fs.existsSync(${JSON.stringify(exportFault)})) {
        fs.unlinkSync(${JSON.stringify(exportFault)}); throw new Error('Injected export setup failure');
      }
      return original.call(this, prefix, ...args);
    };`);
  const serverOptions = { env: { ...process.env, SWISSMOUSE_RUNTIME_MODE: 'managed', APP_ROOT: root, PORT: String(port), NODE_ENV: 'production' }, windowsHide: true, stdio: 'pipe' as const };
  let serverOutput = '';
  const startServer = (args: string[]) => {
    serverOutput = '';
    const child = spawn(process.execPath, args, serverOptions);
    child.stdout.on('data', bytes => { serverOutput += bytes; });
    child.stderr.on('data', bytes => { serverOutput += bytes; });
    return child;
  };
  let server = startServer(['--require', preload, path.resolve('dist/server.cjs')]);
  const request = async (route: string, body?: unknown, method = 'GET') => {
    const response = await fetch(base + route, { method: body === undefined ? method : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data: any = await response.json();
    assert.ok(response.ok, `${route}: ${JSON.stringify(data)}`);
    return data;
  };
  try {
    try { await waitForTestServer(server,base+'/api/library'); }
    catch(error) { assert.fail(`Server started: ${error}\n${serverOutput}`); }
    const newImport = () => request('/api/jobs', { name: 'New book', importPending: true, parts: [] });
    const attach = async (id: string) => {
      await request(`/api/jobs/${id}/step1-settings`, { sourceFolderPath: sourceDir, inputMethod: 'folder', parts: [{ name: path.basename(source), sizeBytes: initialBytes.length, durationSeconds: 2 }] });
      return request(`/api/jobs/${id}/inspect-import`, {});
    };
    const cancelled = await newImport();
    assert.equal((await request('/api/library')).length, 0, 'pending import stays out of library');
    await request(`/api/jobs/${cancelled.id}`, undefined, 'DELETE');
    assert.equal((await request('/api/library')).length, 0, 'cancelling leaves no library entry');

    const switched = await newImport();
    await attach(switched.id);
    await request(`/api/jobs/${switched.id}/step1-settings`, { sourceFolderPath: '', inputMethod: 'youtube', discoveredFiles: [], parts: [] });
    const cleared = await request(`/api/jobs/${switched.id}`);
    assert.equal(cleared.parts.length, 0);
    assert.equal(cleared.importInspected, false);
    assert.equal(cleared.metadata.title, 'New book', 'switching source clears stale imported metadata');
    const staleDraft = await fetch(base + `/api/jobs/${switched.id}/metadata-draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata: { ...cleared.metadata, title: 'Old source' } }) });
    assert.equal(staleDraft.status, 409, 'late draft writes cannot restore metadata from the old source');
    await request(`/api/jobs/${switched.id}`, undefined, 'DELETE');

    const plain = await newImport();
    await request(`/api/jobs/${plain.id}/source-file`, { path: source });
    const inspected = await request(`/api/jobs/${plain.id}/inspect-import`, {});
    assert.equal(inspected.metadata.title, 'Embedded title', 'a whole-book M4B uses its title rather than a potentially shared series album');
    assert.equal(inspected.metadata.author, 'Embedded author');
    assert.equal(inspected.metadata.narrator, 'Embedded narrator');
    assert.match(inspected.metadata.cover.url, /^data:image\/png;base64,/, 'the exclusively associated source cover takes precedence over embedded artwork');
    const edited = { ...inspected.metadata, title: 'Edited title', author: 'Edited author', description: 'Stored only in SwissMouse' };
    await request(`/api/jobs/${plain.id}/finish-import`, { metadata: edited, writeSource: false, process: false });
    assert.deepEqual(fs.readFileSync(source), initialBytes, 'finishing does not change source audio');
    assert.equal((await request('/api/library'))[0].metadata.title, 'Edited title');
    const stored = readProjectState(root)[0];
    assert.equal(stored.metadata.description, 'Stored only in SwissMouse');
    assert.ok(stored.importedAt, 'the book remains imported independently of processing');
    assert.equal((await request(`/api/jobs/${plain.id}`)).mergedMp3, undefined, 'no processing ran');
    const directPlan = await request(`/api/jobs/${plain.id}/organize-library`);
    assert.equal(directPlan.mode, 'move');
    const directOrganized = await request(`/api/jobs/${plain.id}/organize-library`, { source: directPlan.source, target: directPlan.target });
    assert.equal(directOrganized.job.source.path, path.join(directPlan.target, path.basename(source)));
    assert.deepEqual(fs.readFileSync(directOrganized.job.source.path), initialBytes, 'direct M4B can be organized without processing');
    assert.equal(fs.existsSync(source), false, 'organizing moves the external M4B after verification');
    assert.equal(fs.existsSync(cover), false, 'the exclusively associated cover moves with the book');
    assert.ok(fs.existsSync(path.join(directPlan.target, 'cover.png')));
    // Subsequent import scenarios use a fresh external fixture.
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(source, initialBytes);
    fs.copyFileSync(path.join(directPlan.target, 'cover.png'), cover);

    const tagged = await newImport();
    const taggedSource = await attach(tagged.id);
    const replacementCover = path.join(sourceDir, 'replacement.png');
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1', replacementCover], { windowsHide: true });
    await request(`/api/jobs/${tagged.id}/finish-import`, { metadata: { ...taggedSource.metadata, title: 'Written title', cover: { source: 'local', filename: 'replacement.png', url: `data:image/png;base64,${fs.readFileSync(replacementCover).toString('base64')}` } }, writeSource: true, process: false });
    assert.equal(inspect(ffprobe, source).tags.title, 'Written title');
    const replacedArt = inspect(ffprobe, source).artwork;
    assert.equal(replacedArt.codec_name, 'png', 'edited cover was embedded');
    const extractedCover = path.join(sourceDir, 'read-back.png');
    execFileSync(ffmpeg, ['-v', 'error', '-i', source, '-map', `0:${replacedArt.index}`, '-c', 'copy', extractedCover], { windowsHide: true });
    assert.deepEqual(fs.readFileSync(extractedCover), fs.readFileSync(replacementCover), 'embedded cover reads back exactly');

    const removedCoverBook = await newImport();
    const withCover = await attach(removedCoverBook.id);
    await request(`/api/jobs/${removedCoverBook.id}/finish-import`, { metadata: { ...withCover.metadata, cover: null }, writeSource: true });
    assert.equal(inspect(ffprobe, source).artwork, undefined, 'explicit cover removal reads back');

    const processing = await newImport();
    const processingSource = await attach(processing.id);
    await request(`/api/jobs/${processing.id}/finish-import`, { metadata: { ...processingSource.metadata, title: 'Processing title', description: 'Imported description' }, process: true, writeSource: false });
    const received = await request(`/api/jobs/${processing.id}`);
    assert.equal(received.parts[0].name, path.basename(source));
    assert.equal(received.sourceFolderPath, sourceDir);
    assert.equal(received.metadata.title, 'Processing title');
    assert.equal(received.status, 'draft');
    await request(`/api/jobs/${processing.id}/process-step1`, { chapterSource: 'existing_files' });
    let prepared: any;
    for (let attempt = 0; attempt < 100; attempt++) {
      prepared = await request(`/api/jobs/${processing.id}`);
      if (prepared.status === 'transcribed') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(prepared.status, 'transcribed', 'processing used the imported source');
    assert.deepEqual(prepared.chapterReviewBaseline, prepared.chapters, 'processing captures the unedited chapter list');
    const baseline = structuredClone(prepared.chapterReviewBaseline);
    await request(`/api/jobs/${processing.id}/chapters`, { chapters: prepared.chapters.map((chapter: any) => ({ ...chapter, title: 'Reviewed chapter', titleManuallyEdited: true })) });
    const reviewed = await request(`/api/jobs/${processing.id}`);
    assert.equal(reviewed.chapters[0].title, 'Reviewed chapter');
    assert.deepEqual(reviewed.chapterReviewBaseline, baseline, 'saving edits leaves the reset target untouched');
    assert.deepEqual(readProjectState(root).find(item => item.id === processing.id)?.chapterReviewBaseline, baseline, 'reset target persists in the authoritative project store');

    assert.equal(prepared.metadata.description, 'Imported description', 'processing retained import metadata');
    await request(`/api/jobs/${processing.id}/metadata`, { metadata: { ...prepared.metadata, title: 'Reviewed title' } });
    const exported = await request(`/api/jobs/${processing.id}/build-m4b`, { outputFormats: ['m4b'] });
    const output = exported.exports.find((item: any) => item.format === 'm4b')?.fullPath;
    assert.ok(output && fs.existsSync(output), 'reviewed book was exported');
    assert.equal(inspect(ffprobe, output).tags.title, 'Reviewed title');

    const progress = await request(`/api/jobs/${processing.id}/export-progress`);
    assert.equal(progress.running, false);
    assert.equal(progress.exports[0].status, 'success');
    assert.equal(progress.transcriptWords, undefined);
    assert.equal(progress.metadata, undefined);
    const candidateCsv = await fetch(base + `/api/jobs/${processing.id}/export/candidates-csv`);
    assert.equal(candidateCsv.status, 200);
    assert.match(candidateCsv.headers.get('content-type') || '', /^text\/csv/);
    assert.match(candidateCsv.headers.get('content-disposition') || '', /candidates\.csv/);
    assert.match(await candidateCsv.text(), /^candidate_id,candidate_start,/);
    const originalOutput = fs.readFileSync(output);
    fs.writeFileSync(exportFault, 'fail once');
    const failedSetup = await fetch(base + `/api/jobs/${processing.id}/build-m4b`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputFormats: ['m4b'], overwriteExisting: true, confirmedOverwritePaths: [output] }),
    });
    assert.equal(failedSetup.status, 500);
    assert.match((await failedSetup.json()).error, /Injected export setup failure/);
    const stopped = await request(`/api/jobs/${processing.id}/export-progress`);
    assert.equal(stopped.running, false);
    assert.ok(stopped.exports.every((item: any) => !['queued', 'running'].includes(item.status)));
    assert.deepEqual(fs.readFileSync(output), originalOutput, 'setup failure preserves the last successful audio');
    await request(`/api/jobs/${processing.id}/build-audio`, { outputFormats: ['m4b'], overwriteExisting: true, confirmedOverwritePaths: [output] });
    assert.equal((await request(`/api/jobs/${processing.id}/export-progress`)).running, false, 'retry completes without a restart');

    const folder = path.join(root, 'chapter files');
    fs.mkdirSync(folder);
    for (const name of ['01.mp3', '02.mp3']) execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', '-c:a', 'libmp3lame', path.join(folder, name)], { windowsHide: true });
    const originalTracks = ['01.mp3', '02.mp3'].map(name => fs.readFileSync(path.join(folder, name)));
    const scanned = await request('/api/system/scan-folder', { folderPath: folder });
    assert.deepEqual(scanned.files.map((file: any) => file.relativePath), ['01.mp3', '02.mp3'], 'folder browsing scans every track in order');
    const filesBook = await newImport();
    await request(`/api/jobs/${filesBook.id}/step1-settings`, { sourceFolderPath: scanned.sourcePath, inputMethod: 'folder', discoveredFiles: scanned.files, parts: scanned.files.map((file: any) => ({ name: file.relativePath, sourceRelativePath: file.relativePath, sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds })) });
    const filesInspected = await request(`/api/jobs/${filesBook.id}/inspect-import`, {});
    assert.equal(filesInspected.metadata.title, 'chapter files', 'multi-file book title comes from the folder');
    await request(`/api/jobs/${filesBook.id}/finish-import`, { metadata: { ...filesInspected.metadata, title: 'Folder book' }, process: true });
    const handedOff = await request(`/api/jobs/${filesBook.id}`);
    assert.deepEqual(handedOff.parts.map((part: any) => part.name), ['01.mp3', '02.mp3']);
    assert.deepEqual(handedOff.source, { kind: 'external', path: folder, mode: 'folder' }, 'folder remains an external reference');
    assert.equal(handedOff.metadata.title, 'Folder book');
    assert.deepEqual(['01.mp3', '02.mp3'].map(name => fs.readFileSync(path.join(folder, name))), originalTracks, 'folder import leaves original tracks unchanged');
    fs.mkdirSync(path.join(folder, 'Extras'));
    fs.writeFileSync(path.join(folder, 'Extras', 'notes.txt'), 'Keep the complete folder tree');
    const organization = await request(`/api/jobs/${filesBook.id}/organize-library`);
    assert.equal(organization.mode, 'move');
    assert.ok(organization.target.includes('Folder book'));
    const unconfirmedOrganization = await fetch(base + `/api/jobs/${filesBook.id}/organize-library`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: organization.source, target: organization.target + '-changed' }) });
    assert.equal(unconfirmedOrganization.status, 409, 'the destination must match the preview');
    const organized = await request(`/api/jobs/${filesBook.id}/organize-library`, { source: organization.source, target: organization.target });
    assert.equal(organized.job.source.kind, 'managed');
    assert.equal(organized.job.status, 'draft', 'organizing does not process audio');
    assert.equal(organized.job.sourceFolderPath, organization.target);
    assert.deepEqual(fs.readFileSync(path.join(organization.target, '01.mp3')), originalTracks[0]);
    assert.equal(fs.existsSync(path.join(organization.target, 'Extras', 'notes.txt')), false, 'unassociated notes are excluded from transfers');
    assert.equal(fs.readFileSync(path.join(folder, 'Extras', 'notes.txt'), 'utf8'), 'Keep the complete folder tree');
    assert.equal(fs.existsSync(path.join(folder, '01.mp3')), false, 'organizing removes verified external audio while leaving unrelated notes');
    assert.equal(JSON.parse(fs.readFileSync(path.join(organization.target, 'exmetadata.json'), 'utf8')).metadata.title, 'Folder book');
    await request(`/api/jobs/${filesBook.id}/metadata`, { metadata: { ...handedOff.metadata, title: 'Renamed folder book' } });
    const relocation = await request(`/api/jobs/${filesBook.id}/organize-library`);
    assert.equal(relocation.mode, 'move');
    fs.mkdirSync(relocation.target, { recursive: true });
    fs.writeFileSync(path.join(relocation.target, 'sentinel.txt'), 'Do not replace');
    const staleRelocation = await fetch(base + `/api/jobs/${filesBook.id}/organize-library`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: relocation.source, target: relocation.target }) });
    assert.equal(staleRelocation.status, 409, 'a newly occupied destination needs a new preview');
    const revisedRelocation = await request(`/api/jobs/${filesBook.id}/organize-library`);
    const relocated = await request(`/api/jobs/${filesBook.id}/organize-library`, { source: revisedRelocation.source, target: revisedRelocation.target });
    assert.equal(relocated.job.sourceFolderPath, revisedRelocation.target);
    assert.equal(fs.existsSync(organization.target), false, 'managed book folder moved rather than duplicated');
    assert.equal(fs.existsSync(path.join(revisedRelocation.target, 'Extras', 'notes.txt')), false);
    assert.equal(fs.readFileSync(path.join(relocation.target, 'sentinel.txt'), 'utf8'), 'Do not replace');
    assert.deepEqual(relocated.job.parts.map((part: any) => part.name), ['01.mp3', '02.mp3']);
    await request(`/api/jobs/${filesBook.id}/metadata`, { metadata: { ...relocated.job.metadata, title: 'Nested book', series: path.basename(revisedRelocation.target) } });
    const nestedPlan = await request(`/api/jobs/${filesBook.id}/organize-library`);
    assert.ok(nestedPlan.target.startsWith(revisedRelocation.target + path.sep), `series organization can place a book beneath its former folder: ${JSON.stringify({ source: revisedRelocation.target, target: nestedPlan.target })}`);
    const nested = await request(`/api/jobs/${filesBook.id}/organize-library`, { source: nestedPlan.source, target: nestedPlan.target });
    assert.equal(nested.job.sourceFolderPath, nestedPlan.target);
    assert.equal(fs.existsSync(path.join(nestedPlan.target, 'Extras', 'notes.txt')), false);

    // Named chapter groups follow an explicit order, survive settings payloads,
    // and place markers at the inspected durations of the prepared audio.
    const manualDir = path.join(root, 'Manual groups');
    fs.mkdirSync(manualDir);
    const manualNames = ['03.wav', '01.wav', '02.wav', '04.wav'];
    const manualParts = manualNames.map((name, index) => {
      const file = path.join(manualDir, name);
      execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${440 + index * 100}:duration=${0.2 + index * 0.1}`, file], { windowsHide: true });
      return { name, sourceRelativePath: name, sizeBytes: fs.statSync(file).size, durationSeconds: inspect(ffprobe, file).durationSeconds };
    });
    const originals = manualNames.map(name => fs.readFileSync(path.join(manualDir, name)));
    const manual = await newImport();
    await request(`/api/jobs/${manual.id}/step1-settings`, { sourceFolderPath: manualDir, inputMethod: 'folder', parts: manualParts });
    await request(`/api/jobs/${manual.id}/source-files`, { action: 'reorder', files: manualNames });
    await request(`/api/jobs/${manual.id}/source-files`, { action: 'group', files: manualNames.slice(0, 2), title: 'Opening scene' });
    const savedGroups = (await request(`/api/jobs/${manual.id}/source-files`, { action: 'refresh' })).job;
    assert.deepEqual(savedGroups.parts.map((part: any) => part.chapterGroup?.title), ['Opening scene', 'Opening scene', undefined, undefined]);
    await request(`/api/jobs/${manual.id}/step1-settings`, { parts: manualParts, chapterSource: 'grouped_files' });
    await request(`/api/jobs/${manual.id}/process-step1`, { chapterSource: 'grouped_files', parts: manualParts });
    let manualProcessed: any;
    for (let i = 0; i < 200; i++) {
      manualProcessed = await request(`/api/jobs/${manual.id}`);
      if (manualProcessed.status === 'transcribed') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(manualProcessed.status, 'transcribed', JSON.stringify(manualProcessed.logs));
    assert.deepEqual(manualProcessed.parts.map((part: any) => part.name), manualNames);
    assert.deepEqual(manualProcessed.chapters.map((chapter: any) => [chapter.title, chapter.start]), [
      ['Opening scene', '00:00:00.000'], ['02', '00:00:00.500'], ['04', '00:00:00.900'],
    ]);
    assert.ok(Math.abs(inspect(ffprobe, manualProcessed.mergedMp3.fullPath).durationSeconds - 1.4) < 0.05);
    await request(`/api/jobs/${manual.id}/rerun/extracting_chapters`, {});
    for (let i = 0; i < 100; i++) {
      manualProcessed = await request(`/api/jobs/${manual.id}`);
      if (manualProcessed.pipelineSteps.extracting_chapters.status === 'current') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.deepEqual(manualProcessed.chapters.map((chapter: any) => chapter.title), ['Opening scene', '02', '04']);
    const ungrouped = await request(`/api/jobs/${manual.id}/source-files`, { action: 'ungroup', files: [manualNames[0]] });
    assert.ok(ungrouped.job.parts.every((part: any) => !part.chapterGroup));
    assert.equal(ungrouped.job.pipelineSteps.extracting_chapters.status, 'stale');
    manualNames.forEach((name, index) => assert.deepEqual(fs.readFileSync(path.join(manualDir, name)), originals[index]));

    const anthology = path.join(root, 'Stephen King');
    fs.mkdirSync(anthology);
    const salem = ["Stephen King - 1975 - Salem's Lot (1 of 2).m4b", "Stephen King - 1975 - Salem's Lot (2 of 2).m4b"];
    for (const name of [...salem, 'Stephen King - 1974 - Carrie.m4b']) {
      execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.2', '-c:a', 'aac', path.join(anthology, name)], { windowsHide: true });
    }
    const grouped = await newImport();
    const groupPlan = await request(`/api/jobs/${grouped.id}/local-source`, { path: anthology });
    assert.equal(groupPlan.needsGroup, true);
    assert.deepEqual(groupPlan.groups.map((group: any) => group.files.length).sort(), [1, 2]);
    const unsafeCommit = await fetch(base + `/api/jobs/${grouped.id}/local-source`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: anthology, commit: true }) });
    assert.equal(unsafeCommit.status, 409);
    assert.equal((await request(`/api/jobs/${grouped.id}`)).parts.length, 0);
    const salemGroup = groupPlan.groups.find((group: any) => group.files.length === 2);
    const groupedResult = await request(`/api/jobs/${grouped.id}/local-source`, { path: anthology, groupId: salemGroup.id, commit: true });
    assert.deepEqual(groupedResult.job.parts.map((part: any) => part.name), salem);
    const groupTree = await request(`/api/jobs/${grouped.id}/source-tree`);
    assert.equal(groupTree.summary.audioFiles, 2);
    assert.equal(groupTree.summary.diskAudioFiles, 3);
    const previewOnDisk = await fetch(base + `/api/jobs/${grouped.id}/audio-preview?file=${encodeURIComponent('Stephen King - 1974 - Carrie.m4b')}`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(previewOnDisk.status, 206);
    assert.equal((await previewOnDisk.arrayBuffer()).byteLength, 100);
    const unsafePreview = await fetch(base + `/api/jobs/${grouped.id}/audio-preview?file=${encodeURIComponent('../source/Finished book.m4b')}`);
    assert.equal(unsafePreview.status, 400);
    await request(`/api/jobs/${grouped.id}/source-files`, { action: 'remove', files: [salem[1]] });
    for (let i = 0; i < 2; i++) {
      const refreshed = await request(`/api/jobs/${grouped.id}/source-files`, { action: 'refresh' });
      assert.deepEqual(refreshed.job.parts.map((part: any) => part.name), [salem[0]]);
      assert.deepEqual(refreshed.job.discoveredFiles.map((file: any) => file.relativePath), [salem[0]]);
      assert.ok(!refreshed.groups.some((group: any) => group.files.includes(salem[1])), 'explicit exclusions are not suggested');
    }
    const staleRun = await fetch(base + `/api/jobs/${grouped.id}/process-step1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapterSource: 'existing_files', parts: groupedResult.job.parts }) });
    assert.equal(staleRun.status, 409, 'a stale run cannot reattach removed files');
    await request(`/api/jobs/${grouped.id}/process-step1`, { chapterSource: 'existing_files' });
    let groupedProcessed: any;
    for (let i = 0; i < 100; i++) {
      groupedProcessed = await request(`/api/jobs/${grouped.id}`);
      if (groupedProcessed.status === 'transcribed') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(groupedProcessed.status, 'transcribed');
    assert.deepEqual(groupedProcessed.parts.map((part: any) => part.name), [salem[0]], 'processing only uses attached audio');
    assert.equal(groupedProcessed.mergedMp3.fullPath, path.join(anthology, salem[0]));
    // Manual selection is a separate preview/commit operation, with no disk writes.
    const selectionRoute = `/api/jobs/${grouped.id}/source-selection`;
    const sourceBytes = fs.readFileSync(path.join(anthology, salem[0]));
    const replacePlan = await request(selectionRoute, { action: 'replace', files: [...salem].reverse() });
    assert.deepEqual(replacePlan.files, salem, 'manual multipart selection uses sensible natural order');
    assert.equal((await request(`/api/jobs/${grouped.id}`)).parts.length, 1, 'preview does not mutate membership');
    const noConfirm = await fetch(base + selectionRoute, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'replace', files: salem, commit: true }) });
    assert.equal(noConfirm.status, 409);
    const replaced = await request(selectionRoute, { action: 'replace', files: salem, commit: true, token: replacePlan.token });
    assert.equal(replaced.job.sourceMembership, 'confirmed');
    assert.deepEqual(replaced.job.explicitlyAddedSourceFiles, salem);
    await request(`/api/jobs/${grouped.id}/source-files`, { action: 'reorder', files: [...salem].reverse() });
    const manualOrderPlan = await request(selectionRoute, { action: 'replace', files: salem });
    assert.deepEqual(manualOrderPlan.files, [...salem].reverse(), 'an existing explicit playback order is retained');
    await request(`/api/jobs/${grouped.id}/source-files`, { action: 'reorder', files: salem });
    const carrie = 'Stephen King - 1974 - Carrie.m4b';
    const createPlan = await request(selectionRoute, { action: 'create', files: [carrie] });
    assert.equal(createPlan.title, 'Carrie');
    assert.equal(createPlan.transfers.length, 0);
    const created = await request(selectionRoute, { action: 'create', files: [carrie], commit: true, token: createPlan.token });
    assert.ok(created.createdBook.review, 'filename-only metadata stays flagged for review');
    const carrieId = created.createdBook.id;
    assert.deepEqual((await request(`/api/jobs/${carrieId}`)).parts.map((part: any) => part.name), [carrie]);
    const transferPlan = await request(selectionRoute, { action: 'replace', files: [carrie] });
    assert.equal(transferPlan.transfers[0].id, carrieId);
    assert.equal(transferPlan.transfers[0].remaining, 0, 'emptying the previous project is disclosed');
    assert.deepEqual(transferPlan.removed, salem);
    const manuallyTransferred = await request(selectionRoute, { action: 'replace', files: [carrie], commit: true, token: transferPlan.token });
    assert.deepEqual(manuallyTransferred.job.parts.map((part: any) => part.name), [carrie]);
    assert.deepEqual(manuallyTransferred.job.excludedSourceFiles.sort(), [...salem].sort());
    assert.equal((await request(`/api/jobs/${carrieId}`)).parts.length, 0);
    const confirmedSettings = await fetch(base + `/api/jobs/${grouped.id}/step1-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts: groupedResult.job.parts }) });
    assert.equal(confirmedSettings.status, 409, 'stale settings cannot override confirmed membership');
    const forbiddenAdd = await fetch(base + `/api/jobs/${carrieId}/source-files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'include', files: [carrie] }) });
    assert.equal(forbiddenAdd.status, 400, 'adding cannot silently duplicate ownership');
    const replay = await fetch(base + selectionRoute, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'replace', files: [carrie], commit: true, token: transferPlan.token }) });
    assert.equal(replay.status, 409, 'stale confirmations are rejected');
    for (const id of [grouped.id, carrieId]) await request(`/api/jobs/${id}/source-files`, { action: 'refresh' });
    await request('/api/library/rescan', {});
    assert.deepEqual((await request(`/api/jobs/${grouped.id}`)).parts.map((part: any) => part.name), [carrie]);
    assert.equal((await request(`/api/jobs/${carrieId}`)).parts.length, 0, 'refresh preserves deliberate reassignment');
    const manualPersisted = readProjectState(root);
    assert.equal(manualPersisted.find((book: any) => book.id === grouped.id).sourceMembership, 'confirmed');
    assert.ok(manualPersisted.find((book: any) => book.id === carrieId).excludedSourceFiles.includes(carrie));
    assert.deepEqual(fs.readFileSync(path.join(anthology, salem[0])), sourceBytes, 'manual grouping never changes physical audio');
    const failedPlan = await request(selectionRoute, { action: 'create', files: [carrie] });
    const allowWrites=rejectProjectWrites(root);
    try {
      const failedCommit = await fetch(base + selectionRoute, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', files: [carrie], commit: true, token: failedPlan.token }) });
      assert.equal(failedCommit.status, 400);
      assert.deepEqual((await request(`/api/jobs/${grouped.id}`)).parts.map((part: any) => part.name), [carrie], 'failed persistence rolls back reassignment');
    } finally { allowWrites(); }
    await request(`/api/jobs/${carrieId}`, undefined, 'DELETE');
    await request(`/api/jobs/${grouped.id}`, undefined, 'DELETE');

    const chosen = await newImport();
    // Organization above moved these tracks; restore fixtures for read-only selection tests.
    for (const [index, name] of ['01.mp3', '02.mp3'].entries()) fs.writeFileSync(path.join(folder, name), originalTracks[index]);
    const chosenFiles = await request(`/api/jobs/${chosen.id}/local-source`, { paths: [path.join(folder, '02.mp3')] });
    assert.deepEqual(chosenFiles.files.map((file: any) => file.fileName), ['02.mp3']);
    const chosenResult = await request(`/api/jobs/${chosen.id}/local-source`, { paths: [path.join(folder, '02.mp3')], commit: true });
    assert.deepEqual(chosenResult.job.parts.map((part: any) => part.name), ['02.mp3'], 'individual selection excludes other tracks');
    assert.deepEqual(fs.readFileSync(path.join(folder, '02.mp3')), originalTracks[1], 'current-location selection preserves the original');

    const selectionDir = path.join(root, 'selected tracks');
    fs.mkdirSync(selectionDir);
    for (const name of ['01.mp3', '02.mp3', '03.mp3']) fs.copyFileSync(path.join(folder, '01.mp3'), path.join(selectionDir, name));
    const selectedFiles = [path.join(selectionDir, '03.mp3'), path.join(selectionDir, '01.mp3')];
    const selectedBook = await newImport();
    const selectedResult = await request(`/api/jobs/${selectedBook.id}/local-source`, { paths: selectedFiles, commit: true });
    assert.deepEqual(selectedResult.job.parts.map((part: any) => part.name), ['01.mp3', '03.mp3'], 'multiple file selection keeps only selected files in natural order');
    assert.equal(fs.existsSync(path.join(selectionDir, '02.mp3')), true);

    const missingPath = await fetch(base + `/api/jobs/${chosen.id}/local-source`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path.join(root, 'missing') }) });
    assert.equal(missingPath.status, 400);
    assert.match((await missingPath.json()).error, /does not exist/);
    const empty = path.join(root, 'empty-audio');
    fs.mkdirSync(empty);
    const noAudio = await fetch(base + `/api/jobs/${chosen.id}/local-source`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: empty }) });
    assert.equal(noAudio.status, 400);
    assert.match((await noAudio.json()).error, /No supported audio/);

    const moveFrom = path.join(root, 'For move');
    fs.mkdirSync(moveFrom);
    fs.copyFileSync(path.join(folder, '01.mp3'), path.join(moveFrom, '01.mp3'));
    fs.copyFileSync(path.join(folder, '02.mp3'), path.join(moveFrom, '02.mp3'));
    fs.writeFileSync(path.join(moveFrom, 'notes.txt'), 'keep');
    const collisionDir = path.join(root, 'output', 'For move');
    fs.mkdirSync(collisionDir, { recursive: true });
    fs.writeFileSync(path.join(collisionDir, '01.mp3'), 'existing file');
    const moving = await newImport();
    const movePlan = await request(`/api/jobs/${moving.id}/local-source`, { path: moveFrom, move: true });
    assert.equal(movePlan.collision, true);
    assert.notEqual(movePlan.destination, collisionDir);
    const unconfirmed = await fetch(base + `/api/jobs/${moving.id}/local-source`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: moveFrom, move: true, commit: true }) });
    assert.equal(unconfirmed.status, 409, 'a move requires the previewed destination');
    fs.mkdirSync(movePlan.destination);
    fs.writeFileSync(path.join(movePlan.destination, 'sentinel.txt'), 'later collision');
    const stalePlan = await fetch(base + `/api/jobs/${moving.id}/local-source`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: moveFrom, move: true, commit: true, destination: movePlan.destination }) });
    assert.equal(stalePlan.status, 409, 'a newly occupied destination requires another preview');
    assert.equal(fs.readFileSync(path.join(movePlan.destination, 'sentinel.txt'), 'utf8'), 'later collision');
    const updatedPlan = await request(`/api/jobs/${moving.id}/local-source`, { path: moveFrom, move: true });
    const movedLocal = await request(`/api/jobs/${moving.id}/local-source`, { path: moveFrom, move: true, commit: true, destination: updatedPlan.destination });
    assert.equal(movedLocal.job.source.kind, 'managed');
    assert.deepEqual(fs.readFileSync(path.join(updatedPlan.destination, '01.mp3')), originalTracks[0]);
    assert.deepEqual(fs.readFileSync(path.join(updatedPlan.destination, '02.mp3')), originalTracks[1]);
    assert.equal(fs.readFileSync(path.join(collisionDir, '01.mp3'), 'utf8'), 'existing file', 'collision never overwrites');
    assert.equal(fs.existsSync(path.join(moveFrom, '01.mp3')), false);
    assert.equal(fs.existsSync(path.join(moveFrom, '02.mp3')), false);
    assert.equal(fs.readFileSync(path.join(moveFrom, 'notes.txt'), 'utf8'), 'keep', 'unselected files stay in place');

    const externalDir = path.join(root, 'external');
    fs.mkdirSync(externalDir);
    const external = path.join(externalDir, 'Reference only.m4b');
    fs.copyFileSync(source, external);
    const externalBytes = fs.readFileSync(external);
    const referenced = await newImport();
    const relativePath = await fetch(base + `/api/jobs/${referenced.id}/source-file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'Reference only.m4b' }) });
    assert.equal(relativePath.status, 400, 'source registration requires an absolute path');
    const registered = await request(`/api/jobs/${referenced.id}/source-file`, { path: external });
    assert.equal(registered.job.id, referenced.id);
    assert.deepEqual(registered.job.source, { kind: 'external', path: external, mode: 'file' });
    assert.equal(registered.job.parts[0].name, path.basename(external));
    const inspectedReference = await request(`/api/jobs/${referenced.id}/inspect-import`, {});
    assert.equal(inspectedReference.metadata.author, 'Embedded author');
    await request(`/api/jobs/${referenced.id}/finish-import`, { metadata: inspectedReference.metadata, writeSource: false, process: false });
    assert.deepEqual(fs.readFileSync(external), externalBytes, 'reference import does not alter the original');
    assert.deepEqual(fs.readdirSync(externalDir), [path.basename(external)], 'reference import leaves no SwissMouse files beside the audiobook');
    const preview = await fetch(base + `/api/jobs/${referenced.id}/audio-preview`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(preview.status, 206, 'the original M4B is streamed for chapter review without processing');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), externalBytes.subarray(0, 100));
    let summary = (await request('/api/library')).find((book: any) => book.id === referenced.id);
    assert.equal(summary.sourceLocation, 'external');
    assert.equal(summary.sourceMissing, false);
    const prematureRelink = await fetch(base + `/api/jobs/${referenced.id}/source-file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: external, relink: true }) });
    assert.equal(prematureRelink.status, 409, 'an available source cannot be silently replaced');
    const moved = path.join(externalDir, 'Relinked.m4b');
    fs.renameSync(external, moved);
    await request('/api/library/refresh', {}); // Availability is observed in maintenance, not each browse.
    summary = (await request('/api/library')).find((book: any) => book.id === referenced.id);
    assert.equal(summary.sourceMissing, true);
    assert.equal(summary.metadata.title, inspectedReference.metadata.title, 'missing source retains book metadata');
    const relinked = await request(`/api/jobs/${referenced.id}/source-file`, { path: moved, relink: true });
    assert.equal(relinked.job.id, referenced.id, 'relink preserves stable identity');
    assert.equal(relinked.job.source.path, moved);
    assert.equal((await request('/api/library')).filter((book: any) => book.id === referenced.id).length, 1);
    const transferred = await request(`/api/library/${referenced.id}/send-to-library`, {});
    assert.equal(transferred.book.sourceLocation, 'managed');
    assert.equal(transferred.job.source.kind, 'managed');
    assert.equal(transferred.job.id, referenced.id);
    assert.ok(fs.existsSync(transferred.job.source.path));
    assert.deepEqual(fs.readFileSync(moved), externalBytes, 'copy leaves original intact');
    assert.deepEqual(fs.readFileSync(transferred.job.source.path), externalBytes, 'managed source reads back identically');
    const sidecar = JSON.parse(fs.readFileSync(path.join(transferred.path, 'exmetadata.json'), 'utf8')).metadata;
    assert.equal(sidecar.title, inspectedReference.metadata.title);
    for (const internal of ['sourcePath', 'managed', 'processingStatus', 'hashes', 'cachePaths', 'source', 'library']) assert.equal(internal in sidecar, false, `${internal} must stay out of Audiobookshelf metadata`);
    await request('/api/library/metadata', { changes: [{ id: referenced.id, fields: { title: 'Managed title' } }] });
    assert.equal(JSON.parse(fs.readFileSync(path.join(transferred.path, 'exmetadata.json'), 'utf8')).metadata.title, 'Managed title', 'managed sidecar follows metadata edits');
    const compatibilityPath=path.join(transferred.path,'metadata.json');
    assert.equal(fs.existsSync(compatibilityPath),false,'compatibility export is off by default');
    const settings=await request('/api/config');
    await request('/api/config',{...settings,audiobookshelf_metadata:true});
    await request(`/api/jobs/${referenced.id}/metadata-json`,{});
    assert.equal(JSON.parse(fs.readFileSync(compatibilityPath,'utf8')).title,'Managed title');
    const compatibilityBytes=fs.readFileSync(compatibilityPath);
    await request('/api/config',{...settings,audiobookshelf_metadata:false});
    await request(`/api/jobs/${referenced.id}/metadata-json`,{});
    assert.deepEqual(fs.readFileSync(compatibilityPath),compatibilityBytes,'turning compatibility off preserves the existing file during rebuild');
    assert.deepEqual(fs.readdirSync(externalDir), [path.basename(moved)], 'source folder remains untouched after Library transfer');
    assert.equal((await request(`/api/jobs/${referenced.id}`)).source.path, transferred.job.source.path);
    assert.equal(readProjectState(root).find((book: any) => book.id === referenced.id).source.path, transferred.job.source.path, 'managed source is persisted');
    const chapterMeta = path.join(root, 'embedded-chapters.txt');
    fs.writeFileSync(chapterMeta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Opening\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Second\n');
    const chaptered = path.join(externalDir, 'Chaptered.m4b');
    execFileSync(ffmpeg, ['-v', 'error', '-i', source, '-f', 'ffmetadata', '-i', chapterMeta, '-map', '0', '-map_chapters', '1', '-c', 'copy', '-f', 'mp4', chaptered], { windowsHide: true });
    const chaptersBook = await newImport();
    await request(`/api/jobs/${chaptersBook.id}/source-file`, { path: chaptered });
    const chapterImport = await request(`/api/jobs/${chaptersBook.id}/inspect-import`, {});
    assert.deepEqual(chapterImport.existingChapters.map((chapter: any) => chapter.title), ['Opening', 'Second'], 'embedded chapters are detected');
    assert.deepEqual(chapterImport.chapters.map((chapter: any) => chapter.title), ['Opening', 'Second'], 'embedded chapters populate editable state');
    const browseParent = path.join(root, 'Browser fixture'), browseBook = path.join(browseParent, 'Book'), sibling = path.join(browseParent, 'Extras');
    fs.mkdirSync(browseBook, { recursive: true }); fs.mkdirSync(sibling);
    for (const file of [path.join(browseBook, '01.mp3'), path.join(sibling, '02.mp3'), path.join(browseParent, '03.mp3')]) fs.copyFileSync(path.join(folder, '01.mp3'), file);
    const browserBook = await newImport();
    const browserImported = await request(`/api/jobs/${browserBook.id}/local-source`, { paths: [path.join(browseBook, '01.mp3')], commit: true });
    const browserRoute = `/api/jobs/${browserBook.id}/source-tree?view=directory`;
    const browserFiles = `/api/jobs/${browserBook.id}/source-files`;
    const initialBrowser = await request(browserRoute);
    assert.equal(initialBrowser.directory, browseBook); assert.equal(initialBrowser.parent, browseParent);
    assert.equal(initialBrowser.entries[0].included, true);
    const beforeBrowse = JSON.stringify(readProjectState(root));
    const parentBrowser = await request(`${browserRoute}&directory=${encodeURIComponent(initialBrowser.parent)}`);
    assert.deepEqual(parentBrowser.entries.map((entry: any) => entry.name), ['Book', 'Extras', '03.mp3']);
    assert.deepEqual(parentBrowser.missingFiles, [], 'off-screen members are not missing');
    const siblingBrowser = await request(`${browserRoute}&directory=${encodeURIComponent(sibling)}`);
    assert.equal(siblingBrowser.entries[0].included, false);
    assert.equal(JSON.stringify(readProjectState(root)), beforeBrowse, 'navigation does not mutate membership or project state');
    const siblingPreview = await fetch(base + `/api/jobs/${browserBook.id}/audio-preview?directory=${encodeURIComponent(sibling)}&file=02.mp3`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(siblingPreview.status, 206); assert.equal((await siblingPreview.arrayBuffer()).byteLength, 100);
    const attached = await request(browserFiles, { action: 'include', files: [siblingBrowser.entries[0].relativePath], directory: sibling, view: 'directory' });
    assert.equal(attached.job.parts.length, 2);
    assert.equal(attached.job.sourceFolderPath, browseParent);
    assert.deepEqual(attached.job.parts.map((part: any) => part.name), ['Book/01.mp3', 'Extras/02.mp3']);
    assert.equal(attached.job.parts[0].id, browserImported.job.parts[0].id);
    assert.equal(attached.directory, sibling); assert.equal(attached.entries[0].included, true);
    assert.deepEqual(fs.readdirSync(browseBook), ['01.mp3'], 'adding is a reference, not a copy');
    assert.deepEqual(fs.readFileSync(path.join(sibling, '02.mp3')), originalTracks[0]);
    const removed = await request(browserFiles, { action: 'remove', files: ['Extras/02.mp3'], directory: sibling, view: 'directory' });
    assert.equal(removed.entries[0].included, false); assert.equal(removed.job.parts.length, 1);
    await request(browserFiles, { action: 'refresh' });
    assert.equal((await request(`${browserRoute}&directory=${encodeURIComponent(sibling)}`)).entries[0].included, false, 'refresh preserves removal');
    const invalidAttachment = await fetch(base + browserFiles, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'include', directory: sibling, files: ['03.mp3'], view: 'directory' }) });
    assert.equal(invalidAttachment.status, 400, 'selection must belong to the viewed directory');
    assert.equal((await request(`/api/jobs/${browserBook.id}`)).parts.length, 1);
    server.kill();
    await new Promise(resolve => server.once('exit', resolve));
    const persisted = readProjectState(root);
    delete persisted.find((book: any) => book.id === tagged.id).source; // Simulate a pre-migration book.
    const survivingFolder = path.join(directPlan.root, 'Surviving export');
    fs.mkdirSync(survivingFolder, { recursive: true });
    const survivingM4b = path.join(survivingFolder, 'finished.m4b');
    fs.copyFileSync(source, survivingM4b);
    const missingSource = path.join(sourceDir, 'deleted-source.mp3');
    const orphan = structuredClone(persisted.find((book: any) => book.id === plain.id));
    orphan.id = 'orphan-finished-book';
    orphan.name = 'Recovered M4B';
    orphan.metadata = { ...orphan.metadata, title: 'Recovered M4B' };
    orphan.source = { kind: 'external', mode: 'file', path: missingSource };
    orphan.sourceFolderPath = sourceDir;
    orphan.parts = [{ ...orphan.parts[0], name: path.basename(missingSource) }];
    orphan.outputM4b = { filename: 'finished.m4b', fullPath: survivingM4b, duration: 2, sizeBytes: fs.statSync(survivingM4b).size, bitrate: '64k', chaptersCount: 0, codec: 'aac', format: 'm4b' };
    orphan.exports = [{ format: 'm4b', status: 'success', progress: 100, fullPath: survivingM4b, filename: 'finished.m4b' }];
    orphan.exportedFiles = { m4b: survivingM4b };
    delete orphan.libraryScan;
    persisted.push(orphan);
    writeProjectState(root,persisted);
    server = startServer([path.resolve('dist/server.cjs')]);
    try { await waitForTestServer(server,base+'/api/library'); }
    catch(error) { assert.fail(`Server restarted with persisted books: ${error}\n${serverOutput}`); }
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!(await request('/api/library/scan-status')).scanning) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await request(`/api/jobs/${referenced.id}`)).source.kind, 'managed', 'managed source survives restart');
    assert.deepEqual((await request(`/api/jobs/${browserBook.id}`)).parts.map((part: any) => part.name), ['Book/01.mp3'], 'browsed membership survives restart');
    assert.ok(fs.existsSync(path.join(sibling, '02.mp3')), 'removal never deletes the audio');
    assert.equal((await request('/api/library')).find((book: any) => book.id === tagged.id).sourceLocation, 'external', 'older book loads without source migration');
    const recoveryPlan = await request('/api/jobs/orphan-finished-book/organize-library');
    assert.equal(recoveryPlan.finishedOnly, true);
    assert.equal(recoveryPlan.source, survivingM4b);
    const recovered = await request('/api/jobs/orphan-finished-book/organize-library', { source: recoveryPlan.source, target: recoveryPlan.target });
    assert.ok(fs.existsSync(recovered.job.outputM4b.fullPath));
    assert.equal(recovered.job.source.path, missingSource, 'missing original remains linked for review');
    assert.equal(fs.existsSync(survivingM4b), false);
  } finally {
    server.kill();
    await new Promise(resolve => server.once('exit', resolve));
    assert.ok(root.startsWith(process.cwd() + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
