import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleRegistry } from '../src/core/modules';
import { audiobookManifest } from '../src/modules/audiobooks/manifest';

test('built-in module boundary retains typed contributions and rejects collisions and incompatible contracts', () => {
  const registry = createModuleRegistry(), screens = { library: () => 'library' };
  const registered = registry.register(audiobookManifest, screens);
  assert.equal(registered.screens.library(), 'library');
  assert.deepEqual(registry.list(), [audiobookManifest]);
  assert.throws(() => registry.register(audiobookManifest, screens), /already registered/);
  assert.throws(() => createModuleRegistry().register({ ...audiobookManifest, contractVersion: 2 }, screens), /Unsupported/);
  assert.throws(() => createModuleRegistry().register({ ...audiobookManifest, workspaces: [{ id: 'other.library', label: 'Other', description: '' }] }, screens), /namespaced/);
});
