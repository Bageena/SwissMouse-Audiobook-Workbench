import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import type { InformationBundle, InformationDescriptor } from '../packages/sdk/information';
import { createInformationRegistry } from '../src/core/information-registry';
import { coreInformationBundle } from '../src/core/information-builtins';
import { informationPreviewPage } from '../src/core/information-preview';
import { audiobookInformationBundle, audiobookInformationItem } from '../packages/audiobooks/src/information';
import type { LibraryBook } from '../packages/audiobooks/src/legacy-domain';

function registry() { const r = createInformationRegistry(); r.activate(coreInformationBundle); return r; }
const descriptor: InformationDescriptor = { id: 'res_existing', owner: 'audiobooks', kind: 'core.work', typeIds: ['core.work', 'audiobooks.book'], title: 'Book', revision: 8, revisionScope: 'catalog-snapshot', archived: false };
const clone = () => structuredClone(audiobookInformationBundle) as any;
function broken(edit: (bundle: any) => void, pattern: RegExp) {
  const r = registry(), data = clone(); edit(data);
  assert.throws(() => r.activate(data), pattern); assert.equal(r.list().length, coreInformationBundle.definitions.length, 'activation is atomic');
  assert.equal(r.retained().length, coreInformationBundle.definitions.length, 'failed definitions were not retained');
}

test('complete declarations validate atomically and are immutable copies', () => {
  const r = registry(), data = clone(); r.activate(data);
  const first = data.definitions[0].label; data.definitions[0].label = 'Changed'; data.definitions[0].fieldIds.push('bad.field');
  const type = r.list().find(d => d.id === 'audiobooks.book')!;
  assert.equal(type.label, first); assert.equal(Object.isFrozen(type), true);
  assert.throws(() => (type as any).fieldIds.push('bad.field'), TypeError);
  assert.throws(() => r.activate(audiobookInformationBundle), /already active/);
  assert.equal(r.present(descriptor).available, true); assert.deepEqual(r.present(descriptor).actions, []);
});

for (const [label, edit, pattern] of [
  ['owner', (b: any) => { b.definitions[0].owner = 'other'; }, /ownership/],
  ['namespace', (b: any) => { b.definitions[0].id = 'other.book'; }, /ownership/],
  ['contract', (b: any) => { b.prototypeVersion = 2; }, /Unsupported/],
  ['duplicate', (b: any) => { b.definitions.push(b.definitions[0]); }, /Duplicate/],
  ['dangling reference', (b: any) => { b.definitions[0].fieldIds.push('audiobooks.missing'); }, /Missing field/],
  ['wrong reference kind', (b: any) => { b.definitions[0].fieldIds.push('audiobooks.genre'); }, /Missing field/],
  ['unregistered property', (b: any) => { b.definitions[0].onOpen = 'javascript'; }, /property/],
  ['executable callback', (b: any) => { b.definitions[0].onOpen = () => {}; }, /plain data/],
  ['bad depth', (b: any) => { b.definitions.find((d: any) => d.definition === 'taxonomy').maxDepth = 1; }, /depth/],
  ['multiple parents', (b: any) => { b.definitions.find((d: any) => d.definition === 'taxonomy').multipleParents = true; }, /property/],
  ['bad provider bounds', (b: any) => { b.definitions.find((d: any) => d.definition === 'provider').maxLimit = 101; }, /limits/],
  ['short contains search', (b: any) => { b.definitions.find((d: any) => d.definition === 'provider').minimumContainsLength = 1; }, /three/],
  ['multi-value sorting', (b: any) => { b.definitions.find((d: any) => d.id === 'audiobooks.authors').sortable = true; }, /Multi-value/],
  ['numeric string operator', (b: any) => { b.definitions.find((d: any) => d.id === 'audiobooks.personal-rating').filterOperators = ['contains']; }, /operator/],
  ['bad view field', (b: any) => { b.definitions.find((d: any) => d.definition === 'view').columnIds = ['audiobooks.genre']; }, /Missing field/],
  ['unrelated relationship', (b: any) => { b.definitions[0].relationshipIds = ['audiobooks.unrelated']; b.definitions.push({ id: 'audiobooks.unrelated', owner: 'audiobooks', label: 'Other', public: true, definitionVersion: 1, definition: 'relationship', fromTypes: ['core.file'], toTypes: ['core.file'], cardinality: 'many', attributeIds: [] }); }, /does not apply/],
  ['unfilterable view field', (b: any) => { b.definitions.find((d: any) => d.id === 'audiobooks.genres').filterOperators = []; }, /declared operators/],
] as const) test(`invalid registration rejects ${label}`, () => broken(edit, pattern));

test('accessors are rejected without invoking them and private definitions cannot be reused', () => {
  let called = false; const data = clone(); Object.defineProperty(data, 'owner', { get: () => { called = true; return 'audiobooks'; } });
  assert.throws(() => registry().activate(data), /accessors/); assert.equal(called, false);
  const r = registry(), privateCore = structuredClone(coreInformationBundle) as any;
  privateCore.owner = 'private'; privateCore.definitions = [{ definition: 'type', id: 'private.item', owner: 'private', label: 'Private', definitionVersion: 1, public: false, baseKind: 'core.item', fieldIds: [], taxonomyIds: [], relationshipIds: [] }];
  r.activate(privateCore);
  const other: InformationBundle = { owner: 'other', prototypeVersion: 1, definitions: [{ definition: 'view', id: 'other.view', owner: 'other', label: 'Other', public: true, definitionVersion: 1, typeIds: ['private.item'], modes: ['list'], columnIds: [], filterIds: [] }] };
  assert.throws(() => r.activate(other), /private/);
});

