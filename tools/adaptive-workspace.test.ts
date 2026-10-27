import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutHistory, loadWorkspaceState, saveWorkspaceState, validWorkspaceState } from '../src/workspace/workspaceState';
import { defaultContainerLayout, overlaps, resolveContainerLayout } from '../src/utils/containerLayout';
import { registerPanel } from '../src/workspace/panels';

test('corner handles default hidden and preserve global and individual visibility choices', () => {
  assert.equal(validWorkspaceState('page', null).cornerHandlesHidden, true);
  const state = validWorkspaceState('page', {
    schemaVersion: 1, workspaceId: 'page', cornerHandlesHidden: false,
    panels: { visible: { cornerHandleHidden: false }, hidden: { cornerHandleHidden: true } },
  });
  const restored = validWorkspaceState('page', JSON.parse(JSON.stringify(state)));
  assert.equal(restored.cornerHandlesHidden, false);
  assert.equal(restored.panels.visible.cornerHandleHidden, false);
  assert.equal(restored.panels.hidden.cornerHandleHidden, true);
});

test('responsive resolution preserves wide preference, stacks narrowly, and never writes preferred frames', () => {
  const layout = { ...defaultContainerLayout(), mode: 'grid' as const, items: {
    a: { x: 0, y: 48, width: 480, height: 300 }, b: { x: 504, y: 48, width: 480, height: 260 }, c: { x: 504, y: 356, width: 480, height: 200 },
  } };
  const before = JSON.stringify(layout);
  const wide = resolveContainerLayout(layout, 1000);
  assert.deepEqual(wide.items, layout.items);
  const narrow = resolveContainerLayout(layout, 350);
  for (const [id, frame] of Object.entries(narrow.items)) {
    assert.ok(frame.width >= 280 && frame.x + frame.width <= 334);
    assert.equal(Object.entries(narrow.items).some(([key, other]) => key !== id && overlaps(frame, other)), false);
  }
  assert.equal(JSON.stringify(layout), before);
  assert.deepEqual(resolveContainerLayout(layout, 1000).items, layout.items);
  assert.equal(resolveContainerLayout({ ...layout, mode: 'canvas' }, 350).items, layout.items);
});

test('workspace validation bounds records and isolates malformed modes, locks, and generated parents', () => {
  const state = validWorkspaceState('test', { schemaVersion: 1, workspaceId: 'test', panels: {
    one: { handleMode: 'merge', locked: true }, two: { handleMode: 'unknown', locked: 'yes' }, three: null,
  }, groups: { a: 'b', b: 'a' }, frames: { a: { x: 0, y: 0, width: -1, height: 1 } }, generated: [
    { id: 'generated-parent-abc', title: 'Parent' }, { id: 'generated-parent-abc', title: 'Duplicate' }, { id: 'metadata', title: 'Invalid' },
  ] });
  assert.deepEqual(state.panels.one, { handleMode: 'merge', locked: true });
  assert.deepEqual(state.panels.two, { handleMode: 'resize', locked: false });
  assert.deepEqual(state.panels.three, { handleMode: 'resize', locked: false });
  assert.deepEqual(state.groups, {}); assert.deepEqual(state.frames, {});
  assert.equal(state.generated.length, 1);
  assert.deepEqual(validWorkspaceState('other', state), validWorkspaceState('other', null));
});

test('reflowed grid content makes room for taller children without changing saved frames', () => {
  const layout = { ...defaultContainerLayout(), mode: 'grid' as const, items: {
    editor: { x: 0, y: 48, width: 600, height: 180 }, next: { x: 0, y: 264, width: 600, height: 140 },
  } };
  const saved = JSON.stringify(layout);
  const narrow = resolveContainerLayout(layout, 320, {}, { editor: 440 });
  assert.equal(narrow.items.editor.height, 440);
  assert.ok(narrow.items.next.y >= narrow.items.editor.y + 440 + 36);
  assert.equal(overlaps(narrow.items.editor, narrow.items.next), false);
  assert.equal(JSON.stringify(layout), saved);
  assert.deepEqual(resolveContainerLayout(layout, 640, {}, { editor: 140 }).items, layout.items, 'wide content returns to its preferred footprint');
});

