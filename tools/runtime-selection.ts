import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TranscriptionBackend } from '../src/transcription';
import { PYTHON_DLL_SETUP } from './transcription-engine';

const execute = promisify(execFile);
export type RuntimeTool = { path: string; source: 'system' | 'app'; version?: string };
export type SystemPython = RuntimeTool & { packages: Record<string, { ok: boolean; output?: string }>; libraryPaths: string[]; engines: TranscriptionBackend[] };
export type RuntimeSelection = {
  ffmpeg: RuntimeTool; ffprobe: RuntimeTool; ytDlp: RuntimeTool;
  python: RuntimeTool; backends: Partial<Record<TranscriptionBackend, SystemPython>>;
  warnings: string[]; mode: 'hybrid' | 'managed';
};
export function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
/** A managed directory/file must resolve to its declared place under the app. */
export function assertManagedTarget(appRoot: string, target: string) {
  const relative = path.relative(path.resolve(appRoot), path.resolve(target));
  if (!relative || !isWithin(path.join(appRoot, 'runtime'), target)) throw new Error('Not an app-managed runtime target.');
  const expected = path.join(fs.realpathSync(appRoot), relative);
  if (path.relative(expected, fs.realpathSync(target)) !== '') throw new Error('Refusing to change a redirected runtime target.');
}
export function pathCandidates(names: string[], runtimeRoot: string, value = process.env.PATH || '', platform = process.platform): string[] {
  const found = new Set<string>();
  for (const entry of value.split(path.delimiter)) {
    const directory = entry.replace(/^"|"$/g, '');
    // No cwd lookup, shell expansion, batch scripts, or Windows Store launchers.
    if (!path.isAbsolute(directory) || /[\\/]WindowsApps(?:[\\/]|$)/i.test(directory)) continue;
    for (const name of names) {
      const file = path.join(directory, name + (platform === 'win32' ? '.exe' : ''));
      try {
        if (!fs.statSync(file).isFile()) continue;
        const resolved = fs.realpathSync(file);
        if (isWithin(runtimeRoot, file) || isWithin(fs.existsSync(runtimeRoot) ? fs.realpathSync(runtimeRoot) : runtimeRoot, resolved)) continue;
        if (![...found].some(p => platform === 'win32' ? p.toLowerCase() === file.toLowerCase() : p === file)) found.add(file);
      } catch { /* Missing or inaccessible entries are not candidates. */ }
    }
  }
  return [...found].slice(0, 6);
}

