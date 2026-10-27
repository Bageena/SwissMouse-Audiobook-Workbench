import test from 'node:test';
import assert from 'node:assert/strict';
import { conversionComplete } from '../src/utils/conversionWorkflow';
import type { AudiobookJob } from '../src/types';
const exports: NonNullable<AudiobookJob['exports']> = [{format:'m4b',status:'success',progress:100},{format:'mp3',status:'success',progress:100}];
test('conversion completes only when every selected format succeeded', () => {
  assert.equal(conversionComplete(exports,['m4b','mp3'],false),true);
  assert.equal(conversionComplete(undefined,['m4b'],false),false);
  assert.equal(conversionComplete(exports,[],false),false);
  assert.equal(conversionComplete(exports,['flac'],false),false);
  assert.equal(conversionComplete(exports,['m4b'],true),false);
  assert.equal(conversionComplete(exports,['m4b'],false,'Export failed'),false);
  for (const status of ['running','queued','failed'] as const) assert.equal(conversionComplete([{...exports[0]},{...exports[1],status}],['m4b','mp3'],false),false);
});
