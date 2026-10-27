import React from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryColumnHeader } from '../src/components/LibraryColumnHeader';

test('each library header exposes an accessible independent resize handle', () => {
  for (const label of ['Select', 'Cover', 'Title', 'Author', 'Narrator', 'Series', 'Series No.', 'Year', 'Actions']) {
    const html = renderToStaticMarkup(<table><thead><tr><LibraryColumnHeader label={label} width={240} defaultWidth={160} onResize={() => {}}>{label}</LibraryColumnHeader></tr></thead></table>);
    assert.ok(html.includes(`aria-label="Resize ${label} column"`));
    assert.ok(html.includes('role="separator"'));
    assert.ok(html.includes('aria-valuenow="240"'));
    assert.ok(html.includes('tabindex="0"'));
  }
});
