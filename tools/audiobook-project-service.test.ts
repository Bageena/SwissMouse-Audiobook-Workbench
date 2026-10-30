import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import fs from 'node:fs';
import ts from 'typescript';
import { createAudiobookProjectService, AudiobookCommandError } from '../packages/audiobooks/src/project-service';
import type { CreatedProject } from '../packages/audiobooks/src/project-service';

function harness() {
  const records = new Map<string, CreatedProject>();
  const events: string[] = [];
  const state = { importActive: false, processing: false, deleting: false, sidecarFailure: false, hasAudio: false, saves: 0 };
  const service = createAudiobookProjectService<CreatedProject, { id: string; title: string }>({
    store: { get: id => records.get(id), insert: project => { records.set(project.id, project); return project; }, remove: id => { records.delete(id); }, save: () => { state.saves++; } },
    views: { query: async options => { events.push(`query:${options.limit}`); return []; }, prepareRead: () => {}, describe: () => ({ sourceMissing: false, canMoveToLibrary: false, libraryBook: { id: '', title: '' } }), book: project => ({ id: project.id, title: project.metadata!.title }), publish: async ids => { events.push('publish:' + ids.join(',')); } },
    sidecars: { savedAudio: () => state.hasAudio ? ['saved.m4b'] : [], availableAudio: () => state.hasAudio ? ['saved.m4b'] : [], write: () => { if (state.sidecarFailure) throw new Error('Ownership check failed'); events.push('sidecar'); return ['exmetadata.json']; } },
    guards: { sourceImportActive: () => state.importActive, metadataWriteBusy: () => state.processing, deletionBusy: () => state.deleting ? 'Active work' : undefined },
    removeManagedFiles: project => { events.push('cleanup:' + project.id); }, outputFolder: () => 'output',
  });
  const first = service.create({ name: 'First', author: 'Author', narrator: 'Narrator' });
  const second = service.create({ name: 'Second' });
  return { service, records, first, second, state, events };
}
const fails = (status: number, pattern: RegExp) => (error: unknown) => error instanceof AudiobookCommandError && error.status === status && pattern.test(error.message);

test('project creation and bounded queries preserve the legacy protocol without traversing every record', async () => {
  const { service, first, events } = harness();
  assert.match(first.id, /^first-[\da-f]{8}$/); assert.equal(first.totalDurationSeconds, 3720);
  assert.equal(first.chapters[0].start, '00:00:00.000');
  const pending = service.create({ name: 'Import', importPending: true });
  assert.deepEqual(pending.parts, []); assert.equal(pending.importPending, true);
  await service.list(undefined, undefined); await service.list('25', 'cursor');
  assert.deepEqual(events, ['query:100', 'query:25']);
  assert.throws(() => service.read('missing'), fails(404, /not found/));
});

test('revision and import guards reject writes before any metadata, chapter or cleanup change', () => {
  const { service, first, state, events } = harness();
  const before = JSON.stringify(first), saves = state.saves;
  assert.throws(() => service.saveMetadata(first.id, { ...first.metadata, title: 'Conflict' }, 99), fails(409, /another view/));
  assert.throws(() => service.saveMetadata(first.id, { ...first.metadata, author: 123 }), fails(400, /Invalid author/));
  assert.throws(() => service.saveMetadata(first.id, { ...first.metadata, description: {} }), fails(400, /Invalid description/));
  state.importActive = true;
  assert.throws(() => service.saveDraft(first.id, first.metadata), fails(409, /source import/));
  assert.throws(() => service.saveChapters(first.id, first.chapters), fails(409, /source import/));
  assert.throws(() => service.remove(first.id), fails(409, /source import/));
  assert.equal(JSON.stringify(first), before); assert.equal(state.saves, saves); assert.deepEqual(events, []);
  state.importActive = false; state.deleting = true;
  assert.throws(() => service.remove(first.id), fails(409, /Active work/));
  assert.deepEqual(events, []);
});

