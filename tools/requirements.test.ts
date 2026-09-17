import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRequirementReadiness, selectedMissingRequirements, expandRequirementSelection } from './requirements';
import type { BaseRequirementItem } from '../src/types';
const component = (id: string, ready = false, required = false): BaseRequirementItem => ({ id, name: id, purpose: id, classification: required ? 'required' : 'optional', status: ready ? 'ready' : 'missing', isAppManaged: true });
const options = { hasNvidiaGpu: false, accelerationPackagesReady: false };
const core = [component('python', true, true), component('ffmpeg', true, true), component('ffprobe', true, true)];
const faster = [component('faster_whisper', true), component('ctranslate2', true)];
test('complete CPU path is green despite missing optional compatibility engine', () => {
 assert.equal(evaluateRequirementReadiness([...core, ...faster, component('openai_whisper')], options).statusColor, 'green');
});
test('GPU improvement and complete compatibility fallback are yellow', () => {
 assert.equal(evaluateRequirementReadiness([...core, ...faster], {...options, hasNvidiaGpu: true}).statusColor, 'yellow');
 assert.equal(evaluateRequirementReadiness([...core, component('openai_whisper', true), component('pytorch', true)], options).statusColor, 'yellow');
});
test('no backend or missing core dependencies are red', () => {
 for (const [components, opts] of [[core, options], [[...core, ...faster, component('runtime', false, true)], options]] as const) {
  assert.equal(evaluateRequirementReadiness([...components], opts).statusColor, 'red');
 }
});
test('installer includes only missing core and explicitly selected groups with dependencies', () => {
 const components = [component('python', false, true), component('ffmpeg', true, true), component('faster_whisper'), component('ctranslate2'), component('openai_whisper'), component('pytorch'), component('nvidia_acceleration')];
 const plan = (ids: string[]) => selectedMissingRequirements(components, ids).map(c => c.id);
 assert.deepEqual(plan([]), ['python']);
 assert.deepEqual(plan(['faster_whisper']), ['python', 'faster_whisper', 'ctranslate2']);
 assert.deepEqual(plan(['openai_whisper']), ['python', 'openai_whisper', 'pytorch']);
 assert.deepEqual(plan(['faster_whisper', 'openai_whisper']), ['python', 'faster_whisper', 'ctranslate2', 'openai_whisper', 'pytorch']);
 assert.deepEqual(plan(['ctranslate2']), ['python', 'ctranslate2']);
 assert.deepEqual(plan(['unknown']), ['python']);
 assert.deepEqual(expandRequirementSelection(['nvidia_acceleration']).sort(), ['ctranslate2', 'faster_whisper', 'nvidia_acceleration']);
});
