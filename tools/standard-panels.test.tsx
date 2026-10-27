import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Folder } from 'lucide-react';
import { Workspace, NavigationPanel, ToolbarPanel, getContainerDefinition } from '../src/workspace';
import { WorkflowLayout } from '../src/components/WorkflowNavigation';
import { validWorkspaceState } from '../src/workspace/workspaceState';
import { connectWindow, validWindowConnections } from '../src/utils/windowConnections';
import type { AudiobookJob } from '../src/types';

test('navigation and toolbar are registered reusable definitions with accessible destinations and commands', () => {
  assert.equal(getContainerDefinition('swissmouse.navigation')?.name, 'Navigation Panel');
  assert.equal(getContainerDefinition('swissmouse.toolbar')?.name, 'Toolbar Panel');
  const markup = renderToStaticMarkup(<Workspace page="test">
    <NavigationPanel id="example-nav" title="Example Navigation" items={[{ id: 'files', label: 'Files', icon: <Folder />, onClick() {} }]} />
    <ToolbarPanel id="example-tools" title="Example Tools"><button>Command</button></ToolbarPanel>
  </Workspace>);
  assert.match(markup, /data-container-definition="swissmouse.navigation"/);
  assert.match(markup, /data-container-definition="swissmouse.toolbar"/);
  assert.match(markup, /aria-label="Files"/);
  assert.match(markup, /role="toolbar" aria-label="Example Tools" aria-orientation="horizontal"/);
});

test('workflow navigation changes friendly names without changing saved instance identity', () => {
  const job = { id: 'book', status: 'draft', chapters: [], parts: [] } as unknown as AudiobookJob;
  for (const files of [false, true]) {
    const markup = renderToStaticMarkup(<WorkflowLayout job={job} files={files} activeStep={1} onNavigate={() => {}}>Content</WorkflowLayout>);
    assert.match(markup, /data-desktop-window="project-navigation"/);
    assert.ok(markup.includes(files ? 'File Manager Navigation' : 'Navigation'));
  }
});

test('all five toolbar slots and free orientation survive workspace validation', () => {
  for (const side of ['top', 'header', 'left', 'right', 'bottom'] as const) {
    const connections = connectWindow({}, 'tools', 'parent', side);
    assert.equal(validWindowConnections(connections).tools.side, side);
    const state = validWorkspaceState('page', { schemaVersion: 1, workspaceId: 'page', connections, panels: { tools: { horizontal: false } } });
    assert.equal(state.connections.tools.side, side);
    assert.equal(state.panels.tools.horizontal, false);
  }
});

test('toolbars omit title and collapse chrome while retaining their management controls', () => {
  const html = renderToStaticMarkup(<Workspace page="toolbar"><ToolbarPanel id="title-free-toolbar" title="Named Tools"><button>Action</button></ToolbarPanel></Workspace>);
  assert.ok(html.includes('aria-label="Named Tools"'));
  assert.ok(html.includes('Window options for Named Tools'));
  assert.ok(html.includes('Show controls for Named Tools'));
  assert.ok(!html.includes('Collapse Named Tools'));
  assert.ok(!html.includes('workspace-panel-title'));
  assert.match(html, /role="toolbar"[^>]*><button[^>]*class="toolbar-panel-grip"/);
  assert.ok(!html.includes('class="desktop-window-toolbar-toggle"'));
});
