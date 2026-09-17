import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PACKAGE_STATUS_SCRIPT } from './package-status';

const python = path.resolve(process.platform === 'win32' ? 'runtime/venv/Scripts/python.exe' : 'runtime/venv/bin/python');
test('package discovery bypasses legacy startup hooks and never imports transcription packages', {skip: !fs.existsSync(python)}, () => {
  const root = fs.mkdtempSync(path.resolve('.cache/package-probe-'));
  const packages = path.join(root, process.platform === 'win32' ? 'Lib/site-packages' : 'lib/python3.10/site-packages');
  const metadata = path.join(packages, 'torch-1.2.3.dist-info');
  fs.mkdirSync(metadata, {recursive:true});
  fs.writeFileSync(path.join(metadata, 'METADATA'), 'Metadata-Version: 2.1\nName: torch\nVersion: 1.2.3\n');
  const marker = path.join(root, 'unwanted-startup');
  fs.writeFileSync(path.join(packages, 'sitecustomize.py'), `open(${JSON.stringify(marker)}, 'w').write('hook ran')`);
  fs.writeFileSync(path.join(packages, 'torch.py'), "raise RuntimeError('UI must never import torch')");
  const result = JSON.parse(execFileSync(python, ['-S', '-c', PACKAGE_STATUS_SCRIPT, root], {
    encoding:'utf8', windowsHide:true, env:{...process.env, PYTHONPATH:packages},
  }));
  assert.equal(result.torch.output, '1.2.3');
  assert.equal(result.python.ok, true);
  assert.equal(result['faster-whisper'].ok, false);
  assert.equal(fs.existsSync(marker), false);
});
