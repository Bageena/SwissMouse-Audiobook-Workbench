import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdaptiveButton } from '../src/components/AdaptiveButton';
import { PanelGridInspector } from '../src/components/PanelGridInspector';

test('adaptive controls retain a full accessible name and tooltip in all CSS presentations', () => {
  const html = renderToStaticMarkup(<AdaptiveButton icon={<svg />} label="Save book details" description="Keep the current draft" disabled />);
  assert.match(html, /aria-label="Save book details"/);
  assert.match(html, /title="Save book details — Keep the current draft"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /type="button"/);
});

test('compact commands preserve their full action and native button behavior', () => {
  const html = renderToStaticMarkup(<AdaptiveButton icon={<svg />} label="Create the final audiobook" compactLabel="Create audiobook"
    description="Use the selected export settings" tone="primary" slotClassName="export-command" type="submit" name="action" value="export" aria-busy="true" />);
  assert.match(html, /class="adaptive-button-slot export-command"/);
  assert.match(html, /data-has-compact-label="true"/);
  assert.match(html, /aria-label="Create the final audiobook"/);
  assert.match(html, /title="Create the final audiobook — Use the selected export settings"/);
  assert.match(html, /type="submit"/);
  assert.match(html, /name="action" value="export"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-tone="primary"/);
  assert.match(html, /adaptive-button-label-compact">Create audiobook/);
  assert.doesNotMatch(html, /compactLabel=|slotClassName=|description=/);
});

test('explicit accessible names and tooltips survive compact presentation', () => {
  const html = renderToStaticMarkup(<AdaptiveButton icon={<svg />} label="Cancel" compactLabel="Stop" tone="danger"
    aria-label="Cancel audio processing" title="Cancel the current operation" />);
  assert.match(html, /aria-label="Cancel audio processing"/);
  assert.match(html, /title="Cancel the current operation"/);
  assert.match(html, /data-tone="danger"/);
});

test('inspector exposes only actual immediate children with friendly names, selection and editable preferred sizes', () => {
  const frame = { x: 0, y: 48, width: 300, height: 200 };
  const html = renderToStaticMarkup(<PanelGridInspector inspection={{ items: [{ id: 'cover-id', title: 'Cover art', frame, preferred: { ...frame, width: 480 }, locked: false }],
    selected: 'cover-id', width: 600, select() {}, edit() {}, reorder() {}, reset() {}, disabled: false }} />);
  assert.match(html, /aria-label="Select Cover art" aria-pressed="true"/);
  assert.match(html, /aria-label="Preferred width"[^>]*value="480"/);
  assert.match(html, /current 300 × 200 px/);
  assert.equal((html.match(/data-inspector-panel=/g) || []).length, 1);
});
