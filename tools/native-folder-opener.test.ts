import test from 'node:test';
import assert from 'node:assert/strict';
import { openFolderInForeground } from './native-folder-opener';

test('folder opener raises the matching Explorer window without interpolating the path into PowerShell code', async () => {
  const directory = 'D:\\Audiobooks\\A book with spaces';
  let called = false;
  const run = async (command: string, args: string[], options: { env: Record<string, string> }) => {
    called = true;
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-STA'));
    assert.equal(options.env.SWISSMOUSE_OPEN_FOLDER_PATH, directory);
    const script = Buffer.from(args.at(-1) || '', 'base64').toString('utf16le');
    assert.match(script, /\$shell\.Explore\(\$folder\)/);
    assert.match(script, /Find-FolderWindow/);
    assert.match(script, /SetWindowPos/);
    assert.match(script, /SetForegroundWindow/);
    assert.equal(script.includes(directory), false);
    return { stdout: '', stderr: '' };
  };
  await openFolderInForeground(directory, run as any);
  assert.equal(called, true);
});
