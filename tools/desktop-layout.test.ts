import assert from 'node:assert/strict';
import test from 'node:test';
import { canGroupWindow, validWindowGroups, loadWindowGroups, saveWindowGroups, constrainWindow, loadWindowFrame, resetPageLayout, saveWindowFrame, DESKTOP_RESET_EVENT } from '../src/utils/desktopLayout';
import { loadWindowConnections, saveWindowConnections } from '../src/utils/windowConnections';

test('grouping allows siblings and reparenting but supports nested parents while preventing cycles', () => {
  const groups = { files: 'book', order: 'book' };
  assert.equal(canGroupWindow(groups, 'metadata', 'book'), true);
  assert.equal(canGroupWindow(groups, 'files', 'other'), true);
  assert.equal(canGroupWindow(groups, 'book', 'files'), false);
  assert.equal(canGroupWindow(groups, 'metadata', 'files'), true);
  assert.equal(canGroupWindow(groups, 'book', 'other'), true);
  assert.equal(canGroupWindow({}, 'book', 'book'), false);
  assert.equal(canGroupWindow({ middle: 'root', leaf: 'middle' }, 'root', 'leaf'), false);
  assert.deepEqual(validWindowGroups({ root: 'leaf', middle: 'root', leaf: 'middle' }), {});
  assert.deepEqual(validWindowGroups(groups), groups);
  assert.deepEqual(validWindowGroups({ metadata: 'files', cover: 'metadata', details: 'metadata', toolbar: 'files' }), { metadata: 'files', cover: 'metadata', details: 'metadata', toolbar: 'files' });
  assert.deepEqual(validWindowGroups({ cover: '', identity: 'metadata' }), { cover: '', identity: 'metadata' });
  assert.equal(canGroupWindow({ cover: '' }, 'identity', 'cover'), true);
  for (const value of [null, [], 'bad', { a: 'a' }, { a: 'b', b: 'a' }, { a: 7 }]) {
    assert.deepEqual(validWindowGroups(value), {});
  }
  assert.deepEqual(validWindowGroups({ a: 'b', b: 'c', d: 'c' }), { a: 'b', b: 'c', d: 'c' });
});

test('moving and resizing keeps the full window reachable and bounds saved dimensions', () => {
  assert.deepEqual(constrainWindow({ x: -500, y: -1, width: 9000, height: 9000 }, 1000), { x: 0, y: 0, width: 1000, height: 4000 });
  assert.deepEqual(constrainWindow({ x: 950, y: 30000, width: 100, height: 2 }, 1000), { x: 720, y: 20000, width: 280, height: 100 });
  assert.deepEqual(constrainWindow({ x: 450, y: 240, width: 500, height: 650 }, 700), { x: 200, y: 240, width: 500, height: 650 });
  assert.equal(constrainWindow({ x: 10, y: 10, width: 500, height: 300 }, 240).width, 240);
});

test('desk bounds allow both theme margins without changing stored layout coordinates', () => {
  const bounds = { left: -120, right: 1120 };
  const frame = { x: -100, y: 200, width: 300, height: 400 };
  assert.deepEqual(constrainWindow(frame, 1000, 280, bounds), frame);
  assert.equal(constrainWindow({ ...frame, x: -500 }, 1000, 280, bounds).x, -120);
  assert.equal(constrainWindow({ ...frame, x: 1100 }, 1000, 280, bounds).x, 820);
  assert.equal(constrainWindow({ ...frame, width: 1600 }, 1000, 280, bounds).width, 1240);
});

test('layouts survive reload, reject damaged values, and reset only the current page', () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage: Record<string, string> = {};
  Object.defineProperty(storage, 'getItem', { value: (key: string) => storage[key] ?? null });
  Object.defineProperty(storage, 'setItem', { value: (key: string, value: string) => { storage[key] = value; } });
  Object.defineProperty(storage, 'removeItem', { value: (key: string) => { delete storage[key]; } });
  const events: Event[] = [];
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: (event: Event) => events.push(event) } });
    const frame = { x: 125, y: 200, width: 500, height: 400 };
    saveWindowFrame('step-1', 'overview', frame);
    saveWindowFrame('step-1', 'options', { ...frame, y: 700 });
    saveWindowFrame('step-2', 'overview', { ...frame, x: 50 });
    saveWindowGroups('step-1', { options: 'overview' });
    saveWindowGroups('step-2', { transcript: 'overview' });
    const connections = { options: { parent: 'overview', side: 'left' as const, order: -1 } };
    saveWindowConnections('step-1', connections);
    saveWindowConnections('step-2', connections);
    assert.deepEqual(loadWindowConnections('step-1'), connections);
    assert.deepEqual(loadWindowGroups('step-1'), { options: 'overview' });
    assert.deepEqual(loadWindowFrame('step-1', 'overview'), frame);
    storage['swissmouse-theme'] = 'cheese';
    storage['metadata-draft'] = 'Unsaved book title';
    assert.deepEqual(loadWindowFrame('step-1', 'overview'), frame);
    assert.equal(loadWindowFrame('step-3', 'overview'), undefined);
    for (const value of ['broken', 'null', '[]', '{"x":0,"y":0,"width":"500","height":200}', '{"x":0,"y":0,"width":-1,"height":200}', '{"x":1e999,"y":0,"width":500,"height":200}']) {
      storage['swissmouse-desktop-v1:step-1:invalid'] = value;
      assert.equal(loadWindowFrame('step-1', 'invalid'), undefined);
    }
    resetPageLayout('step-1');
    assert.equal(loadWindowFrame('step-1', 'overview'), undefined);
    assert.equal(loadWindowFrame('step-1', 'options'), undefined);
    assert.equal(loadWindowFrame('step-2', 'overview')?.x, 50);
    assert.deepEqual(loadWindowGroups('step-1'), {});
    assert.deepEqual(loadWindowGroups('step-2'), { transcript: 'overview' });
    assert.deepEqual(loadWindowConnections('step-1'), {});
    assert.deepEqual(loadWindowConnections('step-2'), connections);
    assert.equal(storage['metadata-draft'], 'Unsaved book title');
    assert.equal(storage['swissmouse-theme'], 'cheese');
    assert.equal(events[0].type, DESKTOP_RESET_EVENT);
    assert.equal((events[0] as CustomEvent).detail, 'step-1');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Disabled'); } });
    assert.equal(loadWindowFrame('step-1', 'overview'), undefined);
    assert.deepEqual(loadWindowGroups('step-1'), {});
    assert.deepEqual(loadWindowConnections('step-2'), {});
    assert.doesNotThrow(() => saveWindowConnections('step-1', connections));
    assert.doesNotThrow(() => saveWindowGroups('step-1', { child: 'parent' }));
    assert.doesNotThrow(() => saveWindowFrame('step-1', 'overview', frame));
    assert.doesNotThrow(() => resetPageLayout('step-1'));
    assert.equal(events.length, 2);
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor); else delete (globalThis as any).localStorage;
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else delete (globalThis as any).window;
  }
});
