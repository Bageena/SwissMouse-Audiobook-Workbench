import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pickAudioFile, pickAudioFiles, pickAudioFolder } from './native-file-picker';

test('native picker returns the selected filesystem path', async () => {
  let called = false;
  const run = async (command: string, args: string[]) => {
    called = true;
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-STA'));
    assert.match(args.at(-1) || '', /\*\.m4b/);
    assert.match(args.at(-1) || '', /CenterScreen/);
    assert.match(args.at(-1) || '', /TopMost = \$true/);
    assert.match(args.at(-1) || '', /ShowDialog\(\$owner\)/);
    return { stdout: 'D:\\Audiobooks\\Book.m4b', stderr: '' };
  };
  assert.equal(await pickAudioFile(['m4b', 'mp3'], 'win32', run as any), 'D:\\Audiobooks\\Book.m4b');
  assert.equal(called, true);
});

test('cancelling native picker is harmless', async () => {
  assert.equal(await pickAudioFile(['m4b'], 'win32', (async () => ({ stdout: '', stderr: '' })) as any), null);
});

test('native file picker returns only the selected files', async () => {
  const files = ['D:\\Audiobooks\\01.mp3', 'D:\\Audiobooks\\03.mp3'];
  const run = async (_command: string, args: string[]) => {
    assert.match(args.at(-1) || '', /Multiselect = \$true/);
    return { stdout: JSON.stringify(files), stderr: '' };
  };
  assert.deepEqual(await pickAudioFiles(['mp3'], 'win32', run as any), files);
  assert.equal(await pickAudioFiles(['mp3'], 'win32', (async () => ({ stdout: '', stderr: '' })) as any), null);
});

test('Explorer-style folder picker selects the whole directory and keeps the dialog in front', async () => {
  const run = async (command: string, args: string[]) => {
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-STA'));
    assert.match(args.at(-1) || '', /IFileDialogCom/);
    assert.match(args.at(-1) || '', /options \| 0x20u \| 0x40u/);
    assert.match(args.at(-1) || '', /TopMost = \$true/);
    assert.match(args.at(-1) || '', /CenterScreen/);
    assert.match(args.at(-1) || '', /Pick\(\$owner\.Handle\)/);
    assert.match(args.at(-1) || '', /SIGDN_FILESYSPATH/);
    return { stdout: 'D:\\Audiobooks\\Book', stderr: '' };
  };
  assert.equal(await pickAudioFolder('win32', run as any), 'D:\\Audiobooks\\Book');
  assert.equal(await pickAudioFolder('win32', (async () => ({ stdout: '', stderr: '' })) as any), null);
});

test('Explorer folder picker COM declarations compile in Windows PowerShell', { skip: process.platform !== 'win32' }, async () => {
  let script = '';
  await pickAudioFolder('win32', (async (_command: string, args: string[]) => {
    script = args.at(-1) || '';
    return { stdout: '', stderr: '' };
  }) as any);
  const declaration = script.slice(0, script.indexOf('try { $owner.Show()'));
  execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', `${declaration}\n[SwissMouseFolderDialog].FullName | Out-Null`], { windowsHide: true });
});

test('unsupported native dialog platform reports a clear fallback', async () => {
  await assert.rejects(pickAudioFile(['m4b'], 'linux'), /currently requires Windows/);
  await assert.rejects(pickAudioFolder('linux'), /currently requires Windows/);
});
