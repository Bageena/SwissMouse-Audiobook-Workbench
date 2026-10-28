import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { nextAmbientLightLevel } from '../src/playback/ambientLightLevel';
import { PlayerAmbientGlow } from '../src/components/PlayerAmbientGlow';

test('ambient light softens transients and settles gradually during silence', () => {
  const loud = new Uint8Array(256).fill(255);
  const silence = new Uint8Array(256).fill(128);
  const attack = nextAmbientLightLevel(loud, 0);
  assert.equal(attack, .12);
  let level = attack;
  for (let index = 0; index < 100; index++) level = nextAmbientLightLevel(loud, level);
  assert.ok(level <= 1 && level > .99);
  const release = nextAmbientLightLevel(silence, level);
  assert.ok(release > .87 && release < level);
  for (let index = 0; index < 100; index++) level = nextAmbientLightLevel(silence, level);
  assert.ok(level >= 0 && level < .001);
  assert.equal(nextAmbientLightLevel(new Uint8Array(), 0), 0);
});

test('disabled glow has no layer; enabled glow is decorative and inaccessible', () => {
  assert.equal(renderToStaticMarkup(React.createElement(PlayerAmbientGlow, { enabled: false })), '');
  const html = renderToStaticMarkup(React.createElement(PlayerAmbientGlow, { enabled: true }));
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /tabindex|button|audio|canvas/i);
});