test('deactivation retains inert labels and stale cleanup cannot unregister a reactivation', () => {
  const r = registry(), old = r.activate(audiobookInformationBundle); old.unregister();
  const unavailable = r.present(descriptor);
  assert.equal(unavailable.reason, 'owner-unavailable'); assert.equal(unavailable.readOnly, true);
  assert.ok(unavailable.typeLabels.includes('Audiobook work')); assert.deepEqual(unavailable.actions, []);
  const current = r.activate(audiobookInformationBundle); old.unregister(); assert.equal(r.present(descriptor).available, true);
  current.unregister();
  const downgrade = clone(); downgrade.definitions[0].definitionVersion = 0;
  assert.throws(() => r.activate(downgrade), /version/);
  const changed = clone(); changed.definitions[0].label = 'Changed without version';
  assert.throws(() => r.activate(changed), /new version/);
});

test('term providers validate the field taxonomy target, not only a result label', () => {
  const r = registry(), bundle: any = clone();
  const genre = bundle.definitions.find((d: any) => d.id === 'audiobooks.genres');
  genre.valueType = 'reference'; genre.referenceTaxonomyId = 'audiobooks.genre';
  const provider = bundle.definitions.find((d: any) => d.id === 'audiobooks.suggest-genres'); provider.valueKind = 'term'; provider.taxonomyId = 'audiobooks.genre';
  r.activate(bundle);
  const bad = clone(); bad.definitions.find((d: any) => d.id === 'audiobooks.suggest-genres').valueKind = 'resource';
  assert.throws(() => registry().activate(bad), /bounded unique string list/);
});

test('definition object key order does not turn a compatible reactivation into a version change', () => {
  const r = registry(), owner = r.activate(audiobookInformationBundle); owner.unregister();
  const data = clone(); data.definitions = data.definitions.map((definition: object) => Object.fromEntries(Object.entries(definition).reverse()));
  r.activate(data); assert.equal(r.present(descriptor).available, true);
});

function book(): LibraryBook {
  return { id: 'legacy-project', resourceId: 'res_existing-work', recordingId: 'res_existing-recording', name: 'Book', personalRating: 0,
    metadata: { title: 'Book', author: 'Doe, Jane, Other', authors: ['Doe, Jane', 'Other'], narrator: 'Reader, Unknown', genres: ['Fantasy'], language: 'en', abridged: false, explicit: false,
      series: 'Same Name', seriesSequence: 'Omnibus', collections: [{ id: 'existing-collection-id', name: 'Shelf' }], additionalSeries: [{ id: 'custom-existing-series-id', name: 'Other series', sequence: '1.5' }] },
    representations: [{ id: 'legacy-project', resourceId: 'res_existing-recording' }, { id: 'another-project', resourceId: 'res_other-recording' }],
  } as LibraryBook;
}

test('read adapter preserves existing IDs, contributor punctuation, memberships, zero/false and source object', () => {
  const source = book(), before = JSON.stringify(source), result = audiobookInformationItem(source, 12);
  assert.equal(result.descriptor.id, source.resourceId); assert.equal(result.descriptor.revisionScope, 'catalog-snapshot');
  assert.deepEqual(result.fields['audiobooks.authors'], ['Doe, Jane', 'Other']);
  assert.deepEqual(result.fields['audiobooks.narrators'], ['Reader, Unknown']);
  assert.equal(result.fields['audiobooks.personal-rating'], 0); assert.equal(result.fields['audiobooks.explicit'], false);
  assert.equal(result.fields['audiobooks.series-sequence'], 'Omnibus');
  assert.deepEqual(result.relationships.map(r => r.fromId), ['res_existing-recording', 'res_other-recording']);
  assert.deepEqual(result.memberships.map(m => m.legacyId), ['existing-collection-id', 'custom-existing-series-id']);
  assert.equal(result.memberships[1].sequence, '1.5'); assert.equal(JSON.stringify(source), before);
  assert.equal(audiobookInformationItem({ ...source, personalRating: 2.5 }, 12).fields['audiobooks.personal-rating'], 2.5);
  assert.throws(() => audiobookInformationItem({ ...source, resourceId: undefined }, 1), /identities/);
});

test('generic preview stays read-only after owner deactivation and bounds large membership views', () => {
  const r = registry(), owner = r.activate(audiobookInformationBundle), source = book();
  source.metadata.collections = Array.from({ length: 150 }, (_, i) => ({ id: String(i), name: `Shelf ${i}` }));
  const projected = audiobookInformationItem(source, 2);
  owner.unregister();
  const result = informationPreviewPage(r, { items: [projected], total: 1, revision: 2 });
  assert.equal(result.items[0].presentation.available, false); assert.equal(result.items[0].memberships.filter(m => m.providerId === 'audiobooks.suggest-collections').length, 100);
  assert.ok(result.items[0].omitted.includes('audiobooks.collections')); assert.equal(source.metadata.collections.length, 150);
  assert.throws(() => informationPreviewPage(r, { items: Array(501), total: 501, revision: 2 }), /bounded/);
});

test('declaration registry builds without framework, filesystem or private module dependencies', async () => {
  const result = await build({ entryPoints: ['src/core/information-registry.ts'], bundle: true, platform: 'browser', write: false, metafile: true });
  assert.ok(Object.keys(result.metafile!.inputs).every(file => /(?:src\/core\/information-registry|packages\/sdk\/information)\.ts$/.test(file.replaceAll('\\', '/'))));
  assert.equal((result.metafile!.outputs[Object.keys(result.metafile!.outputs)[0]].imports).length, 0);
});