test('metadata saves retain explicit empty/false values, stable identities and recoverable sidecar failures', () => {
  const { service, first, state } = harness();
  const chapterId = first.chapters[0].id;
  const metadata = { ...first.metadata!, title: ' Renamed ', author: '', narrator: '', genres: [], tags: [], explicit: false, abridged: false, cover: null, collections: [{ id: 'shelf-stable', name: 'Shelf' }] };
  service.saveDraft(first.id, metadata, 0);
  state.hasAudio = true; state.sidecarFailure = true;
  assert.throws(() => service.saveMetadata(first.id, metadata, 0), fails(500, /details were saved.*Ownership/));
  assert.equal(first.name, 'Renamed'); assert.equal(first.metadata!.author, ''); assert.equal(first.metadata!.cover, null);
  assert.equal(first.metadataRevision, 1); assert.equal(first.metadataDraft, undefined); assert.equal(first.chapters[0].id, chapterId);
  assert.deepEqual(first.metadata!.collections, [{ id: 'shelf-stable', name: 'Shelf' }]);
  assert.ok(first.staleSteps?.includes('export')); assert.ok(first.staleSteps?.includes('validation'));
  state.processing = true;
  assert.throws(() => service.saveMetadataJson(first.id, metadata, 1), fails(409, /processing/));
});

test('chapter rejection preserves prior work; CSV uses the same durable save and invalidation path', () => {
  const { service, first, state } = harness();
  const original = JSON.stringify(first.chapters), saves = state.saves;
  assert.throws(() => service.saveChapters(first.id, [{ id: 'bad', title: 'Bad', start: 'invalid' }]), fails(400, /timestamp/i));
  assert.equal(JSON.stringify(first.chapters), original); assert.equal(state.saves, saves);
  const result = service.importChaptersCsv(first.id, 'start,end,title\n00:00:00.000,00:00:09.999,"One, with comma"\n00:00:10.000,,Two');
  assert.equal(state.saves, saves + 1); assert.equal(result.chapters[0].title, 'One, with comma');
  assert.equal(first.chapters[0].id, 'imported-1'); assert.match(first.ffmetaContent!, /title=One, with comma/);
  assert.deepEqual(first.staleSteps, ['export', 'validation']);
  assert.match(service.exportChapters(first.id, 'csv').content, /"One, with comma"/);
});

test('bulk metadata validates the entire selection, retains unfinished fields and accepts membership arrays', async () => {
  const { service, first, second, state, events } = harness();
  first.metadataDraft = { ...first.metadata!, description: 'Unfinished description' };
  const before = JSON.stringify(first), saves = state.saves;
  await assert.rejects(service.saveLibraryMetadata([{ id: first.id, fields: { title: 'Do not apply' } }, { id: second.id, fields: { title: '' } }]), fails(400, /title/));
  assert.equal(JSON.stringify(first), before); assert.equal(state.saves, saves);
  await service.saveLibraryMetadata([{ id: first.id, fields: { narrator: '', collections: [{ id: 'stable-shelf', name: 'Shelf' }] } }]);
  assert.equal(first.metadataDraft!.description, 'Unfinished description'); assert.equal(first.metadataDraft!.narrator, '');
  assert.deepEqual(first.metadata!.collections, [{ id: 'stable-shelf', name: 'Shelf' }]);
  assert.equal(second.name, 'Second'); assert.deepEqual(events, ['publish:' + first.id]);
});

test('backend command boundary builds using only the module package and Node built-ins', async () => {
  const result = await build({ entryPoints: ['packages/audiobooks/src/backend.ts'], bundle: true, write: false, format: 'esm', platform: 'node', metafile: true });
  const root = path.resolve('packages/audiobooks/src') + path.sep;
  const sdk = path.resolve('packages/sdk') + path.sep;
  const allowed = (file: string) => file.startsWith(root) || file.startsWith(sdk);
  for (const input of Object.keys(result.metafile!.inputs)) assert.ok(allowed(path.resolve(input)), `Private implementation dependency: ${input}`);
  // Bundlers erase type imports. Check those too so host types cannot leak back in.
  const visited = new Set<string>();
  function inspect(file: string) {
    if (visited.has(file)) return; visited.add(file);
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const dependency = (specifier: string) => {
      if (specifier.startsWith('node:')) return;
      assert.ok(specifier.startsWith('.'), `Unapproved backend import: ${specifier}`);
      const resolved = path.resolve(path.dirname(file), specifier);
      assert.ok(allowed(resolved), `Private backend type or runtime import: ${specifier}`);
      const target = [resolved + '.ts', resolved + '.tsx', resolved].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      assert.ok(target, `Missing backend source: ${specifier}`); inspect(target!);
    };
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) dependency(node.argument.literal.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  inspect(path.resolve('packages/audiobooks/src/backend.ts'));
});
