import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Workspace, WorkspaceContainer, registerContainer } from '../src/workspace';

test('each standard container exposes the same layout control and stable instance identity', () => {
  for (const kind of ['panel', 'bar', 'group'] as const) {
    const html = renderToStaticMarkup(<Workspace page="test"><WorkspaceContainer id="stable-instance" title="Friendly name" kind={kind}>
      <input aria-label="Shared draft" defaultValue="Keep me" />
    </WorkspaceContainer></Workspace>);
    assert.ok(html.includes(`data-container-type="swissmouse.${kind}"`));
    assert.ok(html.includes('data-desktop-window="stable-instance"'));
    assert.ok(html.includes('aria-label="Layout for Friendly name"'));
    assert.ok(html.includes('aria-label="Shared draft"'));
  }
});

test('a registered module widget uses the shared container rendering path', () => {
  const remove = registerContainer({ id: 'sample.notes', name: 'Notes', type: 'panel', content: 'widget', minimumWidth: 240, version: 1 });
  try {
    const html = renderToStaticMarkup(<Workspace page="test"><WorkspaceContainer id="my-notes" title="Reading notes" definitionId="sample.notes"><p>Module content</p></WorkspaceContainer></Workspace>);
    assert.ok(html.includes('data-container-definition="sample.notes"'));
    assert.ok(html.includes('data-container-type="swissmouse.panel"'));
    assert.ok(html.includes('aria-label="Layout for Reading notes"'));
    assert.throws(() => renderToStaticMarkup(<Workspace page="test"><WorkspaceContainer id="$content" title="Invalid">Content</WorkspaceContainer></Workspace>), /Invalid container instance/);
  } finally { remove(); }
});