test('legacy layouts migrate to one atomic envelope with per-panel preferences and reload restoration', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values: Record<string, string> = {};
  let writes = 0;
  Object.defineProperties(values, { getItem: { value: (k: string) => values[k] ?? null }, setItem: { value: (k: string, v: string) => { writes++; values[k] = v; } } });
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: values });
    const frame = { x: 10, y: 20, width: 400, height: 200 };
    values['swissmouse-desktop-v1:page:cover'] = JSON.stringify(frame);
    values['swissmouse-desktop-v1:page:groups'] = JSON.stringify({ cover: 'metadata' });
    values['swissmouse-desktop-v1:page:magnets'] = JSON.stringify([['a', 'b']]);
    values['swissmouse-desktop-v1:page:container:metadata'] = JSON.stringify({ ...defaultContainerLayout(), mode: 'grid', items: { cover: frame } });
    const state = loadWorkspaceState('page');
    assert.deepEqual(state.frames.cover, frame); assert.equal(state.groups.cover, 'metadata');
    assert.equal(state.layouts.metadata.mode, 'grid'); assert.deepEqual(state.magnets, [['a','b']]);
    state.panels.cover = { handleMode: 'magnet', locked: true };
    state.panels.description = { handleMode: 'resize', locked: false };
    state.generated.push({ id: 'generated-parent-123', title: 'My group', autoGenerated: true });
    assert.equal(saveWorkspaceState(state), true); assert.equal(writes, 1);
    assert.deepEqual(loadWorkspaceState('page'), state);
    assert.deepEqual(loadWorkspaceState('other').panels, {});
    assert.ok(values['swissmouse-desktop-v1:page:cover'], 'legacy recovery keys are retained');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('Disabled'); } });
    assert.equal(saveWorkspaceState(state), false);
    assert.deepEqual(loadWorkspaceState('page'), validWorkspaceState('page', null));
  } finally { if (old) Object.defineProperty(globalThis, 'localStorage', old); else delete (globalThis as any).localStorage; }
});

test('history reverses atomic merge/detach snapshots, caps retention, and clears redo on new edits', () => {
  const history = new LayoutHistory();
  const before = validWorkspaceState('page', null);
  const merged = { ...before, groups: { a: 'generated-parent-1', b: 'generated-parent-1' }, generated: [{ id: 'generated-parent-1', title: 'Group', autoGenerated: true as const }] };
  history.checkpoint(before);
  assert.equal(history.undo(merged), before);
  assert.equal(history.redo(before), merged);
  const detached = { ...merged, groups: { ...merged.groups, a: '' } };
  history.checkpoint(merged);
  assert.equal(history.undo(detached), merged);
  history.checkpoint(before); assert.equal(history.future.length, 0);
  for (let i = 0; i < 50; i++) history.checkpoint(before);
  assert.equal(history.past.length, 30);
});

test('reflow cost depends on the small panel registry', () => {
  const items = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [String(i), { x: i % 6 * 350, y: Math.floor(i / 6) * 250 + 48, width: 280, height: 180 }]));
  const start = performance.now();
  const resolved = resolveContainerLayout({ ...defaultContainerLayout(), mode: 'grid', items }, 600);
  assert.equal(Object.keys(resolved.items).length, 150);
  assert.ok(performance.now() - start < 1000);
  for (const [id, frame] of Object.entries(resolved.items)) assert.equal(Object.entries(resolved.items).some(([other, f]) => other !== id && overlaps(frame, f)), false);
});

test('collision arrangement preserves spatial order regardless of registry insertion order', async () => {
  const { arrangeContainer } = await import('../src/utils/containerLayout');
  const layout = arrangeContainer({ ...defaultContainerLayout(), mode: 'grid' }, {
    lower: { x: 0, y: 340, width: 420, height: 250 }, upper: { x: 0, y: 48, width: 420, height: 300 },
  });
  assert.equal(layout.items.upper.y, 48);
  assert.ok(layout.items.lower.y > layout.items.upper.y + layout.items.upper.height);
});

test('fluid constraints reject unusable limits and remain immutable after registration', () => {
  const definition = { id: 'test.fluid', name: 'Fluid test', role: 'child' as const, module: 'test', constraints: { minimumWidth: 240, minimumHeight: 150, maximumWidth: 600, overflow: 'auto' as const } };
  const remove = registerPanel(definition);
  try {
    assert.throws(() => registerPanel({ ...definition, id: 'test.invalid', name: 'Bad constraint', constraints: { minimumWidth: 240, maximumWidth: 100 } }), /fluid panel constraints/);
    assert.throws(() => registerPanel({ ...definition, id: 'test.invalid', name: 'Bad constraint', constraints: { minimumWidth: NaN } }), /fluid panel constraints/);
  } finally { remove(); }
});

test('workflow placement repair is recorded without discarding saved panel geometry', () => {
  const state = validWorkspaceState('step-2', {schemaVersion:1,workspaceId:'step-2',workflowPlacementVersion:1,frames:{'project-navigation':{x:20,y:30,width:210,height:372}}});
  assert.equal(validWorkspaceState('step-2', JSON.parse(JSON.stringify(state))).workflowPlacementVersion,1);
  assert.deepEqual(state.frames['project-navigation'],{x:20,y:30,width:210,height:372});
  assert.equal(validWorkspaceState('step-1',state).workflowPlacementVersion,undefined);
});
