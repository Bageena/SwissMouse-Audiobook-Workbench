import test from 'node:test';
import assert from 'node:assert/strict';
import { isSequenceFolder, normalizeBookTitle, probableBookGroups } from '../src/utils/bookGroups';

test('multipart titles normalize without erasing distinct books or years', () => {
  for (const suffix of ['(1 of 2)', '(2)', 'Part 1', '(Part 2)', 'Disc 1', 'CD 1', 'Disk 02', 'Volume 1'])
    assert.equal(normalizeBookTitle(`Salem’s Lot ${suffix}`), 'salems lot', suffix);
  const groups = probableBookGroups([
    "Stephen King - 1975 - Salem's Lot (1 of 2).m4b",
    "Stephen King - 1975 - Salem's Lot (2 of 2).m4b",
    'Stephen King - 1974 - Carrie.m4b',
  ].map(relativePath => ({ relativePath })));
  assert.deepEqual(groups.map(group => group.files.length), [2, 1]);
  assert.equal(groups[0].title, "Salem's Lot");
  assert.equal(groups[0].author, 'Stephen King');
  assert.equal(probableBookGroups(['1974 - Carrie.m4b', '1975 - Salem.m4b'].map(relativePath => ({ relativePath }))).length, 2);
});

test('MP3 tracks and chapter/disc folders group within book boundaries', () => {
  const groups = probableBookGroups(['Salem/Disc 1/01 - Intro.mp3', 'Salem/Disc 2/02 - Ending.mp3', 'Carrie/Chapter 1/01.mp3', 'Carrie/Chapter 2/02.mp3'].map(relativePath => ({ relativePath })));
  assert.deepEqual(groups.map(group => group.files.length), [2, 2]);
  assert.equal(probableBookGroups(['1974 - Carrie/01.mp3', '1975 - Salem/01.mp3'].map(relativePath => ({ relativePath }))).length, 2, 'year-prefixed book folders are not disc numbers');
  assert.equal(probableBookGroups(['Chapter 1/01.mp3', 'Chapter 2/02.mp3'].map(relativePath => ({ relativePath }))).length, 1);
});

test('embedded album and author split loose chapters; per-track titles do not split an album', () => {
  const groups = probableBookGroups([
    { relativePath: '01.mp3', tags: { ALBUM: 'Salem Part 1', ARTIST: 'Stephen King', TITLE: 'Intro' }, trackNumber: 1 },
    { relativePath: '02.mp3', tags: { album: 'Salem Part 2', author: 'Stephen King', title: 'Ending' }, trackNumber: 2 },
    { relativePath: '03.mp3', tags: { album: 'Carrie', artist: 'Stephen King' } },
    { relativePath: '04.mp3', tags: { album: 'Salem', artist: 'Someone Else' } },
  ]);
  assert.deepEqual(groups.map(group => group.files.length), [2, 1, 1]);
  assert.equal(probableBookGroups([{ relativePath: 'a.m4b', tags: { title: 'Salem Part 1' } }, { relativePath: 'b.m4b', tags: { title: 'Salem Part 2' } }]).length, 1);
});

test('unknown titles remain separate and repeated discovery is idempotent', () => {
  const files = [{ relativePath: 'A.m4b' }, { relativePath: 'B.m4b' }, { relativePath: 'A.m4b' }];
  assert.deepEqual(probableBookGroups(files).map(group => group.files), [['A.m4b'], ['B.m4b']]);
});

test('alternate formats and numbered books are not consecutive audio parts', () => {
  assert.equal(probableBookGroups(['Novel.mp3', 'Novel.m4b'].map(relativePath => ({ relativePath }))).length, 2);
  assert.equal(probableBookGroups(['Book 1/01.mp3', 'Book 2/01.mp3'].map(relativePath => ({ relativePath }))).length, 2);
});

test('standalone M4Bs remain separate books despite a shared series album or track numbering', () => {
  const titles = ['Earth Unaware', 'Earth Afire', 'Earth Awakens', 'The Swarm', 'The Hive'];
  const files = titles.map((title, index) => ({
    relativePath: `${String(index + 1).padStart(2, '0')} FW${index + 1}.0 ${title}.m4b`,
    tags: { album: "Ender's Game", author: 'Orson Scott Card', title }, trackNumber: index + 1,
  }));
  const groups = probableBookGroups(files);
  assert.deepEqual(groups.map(group => group.title), titles);
  assert.deepEqual(groups.map(group => group.files), files.map(file => [file.relativePath]));
  const withoutTitles = probableBookGroups(files.map(file => ({ ...file, tags: { album: "Ender's Game", author: 'Orson Scott Card' } })));
  assert.equal(withoutTitles.length, titles.length);
  assert.ok(withoutTitles.every(group => group.title !== "Ender's Game"), 'the series album cannot replace each filename title');
});

