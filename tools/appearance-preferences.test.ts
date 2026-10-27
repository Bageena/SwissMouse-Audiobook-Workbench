import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readAppearance, saveAppearance, validThemeId } from './appearance-preferences';

test('first browser migrates its theme; another origin cannot overwrite it during initialization', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-appearance-'));
  const file = path.join(dir, 'ui-preferences.json');
  try {
    assert.deepEqual(readAppearance(file), { theme: null });
    assert.deepEqual(saveAppearance(file, 'cheese', true), { theme: 'cheese' });
    assert.deepEqual(saveAppearance(file, 'light', true), { theme: 'cheese' });
    saveAppearance(file, 'dark');
    assert.deepEqual(readAppearance(file), { theme: 'dark' });
    assert.deepEqual(saveAppearance(file, 'cheese', true), { theme: 'dark' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('invalid input and corrupt storage cannot silently destroy existing preferences', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-appearance-'));
  const file = path.join(dir, 'ui-preferences.json');
  try {
    saveAppearance(file, 'my-custom-theme');
    for (const value of ['', '../cheese', null, 42, 'CHEESE', 'x'.repeat(65)]) {
      assert.equal(validThemeId(value), false);
      assert.throws(() => saveAppearance(file, value as string));
    }
    assert.equal(readAppearance(file).theme, 'my-custom-theme');
    fs.writeFileSync(file, '{broken');
    assert.throws(() => saveAppearance(file, 'light', true));
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
