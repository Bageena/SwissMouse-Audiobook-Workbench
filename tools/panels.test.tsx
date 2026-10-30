import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Workspace, WorkspaceContainer, getPanelDefinition, listPanelDefinitions, registerPanel, canDockPanel } from '../src/workspace';
import { filterPanelGroups } from '../src/workspace/panels';
import { activateBuiltInAudiobooks } from '../src/modules/builtins';

after(activateBuiltInAudiobooks());

test('every built-in workspace panel has a unique catalog identity and friendly name', () => {
  const definitions = listPanelDefinitions();
  assert.equal(new Set(definitions.map(p => p.id)).size, definitions.length);
  assert.equal(new Set(definitions.map(p => p.name.toLowerCase())).size, definitions.length);
  const used = new Set<string>();
  for (const file of readdirSync(new URL('../src/components/', import.meta.url)).filter(f => f.endsWith('.tsx'))) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/HEADER_PANEL_ID = '([^']+)'/g)) used.add(match[1]);
    for (const match of source.matchAll(/<(?:DesktopWindow|WorkspacePanel|NavigationPanel|ToolbarPanel|SlideOutPanel|PreviewPanel)\b[^>]*\bid="([^"]+)"/g)) {
      used.add(match[1]);
      assert.ok(getPanelDefinition(match[1]), `${file}: ${match[1]} has a registered identity`);
    }
  }
  const retainedLegacyIds = ['metadata-rights'];
  for (const definition of definitions) assert.ok(used.has(definition.id) || retainedLegacyIds.includes(definition.id), `Unused panel must be explicitly retained for saved-layout compatibility: ${definition.id}`);
  assert.equal(getPanelDefinition('panel-File Manager')?.name, 'File Manager');
  for (const panel of definitions.filter(p => p.role === 'child'))
    assert.equal(getPanelDefinition(panel.defaultParent!)?.role, 'parent');
});

test('parents accept either role while children remain non-owning panels', () => {
  assert.equal(canDockPanel('child', 'parent'), true);
  assert.equal(canDockPanel('parent', 'parent'), true);
  for (const [source, target] of [['child', 'child'], ['parent', 'child']] as const)
    assert.equal(canDockPanel(source, target), false);
  assert.deepEqual(filterPanelGroups({ 'metadata-cover': '', 'metadata-identity': 'metadata-cover', 'metadata': 'panel-File Manager', 'metadata-rights': 'panel-File Manager' }), {
    'metadata-cover': '', 'metadata-identity': '', 'metadata': 'panel-File Manager', 'metadata-rights': 'panel-File Manager',
  });
});

test('registered names and permanent roles reach the shell independently of its instance ID', () => {
  const html = renderToStaticMarkup(<Workspace page="roles-test"><WorkspaceContainer id="custom-cover-instance" panelId="metadata-cover" title="Old label"><p>Cover</p></WorkspaceContainer></Workspace>);
  assert.match(html, /data-panel-name="Cover art"/);
  assert.match(html, /data-panel-role="child"/);
  assert.match(html, /data-panel-id="metadata-cover"/);
  assert.match(html, /data-desktop-window="custom-cover-instance"/);
});

test('panel registration rejects duplicate names and invalid roles', () => {
  assert.throws(() => registerPanel({ id: 'sample.files', name: 'file manager', role: 'child' }), /friendly name/);
  assert.throws(() => registerPanel({ id: 'sample.invalid', name: 'Invalid panel', role: 'parent', defaultParent: 'metadata' }), /Invalid/);
  const remove = registerPanel({ id: 'sample.notes', name: 'Research notebook', role: 'child' });
  try {
    assert.equal(getPanelDefinition('sample.notes')?.role, 'child');
    assert.ok(Object.isFrozen(getPanelDefinition('sample.notes')));
    assert.throws(() => registerPanel({ id: 'sample.notes', name: 'Another notebook', role: 'child' }), /already registered/);
  } finally { remove(); }
  assert.equal(getPanelDefinition('sample.notes'), undefined);
});
