import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Workspace, WorkspaceContainer, ToolbarPanel } from '../src/workspace';
import { HeaderDockSurface, HEADER_PANEL_ID } from '../src/components/HeaderDockSurface';
import { RefreshDocumentIcon } from '../src/components/RefreshDocumentIcon';
import { validWorkspaceState } from '../src/workspace/workspaceState';
import { findDockSnap } from '../src/utils/windowConnections';

test('header provides docking regions, a real toolbar, and media player container controls', () => {
  const html = renderToStaticMarkup(<Workspace page="header-test"><HeaderDockSurface brand={<button>Home</button>} player={<WorkspaceContainer id="header-media-player" title="Media Player" homeWindow={HEADER_PANEL_ID}><p>Player state</p></WorkspaceContainer>} tools={<ToolbarPanel id="header-toolbar" title="Header Toolbar" homeWindow={HEADER_PANEL_ID}><button aria-label="Import Book">+</button></ToolbarPanel>} /></Workspace>);
  for (const side of ['left', 'right']) assert.ok(html.includes(`data-header-dock="${side}"`));
  assert.match(html, /role="toolbar" aria-label="Header Toolbar" aria-orientation="horizontal"/);
  assert.match(html, /data-desktop-window="header-media-player"/);
  assert.match(html, /Show controls for Media Player/);
  assert.ok(html.includes('aria-label="Import Book"'));
});

test('file and page refresh actions have distinct background glyphs', () => {
  const file = renderToStaticMarkup(<RefreshDocumentIcon kind="file" />);
  const page = renderToStaticMarkup(<RefreshDocumentIcon kind="page" />);
  assert.match(file, /lucide-file /);
  assert.match(page, /lucide-panels-top-left /);
  for (const html of [file, page]) assert.ok(html.includes('refresh-document-front'));
});

test('header drop zones select only their intended side even when pointer is near top edge', () => {
  const left = { id: 'application-header', title: 'Header left', sides: ['left'] as const, frame: { x: 200, y: 0, width: 96, height: 150 } };
  const target = { ...left, sides: ['left'] as ('left' | 'right')[] };
  assert.equal(findDockSnap({ x: 230, y: 2 }, [target])?.side, 'left');
  assert.equal(findDockSnap({ x: 270, y: 140 }, [{ ...target, sides: ['right'] }])?.side, 'right');
});

test('header sizes persist separately from free panel frames and reject malformed dimensions', () => {
  const state = validWorkspaceState('header', { schemaVersion: 1, workspaceId: 'header',
    panels: { tools: { headerSize: { width: 180, height: 240 } }, broken: { headerSize: { width: 'bad', height: 70 } }, huge: { headerSize: { width: 9000, height: -5 } } },
    frames: { tools: { x: 20, y: 30, width: 350, height: 400 } },
  });
  assert.deepEqual(state.panels.tools.headerSize, { width: 180, height: 240 });
  assert.equal(state.panels.broken.headerSize, undefined);
  assert.deepEqual(state.panels.huge.headerSize, { width: 680, height: 48 });
  assert.equal(state.frames.tools.width, 350);
});
