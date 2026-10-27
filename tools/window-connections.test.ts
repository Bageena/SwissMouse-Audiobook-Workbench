import assert from 'node:assert/strict';
import test from 'node:test';
import { growDockFrame, connectWindow, dockPreviewFrame, findDockSnap, validWindowConnections, linkMagnet, magnetCluster, type DockSide } from '../src/utils/windowConnections';

test('magnet links move connected chains from either end and pulling away releases only that window', () => {
  const links = linkMagnet(linkMagnet([], 'a', 'b'), 'c', ['b', 'd']);
  assert.deepEqual(new Set(magnetCluster(links, 'a')), new Set(['a', 'b', 'c', 'd']));
  assert.deepEqual(new Set(magnetCluster(links, 'd')), new Set(['a', 'b', 'c', 'd']));
  const released = linkMagnet(links, 'c');
  assert.deepEqual(new Set(magnetCluster(released, 'a')), new Set(['a', 'b']));
  assert.deepEqual(magnetCluster(released, 'd'), ['d']);
  assert.deepEqual(linkMagnet([], 'a', ['a', 'b', 'b']), [['a', 'b']]);
});

const target = { id: 'editor', title: 'Editor', frame: { x: 200, y: 200, width: 600, height: 400 } };
test('magnets acquire every side from inside or outside, including corners, but leave open space free', () => {
  const cases: [number, number, DockSide][] = [
    [180, 400, 'left'], [230, 400, 'left'], [820, 400, 'right'], [780, 400, 'right'],
    [500, 180, 'top'], [500, 220, 'top'], [500, 620, 'bottom'], [500, 580, 'bottom'],
    [185, 185, 'left'], [815, 185, 'right'], [185, 615, 'left'], [815, 615, 'right'],
  ];
  for (const [x, y, side] of cases) assert.equal(findDockSnap({ x, y }, [target])?.side, side);
  assert.ok(findDockSnap({ x: 500, y: 400 }, [target]), 'dropping inside accepts the container');
  for (const [x, y] of [[100, 100], [500, 700]]) assert.equal(findDockSnap({ x, y }, [target]), undefined);
  assert.equal(findDockSnap({ x: 200, y: 300 }, []), undefined);
  assert.equal(findDockSnap({ x: 200, y: 300 }, [{ ...target, frame: { ...target.frame, width: 0 } }]), undefined);
});

test('accepting a child grows the parent for rows and columns without replacing either frame', () => {
  const parent = { x: 30, y: 40, width: 500, height: 300 };
  const child = { x: 700, y: 50, width: 280, height: 400 };
  assert.deepEqual(growDockFrame(parent, child, 'right'), { x: 30, y: 40, width: 804, height: 454 });
  assert.deepEqual(growDockFrame(parent, child, 'bottom'), { x: 30, y: 40, width: 500, height: 754 });
  assert.equal(parent.height, 300);
  assert.equal(child.height, 400);
});

test('a held magnet tolerates small pointer jitter and switches when another side is clearly closer', () => {
  const snap = findDockSnap({ x: 200, y: 350 }, [target])!;
  assert.equal(findDockSnap({ x: 130, y: 350 }, [target]), undefined);
  assert.equal(findDockSnap({ x: 130, y: 350 }, [target], snap)?.side, 'left');
  assert.equal(findDockSnap({ x: 110, y: 350 }, [target], snap), undefined);
  assert.equal(findDockSnap({ x: 400, y: 205 }, [target], snap)?.side, 'top');
  assert.equal(findDockSnap({ x: 205, y: 201 }, [target], snap)?.side, 'left');
});

test('preview stays within the destination and identifies the selected row or column edge', () => {
  for (const side of ['left', 'right', 'top', 'bottom'] as DockSide[]) {
    const zone = dockPreviewFrame({ ...target, side });
    assert.ok(zone.x >= 200 && zone.y >= 200 && zone.x + zone.width <= 800 && zone.y + zone.height <= 600);
    if (side === 'left' || side === 'right') assert.equal(zone.width, 200);
    else assert.equal(zone.height, 400 / 3);
  }
});

test('reconnecting replaces the old link, retains sibling order and clears detached placement', () => {
  let connections = connectWindow({}, 'a', 'editor', 'right');
  connections = connectWindow(connections, 'b', 'editor', 'right');
  assert.ok(connections.a.order < connections.b.order);
  connections = connectWindow(connections, 'a', 'other', 'top');
  connections = connectWindow(connections, 'c', 'other', 'top');
  assert.ok(connections.c.order < connections.a.order);
  assert.equal(connections.a.parent, 'other');
  assert.deepEqual(connectWindow(connections, 'a'), { b: connections.b, c: connections.c });
  assert.deepEqual(validWindowConnections(connections), connections);
  for (const value of [null, [], 'bad', { a: { parent: 'a', side: 'left', order: 0 } }, { a: { parent: 'b', side: 'diagonal', order: 0 } }, { a: { parent: 'b', side: 'left', order: Infinity } }, JSON.parse('{"__proto__":{"parent":"b","side":"left","order":0}}')]) {
    assert.deepEqual(validWindowConnections(value), {});
  }
});
