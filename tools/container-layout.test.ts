import assert from 'node:assert/strict';
import test from 'node:test';
import { arrangeContainer, defaultContainerLayout, getContainerDefinition, loadContainerLayout, magneticFrame, overlaps, placeContainerItem, registerContainer, saveContainerLayout, snapFrame, validContainerLayout } from '../src/utils/containerLayout';
import { resetPageLayout } from '../src/utils/desktopLayout';

test('grid conversion snaps to pixels, preserves readable sizes and resolves overlapping objects', () => {
  const grid = { ...defaultContainerLayout(), mode: 'grid' as const };
  const items = { player: { x: 13, y: 51, width: 301, height: 203 }, editor: { x: 18, y: 55, width: 310, height: 201 } };
  const result = arrangeContainer(grid, items, { player: 300, editor: 400 });
  for (const frame of Object.values(result.items)) for (const n of Object.values(frame)) assert.equal(n % 24, 0);
  assert.ok(result.items.player.width >= 300);
  assert.ok(result.items.editor.width >= 400);
  assert.equal(overlaps(result.items.player, result.items.editor), false);
  assert.deepEqual(arrangeContainer({ ...result, mode: 'canvas' }, result.items).items, result.items);
  assert.deepEqual(items.player, { x: 13, y: 51, width: 301, height: 203 });
});

test('canvas retains positions and drawn grid regions choose the closest available fit', () => {
  const frame = { x: 319, y: 37, width: 280, height: 140 };
  const canvas = { ...defaultContainerLayout(), mode: 'canvas' as const };
  assert.deepEqual(placeContainerItem(frame, canvas, []), frame);
  const regions = [{ x: 0, y: 48, width: 288, height: 192 }, { x: 336, y: 48, width: 288, height: 192 }];
  const grid = { ...canvas, mode: 'grid' as const, regions };
  assert.deepEqual(placeContainerItem(frame, grid, []), regions[1]);
  assert.deepEqual(placeContainerItem(frame, grid, [regions[1]]), regions[0]);
  assert.ok(placeContainerItem(frame, grid, [], 400).width >= 400);
  assert.deepEqual(snapFrame({ x: -5, y: -90, width: 1, height: 1 }, 24, 280), { x: 0, y: 48, width: 288, height: 120 });
});

test('grid conversion preserves adjacent columns while reserving toolbar clearance vertically', () => {
  const result = arrangeContainer({ ...defaultContainerLayout(), mode: 'grid' }, {
    cover: { x: 24, y: 48, width: 480, height: 696 },
    title: { x: 504, y: 48, width: 672, height: 384 },
    taxonomy: { x: 504, y: 430, width: 672, height: 384 },
  });
  assert.equal(result.items.title.y, 48);
  assert.equal(result.items.taxonomy.y, 480);
  assert.equal(result.items.taxonomy.x, 504);
});

test('damaged or future layout data is recoverable and cannot create unsafe object keys', () => {
  for (const invalid of [null, [], 'bad', { version: 2 }]) assert.deepEqual(validContainerLayout(invalid), defaultContainerLayout());
  const layout = validContainerLayout({ version: 1, mode: 'diagonal', gridSize: 0, items: JSON.parse('{"__proto__":{"x":0,"y":0,"width":300,"height":300},"bad":{"x":null}}'), regions: [{ x: NaN, y: 0, width: 300, height: 300 }] });
  assert.deepEqual(layout, defaultContainerLayout());
  const many = Array.from({ length: 1000 }, (_, i) => [String(i), { x: i, y: i, width: 100, height: 100 }]);
  assert.equal(Object.keys(validContainerLayout({ version: 1, items: Object.fromEntries(many) }).items).length, 256);
});

test('magnet edges attract, align, hold through jitter, and release past resistance', () => {
  const targets = [{ id: 'editor', title: 'Editor', frame: { x: 500, y: 300, width: 400, height: 300 } }];
  const frame = { x: 200, y: 305, width: 280, height: 220 };
  const acquired = magneticFrame(frame, targets);
  assert.equal(acquired.snap?.side, 'left');
  assert.equal(acquired.frame.x, 212);
  assert.equal(acquired.frame.y, 300);
  const away = { ...frame, x: 185 };
  assert.equal(magneticFrame(away, targets).snap, undefined);
  assert.equal(magneticFrame(away, targets, acquired.snap).snap?.side, 'left');
  assert.equal(magneticFrame({ ...away, x: 175 }, targets, acquired.snap).snap, undefined);
  assert.equal(magneticFrame({ ...frame, y: 1000 }, targets).snap, undefined);
  assert.equal(magneticFrame({ ...frame, x: 910 }, targets).snap?.side, 'right');
  assert.equal(magneticFrame({ ...frame, x: 520, y: 50 }, targets).snap?.side, 'top');
  assert.equal(magneticFrame({ ...frame, x: 520, y: 630 }, targets).snap?.side, 'bottom');
  assert.deepEqual(targets[0].frame, { x: 500, y: 300, width: 400, height: 300 });
});