// Only complete, importable environments are selected. Never add the private
// venv to sys.path or install packages into an externally managed interpreter.
export const SYSTEM_PYTHON_SCRIPT = PYTHON_DLL_SETUP + String.raw`
import sys, json, struct, importlib.metadata as metadata, importlib.util
r = dict(version='.'.join(map(str,sys.version_info[:3])), compatible=False, packages={}, engines=[], libraryPaths=[], errors=[])
if (3,10) <= sys.version_info[:2] < (3,14) and struct.calcsize('P') == 8:
    r['compatible'] = True
    for name in ['faster-whisper','ctranslate2','openai-whisper','torch','nvidia-cublas-cu12','nvidia-cudnn-cu12']:
        try:
            dist = metadata.distribution(name)
            r['packages'][name] = dict(ok=True, output=dist.version)
            if name.startswith('nvidia-'):
                library = str(dist.locate_file('nvidia/' + ('cublas' if 'cublas' in name else 'cudnn') + ('/bin' if os.name == 'nt' else '/lib')))
                if os.path.isdir(library):
                    r['libraryPaths'].append(library)
                    if os.name == 'nt': _dll_handles.append(os.add_dll_directory(library))
        except metadata.PackageNotFoundError: pass
    try:
        import faster_whisper, ctranslate2, huggingface_hub
        assert hasattr(faster_whisper.WhisperModel, 'transcribe') and ctranslate2.get_supported_compute_types('cpu')
        r['engines'].append('faster-whisper')
    except Exception as e: r['errors'].append('Faster Whisper: ' + str(e)[:300])
    try:
        import whisper, torch
        assert hasattr(whisper, 'load_model') and hasattr(whisper, 'transcribe')
        r['engines'].append('openai-whisper')
    except Exception as e: r['errors'].append('Regular Whisper: ' + str(e)[:300])
print(json.dumps(r))
`;
type Probe = (file: string, args: string[], timeout: number) => Promise<string>;
export function cleanPythonEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const name of Object.keys(result)) if (['PYTHONHOME', 'PYTHONPATH'].includes(name.toUpperCase())) delete result[name];
  return result;
}
export async function discoverRuntime(options: {
  runtimeRoot: string; python: string; ffmpeg: string; ffprobe: string; ytDlp: string;
  mode?: 'hybrid' | 'managed'; pathValue?: string; platform?: NodeJS.Platform; probe?: Probe;
}): Promise<RuntimeSelection> {
  const selection: RuntimeSelection = {
    ffmpeg: { path: options.ffmpeg, source: 'app' }, ffprobe: { path: options.ffprobe, source: 'app' },
    ytDlp: { path: options.ytDlp, source: 'app' }, python: { path: options.python, source: 'app' },
    backends: {}, warnings: [], mode: options.mode || 'hybrid',
  };
  if (selection.mode === 'managed') return selection;
  const probe: Probe = options.probe || (async (file, args, timeout) => (await execute(file, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024, env: cleanPythonEnv() })).stdout);
  const candidates = (names: string[]) => pathCandidates(names, options.runtimeRoot, options.pathValue, options.platform);
  await Promise.all((['ffmpeg', 'ffprobe', 'ytDlp'] as const).map(async key => {
    const name = key === 'ytDlp' ? 'yt-dlp' : key;
    for (const file of candidates([name])) {
      try {
        const output = (await probe(file, [key === 'ytDlp' ? '--version' : '-version'], 3000)).trim();
        const version = output.split(/\r?\n/)[0];
        const release = new RegExp('^' + name + ' version (?:n)?([0-9]+)\\.').exec(version);
        // Current Windows builds often use date/git identifiers instead of a
        // release number. libavformat 59 corresponds to FFmpeg 5 and later.
        const library = /^libavformat\s+(\d+)\./m.exec(output);
        const supported = key === 'ytDlp' ? /^20\d{2}\.\d{2}\.\d{2}/.test(version) && version >= '2025.11.12'
          : version.startsWith(name + ' version ') && (release ? Number(release[1]) >= 5 : !!library && Number(library[1]) >= 59);
        if (!supported) throw new Error('Unsupported version');
        selection[key] = { path: file, source: 'system', version }; break;
      } catch (error: any) { selection.warnings.push(name + ': skipped ' + file + ' (' + String(error.message).slice(0, 200) + ')'); }
    }
  }));
  // yt-dlp accepts a single media-tool directory. Keep this pair together so
  // conversion never picks an unverified ffprobe beside the chosen ffmpeg.
  if (selection.ffmpeg.source !== selection.ffprobe.source || path.dirname(selection.ffmpeg.path).toLowerCase() !== path.dirname(selection.ffprobe.path).toLowerCase()) {
    selection.warnings.push('FFmpeg/FFprobe: no compatible pair in the selected directory; using the app-managed media tools together.');
    selection.ffmpeg = {path:options.ffmpeg,source:'app'};
    selection.ffprobe = {path:options.ffprobe,source:'app'};
  }
  for (const file of candidates(['python', 'python3']).slice(0, 3)) {
    try {
      const data = JSON.parse((await probe(file, ['-c', SYSTEM_PYTHON_SCRIPT], 15000)).trim().split(/\r?\n/).pop()!);
      if (!data.compatible) throw new Error('Requires 64-bit Python 3.10–3.13');
      const python: SystemPython = { path: file, source: 'system', version: data.version, packages: data.packages, libraryPaths: data.libraryPaths, engines: data.engines };
      if (selection.python.source !== 'system') selection.python = python;
      for (const engine of ['faster-whisper', 'openai-whisper'] as const) if (!selection.backends[engine] && python.engines.includes(engine)) selection.backends[engine] = python;
      for (const message of data.errors || []) selection.warnings.push(file + ': ' + message);
      if (selection.backends['faster-whisper'] && selection.backends['openai-whisper']) break;
    } catch (error: any) { selection.warnings.push('Python: skipped ' + file + ' (' + String(error.message).slice(0, 200) + ')'); }
  }
  return selection;
}

export const optionalPackages: Record<string, string[]> = {
  faster_whisper: ['faster-whisper'], ctranslate2: ['ctranslate2'], openai_whisper: ['openai-whisper'],
  pytorch: ['torch'], nvidia_acceleration: ['nvidia-cublas-cu12', 'nvidia-cudnn-cu12'],
};
export const removalImpact: Record<string, string> = {
  faster_whisper: 'App-managed Faster Whisper transcription will be unavailable until reinstalled.',
  ctranslate2: 'App-managed Faster Whisper depends on CTranslate2 and will stop working until it is reinstalled.',
  openai_whisper: 'App-managed regular Whisper transcription will be unavailable until reinstalled.',
  pytorch: 'App-managed regular Whisper (and other local packages using PyTorch) will stop working until it is reinstalled.',
  nvidia_acceleration: 'App-managed Faster Whisper may fall back to CPU without these CUDA libraries.',
  yt_dlp: 'YouTube import needs yt-dlp. A compatible system copy can still be used.',
};
export function optionalRemoval(id: string, confirmed: boolean, installed: boolean) {
  if (!Object.hasOwn(removalImpact, id)) throw new Error('Only optional components can be removed here.');
  if (!installed) throw new Error('No app-managed copy is installed. System installations are never removed.');
  if (!confirmed) throw new Error('Confirm removal and its dependency impact first.');
  return optionalPackages[id] || [];
}

// Invoked only with the private interpreter, never the chosen system Python.
// Check distribution ownership before pip sees the uninstall list (including
// protection against a manually configured system-site-packages venv).
export const PRIVATE_UNINSTALL_CHECK = String.raw`
import sys, os, json, importlib.metadata as metadata
root = os.path.realpath(sys.argv[1])
assert os.path.normcase(os.path.realpath(sys.prefix)) == os.path.normcase(root), 'Not the private runtime'
names = json.loads(sys.argv[2])
for name in names:
    try: location = os.path.realpath(str(metadata.distribution(name).locate_file('')))
    except metadata.PackageNotFoundError: continue
    assert os.path.commonpath([root, location]) == root, 'Refusing to remove an external package: ' + name
print('Private package ownership verified')
`;
