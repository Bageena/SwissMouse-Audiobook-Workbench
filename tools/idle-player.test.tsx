import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { IdlePlayer } from '../src/components/IdlePlayer';
import { idlePlayerMessages, nextIdleMessageIndex } from '../src/utils/idlePlayerMessages';

test('idle messages cover 100 unique activations before repeating', () => {
  assert.equal(idlePlayerMessages.length, 100);
  assert.equal(new Set(idlePlayerMessages).size, 100);
  let index = -1;
  const seen = new Set<string>();
  for (let activation = 0; activation < 100; activation++) {
    index = nextIdleMessageIndex(index);
    seen.add(idlePlayerMessages[index]);
  }
  assert.equal(seen.size, 100);
  assert.equal(nextIdleMessageIndex(index), 0);
  for (const invalid of [NaN, Infinity, -2, 101, 0.5]) assert.equal(nextIdleMessageIndex(invalid), 0);
});

test('idle player displays its mascot and clear listening instructions', () => {
  const html = renderToStaticMarkup(<IdlePlayer />);
  assert.ok(html.includes('Nothing playing'));
  assert.ok(html.includes('aria-label="Idle player mascot"'));
  assert.ok(html.includes('Choose a book'));
  assert.ok(!html.includes('<audio'));
});