test('magnet capture follows visible toolbar clearance instead of a fixed hidden bar', () => {
  const target = { id: 'editor', title: 'Editor', frame: { x: 500, y: 300, width: 400, height: 300 }, topInset: 0 };
  const above = { x: 520, y: 70, width: 280, height: 220 };
  assert.equal(magneticFrame(above, [target], undefined, 0).frame.y, 72);
  assert.equal(magneticFrame(above, [target], undefined, 0).snap?.side, 'top');
  const below = { ...above, y: 610 };
  assert.equal(magneticFrame(below, [target], undefined, 0).frame.y, 608);
  assert.equal(magneticFrame({ ...below, y: 630 }, [target], undefined, 22).frame.y, 630);
  assert.equal(magneticFrame({ ...above, y: 50 }, [{ ...target, topInset: 22 }]).frame.y, 50);
});

test('an aligned side still captures an approaching edge on the other axis', () => {
  const targets = [
    { id: 'nav', title: 'Navigation', frame: { x: 28, y: 312, width: 210, height: 402 }, topInset: 0 },
    { id: 'audio', title: 'Audio', frame: { x: 254, y: 596, width: 1049, height: 119 }, topInset: 0 },
  ];
  const result = magneticFrame({ x: 246, y: 361, width: 350, height: 221 }, targets, undefined, 22);
  assert.equal(result.frame.x, 246);
  assert.equal(result.frame.y, 367);
});

test('module definitions use stable namespaced identities and reject duplicate or invalid registrations', () => {
  const definition = { id: 'example.notes', name: 'Notes', version: 1 as const, type: 'panel' as const, content: 'widget' as const, minimumWidth: 240 };
  const remove = registerContainer(definition);
  assert.equal(getContainerDefinition('example.notes')?.name, 'Notes');
  assert.throws(() => registerContainer(definition), /already registered/);
  assert.throws(() => registerContainer({ ...definition, id: 'bad id' }), /Invalid/);
  remove();
  const removeNew = registerContainer(definition);
  remove(); // A stale disposer must not unregister a later instance.
  assert.ok(getContainerDefinition('example.notes'));
  removeNew();
});

test('container layouts persist per page, reset with existing geometry and preserve book data', () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values: Record<string, string> = {};
  Object.defineProperties(values, {
    getItem: { value: (key: string) => values[key] ?? null },
    setItem: { value: (key: string, value: string) => { values[key] = value; } },
    removeItem: { value: (key: string) => { delete values[key]; } },
  });
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: values });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent() {} } });
    const layout = { ...defaultContainerLayout(), mode: 'canvas' as const, items: { notes: { x: 51, y: 82, width: 400, height: 200 } } };
    saveContainerLayout('files', 'metadata', layout);
    saveContainerLayout('step-3', 'metadata', layout);
    values['book-draft'] = 'unsaved';
    assert.deepEqual(loadContainerLayout('files', 'metadata'), layout);
    resetPageLayout('files');
    assert.deepEqual(loadContainerLayout('files', 'metadata'), defaultContainerLayout());
    assert.deepEqual(loadContainerLayout('step-3', 'metadata'), layout);
    assert.equal(values['book-draft'], 'unsaved');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Disabled storage'); } });
    assert.doesNotThrow(() => saveContainerLayout('files', 'metadata', layout));
    assert.deepEqual(loadContainerLayout('files', 'metadata'), defaultContainerLayout());
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage;
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete (globalThis as any).window;
  }
});

test('geometry cost depends on workspace objects, independent of library size', () => {
  const items = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`widget-${i}`, { x: i % 6 * 350, y: Math.floor(i / 6) * 250 + 48, width: 280, height: 180 }]));
  const start = performance.now();
  const result = arrangeContainer({ ...defaultContainerLayout(), mode: 'grid' }, items);
  assert.equal(Object.keys(result.items).length, 150);
  assert.ok(performance.now() - start < 1000, 'Small workspace layouts should complete without a perceptible stall');
  for (const [id, frame] of Object.entries(result.items)) {
    assert.equal(Object.entries(result.items).some(([other, rect]) => other !== id && overlaps(frame, rect)), false);
  }
});
