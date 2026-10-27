import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileSignature, identifyBook, inventory, scanRoot, stamp, verifiedCopy, within } from './library-filesystem';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoveToLibrary, MoveToLibraryDialog } from '../src/components/MoveToLibrary';
import syncFs from 'node:fs';
import { audiobookshelfMetadata } from '../src/utils/audiobookshelfMetadata';

test('scanner reports disappearing paths and continues through other folders', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-scan-errors-'));
  try {
    for (const name of ['Good', 'Disappearing', 'Unreadable']) {
      await fs.mkdir(path.join(root, name));
      await fs.writeFile(path.join(root, name, 'audio.mp3'), 'audio');
    }
    const errors: string[] = [];
    const books = await scanRoot(root, new Set(['mp3']), [], {
      onFolder: folder => {
        if (folder === root) syncFs.renameSync(path.join(root, 'Unreadable'), path.join(root, '.unavailable'));
        if (path.basename(folder) === 'Disappearing') syncFs.unlinkSync(path.join(folder, 'audio.mp3'));
      },
      onError: (file, error) => { errors.push(file); assert.match(error.message, /ENOENT/); },
    });
    assert.equal(books.length, 1);
    assert.equal(path.basename(books[0].path), 'Good');
    assert.equal(errors.length, 2);
    assert.equal(await fs.readFile(path.join(root, 'Good', 'audio.mp3'), 'utf8'), 'audio');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Move to Library stays disabled until eligible and defaults the dialog to cleanup', () => {
  const render = (eligible: boolean) => renderToStaticMarkup(React.createElement(MoveToLibrary,
    { name: 'Book', eligible, onTransfer: async () => undefined }));
  assert.match(render(true), /Move to Library/);
  assert.match(render(false), /disabled=""[^>]*>Move to Library/);
  const dialog = renderToStaticMarkup(React.createElement(MoveToLibraryDialog, { name: 'Book', busy: false, error: '', onChoose: () => {}, onCancel: () => {} }));
  assert.match(dialog, /Copy &amp; Keep/); assert.match(dialog, /Move &amp; Clean Up/); assert.match(dialog, /Cancel/);
  assert.match(dialog, /original source files/); assert.match(dialog, /after verification/);
  assert.match(dialog, /checked=""[^>]*\/>Move &amp; Clean Up/);
});

