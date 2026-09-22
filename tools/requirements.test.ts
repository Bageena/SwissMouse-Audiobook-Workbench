import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRequirementReadiness, selectedMissingRequirements, expandRequirementSelection, parseNvidiaCudaVersion, pytorchBuildOptions } from './requirements';
import type { BaseRequirementItem } from '../src/types';
const component = (id: string, ready = false, required = false): BaseRequirementItem => ({ id, name: id, purpose: id, classification: required ? 'required' : 'optional', status: ready ? 'ready' : 'missing', isAppManaged: true });
const options = { hasNvidiaGpu: false, accelerationPackagesReady: false };
const core = [component('python', true, true), component('ffmpeg', true, true), component('ffprobe', true, true)];
const faster = [component('faster_whisper', true), component('ctranslate2', true)];

test('driver compatibility parser accepts old CUDA and new CUDA UMD headers', () => {
 assert.equal(parseNvidiaCudaVersion('| NVIDIA-SMI 580.65.06 Driver Version: 580.65.06 CUDA Version: 13.0 |'), '13.0');
 const current = '| NVIDIA-SMI 616.56 KMD Version: 616.56 CUDA UMD Version: 13.4 |';
 assert.equal(parseNvidiaCudaVersion(current), '13.4');
 assert.equal(parseNvidiaCudaVersion('CUDA   UMD Version :  13.4'), '13.4');
 const build = pytorchBuildOptions({ hasNvidiaGpu: true, platform: 'win32', arch: 'x64', computeCapability: 8.6, cudaVersion: parseNvidiaCudaVersion(current) });
 assert.equal(build.cudaAvailable, true);
 assert.equal(build.cudaIndex, 'cu126');
});

test('missing CUDA information never borrows another driver or tool version', () => {
 for (const output of ['', 'NVIDIA-SMI 616.56 KMD Version: 616.56', 'CUDA UMD Version: N/A', 'CUDA Version: N/A V13.4', 'CUDA Version: unknown']) {
  assert.equal(parseNvidiaCudaVersion(output), undefined);
  assert.equal(pytorchBuildOptions({ hasNvidiaGpu: true, platform: 'win32', arch: 'x64', computeCapability: 8.6, cudaVersion: parseNvidiaCudaVersion(output) }).cudaAvailable, false);
 }
});
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