test('identically tagged M4B copies and different volumes are separate duplicate-review candidates', () => {
  const copies = ['Novel.m4b', 'Novel copy.m4b', 'Novel (1).m4b', 'Novel (2).m4b'].map(relativePath => ({ relativePath, tags: { title: 'Novel', author: 'Writer', album: 'Novel' } }));
  assert.deepEqual(probableBookGroups(copies).map(group => group.files), copies.map(file => [file.relativePath]));
  const volumes = ['Novel Volume 1.m4b', 'Novel Volume 2.m4b'].map(relativePath => ({ relativePath }));
  assert.deepEqual(probableBookGroups(volumes).map(group => group.title), ['Novel Volume 1', 'Novel Volume 2']);
});

test('explicit M4B parts group in order while ambiguous part copies and narrators stay separate', () => {
  const parts = [{ relativePath: 'Novel Part 2.m4b' }, { relativePath: 'Novel Part 1.m4b' }];
  assert.deepEqual(probableBookGroups(parts).map(group => group.files), [['Novel Part 1.m4b', 'Novel Part 2.m4b']]);
  assert.equal(probableBookGroups([...parts, { relativePath: 'Novel Disc 1.m4b' }]).length, 3, 'duplicate part numbers must not be concatenated');
  assert.equal(probableBookGroups(parts.map((file, index) => ({ ...file, tags: { narrator: `Reader ${index}` } }))).length, 2);
  assert.equal(probableBookGroups([{ relativePath: 'Novel (1 of 2).m4b' }, { relativePath: 'Novel (2 of 3).m4b' }]).length, 2, 'inconsistent part totals require review');
  assert.equal(probableBookGroups([{ relativePath: 'Novel (1).m4b' }, { relativePath: 'Novel (2).m4b' }]).length, 1, 'paired numbered filenames remain supported');
});

test('named disc folders inherit only from their own book and numbered book folders stay separate', () => {
  for (const folder of ['Earth Afire (Disc 01)', 'Earth Afire Part 2']) {
    assert.equal(isSequenceFolder(folder, 'Earth Afire'), true);
    assert.equal(isSequenceFolder(folder, 'Earth Afire by Orson Scott Card'), true);
    assert.equal(isSequenceFolder(folder, 'Orson Scott Card'), false);
  }
  for (const folder of ['01 Earth Unaware', '02 Earth Afire', 'Book 1', 'Volume 1']) assert.equal(isSequenceFolder(folder, 'Series'), false);
  const files = [
    'Earth Afire by Orson Scott Card/Earth Afire (Disc 01)/01.mp3',
    'Earth Afire by Orson Scott Card/Earth Afire (Disc 02)/02.mp3',
    'Series/01 Earth Unaware/01.mp3',
    'Series/02 Earth Afire/01.mp3',
  ];
  assert.deepEqual(probableBookGroups(files.map(relativePath => ({ relativePath }))).map(group => group.files.length), [2, 1, 1]);
  assert.equal(probableBookGroups([
    { relativePath: 'Novel/Disc 1/Novel.m4b' }, { relativePath: 'Novel/Disc 2/Novel.m4b' },
  ]).length, 1, 'explicit disc directories also provide M4B multipart evidence');
});

test('named disc parents allow narrator, audio format and edition annotations without erasing numbered books', () => {
  for (const parent of ['Earth Afire [Various]', 'Earth Afire [MP3]', 'Earth Afire - Orson Scott Card [MP3]', 'Earth Afire by Orson Scott Card [Stefan Rudnicki]'])
    assert.equal(isSequenceFolder('Earth Afire (Disc 01)', parent), true, parent);
  assert.equal(isSequenceFolder("Ender's Game Disc 1", "Ender’s Game Special 20th Anniversary Edition (Unabridged)"), true);
  for (const parent of ['Earth Afire [Collection]', 'Earth Afire [Book 2]', 'Earth Afire [#2]', 'Earth Afire - Complete Series', 'Earth Afire - Book 2', 'Earth Afire Volume 2'])
    assert.equal(isSequenceFolder('Earth Afire (Disc 01)', parent), false, parent);
  assert.equal(isSequenceFolder('Earth Afire Volume 2 (Disc 01)', 'Earth Afire'), false);
  assert.equal(isSequenceFolder('Earth Afire Book 2 (Disc 01)', 'Earth Afire'), false);
});

test('scanner-relative named discs require root title context to become one book', () => {
  const files = ['Earth Afire (Disc 01)/01.mp3', 'Earth Afire (Disc 02)/01.mp3'].map(relativePath => ({ relativePath }));
  assert.equal(probableBookGroups(files).length, 2, 'without a matching parent the named folders remain independent');
  assert.equal(probableBookGroups(files, 'Author collection').length, 2, 'an unrelated collection is insufficient context');
  const groups = probableBookGroups(files, 'Earth Afire by Orson Scott Card');
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].files, files.map(file => file.relativePath));
  assert.equal(groups[0].title, 'Earth Afire by Orson Scott Card');
  assert.equal(groups[0].directory, '');
});