test('scanner groups chapter folders, ignores working folders, and prioritizes sidecar metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-scan-'));
  try {
    await fs.mkdir(path.join(root, 'Book', 'CD 1'), { recursive: true });
    await fs.mkdir(path.join(root, 'Book', 'CD 2'));
    await fs.mkdir(path.join(root, '.swissmouse-work'));
    await fs.writeFile(path.join(root, 'Book', 'CD 1', '01.mp3'), 'one');
    await fs.writeFile(path.join(root, 'Book', 'CD 2', '02.mp3'), 'two');
    await fs.writeFile(path.join(root, '.swissmouse-work', 'analysis.wav'), 'working');
    await fs.writeFile(path.join(root, 'Loose.m4b'), 'loose');
    await fs.writeFile(path.join(root, 'Book', 'metadata.json'), JSON.stringify({ title: 'Real title', authors: ['Author, Jr.', 'Second Author'], narrators: ['Narrator, Sr.'], series: ['Series #2'], tags: ['Keep'], genres: ['Fiction'] }));
    const books = await scanRoot(root, new Set(['mp3', 'm4b', 'wav']));
    assert.equal(books.length, 2);
    const book = books.find(book => book.mode === 'folder')!;
    assert.equal(book.files.length, 2);
    const identified = await identifyBook(book, async () => { throw new Error('Complete sidecar should not require a probe'); });
    assert.equal(identified.metadata.title, 'Real title');
    assert.equal(identified.metadata.author, 'Author, Jr., Second Author');
    assert.deepEqual(audiobookshelfMetadata(identified.metadata).authors, ['Author, Jr.', 'Second Author']);
    assert.deepEqual(audiobookshelfMetadata(identified.metadata).narrators, ['Narrator, Sr.']);
    assert.deepEqual(audiobookshelfMetadata({ ...identified.metadata, author: 'Updated Author' }).authors, ['Updated Author'], 'legacy scalar edits take precedence over old contributor lists');
    assert.equal(identified.metadata.seriesSequence, '2');
    assert.equal(identified.warning, undefined);
    const loose = await identifyBook(books.find(book => book.mode === 'file')!, async () => ({}));
    assert.match(loose.warning!, /filename/);
    const signature = book.signature;
    await fs.writeFile(path.join(root, 'Book', 'metadata.json'), '{');
    const changed = (await scanRoot(root, new Set(['mp3', 'm4b']))).find(book => book.mode === 'folder')!;
    assert.notEqual(changed.signature, signature);
    assert.match((await identifyBook(changed, async () => ({ album: 'Embedded', artist: 'Writer' }))).warning!, /metadata.json/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('scanner keeps Disc, Part, and nested Chapters ranges under their parent book', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-nested-'));
  try {
    for (const [book, folders] of [
      ['Discs', ['Disc 1', 'Disc 2', 'Disc 3']],
      ['Parts', ['Part 1', 'Part 2']],
      ['Chapters', ['Chapters 01-10', 'Chapters 11-20']],
      ['Encoded', ['1%7C Part One - Beginning', '2%7C Part Two - Ending']],
      ['Internal books', ['Book 1 - Beginning', 'Book 2 - Ending']],
    ] as const) for (const folder of folders) {
      await fs.mkdir(path.join(root, book, folder), { recursive: true });
      await fs.writeFile(path.join(root, book, folder, 'Track 01.mp3'), 'audio');
    }
    await fs.mkdir(path.join(root, 'Single'), { recursive: true });
    await fs.writeFile(path.join(root, 'Single', 'Book.mp3'), 'audio');
    const books = await scanRoot(root, new Set(['mp3']));
    assert.equal(books.length, 7);
    assert.equal(books.filter(book => path.dirname(book.folder) === path.join(root, 'Internal books')).length, 2, 'Book 1 and Book 2 remain separate until explicitly combined');
    for (const [name, count] of [['Discs', 3], ['Parts', 2], ['Chapters', 2], ['Encoded', 2], ['Single', 1]] as const) {
      const book = books.find(item => path.basename(item.path) === name)!;
      assert.equal(book.files.length, count);
      assert.ok(book.files.every(file => file.name.includes(path.sep) || name === 'Single'));
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('verified copies preserve files, reject collisions, and retain sources on changed-file failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-move-'));
  try {
    const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library');
    await fs.mkdir(inbox); await fs.mkdir(library);
    await fs.mkdir(path.join(inbox, 'chapters'));
    await fs.writeFile(path.join(inbox, 'chapters', '01.mp3'), 'audio');
    await fs.writeFile(path.join(inbox, 'metadata.json'), '{"title":"Keep"}');
    const files = await inventory(inbox);
    const entries = files.map(file => ({ source: path.join(inbox, file.name), name: file.name, stamp: file }));
    const target = path.join(library, 'Book');
    await verifiedCopy(library, target, entries, () => {});
    assert.equal((await inventory(target)).length, 2);
    assert.equal(await fs.readFile(path.join(target, 'chapters', '01.mp3'), 'utf8'), 'audio');
    assert.equal(fileSignature(await inventory(inbox)), fileSignature(files));
    await assert.rejects(verifiedCopy(library, target, entries, () => {}), /already exists/);
    assert.equal(await fs.readFile(path.join(target, 'metadata.json'), 'utf8'), '{"title":"Keep"}');
    await fs.writeFile(entries[0].source, 'changed after snapshot');
    await assert.rejects(verifiedCopy(library, path.join(library, 'Failed'), entries, () => {}), /changed during copy/);
    assert.equal(await fs.readFile(entries[0].source, 'utf8'), 'changed after snapshot');
    assert.deepEqual(await fs.readdir(library), ['Book']);
    assert.equal(within(library, path.join(root, 'Library-other')), false);
    const current = await stamp(entries[0].source);
    await assert.rejects(verifiedCopy(library, path.join(library, 'Unsafe'), [{ source: entries[0].source, name: '../escape', stamp: current }], () => {}), /unsafe/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('mixed author collections separate book folders and loose multipart books without absorbing descendants', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-collection-'));
  const author = path.join(root, 'Stephen King');
  const files = [
    'Stephen King/1974 - Carrie/01.mp3',
    'Stephen King/1974 - Carrie/02.mp3',
    'Stephen King/1977 - The Shining/Disc 1/01.mp3',
    'Stephen King/1977 - The Shining/Disc 2/01.mp3',
    'Stephen King/-Alternate versions/1974 - Carrie/01.mp3',
    'Stephen King/Stephen King - 1975 - Salem (1 of 2).m4b',
    'Stephen King/Stephen King - 1975 - Salem (2 of 2).m4b',
    'Stephen King/Stephen King - 1982 - Pet Sematary (1).m4b',
    'Stephen King/Stephen King - 1982 - Pet Sematary (2).m4b',
    'Stephen King/Fairy Tale.m4b',
    'Loose Book (1 of 2).m4b',
    'Loose Book (2 of 2).m4b',
  ];
  try {
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), file);
    }
    // Even stale collection-level metadata cannot annex named book folders.
    await fs.writeFile(path.join(author, 'metadata.json'), JSON.stringify({ title: 'Wrong combined title' }));
    const books = await scanRoot(root, new Set(['mp3', 'm4b']));
    assert.equal(books.length, 7);
    assert.ok(!books.some(book => book.path === author));
    assert.deepEqual(books.map(book => book.files.length).sort(), [1, 1, 2, 2, 2, 2, 2]);
    assert.equal(books.find(book => book.title === 'Salem')!.files.length, 2);
    assert.equal(books.find(book => book.title === 'Pet Sematary')!.files.length, 2);
    assert.equal(books.find(book => path.basename(book.path) === '1977 - The Shining')!.files.length, 2);
    const observed = books.flatMap(book => book.files.map(file => path.relative(root, path.join(book.folder, file.name)).replace(/\\/g, '/')));
    assert.deepEqual(observed.sort(), [...files].sort(), 'every physical file belongs to exactly one discovered book');
    for (const book of books) assert.notEqual(book.metadataFile, path.join(author, 'metadata.json'));
    assert.deepEqual(await scanRoot(root, new Set(['mp3', 'm4b'])), books, 'stable scan keys and signatures');
    for (const file of files) assert.equal(await fs.readFile(path.join(root, file), 'utf8'), file);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('leaf collections of M4Bs split by title while numeric disc folders stay together', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-loose-books-'));
  try {
    for (const file of ['Author/A (1 of 2).m4b', 'Author/A (2 of 2).m4b', 'Author/B.m4b', 'Book/01/01.mp3', 'Book/02/01.mp3']) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), 'audio');
    }
    const books = await scanRoot(root, new Set(['mp3', 'm4b']));
    assert.equal(books.length, 3);
    assert.deepEqual(books.map(book => book.files.length).sort(), [1, 2, 2]);
    assert.equal(books.find(book => book.title === 'A')!.mode, 'folder');
    assert.equal(books.find(book => path.basename(book.path) === 'Book')!.files.length, 2);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a collection metadata sidecar cannot combine separately titled M4Bs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-m4b-sidecar-'));
  const collection = path.join(root, "Orson Scott Card - Ender's Game");
  const names = ['01 FW1.0 Earth Unaware.m4b', '02 FW2.0 Earth Afire.m4b', '03 FW3.0 Earth Awakens.m4b'];
  try {
    await fs.mkdir(collection);
    for (const name of names) await fs.writeFile(path.join(collection, name), name);
    const sidecar = JSON.stringify({ title: 'Collection title', author: 'Orson Scott Card' });
    await fs.writeFile(path.join(collection, 'metadata.json'), sidecar);
    await fs.writeFile(path.join(collection, 'cover.jpg'), 'collection artwork');
    const books = await scanRoot(root, new Set(['m4b']));
    assert.equal(books.length, 3);
    assert.deepEqual(books.map(book => book.files.map(file => file.name)), names.map(name => [name]));
    assert.ok(books.every(book => book.mode === 'file' && book.grouped));
    assert.ok(books.every(book => !book.metadataFile && !book.associatedFiles?.length), 'collection sidecars cannot be attributed to each independent book');
    assert.deepEqual(await scanRoot(root, new Set(['m4b'])), books, 'repeated scans retain stable identities');
    for (const name of names) assert.equal(await fs.readFile(path.join(collection, name), 'utf8'), name);
    assert.equal(await fs.readFile(path.join(collection, 'metadata.json'), 'utf8'), sidecar);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('scanner recognizes repeated book titles in Disc and Part folders only under a matching book parent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-named-discs-'));
  const files = [
    'Earth Afire by Orson Scott Card/Earth Afire (Disc 01)/01.mp3',
    'Earth Afire by Orson Scott Card/Earth Afire (Disc 02)/01.mp3',
    "Ender's Game/Ender's Game Part 1/01.mp3",
    "Ender's Game/Ender's Game Part 2/01.mp3",
    'Author collection/Other Title Part 1/01.mp3',
    'Author collection/Other Title Part 2/01.mp3',
    'Shadow of the Giant [Various]/Shadow of the Giant (Disc 01)/01.mp3',
    'Shadow of the Giant [Various]/Shadow of the Giant (Disc 02)/01.mp3',
    'Earth Unaware - Orson Scott Card [MP3]/Earth Unaware (Disc 01)/01.mp3',
    'Earth Unaware - Orson Scott Card [MP3]/Earth Unaware (Disc 02)/01.mp3',
  ];
  try {
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), file);
    }
    const books = await scanRoot(root, new Set(['mp3']));
    assert.equal(books.length, 6);
    for (const name of ['Earth Afire by Orson Scott Card', "Ender's Game", 'Shadow of the Giant [Various]', 'Earth Unaware - Orson Scott Card [MP3]'])
      assert.equal(books.find(book => book.path === path.join(root, name))?.files.length, 2, name);
    assert.equal(books.filter(book => path.dirname(book.path) === path.join(root, 'Author collection')).length, 2, 'a collection parent cannot supply missing book ownership evidence');
    assert.deepEqual(books.flatMap(book => book.files.map(file => path.relative(root, path.join(book.folder, file.name)).replace(/\\/g, '/'))).sort(), [...files].sort());
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('number-prefixed named book folders remain independent members of their series', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-numbered-books-'));
  const names = ['01 Earth Unaware', '02 Earth Afire', '03 Earth Awakens'];
  try {
    for (const name of names) {
      await fs.mkdir(path.join(root, 'Series', name), { recursive: true });
      await fs.writeFile(path.join(root, 'Series', name, '01.mp3'), name);
      await fs.writeFile(path.join(root, 'Series', name, '02.mp3'), name);
    }
    const books = await scanRoot(root, new Set(['mp3']));
    assert.deepEqual(books.map(book => path.basename(book.path)), names);
    assert.ok(books.every(book => book.files.length === 2 && book.folder === book.path));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('single M4B identification prefers a named TITLE over a shared series ALBUM and preserves sidecar priority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-m4b-title-'));
  try {
    await fs.writeFile(path.join(root, 'Earth Unaware.m4b'), 'first book');
    await fs.writeFile(path.join(root, 'Earth Afire.m4b'), 'second book');
    const books = await scanRoot(root, new Set(['m4b']));
    for (const book of books) {
      const title = path.basename(book.path, '.m4b');
      const identified = await identifyBook(book, async () => ({ TITLE: title, ALBUM: "Ender's Game", ARTIST: 'Orson Scott Card' }));
      assert.equal(identified.metadata.title, title);
      assert.equal(identified.metadata.author, 'Orson Scott Card');
      const chapterLabel = await identifyBook(book, async () => ({ TITLE: 'Chapter 1', ALBUM: 'Real book title', ARTIST: 'Writer' }));
      assert.equal(chapterLabel.metadata.title, 'Real book title', 'generic chapter tags cannot replace a book album');
    }
    const metadataFile = path.join(root, 'metadata.json');
    await fs.writeFile(metadataFile, JSON.stringify({ title: 'Explicit sidecar title', author: 'Sidecar author' }));
    const sidecar = await identifyBook({ ...books[0], metadataFile }, async () => ({ title: 'Embedded title', album: 'Series title', artist: 'Embedded author' }));
    assert.equal(sidecar.metadata.title, 'Explicit sidecar title');
    assert.equal(sidecar.metadata.author, 'Sidecar author');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
