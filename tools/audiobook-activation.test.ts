import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { activateBuiltInAudiobooks, listBuiltInModules } from '../src/modules/builtins';
import { getPanelDefinition } from '../src/workspace/panels';
import { validWorkspaceState } from '../src/workspace/workspaceState';

test('activation owns audiobook contributions; removal preserves shell panels and saved layout state', () => {
  assert.equal(getPanelDefinition('metadata'), undefined);
  assert.equal(listBuiltInModules().length, 0);
  const saved = validWorkspaceState('step-3', { schemaVersion: 1, workspaceId: 'step-3', frames: { metadata: { x: 12, y: 34, width: 700, height: 400 } }, panels: { metadata: { handleMode: 'move', locked: true } } });
  const before = JSON.stringify(saved);
  const first = activateBuiltInAudiobooks(), second = activateBuiltInAudiobooks();
  assert.equal(listBuiltInModules().length, 1);
  assert.equal(getPanelDefinition('metadata')?.module, 'audiobooks');
  assert.equal(getPanelDefinition('project-navigation')?.constraints?.minimumWidth, 56);
  first(); first(); assert.ok(getPanelDefinition('metadata'));
  second(); assert.equal(getPanelDefinition('metadata'), undefined);
  assert.equal(listBuiltInModules().length, 0);
  assert.ok(getPanelDefinition('application-header')); assert.ok(getPanelDefinition('panel-File Manager'));
  assert.deepEqual(validWorkspaceState('step-3', saved), saved);
  assert.equal(JSON.stringify(saved), before);
  const reinstall = activateBuiltInAudiobooks();
  try { assert.equal(getPanelDefinition('metadata')?.name, 'Metadata'); assert.equal(JSON.stringify(saved), before); }
  finally { reinstall(); }
});

test('independent client coordination builds without private host or third-party runtime imports', async () => {
  for (const name of ['client-service.ts', 'legacy-workspace-client.ts', 'edit-controller.ts', 'session-view.ts', 'workspace-contributions.ts']) {
    const result = await build({ entryPoints: [`packages/audiobooks/src/${name}`], bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true });
    for (const input of Object.keys(result.metafile!.inputs)) assert.ok(input.replaceAll('\\', '/').startsWith('packages/audiobooks/src/'), `${name} imported ${input}`);
  }
});
