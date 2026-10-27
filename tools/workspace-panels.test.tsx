import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResizableColumns } from '../src/components/ResizableColumns';
import { ResizableRegion } from '../src/components/ResizableRegion';

test('height handles restore bounded sizes, keep natural defaults, and can be disabled', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    const values = new Map([['swissmouse-region-cover', '480'], ['swissmouse-region-invalid', '50000']]);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null } });
    const render = (key: string, enabled = true) => renderToStaticMarkup(<ResizableRegion storageKey={key} label="cover" enabled={enabled}><p>Artwork</p></ResizableRegion>);
    assert.match(render('cover'), /min-height:480px/);
    assert.ok(!render('cover').includes('overflow:auto'));
    assert.ok(!render('invalid').includes('height:50000'));
    assert.match(render('cover'), /aria-orientation="horizontal"/);
    assert.match(render('cover'), /aria-label="Resize cover height"/);
    assert.equal(render('cover', false), '<p>Artwork</p>');
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete (globalThis as any).localStorage; }
});

test('workspace splits recover invalid saved sizing and isolate each workspace preference', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([['swissmouse-panel-chapters', '61'], ['swissmouse-panel-metadata', 'broken']]);
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null } });
    const render = (storageKey: string) => renderToStaticMarkup(<ResizableColumns storageKey={storageKey} initialRatio={42} label="Resize panels"><section>Source</section><section>Editor</section></ResizableColumns>);
    assert.match(render('chapters'), /aria-valuenow="61"/);
    assert.match(render('metadata'), /aria-valuenow="42"/);
    assert.match(render('new-workspace'), /aria-valuenow="42"/);
    values.set('swissmouse-panel-chapters', '900');
    assert.match(render('chapters'), /aria-valuenow="78"/);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
    const html = render('chapters');
    assert.match(html, /aria-valuenow="42"/);
    assert.ok(html.includes('Source') && html.includes('Editor'));
    assert.match(html, /role="separator"[^>]*tabindex="0"/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete (globalThis as any).localStorage;
  }
});
