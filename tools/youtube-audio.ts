import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export function youtubeUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A YouTube video URL is required.');
  const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : 'https://' + value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || !['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname) || url.username || url.password || url.port || url.pathname === '/') throw new Error('Enter a valid youtube.com or youtu.be video URL.');
  return url.href;
}

export const youtubeBaseArgs = () => ['--ignore-config', '--no-playlist', '--no-progress', '--socket-timeout', '30', '--js-runtimes', 'node:' + process.execPath, '-f', 'bestaudio'];

export async function downloadYoutubeAudio(executable: string, ffmpegDirectory: string, directory: string, url: string, format: string, executableArgs: string[] = []) {
  if (!['best','m4a','mp3','flac','opus','wav'].includes(format)) throw new Error('Unsupported YouTube audio format.');
  const cleanUrl = youtubeUrl(url);
  fs.mkdirSync(directory, {recursive: true});
  const args = [...youtubeBaseArgs(), '--ffmpeg-location', ffmpegDirectory, '--windows-filenames', '--no-overwrites', '--no-simulate', '--print', 'after_move:%(filepath)j', '-o', path.join(directory, '%(title).80s_%(id)s.%(ext)s')];
  // Best keeps the original audio-only container and encoded packets, including WebM/Opus.
  if (format !== 'best') args.push('-x', '--audio-format', format, '--audio-quality', '0');
  args.push('--', cleanUrl);
  const {stdout} = await run(executable, [...executableArgs, ...args], {encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024});
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error('yt-dlp did not report exactly one completed audio file.');
  const file = JSON.parse(lines[0]);
  if (typeof file !== 'string') throw new Error('yt-dlp returned an invalid file path.');
  const fullPath = path.resolve(file);
  const relative = path.relative(path.resolve(directory), fullPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(fullPath).isFile()) throw new Error('Downloaded audio is outside its import directory or is missing.');
  return {file: path.basename(fullPath), fullPath};
}
