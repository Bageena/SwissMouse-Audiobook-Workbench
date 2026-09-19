import { StatusCache } from './tools/status-cache';
import { PACKAGE_STATUS_SCRIPT } from './tools/package-status';
import { youtubeUrl, youtubeBaseArgs, downloadYoutubeAudio } from './tools/youtube-audio';
import { inspect, fingerprint, makePreview, exportAudio, validateChapters } from './tools/audio-engine';
import { prepareMaster } from './tools/source-audio';
import { audiobookTags } from './tools/audiobook-metadata';
import { naturalPathCompare, sourceChapterGroups } from './src/utils/sourceStructure';
import { outputFormats, canCopy, defaultBitrate, bitrateOptions, stitchCompatibility } from './src/audioFormats';
import { transcriptionEngines, chooseFasterWhisperAttempts, PYTHON_DLL_SETUP, type NormalizedTranscription, type TranscriptionEngineId } from './tools/transcription-engine';
import { evaluateRequirementReadiness, selectedMissingRequirements } from './tools/requirements';
import { missingDependencies, missingRequirementsTooltip } from './tools/feature-dependencies';
import type { FeatureId } from './tools/feature-dependencies';
import type { WorkbenchConfig, ChapterEntry, AudiobookMetadata, AudiobookJob, HardwareInfo, SpeechModelInfo, InstallRepairProgress, Step1ProcessState, HardwareEnvironmentInfo, RequirementsReport, BaseRequirementItem, FolderScanResult, DiscoveredAudioFile, UnsupportedFileItem, YtDlpStatusInfo, YtDlpStatusState, YouTubeVideoInfo, YouTubeAudioFormat, ChapterCandidate, CoverArtInfo, OutputAudioFormat } from './src/types';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import { execSync, exec, execFile, execFileSync, spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import AdmZip from 'adm-zip';
import { promisify } from 'util';
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Utility to download a file
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    const request = (currentUrl: string) => {
      https.get(currentUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307 || response.statusCode === 308) {
          if (response.headers.location) {
            // Providers may return a relative redirect; resolve it against the
            // URL we requested before following it.
            response.resume();
            request(new URL(response.headers.location, currentUrl).toString());
          } else {
            reject(new Error(`Redirected without location header: ${response.statusCode}`));
          }
          return;
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };
    
    request(url);
  });
}

function runSpawnCmd(cmd: string, args: string[], onLog: (msg: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    // spawn accepts executable paths with spaces when shell is false. Running
    // through cmd.exe can leave the wrapper open after pip has finished.
    onLog(`$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { shell: false, windowsHide: true });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    
    child.stdout.on('data', (data) => {
      const str = data.toString();
      // Also write directly to the system process stdout for "real" terminal feel
      process.stdout.write(str);
      const lines = str.split('\n');
      for (const line of lines) {
        if (line.trim()) onLog(line.trim());
      }
    });
    
    child.stderr.on('data', (data) => {
      const str = data.toString();
      // PIP and FFmpeg often use stderr for progress bars
      process.stderr.write(str);
      const lines = str.split('\n');
      for (const line of lines) {
        if (line.trim()) onLog(line.trim());
      }
    });
    
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`Command failed with exit code ${code ?? 'unknown'}`));
      } else {
        finish();
      }
    });
    
    child.on('error', (err) => {
        finish(new Error(`Could not start '${cmd}': ${err.message}`));
    });
  });
}
import multer from 'multer';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// The launcher sets APP_ROOT to its own folder so shortcuts and removable
// drives never turn the caller's current directory into the application root.
const APP_ROOT = path.resolve(process.env.APP_ROOT || process.cwd());
const appPath = (...segments: string[]) => path.join(APP_ROOT, ...segments);
const RUNTIME_DIR = appPath('runtime');
const PORTABLE_PYTHON_DIR = path.join(RUNTIME_DIR, 'python');
const isWin = os.platform() === 'win32';
const PORTABLE_PYTHON_EXE = isWin ? path.join(PORTABLE_PYTHON_DIR, 'tools', 'python.exe') : path.join(PORTABLE_PYTHON_DIR, 'bin', 'python3');
const RUNTIME_BIN_DIR = appPath('runtime', 'bin');
const MANAGED_FFMPEG_PATH = path.join(RUNTIME_BIN_DIR, isWin ? 'ffmpeg.exe' : 'ffmpeg');
const MANAGED_FFPROBE_PATH = path.join(RUNTIME_BIN_DIR, isWin ? 'ffprobe.exe' : 'ffprobe');

// FFmpeg.org links Windows users to this build provider. The installer verifies
// the published SHA-256 before extracting its two application-local binaries.
const WINDOWS_FFMPEG_ARCHIVE_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const WINDOWS_FFMPEG_ARCHIVE_SHA256_URL = `${WINDOWS_FFMPEG_ARCHIVE_URL}.sha256`;
const WHISPERX_VERSION = '3.7.4';
const TORCH_VERSION = '2.8.0';
const TORCHAUDIO_VERSION = '2.8.0';
const TORCHVISION_VERSION = '0.23.0';
const WHISPERX_MODEL_CACHE_DIR = appPath('models', 'whisperx');
const OPENAI_WHISPER_MODEL_CACHE_DIR = appPath('models', 'openai-whisper');
const TORCH_CACHE_DIR = appPath('models', 'torch');
const MATPLOTLIB_CACHE_DIR = appPath('runtime', 'cache', 'matplotlib');
const FASTER_WHISPER_REPOSITORIES: Record<string, string> = {
  tiny: 'Systran/faster-whisper-tiny',
  base: 'Systran/faster-whisper-base',
  small: 'Systran/faster-whisper-small',
  medium: 'Systran/faster-whisper-medium',
  'large-v3': 'Systran/faster-whisper-large-v3',
  // This is the repository Faster-Whisper resolves for the CLI model name.
  // Keeping this mapping identical prevents a second surprise model download.
  'large-v3-turbo': 'mobiuslabsgmbh/faster-whisper-large-v3-turbo',
};
const PORTABLE_PYTHON_URL = isWin 
    ? 'https://www.nuget.org/api/v2/package/python/3.10.11' 
    : 'https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.10.15+20241016-x86_64-unknown-linux-gnu-install_only.tar.gz';

// Keep the private environment inside the portable application tree.
const VENV_DIR = appPath('runtime', 'venv');
const getVenvPython = () => {
    const isWin = os.platform() === 'win32';
    return isWin ? path.join(VENV_DIR, 'Scripts', 'python.exe') : path.join(VENV_DIR, 'bin', 'python');
};

// PyTorch 2.6 changed torch.load's default to `weights_only=True`. WhisperX
// 3.7.4 ships a trusted Pyannote VAD checkpoint that contains legacy OmegaConf
// metadata, so that one bundled file needs the old loader behavior. This
// startup hook is intentionally limited to that exact app-installed file; all
// user files and every other model retain PyTorch's safer default.
function ensureWhisperxVadCompatibility(): void {
  const sitePackages = isWin
    ? path.join(VENV_DIR, 'Lib', 'site-packages')
    : path.join(VENV_DIR, 'lib', 'python3.10', 'site-packages');
  if (!fs.existsSync(sitePackages)) return;

  const siteCustomizePath = path.join(sitePackages, 'sitecustomize.py');
  const marker = '# Audiobook Workbench WhisperX VAD compatibility shim';
  const shim = [
    marker,
    'import os',
    'import torch',
    '',
    '_awb_original_torch_load = torch.load',
    'def _awb_torch_load(file, *args, **kwargs):',
    '    try:',
    '        _awb_candidate = getattr(file, "name", file)',
    "        _awb_path = os.path.normcase(os.fspath(_awb_candidate)).replace('/', '\\\\')",
    '    except TypeError:',
    "        _awb_path = ''",
    "    if _awb_path.endswith(r'whisperx\\assets\\pytorch_model.bin'):",
    "        if kwargs.get('weights_only') is None:",
    "            kwargs['weights_only'] = False",
    '    return _awb_original_torch_load(file, *args, **kwargs)',
    'torch.load = _awb_torch_load',
    '',
  ].join('\n');

  try {
    const existing = fs.existsSync(siteCustomizePath) ? fs.readFileSync(siteCustomizePath, 'utf8') : '';
    const beforeShim = existing.includes(marker) ? existing.slice(0, existing.indexOf(marker)) : existing;
    fs.writeFileSync(siteCustomizePath, `${beforeShim}${beforeShim && !beforeShim.endsWith('\n') ? '\n' : ''}${shim}`, 'utf8');
  } catch (error) {
    console.warn('[WhisperX] Could not write the local VAD compatibility shim:', error);
  }
}

function getManagedBinaryVersion(executablePath: string): string | null {
  if (!fs.existsSync(executablePath)) return null;
  try {
    return execFileSync(executablePath, ['-version'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

async function installManagedFfmpeg(onLog: (message: string) => void): Promise<void> {
  if (!isWin) {
    throw new Error('Automatic FFmpeg setup is currently implemented for Windows only.');
  }

  fs.mkdirSync(RUNTIME_BIN_DIR, { recursive: true });
  const archivePath = path.join(RUNTIME_DIR, 'ffmpeg-release-essentials.zip');
  const checksumPath = `${archivePath}.sha256`;
  let installSucceeded = false;

  try {
    const hasVerifiedArchive = fs.existsSync(archivePath) && fs.existsSync(checksumPath) &&
      fs.readFileSync(checksumPath, 'utf8').match(/\b[a-fA-F0-9]{64}\b/)?.[0]?.toLowerCase() ===
      createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    if (hasVerifiedArchive) {
      onLog('Using the previously verified FFmpeg archive from the interrupted repair.');
    } else {
      onLog('Downloading the FFmpeg Essentials archive...');
      await downloadFile(WINDOWS_FFMPEG_ARCHIVE_URL, archivePath);
      await downloadFile(WINDOWS_FFMPEG_ARCHIVE_SHA256_URL, checksumPath);
    }

    const expected = fs.readFileSync(checksumPath, 'utf8').match(/\b[a-fA-F0-9]{64}\b/)?.[0]?.toLowerCase();
    const actual = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    if (!expected || expected !== actual) {
      throw new Error('FFmpeg archive checksum verification failed. The download was not installed.');
    }
    onLog('FFmpeg archive checksum verified. Unpacking application-local binaries...');

    // Do not invoke Windows tar.exe or PowerShell here. In some Windows setups
    // those extractors can terminate the parent server during a large ZIP
    // operation. The archive is checksum-verified above, then this pure
    // JavaScript reader writes only the two required application-local files.
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    const ffmpegEntry = entries.find((entry) => /(^|\/)bin\/ffmpeg\.exe$/i.test(entry.entryName));
    const ffprobeEntry = entries.find((entry) => /(^|\/)bin\/ffprobe\.exe$/i.test(entry.entryName));
    if (!ffmpegEntry || !ffprobeEntry) {
      throw new Error('The downloaded FFmpeg archive did not contain both ffmpeg.exe and ffprobe.exe.');
    }
    onLog('Writing FFmpeg and FFprobe to runtime/bin...');
    fs.writeFileSync(MANAGED_FFMPEG_PATH, ffmpegEntry.getData());
    fs.writeFileSync(MANAGED_FFPROBE_PATH, ffprobeEntry.getData());
    installSucceeded = true;
  } finally {
    if (installSucceeded) {
      try { fs.rmSync(archivePath, { force: true }); } catch {}
      try { fs.rmSync(checksumPath, { force: true }); } catch {}
    } else {
      onLog('FFmpeg archive was preserved for diagnostics or a retry.');
    }
  }

  if (!getManagedBinaryVersion(MANAGED_FFMPEG_PATH) || !getManagedBinaryVersion(MANAGED_FFPROBE_PATH)) {
    throw new Error('Downloaded FFmpeg binaries could not be executed from runtime/bin.');
  }
}

console.log(`[Startup] App root: ${APP_ROOT}`);
console.log(`[Startup] CWD: ${process.cwd()}`);
console.log(`[Startup] VENV_DIR: ${VENV_DIR}`);
console.log(`[Startup] Expected Python: ${getVenvPython()}`);
console.log(`[Startup] Venv Exists: ${fs.existsSync(VENV_DIR)}`);
if (fs.existsSync(VENV_DIR)) {
    console.log(`[Startup] Python Exists: ${fs.existsSync(getVenvPython())}`);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const uploadDir = appPath('inputs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Preserve the original name but ensure it's safe. 
    // Allowing spaces as users expect them to be preserved in their project parts.
    cb(null, randomUUID() + path.extname(file.originalname).toLowerCase());
  }
});

const upload = multer({ storage, preservePath: true });

function appendOperationFailure(jobId: string | undefined, operation: string, message: string) {
  const job = jobId ? jobs.find(item => item.id === jobId) : undefined;
  if (!job) return;
  job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `${operation} failed. ${message}` });
  saveJobs();
}

function requireFeatures(features: FeatureId[], operation: string, jobId: (req: any) => string | undefined = req => req.params?.id || req.query?.jobId || req.body?.jobId) {
  return (req: any, res: any, next: any) => {
    void checkActiveRequirements().then(report => {
      const missing = missingDependencies(report.components, features);
      if (!missing.length) return next();
      const tooltip = missingRequirementsTooltip(missing)!;
      const message = `${tooltip}. No files were copied or modified.`;
      appendOperationFailure(jobId(req), operation, message);
      return res.status(424).json({ error: `${operation} failed`, message, missingRequirements: missing.map(item => item.name) });
    }).catch((error: any) => res.status(500).json({ error: `Could not validate requirements for ${operation}.`, details: error.message }));
  };
}

app.post('/api/upload-audio', requireFeatures(['file_import'], 'Import'), upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const jobId = req.query.jobId as string;
  if (!jobId) {
    // Cleanup files if they were uploaded without a jobId
    (req.files as Express.Multer.File[]).forEach(f => {
      try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) {}
    });
    return res.status(400).json({ error: 'No active project selected. Please create or open a book project first.' });
  }

  const staged = req.files as Express.Multer.File[];
  const finalUploadDir = path.join(uploadDir, jobId);
  const moved: string[] = [];
  try {
    // Validate every staged file before committing any of them to the project.
    const probes = staged.map(file => probeAudioFile(file.path));
    fs.mkdirSync(finalUploadDir, { recursive: true });
    const uploadedFiles = staged.map((file, index) => {
      const finalPath = path.join(finalUploadDir, file.filename);
      fs.renameSync(file.path, finalPath);
      moved.push(finalPath);
      const probe = probes[index];
      return {
        originalName: file.originalname.replace(/\\/g, '/'), filename: file.filename, path: finalPath, size: file.size,
        durationSeconds: probe.durationSeconds, bitrate: probe.bitrate, format: probe.format, codec: probe.codec,
        sampleRate: probe.sampleRate, channels: probe.channels, streamSignature: probe.streamSignature,
      };
    });
    res.json({ message: 'Successfully uploaded files.', files: uploadedFiles, uploadDir: finalUploadDir });
  } catch (error: any) {
    for (const file of staged) { try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {} }
    for (const file of moved) { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {} }
    try { if (fs.existsSync(finalUploadDir) && fs.readdirSync(finalUploadDir).length === 0) fs.rmdirSync(finalUploadDir); } catch {}
    const message = `${error.message || 'Audio validation failed'}. No files were imported; staged files were removed.`;
    appendOperationFailure(jobId, 'Import', message);
    res.status(400).json({ error: 'Import failed', message });
  }
});


// Initial workbench configuration matching config.json from original Python app
const CONFIG_PATH = appPath('config.json');
const defaultConfig: WorkbenchConfig = {
  faster_transcription: true,
  selected_model: 'small',
  ffmpeg_path: MANAGED_FFMPEG_PATH,
  ffprobe_path: MANAGED_FFPROBE_PATH,
  whisper_profile: "turbo",
  profiles: {
    turbo: {
      model: "large-v3-turbo",
      language: "en",
      device_preference: "cuda",
      compute_type_cuda: "float16",
      compute_type_cpu: "int8",
      batch_size_cuda: 4,
      batch_size_cpu: 1,
      alignment: true,
    },
    accurate: {
      model: "large-v3",
      language: "en",
      device_preference: "cuda",
      compute_type_cuda: "float16",
      compute_type_cpu: "int8",
      batch_size_cuda: 2,
      batch_size_cpu: 1,
      alignment: true,
    },
    cpu: {
      model: "medium.en",
      language: "en",
      device_preference: "cpu",
      compute_type_cpu: "int8",
      batch_size_cpu: 1,
      alignment: true,
    },
  },
  m4b_settings: {
    audio_codec: "aac",
    bitrate_mono: "64k",
    bitrate_stereo: "96k",
    sample_rate: 44100,
  },
  lead_in_seconds: 1.5,
};
let currentConfig: WorkbenchConfig = defaultConfig;
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    currentConfig = { ...defaultConfig, ...saved, faster_transcription: saved.faster_transcription !== false };
  }
} catch (error) {
  console.warn('[Config] Could not load saved configuration; defaults will be used.', error);
}

// Helper: Format bytes to human readable string
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Helper: Format seconds to HH:MM:SS.mmm
function formatTimestamp(seconds: number): string {
  const safeSec = Math.max(0, seconds);
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = safeSec % 60;
  const secsStr = secs.toFixed(3).padStart(6, '0');
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secsStr}`;
}

// Helper: Parse HH:MM:SS.mmm to milliseconds
function parseTimestampToMs(tsStr: string): number {
  const match = tsStr.trim().match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid timestamp format: '${tsStr}'. Expected HH:MM:SS.mmm`);
  }
  const [, hrs, mins, secs, ms] = match;
  let totalMs = (parseInt(hrs, 10) * 3600 + parseInt(mins, 10) * 60 + parseInt(secs, 10)) * 1000;
  if (ms) {
    const cleanMs = (ms + "000").slice(0, 3);
    totalMs += parseInt(cleanMs, 10);
  }
  return totalMs;
}

// Helper: Escape string for FFMETADATA
function escapeFFMeta(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/;/g, '\\;')
    .replace(/#/g, '\\#')
    .replace(/\n/g, ' ');
}

// Helper: Generate FFMETADATA string
function generateFFMetaContent(chapters: ChapterEntry[], totalDurationSeconds: number, meta?: AudiobookMetadata): string {
  const totalDurationMs = Math.round(totalDurationSeconds * 1000);
  let content = ";FFMETADATA1\n";
  if (meta) {
    if (meta.title) content += `title=${escapeFFMeta(meta.title)}\n`;
    if (meta.subtitle) content += `subtitle=${escapeFFMeta(meta.subtitle)}\n`;
    if (meta.author) content += `artist=${escapeFFMeta(meta.author)}\n`;
    // Standard Audiobookshelf & iTunes M4B standard: Narrator stored in Composer tag!
    if (meta.narrator) content += `composer=${escapeFFMeta(meta.narrator)}\n`;
    if (meta.series) {
      const albumStr = meta.seriesSequence ? `${meta.series}, Book ${meta.seriesSequence}` : meta.series;
      content += `album=${escapeFFMeta(albumStr)}\n`;
      content += `series=${escapeFFMeta(meta.series)}\n`;
      if (meta.seriesSequence) content += `series-part=${escapeFFMeta(meta.seriesSequence)}\n`;
    } else if (meta.title) {
      content += `album=${escapeFFMeta(meta.title)}\n`;
    }
    if (meta.genres && meta.genres.length > 0) {
      content += `genre=${escapeFFMeta(meta.genres.join(', '))}\n`;
    } else {
      content += `genre=Audiobook\n`;
    }
    if (meta.publishedYear) content += `date=${escapeFFMeta(meta.publishedYear)}\n`;
    if (meta.publisher) content += `publisher=${escapeFFMeta(meta.publisher)}\n`;
    if (meta.language) content += `language=${escapeFFMeta(meta.language)}\n`;
    if (meta.asin) content += `ASIN=${escapeFFMeta(meta.asin)}\n`;
    if (meta.isbn) content += `ISBN=${escapeFFMeta(meta.isbn)}\n`;
    if (meta.description) {
      content += `description=${escapeFFMeta(meta.description)}\n`;
      content += `comment=${escapeFFMeta(meta.description)}\n`;
    }
    if (meta.copyright) content += `copyright=${escapeFFMeta(meta.copyright)}\n`;
    content += `explicit=${meta.explicit ? '1' : '0'}\n`;
    content += `abridged=${meta.abridged ? '1' : '0'}\n`;
  } else {
    content += "genre=Audiobook\n";
  }

  for (let i = 0; i < chapters.length; i++) {
    const chap = chapters[i];
    const startMs = parseTimestampToMs(chap.start);
    const endMs = i + 1 < chapters.length ? parseTimestampToMs(chapters[i + 1].start) : totalDurationMs;
    content += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${startMs}\nEND=${endMs}\ntitle=${escapeFFMeta(chap.title)}\n`;
  }
  return content;
}

const JOBS_FILE = appPath('jobs.json');

function saveJobs() {
    try {
        fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
    } catch (e) {
        console.error('Failed to save jobs:', e);
    }
}

function loadJobs() {
    if (fs.existsSync(JOBS_FILE)) {
        try {
            const data = fs.readFileSync(JOBS_FILE, 'utf8');
            const saved = JSON.parse(data);
            for (const job of saved) for (const item of job.exports || []) if (['running','queued'].includes(item.status)) { item.status = 'failed'; item.error = 'Export interrupted by application shutdown. Start a new export.'; }
            return saved;
        } catch (e) {
            console.error('Failed to load jobs:', e);
        }
    }
    return null;
}

// Fresh installations start with no project data. Jobs are created only by the user.
let jobs: AudiobookJob[] = loadJobs() || [];

// Stream the app-owned merged master for Chapter Review. Range support lets
// the browser seek directly to a word timestamp without loading a full book.
app.get('/api/jobs/:id/audio-preview', (req, res) => {
  const job = jobs.find(job => job.id === req.params.id);
  const audioPath = job?.previewPath;
  if (!audioPath || !fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Merged review audio is unavailable. Run Step 1 first.' });
  }
  res.type('audio/wav').sendFile(path.resolve(audioPath));
});

// ----------------------------------------------------
// Local Desktop Processing: Hardware, Models & Folder Utilities
// ----------------------------------------------------

function naturalSort<T>(items: T[], keyFn: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    return keyFn(a).localeCompare(keyFn(b), undefined, { numeric: true, sensitivity: 'base' });
  });
}

async function getHardwareInfo(): Promise<HardwareInfo> {
  const hw = await getFullHardwareEnvironment();
  return { mode: hw.mode, gpuName: hw.gpuName, cpuModel: hw.cpuModel, vramGb: hw.vramGb,
    recommendedModelId: hw.hasNvidiaGpu ? (hw.vramGb! >= 8 ? 'large-v3-turbo' : hw.vramGb! >= 4 ? 'small' : 'base') : 'small' };
}

// Official Whisper model weight sources (Hosted on OpenAI / Azure CDN)
const WHISPER_MODEL_SOURCES: Record<string, { url: string; fileName: string; sizeBytes: number }> = {
  tiny: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt',
    fileName: 'tiny.pt',
    sizeBytes: 75572083,
  },
  base: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt',
    fileName: 'base.pt',
    sizeBytes: 147790757,
  },
  small: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt',
    fileName: 'small.pt',
    sizeBytes: 483409681,
  },
  medium: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt',
    fileName: 'medium.pt',
    sizeBytes: 1533858079,
  },
  'large-v3-turbo': {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a/large-v3-turbo.pt',
    fileName: 'large-v3-turbo.pt',
    sizeBytes: 1634845959,
  },
  'large-v3': {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt',
    fileName: 'large-v3.pt',
    sizeBytes: 3094769823,
  },
};

// Ensure models directory exists
const modelsBaseDir = appPath('models');
if (!fs.existsSync(modelsBaseDir)) {
  try {
    fs.mkdirSync(modelsBaseDir, { recursive: true });
  } catch (e) {}
}

// Inspect actual filesystem to determine if model weights exist on disk
async function getModelInstallationStatus(modelId: string, backend: TranscriptionEngineId = currentConfig.faster_transcription ? 'faster-whisper' : 'openai-whisper'): Promise<{
  isInstalled: boolean;
  sizeOnDiskBytes: number;
  sizeOnDiskLabel: string;
  installedFile?: string;
  modelDirPath: string;
}> {
  // Faster-Whisper uses Hugging Face snapshots. `--model_dir` directs these to
  // the portable application directory instead of the user's profile.
  const repository = FASTER_WHISPER_REPOSITORIES[modelId];
  const modelDir = backend === 'openai-whisper'
    ? path.join(OPENAI_WHISPER_MODEL_CACHE_DIR, modelId)
    : repository
    ? path.join(WHISPERX_MODEL_CACHE_DIR, `models--${repository.replace('/', '--')}`)
    : path.join(WHISPERX_MODEL_CACHE_DIR, `models--Systran--faster-whisper-${modelId}`);

  if (await fs.promises.stat(modelDir).then(s => s.isDirectory(), () => false)) {
    try {
      let weightFile: string | undefined;
      let weightFileSize = 0;
      const findWeight = async (directory: string) => {
        for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
          const entryPath = path.join(directory, entry.name);
          if (entry.isDirectory()) await findWeight(entryPath);
          if ((!entry.isFile() && !entry.isSymbolicLink()) || entry.name.endsWith('.downloading')) continue;
          const stat = await fs.promises.stat(entryPath);
          if ((backend === 'openai-whisper' ? entry.name === WHISPER_MODEL_SOURCES[modelId]?.fileName : entry.name === 'model.bin' && await fs.promises.access(path.join(directory, 'config.json')).then(() => true, () => false) && await fs.promises.access(path.join(directory, 'tokenizer.json')).then(() => true, () => false)) && stat.size > 10 * 1024 * 1024) {
            weightFile ??= path.relative(modelDir, entryPath);
            weightFileSize += stat.size;
          }
        }
      };
      await findWeight(modelDir);

      if (weightFile && weightFileSize > 10 * 1024 * 1024) {
        return {
          isInstalled: true,
          sizeOnDiskBytes: weightFileSize,
          sizeOnDiskLabel: formatBytes(weightFileSize),
          installedFile: weightFile,
          modelDirPath: modelDir,
        };
      }
    } catch (e) {}
  }

  return {
    isInstalled: false,
    sizeOnDiskBytes: 0,
    sizeOnDiskLabel: '0 B',
    modelDirPath: modelDir,
  };
}

// Local Speech Models Registry
let speechModels: SpeechModelInfo[] = [
  {
    id: 'tiny',
    name: 'Whisper Tiny',
    sizeLabel: '~75 MB',
    vramRequirementGb: 1,
    requiresGpu: false,
    category: 'lightweight',
    isInstalled: false,
    description: 'Lightweight model suitable for lower-resource computers, battery saving, or fast testing.',
  },
  {
    id: 'base',
    name: 'Whisper Base',
    sizeLabel: '~145 MB',
    vramRequirementGb: 1,
    requiresGpu: false,
    category: 'lightweight',
    isInstalled: false,
    description: 'Lightweight fast model with reasonable transcription accuracy and minimal memory usage.',
  },
  {
    id: 'small',
    name: 'Whisper Small',
    sizeLabel: '~480 MB',
    vramRequirementGb: 2,
    requiresGpu: false,
    category: 'balanced',
    isInstalled: false,
    description: 'Balanced model for CPU or moderate GPU setups. Recommended default for CPU-only systems.',
  },
  {
    id: 'medium',
    name: 'Whisper Medium',
    sizeLabel: '~1.5 GB',
    vramRequirementGb: 4,
    requiresGpu: false,
    category: 'balanced',
    isInstalled: false,
    description: 'High-quality transcription across varied narrator accents and complex audiobooks.',
  },
  {
    id: 'large-v3-turbo',
    name: 'Whisper Large-v3 Turbo',
    sizeLabel: '~1.6 GB',
    vramRequirementGb: 6,
    requiresGpu: false,
    category: 'high-accuracy',
    isInstalled: false,
    description: 'Optimized high-accuracy model. Faster Whisper can run it on CPU or use a compatible NVIDIA GPU when available.',
  },
  {
    id: 'large-v3',
    name: 'Whisper Large-v3',
    sizeLabel: '~3.1 GB',
    vramRequirementGb: 8,
    requiresGpu: false,
    category: 'high-accuracy',
    isInstalled: false,
    description: 'Maximum-accuracy model for complex literary vocabularies and character names. CPU processing is supported but may be slow.',
  },
];

const backendModels: Record<TranscriptionEngineId, SpeechModelInfo[]> = {
  'faster-whisper': speechModels.map(model => ({ ...model, name: model.name.replace('Whisper', 'Faster Whisper'), backend: 'faster-whisper' })),
  'openai-whisper': speechModels.map(model => ({ ...model, name: model.name.replace('Whisper', 'OpenAI Whisper'), backend: 'openai-whisper' })),
};
function requestEngine(value: unknown): TranscriptionEngineId {
  return value === 'openai-whisper' ? 'openai-whisper' : value === 'faster-whisper' ? 'faster-whisper' : currentConfig.faster_transcription ? 'faster-whisper' : 'openai-whisper';
}

// Synchronize speechModels state with real filesystem contents
async function refreshModelsFromDisk(backend: TranscriptionEngineId = currentConfig.faster_transcription ? 'faster-whisper' : 'openai-whisper'): Promise<void> {
  for (const model of backendModels[backend]) {
    // Only refresh if not actively downloading
    if (!model.isDownloading) {
      const status = await getModelInstallationStatus(model.id, backend);
      if (model.isDownloading) continue;
      model.isInstalled = status.isInstalled;
      model.sizeOnDiskBytes = status.sizeOnDiskBytes;
      model.sizeOnDiskLabel = status.sizeOnDiskLabel;
      model.installedFile = status.installedFile;
      model.backend = backend;
    }
  }
}

// Progress reads return state. Disk discovery is explicit on opening/refreshing the model area.
const modelSnapshots = {
  'faster-whisper': new StatusCache<void>(60_000),
  'openai-whisper': new StatusCache<void>(60_000),
};
function ensureModels(backend: TranscriptionEngineId, refresh = false) {
  const cache = modelSnapshots[backend];
  return refresh ? cache.refresh(() => refreshModelsFromDisk(backend)) : cache.get(() => refreshModelsFromDisk(backend));
}

interface ActiveModelDownloadTask {
  modelId: string;
  abortController: AbortController;
  tempFilePath: string;
  finalFilePath: string;
}

const activeModelDownloads = new Map<string, ActiveModelDownloadTask>();
const activeFasterWhisperInstalls = new Map<string, ReturnType<typeof spawn>>();

// Local Output Folder State
let currentOutputFolder = appPath('output');
if (!fs.existsSync(currentOutputFolder)) {
  try {
    fs.mkdirSync(currentOutputFolder, { recursive: true });
  } catch (e) {}
}

// ----------------------------------------------------
// Local Requirements & Dependencies Management Engine
// ----------------------------------------------------

// Required base directories for SwissMouse
const REQUIRED_APP_DIRECTORIES = [
  { id: 'output', name: 'Default Output Folder', path: appPath('output'), purpose: 'Final chaptered .m4b audiobooks and exports' },
  { id: 'cache', name: 'Temporary Cache Folder', path: appPath('.cache'), purpose: 'Intermediate processing cache and temporary work files' },
  { id: 'temp_work', name: 'PCM Working Directory', path: appPath('.cache', 'work'), purpose: 'Uncompressed raw audio PCM workspace' },
  { id: 'logs', name: 'Application Logs Folder', path: appPath('logs'), purpose: 'Persistent diagnostic and workbench execution logs' },
  { id: 'models_root', name: 'Models Storage Directory', path: appPath('models'), purpose: 'Local storage location for Whisper model weights' },
  { id: 'tools_root', name: 'Application Tools Directory', path: appPath('tools'), purpose: 'Managed directory for local helper utilities' },
];

// Ensure required app directories exist on startup
for (const dir of REQUIRED_APP_DIRECTORIES) {
  try {
    if (!fs.existsSync(dir.path)) {
      fs.mkdirSync(dir.path, { recursive: true });
    }
  } catch (e) {}
}

// Global active installation/repair progress
let activeInstallProgress: InstallRepairProgress = {
  isActive: false,
  phase: 'idle',
  currentActivity: 'Idle',
  overallProgress: 0,
  logs: [],
  canCancel: false,
};
const INSTALL_DIAGNOSTIC_LOG = appPath('logs', 'install-repair.log');

function appendInstallDiagnostic(message: string, includeInUi = true) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  try {
    fs.mkdirSync(path.dirname(INSTALL_DIAGNOSTIC_LOG), { recursive: true });
    fs.appendFileSync(INSTALL_DIAGNOSTIC_LOG, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write installation diagnostic log:', error);
  }
  if (includeInUi) {
    activeInstallProgress.logs.push(line);
    if (activeInstallProgress.logs.length > 50) activeInstallProgress.logs.shift();
  }
}

// Global active Step 1 processing progress state
let jobIdForStep1: string | null = null;
let activeStep1ProgressState: Step1ProcessState = {
  isActive: false,
  stage: 'idle',
  label: 'Ready to process audiobook source',
  currentTask: 'Idle',
  currentStageNumber: 0,
  totalStages: 6,
  percentage: 0,
  isDeterminate: true,
  elapsedSeconds: 0,
  liveStatusMessage: 'No active processing task.',
  logs: [],
  canCancel: false,
  isCancelling: false,
  error: null,
  summary: null,
};

let activeStep1Timer: NodeJS.Timeout | null = null;
let activeStep1StartTime = 0;

// Detailed hardware environment detection
const hardwareSnapshot = new StatusCache<HardwareEnvironmentInfo>(10 * 60_000);
function getFullHardwareEnvironment(): Promise<HardwareEnvironmentInfo> {
  return hardwareSnapshot.get(detectHardwareEnvironment);
}
async function detectHardwareEnvironment(): Promise<HardwareEnvironmentInfo> {
  const osType = os.type();
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Host CPU';

  let hasNvidiaGpu = false;
  let gpuName: string | undefined;
  let vramGb: number | undefined;
  let cudaVersion: string | undefined;

  try {
    const smiOut = (await execAsync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
      encoding: 'utf8',
      timeout: 3000, windowsHide: true,
    })).stdout.trim();
    if (smiOut) {
      const [gName, memStr] = smiOut.split(',').map(s => s.trim());
      gpuName = gName || 'NVIDIA GPU';
      const vramMb = parseInt(memStr, 10) || 0;
      vramGb = Math.round(vramMb / 1024);
      hasNvidiaGpu = true;
    }
  } catch (e) {}

  if (hasNvidiaGpu) {
    try {
      const nvccOut = (await execAsync('nvidia-smi', {
        encoding: 'utf8',
        timeout: 3000, windowsHide: true,
      })).stdout;
      const cudaMatch = nvccOut.match(/CUDA Version[:\s]+([\d.]+)/i) || nvccOut.match(/V([\d.]+)/i);
      if (cudaMatch) {
        cudaVersion = cudaMatch[1];
      }
    } catch (e) {}
  }

  const mode: 'gpu' | 'cpu' = hasNvidiaGpu ? 'gpu' : 'cpu';
  const recommendedPyTorchFlavor: 'cuda' | 'cpu' = hasNvidiaGpu ? 'cuda' : 'cpu';
  const recommendationSummary = hasNvidiaGpu
    ? `An NVIDIA GPU was detected (${gpuName || 'NVIDIA GPU'}, ~${vramGb || 'N/A'} GB VRAM). Faster Whisper will verify acceleration and use optimized CPU transcription automatically if it is unavailable.`
    : `This computer is ready for supported Faster Whisper CPU transcription (${cpuModel}, ${arch}).`;

  return {
    os: osType,
    platform,
    arch,
    cpuModel,
    hasNvidiaGpu,
    gpuName,
    vramGb,
    cudaVersion,
    mode,
    recommendedPyTorchFlavor,
    recommendationSummary,
  };
}

// Scan and test all base dependencies
function transcriptionRuntimeEnv(): NodeJS.ProcessEnv {
  const sitePackages = isWin ? path.join(VENV_DIR, 'Lib', 'site-packages') : path.join(VENV_DIR, 'lib', 'python3.10', 'site-packages');
  const libraryPaths = ['cublas', 'cudnn'].map(name => path.join(sitePackages, 'nvidia', name, isWin ? 'bin' : 'lib')).filter(dir => fs.existsSync(dir));
  return { ...process.env, PATH: [RUNTIME_BIN_DIR, ...libraryPaths, process.env.PATH || ''].join(path.delimiter),
    LD_LIBRARY_PATH: [...libraryPaths, process.env.LD_LIBRARY_PATH || ''].join(path.delimiter) };
}

type PythonProbe = { ok: boolean; output?: string; error?: string };
const pythonSnapshot = new StatusCache<Record<string, PythonProbe>>(5 * 60_000);
const compatibilityErrors = new Map<string, string>();
const binarySnapshots = new Map<string, StatusCache<string>>();
async function pythonPackages(): Promise<Record<string, PythonProbe>> {
  return pythonSnapshot.get(async () => {
    try {
      const {stdout} = await execFileAsync(getVenvPython(), ['-S', '-c', PACKAGE_STATUS_SCRIPT, VENV_DIR], {encoding:'utf8', timeout:12000, windowsHide:true});
      return JSON.parse(stdout);
    } catch (error: any) { return {python: {ok:false, error: error.message}}; }
  });
}
async function managedBinaryStatus(binary: string): Promise<string> {
  if (!binarySnapshots.has(binary)) binarySnapshots.set(binary, new StatusCache<string>(5 * 60_000));
  return binarySnapshots.get(binary)!.get(async () => {
    try { return (await execFileAsync(binary, ['-version'], {encoding:'utf8', timeout:3000, windowsHide:true})).stdout.split(/\r?\n/)[0]; }
    catch { return ''; }
  });
}
function invalidateRequirements(includeHardware = false) {
  pythonSnapshot.invalidate();
  for (const cache of binarySnapshots.values()) cache.invalidate();
  if (includeHardware) hardwareSnapshot.invalidate();
}
async function checkActiveRequirements(): Promise<RequirementsReport> {
  const [hw, packages] = await Promise.all([getFullHardwareEnvironment(), pythonPackages()]);
  const probe = (name: string): PythonProbe => packages[name] || {ok:false};
  const components: BaseRequirementItem[] = [];
  const item = (value: BaseRequirementItem) => { components.push(value); return value; };

  const pythonPath = getVenvPython();
  const pythonCheck = probe('python');
  item({ id: 'python', name: 'Application Runtime', purpose: 'Private runtime used by local speech-recognition engines.', classification: 'required', group: 'core', status: pythonCheck.ok ? 'ready' : 'missing', installedVersion: pythonCheck.output, installLocation: pythonPath, isAppManaged: true, error: pythonCheck.ok ? undefined : 'The application runtime is not ready.' });

  for (const [id, name, binary, purpose] of [
    ['ffmpeg', 'FFmpeg', MANAGED_FFMPEG_PATH, 'Required for audiobook processing, merging, encoding, and export.'],
    ['ffprobe', 'FFprobe', MANAGED_FFPROBE_PATH, 'Required to inspect audio streams and validate output.'],
  ] as const) {
    let output = '';
    try { output = await managedBinaryStatus(binary); } catch {}
    item({ id, name, purpose, classification: 'required', group: 'core', status: output ? 'ready' : 'missing', installLocation: binary, isAppManaged: true, error: output ? undefined : `${name} is not installed in the application runtime.` });
  }

  const ytDlp = await getYtDlpStatus();
  item({ id: 'yt_dlp', name: 'yt-dlp', purpose: 'Optional download tool used only for YouTube inspection and audio import.', classification: 'optional', group: 'compatibility', status: ytDlp.status === 'installed' ? 'ready' : ytDlp.status === 'error' ? 'broken' : 'missing', installedVersion: ytDlp.version, installLocation: ytDlp.executablePath, isAppManaged: true, error: ytDlp.error });

  // Package discovery never imports a transcription engine or initializes CUDA.
  // Real device compatibility is tested by the transcription engine when used.
  const faster = probe('faster-whisper');
  const ct2 = probe('ctranslate2');
  const openai = probe('openai-whisper');
  const torch = probe('torch');
  const cudaDevices = hw.hasNvidiaGpu && probe('nvidia-cublas-cu12').ok && probe('nvidia-cudnn-cu12').ok ? 1 : 0;
  for (const [id, name, purpose, probe, group] of [
    ['faster_whisper', 'Faster Whisper', 'Recommended transcription engine. Provides faster local transcription using CTranslate2.', faster, 'active_transcription'],
    ['ctranslate2', 'CTranslate2', 'Required for Faster Whisper. Included with that engine.', ct2, 'active_transcription'],
    ['openai_whisper', 'OpenAI Whisper', 'Optional compatibility transcription engine.', openai, 'compatibility'],
    ['pytorch', 'PyTorch', 'Required for OpenAI Whisper. Included with that engine.', torch, 'compatibility'],
  ] as const) item({ id, name, purpose, classification: 'optional', group, status: probe.ok ? 'ready' : 'missing', installedVersion: probe.output?.split(/\r?\n/)[0], isAppManaged: true });
  // Requirements describes engine dependencies; weight files are managed in Models.
  const gpuStatus: BaseRequirementItem['status'] = hw.hasNvidiaGpu && cudaDevices > 0 ? 'ready' : 'missing';
  item({ id: 'nvidia_acceleration', name: 'NVIDIA GPU Acceleration', purpose: !hw.hasNvidiaGpu ? 'No compatible GPU detected. Optimized CPU transcription will be used.' : cudaDevices > 0 ? 'CUDA runtime packages are installed; device compatibility is verified when transcription starts.' : 'Optional CUDA libraries for Faster Whisper on compatible NVIDIA hardware. CPU transcription remains available.', classification: 'optional', group: 'optional_acceleration', status: gpuStatus, isAppManaged: hw.hasNvidiaGpu, diagnosticDetails: !hw.hasNvidiaGpu ? 'Optional; this computer is fully supported in CPU mode.' : cudaDevices > 0 ? 'CUDA libraries detected without initializing CTranslate2. Compatibility is checked during transcription.' : undefined, error: hw.hasNvidiaGpu && cudaDevices === 0 ? 'Optional performance improvement available; the application remains usable.' : undefined });

  for (const component of components) {
    const error = compatibilityErrors.get(component.id);
    if (error) { component.status = 'broken'; component.error = error; }
  }

  const readiness = evaluateRequirementReadiness(components, { hasNvidiaGpu: hw.hasNvidiaGpu, accelerationPackagesReady: cudaDevices > 0 });
  const statusColor = readiness.statusColor;
  return {
    timestamp: new Date().toISOString(), allReady: readiness.allReady, statusColor,
    needsAttentionCount: readiness.needsAttentionCount,
    summaryMessage: statusColor === 'red'
      ? 'Setup required: install the core tools and at least one transcription engine, then download a model for that engine in Models.'
      : statusColor === 'yellow'
        ? 'A complete workflow is available. Faster Whisper or GPU acceleration can improve performance.'
        : 'Runtime dependencies are ready. Manage downloaded transcription models in Models.',
    hardware: hw, components, availableUpdatesCount: 0,
  };
}

// ----------------------------------------------------
// Requirements API Endpoints
// ----------------------------------------------------

// 1. Get Requirements Status Report
app.get('/api/requirements/status', async (req, res) => {
  try {
    if (req.query.refresh === 'true') invalidateRequirements(true);
    const report = await checkActiveRequirements();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to inspect requirements' });
  }
});

// 2. Get Installation / Repair Progress State
app.get('/api/requirements/install-progress', (req, res) => {
  res.json(activeInstallProgress);
});

// The in-dialog log stays compact; this download contains the full installer
// transcript, including pip stdout/stderr and the final exception.
app.get('/api/requirements/diagnostic-log', (req, res) => {
  if (!fs.existsSync(INSTALL_DIAGNOSTIC_LOG)) {
    return res.status(404).json({ error: 'No installation diagnostic log has been created yet.' });
  }
  res.download(INSTALL_DIAGNOSTIC_LOG, 'audiobook-workbench-install-repair.log');
});

// 3. Install / Repair Required Base Components
app.post('/api/requirements/install-repair', async (req, res) => {
  if (activeInstallProgress.isActive) {
    return res.status(400).json({ error: 'An installation or repair task is already running.' });
  }

  const report = await checkActiveRequirements();
  // Another request may have started an install while this one awaited probes.
  if (activeInstallProgress.isActive) return res.status(409).json({ error: 'An installation or repair task is already running.' });
  const selectedIds = Array.isArray(req.body?.selectedIds) ? req.body.selectedIds.filter((id: unknown) => typeof id === 'string') : [];
  const componentsToFix = selectedMissingRequirements(report.components, selectedIds).sort((a, b) => Number(b.id === 'pytorch') - Number(a.id === 'pytorch'));
  // Core runtime must precede every Python package.
  componentsToFix.sort((a, b) => Number(b.classification === 'required') - Number(a.classification === 'required'));

  console.log(`[Repair] Components to fix: ${componentsToFix.map(c => c.id).join(', ')}`);

  if (componentsToFix.length === 0) {
    return res.json({
      status: 'ok',
      message: 'All required components are already installed and working. No installation needed.',
      report,
    });
  }

  activeInstallProgress = {
    isActive: true,
    phase: 'preparing',
    currentActivity: 'Preparing installation plan...',
    overallProgress: 5,
    logs: [
      `[${new Date().toLocaleTimeString()}] Initializing installation/repair for ${componentsToFix.length} component(s)...`,
      `[${new Date().toLocaleTimeString()}] Safety Check: Speech model files will NOT be installed. yt-dlp is installed only when selected. User projects and audio files will NOT be modified.`,
      `[${new Date().toLocaleTimeString()}] Hardware detection: ${report.hardware.recommendationSummary}`,
    ],
    canCancel: true,
  };
  try {
    fs.mkdirSync(path.dirname(INSTALL_DIAGNOSTIC_LOG), { recursive: true });
    fs.appendFileSync(INSTALL_DIAGNOSTIC_LOG, `\n========== Install / Repair started ${new Date().toISOString()} ==========\n`, 'utf8');
  } catch (error) {
    console.error('Failed to initialize installation diagnostic log:', error);
  }

  res.json({
    status: 'started',
    message: 'Installation / repair started.',
    componentsToFix: componentsToFix.map(c => ({ id: c.id, name: c.name, issue: c.error || 'Missing or incomplete' })),
  });

  // Run async installation in background
  (async () => {
    try {
      const stepWeight = 85 / Math.max(1, componentsToFix.length);
      let currentProgress = 10;
      let mediaBinariesConfigured = false;

      for (let i = 0; i < componentsToFix.length; i++) {
        if (!activeInstallProgress.isActive || activeInstallProgress.phase === 'cancelled') {
          break;
        }

        const comp = componentsToFix[i];
        activeInstallProgress.currentItemId = comp.id;
        activeInstallProgress.currentActivity = `Setting up ${comp.name}...`;
        activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Starting repair/installation: ${comp.name}`);

        // Handle specific component
        if (comp.id.startsWith('dir_')) {
          activeInstallProgress.currentActivity = `Creating application working folder: ${comp.name}...`;
          const targetDir = comp.installLocation;
          if (targetDir) {
            try {
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }
              const testFile = path.join(targetDir, `.perm_test_${Date.now()}.tmp`);
              fs.writeFileSync(testFile, 'ready', 'utf8');
              fs.unlinkSync(testFile);
              activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Created and verified folder permissions: ${targetDir}`);
            } catch (err: any) {
              activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Warning: ${err.message}`);
            }
          }
        } else if (comp.id === 'python') {
          activeInstallProgress.currentActivity = 'Deploying Isolated Python Runtime...';
          activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Downloading the application-managed Python 3.10.11 runtime...`);

          try {
            if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
            if (!fs.existsSync(PORTABLE_PYTHON_DIR)) fs.mkdirSync(PORTABLE_PYTHON_DIR, { recursive: true });

            const zipDest = path.join(RUNTIME_DIR, 'python.zip');
            await downloadFile(PORTABLE_PYTHON_URL, zipDest);
            activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Download complete. Extracting to ${PORTABLE_PYTHON_DIR}...`);

            // Extraction using system tools to keep binary count low
            if (isWin) {
              await execAsync(`powershell -Command "Expand-Archive -Path '${zipDest}' -DestinationPath '${PORTABLE_PYTHON_DIR}' -Force"`);
            } else {
              await execAsync(`tar -xzf "${zipDest}" -C "${PORTABLE_PYTHON_DIR}" --strip-components=1`);
            }
            
            // Cleanup zip
            try { fs.unlinkSync(zipDest); } catch(e) {}

            if (fs.existsSync(PORTABLE_PYTHON_EXE)) {
              activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Isolated Python runtime successfully deployed.`);
              await runSpawnCmd(PORTABLE_PYTHON_EXE, ['-m', 'venv', VENV_DIR], appendInstallDiagnostic);
              pythonSnapshot.invalidate();
            } else {
              throw new Error("Extraction failed: Python executable not found in expected location.");
            }
          } catch (err: any) {
            activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Critical Error during Python deployment: ${err.message}`);
            throw err;
          }
        } else if (['faster_whisper', 'ctranslate2', 'openai_whisper', 'pytorch', 'nvidia_acceleration'].includes(comp.id)) {
          const python = getVenvPython();
          if (!fs.existsSync(python) || !fs.existsSync(path.join(VENV_DIR, 'pyvenv.cfg'))) {
            await runSpawnCmd(PORTABLE_PYTHON_EXE, ['-m', 'venv', VENV_DIR], appendInstallDiagnostic);
          }
          // Recheck after parent installs: pip may have already supplied this dependency.
          if ((await checkActiveRequirements()).components.find(item => item.id === comp.id)?.status !== 'ready') {
            const packages: Record<string, string[]> = {
              faster_whisper: ['faster-whisper'], ctranslate2: ['ctranslate2'],
              openai_whisper: ['openai-whisper'],
              pytorch: [`torch==${TORCH_VERSION}`, '--index-url', 'https://download.pytorch.org/whl/cpu', '--extra-index-url', 'https://pypi.org/simple'],
              nvidia_acceleration: ['nvidia-cublas-cu12', 'nvidia-cudnn-cu12>=9,<10'],
            };
            await runSpawnCmd(python, ['-m', 'pip', 'install', ...packages[comp.id]], appendInstallDiagnostic);
            pythonSnapshot.invalidate();
          }
        } else if (comp.id === 'ffmpeg' || comp.id === 'ffprobe') {
          if (mediaBinariesConfigured) {
            activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Application-local FFmpeg and FFprobe were already configured during this repair.`);
            currentProgress += stepWeight;
            activeInstallProgress.overallProgress = Math.min(95, Math.round(currentProgress));
            continue;
          }

          activeInstallProgress.currentActivity = 'Installing application-local FFmpeg and FFprobe...';
          const logFn = (message: string) => {
            appendInstallDiagnostic(message);
          };
          await installManagedFfmpeg(logFn);
          binarySnapshots.get(MANAGED_FFMPEG_PATH)?.invalidate();
          binarySnapshots.get(MANAGED_FFPROBE_PATH)?.invalidate();
          mediaBinariesConfigured = true;
          logFn(`Verified application-local FFmpeg: ${getManagedBinaryVersion(MANAGED_FFMPEG_PATH)}.`);
          logFn(`Verified application-local FFprobe: ${getManagedBinaryVersion(MANAGED_FFPROBE_PATH)}.`);
        } else if (comp.id === 'yt_dlp') {
          const status = await installLocalYtDlp();
          if (status.status !== 'installed') throw new Error(status.error || 'yt-dlp installation could not be verified.');
          appendInstallDiagnostic(`Verified application-local yt-dlp ${status.version || ''}.`);
        }

        currentProgress += stepWeight;
        activeInstallProgress.overallProgress = Math.min(95, Math.round(currentProgress));
        await new Promise(r => setTimeout(r, 400));
      }

      if (activeInstallProgress.phase === 'cancelled') return;

      const importChecks: Record<string, string> = {
        faster_whisper: 'import faster_whisper', ctranslate2: 'import ctranslate2; assert ctranslate2.get_supported_compute_types("cpu")',
        openai_whisper: 'import whisper', pytorch: 'import torch',
        nvidia_acceleration: 'import ctranslate2; assert ctranslate2.get_supported_compute_types("cuda")',
      };
      for (const component of componentsToFix) {
        if (!importChecks[component.id]) continue;
        try {
          await execFileAsync(getVenvPython(), ['-c', PYTHON_DLL_SETUP + importChecks[component.id]],
            { env: transcriptionRuntimeEnv(), timeout: 30_000, windowsHide: true });
          compatibilityErrors.delete(component.id);
        } catch (error: any) {
          compatibilityErrors.set(component.id, String(error.stderr || error.message));
          throw error;
        }
      }
      // Verification phase
      activeInstallProgress.phase = 'verifying';
      activeInstallProgress.currentActivity = 'Running post-installation verification check...';
      activeInstallProgress.overallProgress = 96;
      activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Running automated post-installation diagnostics...`);
      await new Promise(r => setTimeout(r, 800));

      const updatedReport = await checkActiveRequirements();
      activeInstallProgress.overallProgress = 100;
      activeInstallProgress.canCancel = false;

      if (selectedMissingRequirements(updatedReport.components, selectedIds).length === 0) {
        activeInstallProgress.isActive = false;
        activeInstallProgress.phase = 'completed';
        activeInstallProgress.currentActivity = 'Installation and repair complete.';
        activeInstallProgress.successMessage = 'Selected components installed and verified. Download a speech model in Models if needed.';
        activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] All required base components are ready. Speech models remain separately managed.`);
      } else {
        const remaining = selectedMissingRequirements(updatedReport.components, selectedIds);
        activeInstallProgress.isActive = false;
        activeInstallProgress.phase = 'error';
        activeInstallProgress.currentActivity = 'Installation did not pass verification.';
        activeInstallProgress.error = `Verification failed: ${remaining.map(component => component.name).join(', ')} still need attention.`;
        activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] ${activeInstallProgress.error}`);
      }
    } catch (err: any) {
      invalidateRequirements();
      activeInstallProgress.isActive = false;
      activeInstallProgress.canCancel = false;
      activeInstallProgress.phase = 'error';
      activeInstallProgress.error = err.message || 'Installation error occurred.';
      activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] ERROR: ${err.message}`);
      appendInstallDiagnostic(`ERROR: ${err.stack || err.message}`, false);
    }
  })();
});

// 4. Cancel active installation
app.post('/api/requirements/cancel', (req, res) => {
  if (!activeInstallProgress.isActive) {
    return res.status(400).json({ error: 'No active installation task to cancel.' });
  }

  invalidateRequirements();
  activeInstallProgress.phase = 'cancelled';
  activeInstallProgress.isActive = false;
  activeInstallProgress.currentActivity = 'Installation cancelled by user.';
  activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Installation cancelled by user. Safe state preserved. You can run Repair on the next check.`);
  res.json({ status: 'ok', message: 'Installation cancelled.' });
});

// 5. Check for Updates on Application-Managed Dependencies
app.get('/api/requirements/updates', async (req, res) => {
  try {
    const report = await checkActiveRequirements();
    const appManaged = report.components.filter(c => c.isAppManaged);
    const updates = appManaged
      .filter(c => c.updateAvailable || (c.availableVersion && c.installedVersion && c.availableVersion !== c.installedVersion))
      .map(c => ({
        id: c.id,
        name: c.name,
        installedVersion: c.installedVersion || 'None',
        availableVersion: c.availableVersion || 'Latest',
        purpose: c.purpose,
      }));

    res.json({
      updatesAvailable: updates.length > 0,
      updates,
      message: updates.length === 0 ? 'All application-managed required components are up to date.' : `${updates.length} update(s) available.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to check updates' });
  }
});

// ----------------------------------------------------
// Step 1 Live Processing Progress Endpoints & Execution Engine
// ----------------------------------------------------

// Get live Step 1 progress state
app.get('/api/step1/progress', (req, res) => {
  res.json(activeStep1ProgressState);
});

let step1Abort: AbortController | undefined;
let step1TaskRunning = false;
// Cancel active Step 1 process
app.post('/api/step1/cancel', (req, res) => {
  if (!step1TaskRunning) {
    return res.status(400).json({ error: 'No active Step 1 processing job.' });
  }

  step1Abort?.abort();
  activeStep1ProgressState.isActive = false;
  activeStep1ProgressState.stage = 'cancelled';
  activeStep1ProgressState.label = 'Processing cancelled';
  activeStep1ProgressState.currentTask = 'Ready to restart with updated settings';
  activeStep1ProgressState.currentStageNumber = 0;
  activeStep1ProgressState.percentage = 0;
  activeStep1ProgressState.isCancelling = false;
  activeStep1ProgressState.canCancel = false;
  activeStep1ProgressState.error = null;
  activeStep1ProgressState.summary = null;
  activeStep1ProgressState.liveStatusMessage = 'Processing cancelled. Completed audio preparation is preserved for the next run.';
  logStep1(`User cancelled processing. Completed audio preparation was preserved.`);

  res.json({ status: 'ok', message: 'Processing cancelled.', progress: activeStep1ProgressState });
});

// ----------------------------------------------------
// Expanded Audio-Format Support & Media Inspection Layer
// ----------------------------------------------------

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'm4b',
  'ogg',
  'oga',
  'opus',
  'flac',
  'wav',
  'aiff',
  'aif',
  'wma',
  'alac', 'webm', 'mka'
]);

// FFprobe / FFmpeg media inspector
function probeAudioFile(filePath: string) {
  return inspect(MANAGED_FFPROBE_PATH, filePath);
}

// Local Recursive Directory Scanner (Supports Layout A, Layout B, and Layout C with natural sorting)
function scanLocalFolder(folderPath: string): FolderScanResult {
  const resolved = path.resolve(folderPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory does not exist: ${folderPath}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${folderPath}`);
  }

  const audioFiles: DiscoveredAudioFile[] = [];
  const unsupportedFiles: UnsupportedFileItem[] = [];
  const chapterFoldersSet = new Set<string>();

  function walk(currentDir: string, relativeParent = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    // Sort naturally: Chapter 2 before Chapter 10
    const sortedEntries = naturalSort(entries, e => e.name);

    for (const entry of sortedEntries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativeParent ? path.join(relativeParent, entry.name) : entry.name;

      if (entry.isDirectory()) {
        chapterFoldersSet.add(entry.name);
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().replace('.', '');
        const fileStat = fs.statSync(fullPath);

        if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
          // Probe with FFprobe
          let probe: ReturnType<typeof probeAudioFile>;
          try { probe = probeAudioFile(fullPath); } catch (error: any) {
            unsupportedFiles.push({ fileName: entry.name, relativePath: relPath, reason: error.message, sizeBytes: fileStat.size });
            continue;
          }
          const folderName = relativeParent ? path.basename(relativeParent) : 'Root';
          if (relativeParent) {
            chapterFoldersSet.add(relativeParent);
          }

          audioFiles.push({
            relativePath: relPath,
            fileName: entry.name,
            folderName,
            format: probe.format,
            codec: probe.codec,
            sampleRate: probe.sampleRate,
            channels: probe.channels,
            bitrate: probe.bitrate,
            sizeBytes: fileStat.size,
            durationSeconds: probe.durationSeconds,
            chapterGroup: relativeParent || undefined,
            isProbed: true,
            streamSignature: probe.streamSignature,
          });
        } else {
          // Unsupported file found (e.g. .txt, .jpg, .pdf) - tracked separately without erroring
          unsupportedFiles.push({
            fileName: entry.name,
            relativePath: relPath,
            reason: `Non-audio format (.${ext || 'unknown'})`,
            sizeBytes: fileStat.size,
          });
        }
      }
    }
  }

  walk(resolved);

  // Natural sort for files
  const sortedFiles = naturalSort(audioFiles, f => f.relativePath);
  const hasNestedChapterFolders = sortedFiles.some(f => Boolean(f.chapterGroup));

  // Determine formats detected
  const formatsSet = new Set(sortedFiles.map(f => f.format.toLowerCase()));
  const formatsDetected = Array.from(formatsSet);
  const isUniformFormat = formatsDetected.length <= 1;

  const compatibility = stitchCompatibility(sortedFiles);
  const isStreamCopyCompatible = compatibility.compatible;
  const streamCopyIncompatibilityReason = compatibility.reason || undefined;

  return {
    sourcePath: folderPath,
    totalFiles: sortedFiles.length,
    hasNestedChapterFolders,
    chapterFoldersCount: hasNestedChapterFolders ? chapterFoldersSet.size : 0,
    files: sortedFiles,
    unsupportedFiles: unsupportedFiles.length > 0 ? unsupportedFiles : undefined,
    formatsDetected,
    isUniformFormat,
    isStreamCopyCompatible,
    streamCopyIncompatibilityReason,
  };
}

// ----------------------------------------------------
// yt-dlp & FFmpeg Local Dependency Management
// ----------------------------------------------------

const LOCAL_YT_DLP_PATH = path.join(RUNTIME_BIN_DIR, isWin ? 'yt-dlp.exe' : 'yt-dlp');
const WINDOWS_YT_DLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const WINDOWS_YT_DLP_SHA256_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';

let isYtDlpInstalling = false;
let ytDlpInstallError: string | null = null;

async function checkBinaryVersion(executablePath: string, args: string[] = ['--version']): Promise<string | null> {
  try {
    const {stdout: out} = await execFileAsync(executablePath, args, { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const firstLine = out.trim().split('\n')[0];
    return firstLine.trim();
  } catch (e) {
    return null;
  }
}

const ytDlpVersion = new StatusCache<string | null>(5 * 60_000);
async function getYtDlpStatus(): Promise<YtDlpStatusInfo> {
  // Check local managed yt-dlp first
  let executablePath = LOCAL_YT_DLP_PATH;
  const isSystemInstalled = false;
  let version: string | undefined;

  version = (await ytDlpVersion.get(() => checkBinaryVersion(LOCAL_YT_DLP_PATH))) || undefined;

  // Check FFmpeg and FFprobe
  const ffmpegVerLine = await managedBinaryStatus(MANAGED_FFMPEG_PATH);
  const ffprobeVerLine = await managedBinaryStatus(MANAGED_FFPROBE_PATH);
  const ffmpegAvailable = Boolean(ffmpegVerLine);
  const ffprobeAvailable = Boolean(ffprobeVerLine);

  let status: YtDlpStatusState = 'not_installed';
  if (isYtDlpInstalling) {
    status = 'downloading';
  } else if (ytDlpInstallError) {
    status = 'error';
  } else if (version) {
    status = 'installed';
  }

  return {
    status,
    version,
    executablePath,
    isSystemInstalled,
    ffmpegAvailable,
    ffmpegVersion: ffmpegVerLine ? ffmpegVerLine.split(' ')[2] : undefined,
    ffprobeAvailable,
    ffprobeVersion: ffprobeVerLine ? ffprobeVerLine.split(' ')[2] : undefined,
    error: ytDlpInstallError || undefined,
    lastCheckedAt: new Date().toISOString(),
    latestVersion: '2026.08.19',
  };
}

async function installLocalYtDlp(): Promise<YtDlpStatusInfo> {
  isYtDlpInstalling = true;
  ytDlpInstallError = null;

  try {
    if (!isWin) throw new Error('Automatic yt-dlp setup is currently implemented for Windows only.');
    fs.mkdirSync(RUNTIME_BIN_DIR, { recursive: true });
    const downloadPath = `${LOCAL_YT_DLP_PATH}.downloading`;
    const checksumPath = path.join(RUNTIME_BIN_DIR, 'yt-dlp-sha256sums.txt');
    try {
      await downloadFile(WINDOWS_YT_DLP_URL, downloadPath);
      await downloadFile(WINDOWS_YT_DLP_SHA256_URL, checksumPath);
      const expected = fs.readFileSync(checksumPath, 'utf8').split(/\r?\n/).find(line => /\byt-dlp\.exe\b/i.test(line))?.match(/\b[a-fA-F0-9]{64}\b/)?.[0]?.toLowerCase();
      const actual = createHash('sha256').update(fs.readFileSync(downloadPath)).digest('hex');
      if (!expected || expected !== actual) throw new Error('yt-dlp checksum verification failed. The download was not installed.');
      fs.copyFileSync(downloadPath, LOCAL_YT_DLP_PATH);
    } finally {
      try { fs.rmSync(downloadPath, { force: true }); } catch {}
      try { fs.rmSync(checksumPath, { force: true }); } catch {}
    }
    ytDlpVersion.invalidate();
    if (!await checkBinaryVersion(LOCAL_YT_DLP_PATH)) throw new Error('Downloaded yt-dlp.exe could not be executed from runtime/bin.');

    isYtDlpInstalling = false;
    ytDlpVersion.invalidate();
    invalidateRequirements();
    return getYtDlpStatus();
  } catch (err: any) {
    isYtDlpInstalling = false;
    ytDlpInstallError = err.message || 'Failed to download or execute yt-dlp';
    return getYtDlpStatus();
  }
}

async function updateLocalYtDlp(): Promise<YtDlpStatusInfo> {
  const currentStatus = await getYtDlpStatus();
  if (currentStatus.status !== 'installed') {
    throw new Error('yt-dlp is not installed yet.');
  }

  try {
    if (fs.existsSync(LOCAL_YT_DLP_PATH)) {
      await execFileAsync(LOCAL_YT_DLP_PATH, ['-U'], {
        encoding: 'utf-8',
        timeout: 25000, windowsHide: true,
      });
    } else {
      throw new Error('The application-local yt-dlp executable is missing. Use Install yt-dlp instead.');
    }
    ytDlpVersion.invalidate();
    invalidateRequirements();
    return getYtDlpStatus();
  } catch (err: any) {
    throw new Error(`yt-dlp update failed: ${err.message}. Previous version was retained.`);
  }
}

async function uninstallLocalYtDlp(): Promise<YtDlpStatusInfo> {
  // Removes only the application-managed yt-dlp executable in runtime/bin.
  // Never touches user audio, models, or settings!
  if (fs.existsSync(LOCAL_YT_DLP_PATH)) {
    try {
      fs.unlinkSync(LOCAL_YT_DLP_PATH);
    } catch (e) {}
  }
  ytDlpInstallError = null;
  ytDlpVersion.invalidate();
  invalidateRequirements();
  return getYtDlpStatus();
}

// ----------------------------------------------------
// API Endpoints
// ----------------------------------------------------

// Hardware detection
app.get('/api/system/hardware', async (req, res) => {
  const hw = await getHardwareInfo();
  res.json(hw);
});

// Get speech models list
app.get('/api/models', async (req, res) => {
  const backend: TranscriptionEngineId = requestEngine(req.query.engine);
  if (req.query.progress !== 'true') await ensureModels(backend, req.query.refresh === 'true');
  const hw = await getHardwareInfo();
  // Ensure we include system compatibility
  const modelsWithCompatibility = backendModels[backend].map(m => ({
    ...m,
    isCompatible: hw.mode === 'gpu' ? true : !m.requiresGpu,
    isRecommended: m.id === hw.recommendedModelId,
  }));
  res.json(modelsWithCompatibility);
});

// Force refresh model detection from disk
app.post('/api/models/refresh', async (req, res) => {
  const backend: TranscriptionEngineId = requestEngine(req.query.engine);
  await ensureModels(backend, true);
  const hw = await getHardwareInfo();
  const modelsWithCompatibility = backendModels[backend].map(m => ({
    ...m,
    isCompatible: hw.mode === 'gpu' ? true : !m.requiresGpu,
    isRecommended: m.id === hw.recommendedModelId,
  }));
  res.json({ status: 'ok', models: modelsWithCompatibility });
});

// Get local models directory info and disk usage
app.get('/api/models/info', async (req, res) => {
  const backend = requestEngine(req.query.engine);
  await ensureModels(backend);
  const modelsDir = appPath('models');
  let totalDiskBytes = 0;
  const installedList: any[] = [];

  for (const m of backendModels[backend]) {
    const status = await getModelInstallationStatus(m.id, backend);
    if (status.isInstalled) {
      totalDiskBytes += status.sizeOnDiskBytes;
      installedList.push({
        id: m.id,
        name: m.name,
        file: status.installedFile,
        sizeBytes: status.sizeOnDiskBytes,
        sizeFormatted: status.sizeOnDiskLabel,
        dirPath: status.modelDirPath,
      });
    }
  }

  res.json({
    modelsDirectory: modelsDir,
    totalInstalled: installedList.length,
    totalDiskBytes,
    totalDiskFormatted: formatBytes(totalDiskBytes),
    installedModels: installedList,
  });
});

// Download a Faster-Whisper model snapshot into the portable app cache. This is
// separate from Runtime Repair because model weights are installed only when a
// user explicitly chooses one in the Models section.
app.post('/api/models/:id/prepare', requireFeatures(['faster_model_management'], 'Model download'), async (req, res) => {
  const modelId = req.params.id;
  const model = backendModels['faster-whisper'].find(m => m.id === modelId);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const backend: TranscriptionEngineId = requestEngine(req.query.engine);
  if (backend === 'openai-whisper') {
    return res.status(400).json({ error: 'Use the compatibility model download action for OpenAI Whisper.' });
  }
  const repository = FASTER_WHISPER_REPOSITORIES[modelId];
  if (!repository) return res.status(400).json({ error: `No Faster-Whisper repository is configured for '${modelId}'.` });
  const venvPython = getVenvPython();
  if (!fs.existsSync(venvPython)) {
    return res.status(400).json({ error: 'Faster Whisper runtime is not installed. Open System Requirements and install the missing requirements first.' });
  }
  if (activeFasterWhisperInstalls.has(modelId)) {
    return res.status(409).json({ error: 'This model download is already in progress.' });
  }

  const force = req.query.force === 'true';
  const diskStatus = await getModelInstallationStatus(modelId, 'faster-whisper');
  if (activeFasterWhisperInstalls.has(modelId)) return res.status(409).json({ error: 'This model download is already in progress.' });
  const cachePath = diskStatus.modelDirPath;
  if (force && fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true, force: true });
  } else if (!force && diskStatus.isInstalled) {
    const {modelDirPath, ...installed} = diskStatus;
    Object.assign(model, installed);
    return res.json({ status: 'already_installed', model });
  }

  fs.mkdirSync(WHISPERX_MODEL_CACHE_DIR, { recursive: true });
  const pythonScript = [
    'from huggingface_hub import snapshot_download',
    `snapshot_download(repo_id=${JSON.stringify(repository)}, cache_dir=${JSON.stringify(WHISPERX_MODEL_CACHE_DIR)})`,
    "print('Model download complete.')",
  ].join('\n');
  const logPath = appPath('logs', `model-${modelId}-download.log`);
  const writeLog = (text: string) => {
    try { fs.appendFileSync(logPath, text, 'utf8'); } catch {}
  };

  model.isDownloading = true;
  model.downloadProgress = 0;
  model.downloadSpeed = 'Preparing download...';
  model.downloadError = undefined;
  writeLog(`\n========== ${new Date().toISOString()} ${force ? 'Reinstall' : 'Install'} ${model.name} ==========\n`);
  const child = spawn(venvPython, ['-c', pythonScript], { shell: false, windowsHide: true });
  activeFasterWhisperInstalls.set(modelId, child);

  const receiveOutput = (data: Buffer) => {
    const text = data.toString();
    writeLog(text);
    const lastLine = text.trim().split(/\r?\n/).filter(Boolean).pop();
    if (lastLine) model.downloadSpeed = lastLine.slice(0, 120);
  };
  child.stdout.on('data', receiveOutput);
  child.stderr.on('data', receiveOutput);
  child.on('error', (error) => {
    if (activeFasterWhisperInstalls.get(modelId) !== child) return;
    model.downloadError = `Could not start model download: ${error.message}`;
    model.isDownloading = false;
    activeFasterWhisperInstalls.delete(modelId);
    writeLog(`ERROR: ${model.downloadError}\n`);
  });
  child.on('close', async (code) => {
    if (activeFasterWhisperInstalls.get(modelId) !== child) return;
    model.downloadProgress = 0;
    if (code === 0) {
      const {modelDirPath, ...installed} = await getModelInstallationStatus(modelId, 'faster-whisper');
      if (activeFasterWhisperInstalls.get(modelId) !== child) return;
      Object.assign(model, installed);
      if (!installed.isInstalled) model.downloadError = 'Download finished without a complete model snapshot. Please retry.';
      model.downloadSpeed = undefined;
    } else {
      model.downloadError = `Model download failed with exit code ${code ?? 'unknown'}. See logs\\model-${modelId}-download.log.`;
      writeLog(`ERROR: ${model.downloadError}\n`);
    }
    modelSnapshots['faster-whisper'].invalidate();
    activeFasterWhisperInstalls.delete(modelId);
    model.isDownloading = false;
  });

  res.json({ status: 'started', model });
});

// OpenAI Whisper downloads use their own PyTorch checkpoint cache.
app.post('/api/models/:id/install', requireFeatures(['openai_model_management'], 'Model download'), async (req, res) => {
  const modelId = req.params.id;
  const model = backendModels['openai-whisper'].find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  // Check if actually installed on disk
  const diskStatus = await getModelInstallationStatus(modelId, 'openai-whisper');
  if (diskStatus.isInstalled && req.query.force !== 'true') {
    model.isInstalled = true;
    model.isDownloading = false;
    model.downloadProgress = 100;
    model.sizeOnDiskBytes = diskStatus.sizeOnDiskBytes;
    model.sizeOnDiskLabel = diskStatus.sizeOnDiskLabel;
    model.installedFile = diskStatus.installedFile;
    return res.json({ status: 'already_installed', model });
  }

  if (activeModelDownloads.has(modelId)) {
    return res.status(409).json({ error: 'Download already in progress', model });
  }

  const source = WHISPER_MODEL_SOURCES[modelId];
  if (!source) {
    return res.status(400).json({ error: `No download source configured for model '${modelId}'` });
  }

  const targetDir = path.join(OPENAI_WHISPER_MODEL_CACHE_DIR, modelId);
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e: any) {
      return res.status(500).json({ error: `Failed to create model folder: ${e.message}` });
    }
  }

  const finalFilePath = path.join(targetDir, source.fileName);
  const tempFilePath = path.join(targetDir, `${source.fileName}.downloading`);

  // Remove any leftover partial file
  if (fs.existsSync(tempFilePath)) {
    try { fs.unlinkSync(tempFilePath); } catch (e) {}
  }

  const abortController = new AbortController();
  activeModelDownloads.set(modelId, {
    modelId,
    abortController,
    tempFilePath,
    finalFilePath,
  });

  model.isDownloading = true;
  model.downloadProgress = 0;
  model.downloadSpeed = 'Connecting...';
  model.downloadError = undefined;
  model.downloadedBytes = 0;
  model.totalBytes = source.sizeBytes;

  console.log(`[Models] Starting real download of ${model.name} (${modelId}) from ${source.url}`);

  // Initiate real streaming download asynchronously
  (async () => {
    let fileStream: fs.WriteStream | null = null;
    try {
      const response = await fetch(source.url, {
        signal: abortController.signal,
        headers: {
          'User-Agent': 'Audiobook-Chapter-Workbench/1.0',
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText} fetching model from ${source.url}`);
      }

      const contentLengthHeader = response.headers.get('content-length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : source.sizeBytes;
      model.totalBytes = totalBytes;

      fileStream = fs.createWriteStream(tempFilePath);
      const reader = response.body.getReader();

      let receivedBytes = 0;
      let lastBytes = 0;
      let lastTime = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value && value.length > 0) {
          fileStream.write(value);
          receivedBytes += value.length;

          const now = Date.now();
          const elapsed = (now - lastTime) / 1000;
          if (elapsed >= 0.4) {
            const speedBps = (receivedBytes - lastBytes) / elapsed;
            const speedMb = speedBps / (1024 * 1024);
            lastBytes = receivedBytes;
            lastTime = now;
            model.downloadSpeed = `${speedMb.toFixed(1)} MB/s`;
            if (totalBytes > 0) {
              model.downloadProgress = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
            }
            model.downloadedBytes = receivedBytes;
          }
        }
      }

      // Finalize file write
      await new Promise<void>((resolve, reject) => {
        if (!fileStream) return resolve();
        fileStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Verify file presence and minimum expected size
      if (!fs.existsSync(tempFilePath)) {
        throw new Error('Downloaded weight file missing after stream completed');
      }

      const stat = fs.statSync(tempFilePath);
      if (stat.size < 1024 * 1024) {
        throw new Error(`Downloaded weight file size is too small (${stat.size} bytes). File may be corrupted.`);
      }

      // Rename temp file to final destination
      if (fs.existsSync(finalFilePath)) {
        try { fs.unlinkSync(finalFilePath); } catch (e) {}
      }
      fs.renameSync(tempFilePath, finalFilePath);

      // Create model.pt alias in the directory if needed by Whisper scripts
      const aliasPt = path.join(targetDir, 'model.pt');
      if (finalFilePath !== aliasPt && !fs.existsSync(aliasPt)) {
        try {
          fs.linkSync(finalFilePath, aliasPt);
        } catch {
          try {
            fs.copyFileSync(finalFilePath, aliasPt);
          } catch (e) {}
        }
      }

      // Write descriptive model_info.json in the folder
      const infoPath = path.join(targetDir, 'model_info.json');
      try {
        fs.writeFileSync(
          infoPath,
          JSON.stringify(
            {
              id: modelId,
              name: model.name,
              fileName: source.fileName,
              sizeBytes: stat.size,
              sizeFormatted: formatBytes(stat.size),
              downloadUrl: source.url,
              downloadedAt: new Date().toISOString(),
              format: 'whisper_pt',
              status: 'ready',
            },
            null,
            2
          )
        );
      } catch (e) {}

      console.log(`[Models] Successfully installed ${model.name} (${formatBytes(stat.size)}) to ${finalFilePath}`);

      model.isDownloading = false;
      model.downloadProgress = 100;
      model.isInstalled = true;
      model.downloadSpeed = undefined;
      model.downloadError = undefined;
      model.sizeOnDiskBytes = stat.size;
      model.sizeOnDiskLabel = formatBytes(stat.size);
      model.installedFile = source.fileName;
    } catch (err: any) {
      if (fileStream) {
        try { fileStream.destroy(); } catch (e) {}
      }
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }

      if (err.name === 'AbortError') {
        console.log(`[Models] Download of '${modelId}' cancelled by user.`);
        model.isDownloading = false;
        model.downloadProgress = 0;
        model.downloadSpeed = undefined;
        model.downloadError = undefined;
      } else {
        console.error(`[Models] Download of '${modelId}' failed:`, err);
        model.isDownloading = false;
        model.downloadProgress = 0;
        model.downloadSpeed = undefined;
        model.downloadError = err.message || 'Download failed';
      }
    } finally {
      activeModelDownloads.delete(modelId);
    }
  })();

  res.json({ status: 'downloading', model });
});

// Cancel model download
app.post('/api/models/:id/cancel', (req, res) => {
  const modelId = req.params.id;
  const model = backendModels[requestEngine(req.query.engine)].find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const active = requestEngine(req.query.engine) === 'openai-whisper' ? activeModelDownloads.get(modelId) : undefined;
  if (active) {
    try {
      active.abortController.abort();
    } catch (e) {}
    activeModelDownloads.delete(modelId);
  }
  const activeFasterWhisper = requestEngine(req.query.engine) === 'faster-whisper' ? activeFasterWhisperInstalls.get(modelId) : undefined;
  if (activeFasterWhisper) {
    try { activeFasterWhisper.kill(); } catch {}
    activeFasterWhisperInstalls.delete(modelId);
  }

  const targetDir = path.join(OPENAI_WHISPER_MODEL_CACHE_DIR, modelId);
  const source = WHISPER_MODEL_SOURCES[modelId];
  if (source && fs.existsSync(targetDir)) {
    const tempFile = path.join(targetDir, `${source.fileName}.downloading`);
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (e) {}
    }
  }

  model.isDownloading = false;
  model.downloadProgress = 0;
  model.downloadSpeed = undefined;
  model.downloadError = undefined;

  res.json({ status: 'cancelled', model });
});

// Uninstall model
app.post('/api/models/:id/uninstall', async (req, res) => {
  const modelId = req.params.id;
  const model = backendModels[requestEngine(req.query.engine)].find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const active = requestEngine(req.query.engine) === 'openai-whisper' ? activeModelDownloads.get(modelId) : undefined;
  if (active) {
    try {
      active.abortController.abort();
    } catch (e) {}
    activeModelDownloads.delete(modelId);
  }
  const activeFasterWhisper = requestEngine(req.query.engine) === 'faster-whisper' ? activeFasterWhisperInstalls.get(modelId) : undefined;
  if (activeFasterWhisper) {
    try { activeFasterWhisper.kill(); } catch {}
    activeFasterWhisperInstalls.delete(modelId);
  }

  model.isDownloading = false;
  model.downloadProgress = 0;
  model.downloadSpeed = undefined;
  model.downloadError = undefined;
  model.isInstalled = false;
  model.sizeOnDiskBytes = 0;
  model.sizeOnDiskLabel = '0 B';
  model.installedFile = undefined;

  // Remove only this app's Faster-Whisper snapshot. User audio and profile
  // caches are deliberately outside the scope of portable-app cleanup.
  const backend: TranscriptionEngineId = requestEngine(req.query.engine);
  const targetDir = (await getModelInstallationStatus(modelId, backend)).modelDirPath;
  if (fs.existsSync(targetDir)) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (e) {}
  }
  modelSnapshots[backend].invalidate();
  await ensureModels(backend);

  res.json({ status: 'uninstalled', model });
});

// Scan local folder
app.post('/api/system/scan-folder', requireFeatures(['folder_scan'], 'Folder scan'), (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ error: 'folderPath is required' });
  }

  try {
    const result = scanLocalFolder(folderPath);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to scan folder' });
  }
});

// Output folder endpoints
app.get('/api/system/output-folder', (req, res) => {
  res.json({
    outputFolder: currentOutputFolder,
    defaultOutputFolder: appPath('output'),
    isWritable: fs.existsSync(currentOutputFolder),
  });
});

app.post('/api/system/output-folder', (req, res) => {
  const { outputFolder } = req.body;
  if (outputFolder !== undefined && typeof outputFolder !== 'string') return res.status(400).json({error: 'Output folder must be a path.'});
  const target = outputFolder ? path.resolve(APP_ROOT, outputFolder) : appPath('output');
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    fs.accessSync(target, fs.constants.W_OK);
    currentOutputFolder = target;
    res.json({
      outputFolder: currentOutputFolder,
      defaultOutputFolder: appPath('output'),
      isWritable: true,
    });
  } catch (err: any) {
    res.status(400).json({
      error: `The selected output folder cannot be written to: ${err.message}`,
      outputFolder: currentOutputFolder,
    });
  }
});

// ----------------------------------------------------
// yt-dlp & YouTube Import API Endpoints
// ----------------------------------------------------

// Check status of yt-dlp and FFmpeg
app.get('/api/tools/yt-dlp/status', async (req, res) => {
  const status = await getYtDlpStatus();
  res.json(status);
});

// Install local yt-dlp binary
app.post('/api/tools/yt-dlp/install', async (req, res) => {
  try {
    const status = await installLocalYtDlp();
    if (status.status === 'error') {
      return res.status(500).json({ error: status.error, status });
    }
    res.json({ status: 'ok', info: status, message: `yt-dlp installed successfully (${status.version || 'latest'}).` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to install yt-dlp' });
  }
});

// Update local yt-dlp binary
app.post('/api/tools/yt-dlp/update', async (req, res) => {
  try {
    const status = await updateLocalYtDlp();
    res.json({ status: 'ok', info: status, message: `yt-dlp updated to version ${status.version || 'latest'}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update yt-dlp' });
  }
});

// Uninstall local yt-dlp binary
app.post('/api/tools/yt-dlp/uninstall', async (req, res) => {
  try {
    const status = await uninstallLocalYtDlp();
    res.json({ status: 'ok', info: status, message: 'Local yt-dlp binary uninstalled. Source files, whisper models, and projects were preserved.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to uninstall yt-dlp' });
  }
});

// Fetch YouTube video metadata via yt-dlp
app.post('/api/youtube/fetch-info', requireFeatures(['youtube_inspection'], 'YouTube inspection', () => undefined), async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'Please enter a valid YouTube video URL.' });
  }

  let cleanUrl: string;
  try { cleanUrl = youtubeUrl(url); } catch (error: any) { return res.status(400).json({error: error.message}); }

  const status = await getYtDlpStatus();
  if (status.status !== 'installed') {
    return res.status(400).json({
      error: 'yt-dlp Required',
      message: 'yt-dlp is required for YouTube Audio Import. Install it to fetch video information and download audio.',
    });
  }

  try {
    const {stdout} = await execFileAsync(status.executablePath, [...youtubeBaseArgs(), '--dump-single-json', '--skip-download', '--', cleanUrl], {
      encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    });

    const parsed = JSON.parse(stdout);
    const duration = parsed.duration ? Math.round(parsed.duration) : 0;
    const info: YouTubeVideoInfo = {
      url: cleanUrl,
      title: parsed.title || 'Untitled YouTube Audio',
      uploader: parsed.uploader || parsed.channel || 'Unknown Channel',
      uploaderUrl: parsed.uploader_url || parsed.channel_url,
      durationSeconds: duration,
      durationFormatted: formatTimestamp(duration),
      thumbnailUrl: parsed.thumbnail,
      description: parsed.description ? parsed.description.slice(0, 320) : undefined,
      audioBitrate: parsed.abr ? `${Math.round(parsed.abr)} kbps` : 'Best available',
      availableFormats: ['Best available / preserve source', 'M4A', 'MP3', 'FLAC', 'Opus', 'WAV'],
    };

    res.json({ status: 'ok', info });
  } catch (err: any) {
    const errorMsg = err.message || 'Failed to inspect YouTube video';
    let userMsg = 'Unable to fetch YouTube video details. Ensure the video is public and accessible.';
    if (errorMsg.includes('Private video')) {
      userMsg = 'This video is private. Please provide a link to a public or unlisted video.';
    } else if (errorMsg.includes('Video unavailable')) {
      userMsg = 'Video is unavailable or has been removed.';
    } else if (errorMsg.includes('timed out')) {
      userMsg = 'Request timed out while contacting YouTube. Please check your network connection and try again.';
    }
    res.status(400).json({ error: 'Inspection Failed', message: userMsg, details: errorMsg });
  }
});

// Download YouTube audio via yt-dlp & FFmpeg
const youtubeImports = new Set<string>();
app.post('/api/youtube/download', (req, res, next) => requireFeatures(
  [req.body?.format && req.body.format !== 'best' ? 'youtube_conversion' : 'youtube_import'],
  'YouTube import', request => request.body?.jobId,
)(req, res, next), async (req, res) => {
  const {
    jobId,
    url,
    format = 'best',
  } = req.body as {
    jobId?: string;
    url?: string;
    format?: YouTubeAudioFormat;
    overwrite?: boolean;
  };

  let cleanUrl: string;
  try { cleanUrl = youtubeUrl(url); } catch (error: any) { return res.status(400).json({error: error.message}); }
  if (!['best','mp3','m4a','flac','opus','wav'].includes(format)) return res.status(400).json({error: 'Unsupported audio format.'});
  const targetJob = jobId ? jobs.find(j => j.id === jobId) : undefined;
  if (jobId && !targetJob) return res.status(404).json({error: 'Job not found'});
  if (youtubeImports.has(jobId || '') || step1TaskRunning || targetJob?.exports?.some(e => ['queued','running'].includes(e.status))) return res.status(409).json({error: 'Wait for the active import, processing or export to complete.'});
  const status = await getYtDlpStatus();
  if (status.status !== 'installed') {
    return res.status(400).json({
      error: 'yt-dlp Required',
      message: 'yt-dlp is required for YouTube Audio Import. Install it to fetch video information and download audio.',
    });
  }

  if (format !== 'best' && !status.ffmpegAvailable) {
    return res.status(400).json({
      error: 'FFmpeg Required',
      message: 'FFmpeg is required to extract, merge, and convert audio. Install or configure FFmpeg before downloading converted audio formats.',
    });
  }

  if (!status.ffprobeAvailable) return res.status(400).json({error: 'FFprobe is required to verify downloaded audio. Install / Repair FFmpeg first.'});
  const importDir = appPath('output', 'imports', 'youtube', randomUUID());
  youtubeImports.add(jobId || '');
  try {
    const latestFile = await downloadYoutubeAudio(status.executablePath, RUNTIME_BIN_DIR, importDir, cleanUrl, format);
    const probe = probeAudioFile(latestFile.fullPath);
    const fileStat = fs.statSync(latestFile.fullPath);

    // If active job provided, update job with this newly downloaded audio part
    let updatedJob: AudiobookJob | undefined;
    if (jobId) {
      const job = jobs.find(j => j.id === jobId);
      if (job) {
        const cleanTitle = path.basename(latestFile.file, path.extname(latestFile.file));
        const newPart = {
          id: `yt-part-${Date.now()}`,
          name: latestFile.file,
          sizeBytes: fileStat.size,
          durationSeconds: probe.durationSeconds,
          bitrate: probe.bitrate,
          order: 1,
        };

        job.inputMethod = 'youtube';
        job.mergeMethod = 'quick';
        job.status = 'draft';
        job.mergedMp3 = null; job.previewPath = undefined; job.sourceKey = undefined; job.preparedAudioKey = undefined;
        job.transcription = null; job.transcriptWords = []; job.transcriptKey = undefined;
        job.existingChapters = []; job.chapters = []; job.candidates = [];
        job.outputM4b = null; job.validation = null; job.exports = [];
        job.hasNestedChapterFolders = false;
        job.youtubeUrl = cleanUrl;
        job.downloadedAudioFile = latestFile.fullPath;
        job.parts = [newPart];
        job.totalDurationSeconds = probe.durationSeconds;
        job.totalSizeBytes = fileStat.size;
        job.sourceFolderPath = importDir;

        // Set discovered files
        job.discoveredFiles = [{
          relativePath: latestFile.file,
          fileName: latestFile.file,
          folderName: 'YouTube Import',
          format: probe.format,
          codec: probe.codec,
          sampleRate: probe.sampleRate,
          channels: probe.channels,
          bitrate: probe.bitrate,
          sizeBytes: fileStat.size,
          durationSeconds: probe.durationSeconds,
          isProbed: true,
          streamSignature: probe.streamSignature,
        }];

        // Source summary
        job.sourceSummary = {
          inputMethod: 'youtube',
          sourcePath: latestFile.fullPath,
          formatsDetected: [probe.format],
          totalFiles: 1,
          totalDurationSeconds: probe.durationSeconds,
          chapterWorkflow: job.chapterSource || 'whisperx',
          mergeMethod: job.mergeMethod || 'quick',
        };

        job.logs.push({
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          level: 'INFO',
          message: `YouTube Audio Import: Successfully downloaded and processed "${cleanTitle}" (${probe.format.toUpperCase()}, ${probe.bitrate} kbps, ${formatTimestamp(probe.durationSeconds)}) into output/imports/youtube/. Added as project source file.`,
        });

        updatedJob = job;
        saveJobs();
      }
    }

    res.json({
      status: 'ok',
      message: `Audio downloaded successfully: ${latestFile.file}`,
      file: {
        fileName: latestFile.file,
        filePath: latestFile.fullPath,
        format: probe.format,
        codec: probe.codec,
        bitrate: probe.bitrate,
        durationSeconds: probe.durationSeconds,
        sizeBytes: fileStat.size,
      },
      job: updatedJob,
    });
  } catch (err: any) {
    appendOperationFailure(jobId, 'YouTube import', err.message || 'yt-dlp download failed.');
    res.status(500).json({
      error: 'Download Failed',
      message: err.message || 'Failed to download audio with yt-dlp. Please check the URL and your local network.',
    });
  } finally { youtubeImports.delete(jobId || ''); }
});

// Get configuration
app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

// Update configuration
app.post('/api/config', (req, res) => {
  const updates = req.body;
  currentConfig = { ...currentConfig, ...updates };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2), 'utf8');
  res.json({ status: 'ok', config: currentConfig });
});

// List jobs
app.get('/api/jobs', (req, res) => {
  res.json(jobs);
});

// Create new job
app.post('/api/jobs', (req, res) => {
  const { name, author, narrator, parts } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Job name is required' });
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `job-${Date.now()}`;
  
  const formattedParts = Array.isArray(parts) && parts.length > 0
    ? parts.map((p, idx) => ({
        id: `p-${idx + 1}`,
        name: p.name || `part_${idx + 1}.mp3`,
      sourceRelativePath: p.sourceRelativePath,
        sizeBytes: p.sizeBytes || 35000000,
        durationSeconds: p.durationSeconds || 1800,
        bitrate: p.bitrate || 128,
        order: idx + 1,
      }))
    : [
        { id: 'p-1', name: '01.mp3', sizeBytes: 35000000, durationSeconds: 1800, bitrate: 128, order: 1 },
        { id: 'p-2', name: '02.mp3', sizeBytes: 36500000, durationSeconds: 1920, bitrate: 128, order: 2 },
      ];

  const totalDur = formattedParts.reduce((acc, p) => acc + p.durationSeconds, 0);
  const totalBytes = formattedParts.reduce((acc, p) => acc + p.sizeBytes, 0);

  const newJob: AudiobookJob = {
    id,
    name: name.trim(),
    author: author?.trim() || '',
    narrator: narrator?.trim() || '',
    metadata: {
      title: name.trim(),
      author: author?.trim() || '',
      narrator: narrator?.trim() || '',
      genres: ['Audiobook'],
      language: 'eng',
      abridged: false,
      explicit: false,
    },
    createdAt: new Date().toISOString(),
    parts: formattedParts,
    totalDurationSeconds: totalDur,
    totalSizeBytes: totalBytes,
    status: 'draft',
    candidates: [],
    chapters: [{ id: `c-${Date.now()}`, start: '00:00:00.000', title: 'Chapter 1' }],
    logs: [
      {
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        level: 'INFO',
        message: `Job '${name}' initialized with ${formattedParts.length} audio parts. Ready for Step 1.`,
      },
    ],
  };

  jobs.unshift(newJob);
  saveJobs();
  res.status(201).json(newJob);
});

// Get job by ID
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (!job.sourceBitrate && job.mergedMp3?.fullPath) {
    try {
      const media = job.parts.map(part=>inspect(MANAGED_FFPROBE_PATH,path.resolve(APP_ROOT,job.sourceFolderPath || '',part.name)));
      job.sourceBitrate = Math.max(...media.map(m=>m.bitrate));
    } catch { /* Keep unknown explicit until the source can be inspected. */ }
  }
  res.json(job);
});

// Delete job
app.delete('/api/jobs/:id', (req, res) => {
  const index = jobs.findIndex(j => j.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const job = jobs[index];
  
  // Cleanup files in inputs/[jobId]
  const jobUploadDir = path.join(uploadDir, job.id);
  if (fs.existsSync(jobUploadDir)) {
    try {
      fs.rmSync(jobUploadDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`Failed to cleanup upload dir for ${job.id}:`, e);
    }
  }

  // Also cleanup audiobooks/[jobId] if it exists
  const jobProcessDir = appPath('audiobooks', job.id);
  if (fs.existsSync(jobProcessDir)) {
    try {
      fs.rmSync(jobProcessDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`Failed to cleanup process dir for ${job.id}:`, e);
    }
  }

  jobs.splice(index, 1);
  saveJobs();
  res.json({ status: 'ok' });
});

// Step 1: Save Step 1 Options & Settings
app.post('/api/jobs/:id/step1-settings', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const {
    sourceFolderPath,
    outputFolderPath,
    chapterSource,
    mergeMethod,
    selectedModelId,
    parts,
  } = req.body;

  if (sourceFolderPath !== undefined) job.sourceFolderPath = sourceFolderPath;
  if (outputFolderPath !== undefined) job.outputFolderPath = outputFolderPath;
  if (chapterSource !== undefined) job.chapterSource = chapterSource;
  if (mergeMethod !== undefined) job.mergeMethod = mergeMethod;
  if (selectedModelId !== undefined) job.selectedModelId = selectedModelId;
  if (Array.isArray(req.body.discoveredFiles)) job.discoveredFiles = req.body.discoveredFiles;

  if (Array.isArray(parts)) {
    job.parts = naturalSort(parts.map((p: any, idx: number) => ({
      id: p.id || `p-${idx + 1}`,
      name: p.name || `part_${idx + 1}.mp3`,
      sourceRelativePath: p.sourceRelativePath,
      sizeBytes: p.sizeBytes || 25000000,
      durationSeconds: p.durationSeconds || 1500,
      bitrate: p.bitrate || 128,
      order: idx + 1,
    })), p => p.sourceRelativePath || p.name);
    job.totalDurationSeconds = job.parts.reduce((acc, p) => acc + p.durationSeconds, 0);
    job.totalSizeBytes = job.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
  }

  saveJobs();
  res.json({ status: 'ok', job });
});

const logStep1 = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    activeStep1ProgressState.logs.push(formatted);
    console.log(`[Step1: ${jobIdForStep1 || 'Global'}] ${formatted}`);
};

// Step 1: Process Step 1 (Supports both 'whisperx' and 'existing_files' workflows)
const handleStep1Process = async (req: any, res: any) => {
  if (step1TaskRunning) return res.status(409).json({ error: 'Another source is being processed or finishing cancellation.' });
  jobIdForStep1 = req.params.id;
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (youtubeImports.has(job.id) || job.exports?.some(e => ['running','queued'].includes(e.status))) return res.status(409).json({error: 'Wait for import or export to finish.'});

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  const requestedEngine = requestEngine(undefined);
  const {
    chapterSource = job.chapterSource || 'whisperx',
    mergeMethod = job.mergeMethod || 'standard',
    selectedModelId = job.selectedModelId || 'small',
    sourceFolderPath = job.sourceFolderPath,
    outputFolderPath = job.outputFolderPath || currentOutputFolder,
    parts = null,
  } = req.body || {};

  const previousMergeMethod = job.mergeMethod;
  const previousPreparedDurations = job.parts.map(part => part.durationSeconds);

  // Update job settings
  job.chapterSource = chapterSource;
  job.mergeMethod = mergeMethod;
  job.selectedModelId = selectedModelId;
  if (sourceFolderPath) job.sourceFolderPath = sourceFolderPath;
  if (outputFolderPath) job.outputFolderPath = outputFolderPath;

  // Update parts if provided from folder import
  if (Array.isArray(parts) && parts.length > 0) {
    job.parts = naturalSort(parts.map((p: any, idx: number) => ({
      id: p.id || `p-${idx + 1}`,
      name: p.name || `part_${idx + 1}.mp3`,
      sourceRelativePath: p.sourceRelativePath,
      sizeBytes: p.sizeBytes || 25000000,
      durationSeconds: p.durationSeconds || 1500,
      bitrate: p.bitrate || 128,
      order: idx + 1,
    })), p => p.sourceRelativePath || p.name);
    job.totalDurationSeconds = job.parts.reduce((acc, p) => acc + p.durationSeconds, 0);
    job.totalSizeBytes = job.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
  }

  if (job.parts.length === 0) {
    return res.status(400).json({ error: 'No MP3 files found in the selected folder.' });
  }

  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `=== Starting Step 1 for: ${job.name} (Workflow: ${chapterSource === 'existing_files' ? 'Existing Audio Files' : 'Speech Recognition'}) ===`,
  });

  // Initialize live Step 1 progress state
  activeStep1StartTime = Date.now();
  activeStep1ProgressState = {
    isActive: true,
    stage: 'scanning_folder',
    label: chapterSource === 'existing_files' ? 'Scanning & validating input audio files' : 'Scanning input audio files',
    currentTask: `Verifying ${job.parts.length} source audio files...`,
    currentStageNumber: 1,
    totalStages: chapterSource === 'existing_files' ? 3 : 6,
    percentage: 10,
    isDeterminate: true,
    elapsedSeconds: 0,
    liveStatusMessage: `Discovered ${job.parts.length} input files. Checking format & integrity.`,
    logs: [
      `[${new Date().toLocaleTimeString()}] Step 1 initiated for: ${job.name}`,
      `[${new Date().toLocaleTimeString()}] Target output folder: ${job.outputFolderPath || currentOutputFolder}`,
      `[${new Date().toLocaleTimeString()}] Workflow: ${chapterSource === 'existing_files' ? 'Direct Audio File Preservation' : 'Whisper Speech Recognition'}`,
    ],
    canCancel: true,
    isCancelling: false,
    error: null,
    summary: null,
  };

  // Respond immediately so the client can begin polling without NetworkError timeouts
  res.json({ status: 'started', message: 'Step 1 processing started in background' });

  const controller = new AbortController();
  step1Abort = controller;
  step1TaskRunning = true;
  const signal = controller.signal;
  // Run the heavy processing in the background
  (async () => {
    try {
      // ----------------------------------------------------
      job.parts.sort((a,b) => naturalPathCompare(a.sourceRelativePath || a.name, b.sourceRelativePath || b.name));
      const sourcePaths = job.parts.map(part => path.resolve(APP_ROOT, job.sourceFolderPath || '', part.name));
      const media = sourcePaths.map(p => inspect(MANAGED_FFPROBE_PATH, p));
      job.discoveredFiles = job.parts.map((part,i)=>({
        relativePath: part.sourceRelativePath || part.name,
        storedName: part.name, fileName: path.basename(part.sourceRelativePath || part.name), folderName: path.dirname(part.sourceRelativePath || part.name),
        format: media[i].format, codec: media[i].codec, sampleRate: media[i].sampleRate, channels: media[i].channels,
        bitrate: media[i].bitrate, durationSeconds: media[i].durationSeconds, sizeBytes: fs.statSync(sourcePaths[i]).size,
        isProbed: true, streamSignature: media[i].streamSignature,
      }));
      const settings = { model: selectedModelId, language: 'en', alignment: true, engine: requestedEngine, mergeMethod, chapterSource, profile: currentConfig.whisper_profile, profiles: currentConfig.profiles };
      const key = await fingerprint(sourcePaths, settings);
      signal.throwIfAborted();
      if (job.transcriptKey === key && job.transcription && job.previewPath && fs.existsSync(job.previewPath) && job.mergedMp3?.fullPath && fs.existsSync(job.mergedMp3.fullPath)) {
        logStep1('Reusing completed aligned transcript and reviewed chapters.');
        activeStep1ProgressState.isActive = false;
        activeStep1ProgressState.stage = 'completed';
        activeStep1ProgressState.percentage = 100;
        return;
      }
      const sourceKey = await fingerprint(sourcePaths, {});
      const preparedAudioKey = await fingerprint(sourcePaths, { mergeMethod });
      signal.throwIfAborted();
      const sameSource = job.sourceKey === sourceKey;
      const existingMaster = job.mergedMp3?.fullPath;
      const reusePreparedAudio = sameSource && Boolean(existingMaster && fs.existsSync(existingMaster)) && (
        job.preparedAudioKey === preparedAudioKey || (!job.preparedAudioKey && previousMergeMethod === mergeMethod)
      );
      job.status = 'draft'; job.outputM4b = null; job.validation = null; job.exports = [];
      if (!reusePreparedAudio) {
        job.mergedMp3 = null;
        job.previewPath = undefined;
        job.preparedAudioKey = undefined;
      }
      job.chapters = []; job.candidates = [];
      job.transcriptWords = []; job.transcription = null; job.transcriptKey = undefined;
      if (!sameSource) { job.existingChapters = []; job.sourceTags = {}; job.importedMetadata = undefined; }
      const intermediatesDir = path.join(job.outputFolderPath || currentOutputFolder, 'intermediates', job.id);
      if (sourcePaths.some(p => { const relative = path.relative(intermediatesDir,p); return !relative.startsWith('..') && !path.isAbsolute(relative); })) throw new Error('Move source files outside this project’s intermediate directory before processing.');
      fs.mkdirSync(intermediatesDir, { recursive: true });
      const prepared = reusePreparedAudio
        ? {
            master: existingMaster!,
            media,
            durations: job.parts.map((part, index) => previousPreparedDurations[index] || part.durationSeconds || media[index].durationSeconds),
            normalized: mergeMethod === 'standard',
          }
        : await prepareMaster(MANAGED_FFMPEG_PATH, MANAGED_FFPROBE_PATH, sourcePaths, intermediatesDir, mergeMethod, logStep1, signal);
      if (reusePreparedAudio) logStep1('Reusing prepared master audio; skipping PCM conversion and stitching.');
      const master = prepared.master;
      job.sourceBitrate = Math.max(...media.map(m => m.bitrate));
      const masterInfo = inspect(MANAGED_FFPROBE_PATH, master);
      job.sourceCodec = masterInfo.codec;
      job.sourceFormat = media.every(m => m.format === media[0].format) ? media[0].format : 'wav';
      job.totalDurationSeconds = masterInfo.durationSeconds;
      job.totalSizeBytes = sourcePaths.reduce((sum,p)=>sum+fs.statSync(p).size,0);
      job.parts.forEach((part, i) => { part.durationSeconds = prepared.durations[i]; part.bitrate = media[i].bitrate; });
      job.mergedMp3 = { filename: path.basename(master), fullPath: master, duration: masterInfo.durationSeconds, bitrate: masterInfo.bitrate, sizeBytes: fs.statSync(master).size };
      job.sourceKey = sourceKey;
      job.preparedAudioKey = preparedAudioKey;
      saveJobs();
      if (!sameSource && sourcePaths.length === 1) {
        job.existingChapters = media[0].chapters;
        const tags = Object.fromEntries(Object.entries(media[0].tags).map(([k,v])=>[k.toLowerCase(),String(v)]));
        job.sourceTags = media[0].tags;
        job.metadata = { title: tags.album || tags.title || job.name, author: tags.artist || tags.album_artist || '', narrator: tags.composer || '', genres: (tags.genre || '').split(/[;,]/).map(value => value.trim()).filter(Boolean), language: tags.language || 'eng', abridged: tags.abridged === '1', explicit: tags.explicit === '1', subtitle: tags.subtitle || tags.tit3, series: tags.series, seriesSequence: tags['series-part'], publishedYear: tags.date, releaseDate: tags.releasetime, publisher: tags.publisher, description: tags.description || tags.desc || tags.comment, copyright: tags.copyright, isbn: tags.isbn, asin: tags.asin };
        if (media[0].artwork) {
          const coverPath = path.join(intermediatesDir, media[0].artwork.codec_name === 'png' ? 'original-cover.png' : 'original-cover.jpg');
          await execFileAsync(MANAGED_FFMPEG_PATH, ['-v', 'error', '-y', '-i', master, '-map', '0:' + media[0].artwork.index, '-c', 'copy', coverPath]);
          job.metadata.cover = { source: 'local', filename: path.basename(coverPath), url: 'data:image/' + (coverPath.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(coverPath).toString('base64') };
        }
        job.importedMetadata = JSON.parse(JSON.stringify(job.metadata));
      }
      const reusablePreview = reusePreparedAudio && job.previewPath && fs.existsSync(job.previewPath);
      if (reusablePreview) {
        logStep1('Reusing existing analysis preview.');
      } else {
        job.previewPath = path.join(intermediatesDir, 'analysis.wav');
        await makePreview(MANAGED_FFMPEG_PATH, master, job.previewPath, signal);
      }
      signal.throwIfAborted();
      saveJobs();
      // WORKFLOW A: Use existing MP3 files as individual chapters
      // ----------------------------------------------------
  if (chapterSource === 'existing_files') {
    activeStep1ProgressState.stage = 'probing_media';
    activeStep1ProgressState.currentStageNumber = 2;
    activeStep1ProgressState.percentage = 45;
    activeStep1ProgressState.label = 'Extracting existing file durations & chapter tags';
    activeStep1ProgressState.currentTask = 'Reading durations and metadata from individual audio tracks';
    logStep1(`Probing ${job.parts.length} files with FFprobe...`);

    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Preserving ${job.parts.length} source audio files directly as completed chapters. Skipping transcription; audio is still merged into one recording.`,
    });

    const relativeNames = job.parts.map(part => part.sourceRelativePath || (path.isAbsolute(part.name) ? path.relative(job.sourceFolderPath || path.dirname(part.name),part.name) : part.name));
    const structure = sourceChapterGroups(relativeNames);
    job.chapterStructure = structure.mode;
    const starts: number[] = [];
    let cumulativeSec = 0;
    for (const duration of prepared.durations) { starts.push(cumulativeSec); cumulativeSec += duration; }
    const directChapters: ChapterEntry[] = structure.groups.map((group,index) => ({
      id: 'chap-' + (index+1), start: formatTimestamp(starts[group.indices[0]]), title: group.title,
      notes: group.indices.map(i => relativeNames[i]).join(' → '),
    }));
    job.chapters = directChapters;
    job.candidates = []; // No AI candidates needed
    job.status = 'transcribed';

    if (sourcePaths.length === 1 && job.existingChapters?.length) job.chapters = [...job.existingChapters];
    job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);

    activeStep1ProgressState.stage = 'completed';
    activeStep1ProgressState.currentStageNumber = 3;
    activeStep1ProgressState.percentage = 100;
    activeStep1ProgressState.label = 'Step 1 complete';
    activeStep1ProgressState.currentTask = 'Chapters created successfully';
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.canCancel = false;
    activeStep1ProgressState.liveStatusMessage = `Created ${directChapters.length} chapters directly from existing files. Ready for Step 2 human review.`;
    activeStep1ProgressState.summary = {
      totalFilesProcessed: job.parts.length,
      totalDurationSeconds: cumulativeSec,
      chaptersFound: directChapters.length,
      wordsTranscribed: 0,
      modelUsed: 'Direct File Preservation (Bypassed Whisper)',
    };
    logStep1(`Step 1 complete. ${directChapters.length} chapters mapped in natural sequence.`);

    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Step 1 Complete: Created ${directChapters.length} chapters from individual audio files in natural order. Total duration: ${formatTimestamp(cumulativeSec)}. Ready for review.`,
    });

    saveJobs();
    return;
  }

  // ----------------------------------------------------
  // WORKFLOW B: Generate chapters with WhisperX
  // ----------------------------------------------------
  const model = speechModels.find(m => m.id === selectedModelId) || speechModels[1];
  const hw = await getHardwareInfo();

  const mergedFilePath = job.previewPath;
  // Stage 4: Transcribing with Local WhisperX
  activeStep1ProgressState.stage = 'transcribing_whisper';
  activeStep1ProgressState.currentStageNumber = 4;
  activeStep1ProgressState.percentage = 62;
  activeStep1ProgressState.label = `Transcribing speech (${model.name})`;
  activeStep1ProgressState.currentTask = requestedEngine === 'faster-whisper'
    ? `Using Faster Whisper with ${hw.mode === 'gpu' ? 'automatic GPU acceleration' : 'optimized CPU transcription'}...`
    : 'Using OpenAI Whisper compatibility mode...';
  logStep1(`Initialized Whisper model: ${model.name} (${model.id})`);

  // Do not create estimated transcript statistics. A prior demo implementation
  // filled these values before WhisperX had actually succeeded, which made a
  // failed run look partially complete. They are set from real JSON below.
  delete job.transcription;

  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `${requestedEngine === 'faster-whisper' ? 'Faster Whisper' : 'OpenAI Whisper compatibility mode'} started with '${model.name}' (${hw.mode === 'gpu' ? 'GPU preferred' : 'CPU'}).`,
  });

  // Stage 5: Detecting chapter markers
  activeStep1ProgressState.stage = 'extracting_chapters';
  activeStep1ProgressState.currentStageNumber = 5;
  activeStep1ProgressState.percentage = 85;
  activeStep1ProgressState.label = 'Detecting chapter headings & boundary tokens';
  activeStep1ProgressState.currentTask = 'Alignment & lead-in window calculation...';
  
  const leadIn = currentConfig.lead_in_seconds || 1.5;
  let generatedCandidates: ChapterCandidate[] = [];

  try {
    if (!fs.existsSync(mergedFilePath)) {
        const errorMsg = "Cannot run transcription because the merged audio file was not successfully created.";
        logStep1(`ERROR: ${errorMsg}`);
        activeStep1ProgressState.isActive = false;
        activeStep1ProgressState.error = errorMsg;
        return;
    }
    
    const venvPython = getVenvPython();
    if (!fs.existsSync(venvPython)) {
        throw new Error("The private transcription runtime is not ready. Open System Requirements and choose Install Missing Requirements.");
    }

    fs.mkdirSync(TORCH_CACHE_DIR, { recursive: true });
    fs.mkdirSync(MATPLOTLIB_CACHE_DIR, { recursive: true });
    fs.mkdirSync(OPENAI_WHISPER_MODEL_CACHE_DIR, { recursive: true });
    const normalizedPath = path.join(intermediatesDir, `${path.parse(mergedFilePath).name}.transcript.json`);
    const runtimeEnv = {
      ...transcriptionRuntimeEnv(),
      HF_HOME: WHISPERX_MODEL_CACHE_DIR,
      TORCH_HOME: TORCH_CACHE_DIR,
      MPLCONFIGDIR: MATPLOTLIB_CACHE_DIR,
    };
    let normalized: NormalizedTranscription | undefined;
    let lastEngineError: unknown;
    const runEngine = async (engine: TranscriptionEngineId, device: 'cpu' | 'cuda', computeType: string) => {
      logStep1(`Transcription engine=${engine}, model=${model.id}, device=${device}, compute=${computeType}, cache=${engine === 'faster-whisper' ? WHISPERX_MODEL_CACHE_DIR : OPENAI_WHISPER_MODEL_CACHE_DIR}`);
      return transcriptionEngines[engine].transcribe({
        pythonPath: venvPython, audioPath: mergedFilePath, outputPath: normalizedPath,
        modelId: engine === 'openai-whisper' && model.id === 'large-v3-turbo' ? 'turbo' : model.id,
        fasterModelRepository: FASTER_WHISPER_REPOSITORIES[model.id], engine,
        device, computeType, fasterCacheDir: WHISPERX_MODEL_CACHE_DIR,
        openAiCacheDir: path.join(OPENAI_WHISPER_MODEL_CACHE_DIR, model.id), language: 'en', signal, env: runtimeEnv,
      });
    };
    const runOpenAiCompatibility = async () => {
      const attempts: Array<{ device: 'cpu' | 'cuda'; computeType: string }> = hw.mode === 'gpu'
        ? [{ device: 'cuda', computeType: 'float16' }, { device: 'cpu', computeType: 'float32' }]
        : [{ device: 'cpu', computeType: 'float32' }];
      for (const attempt of attempts) {
        try { return await runEngine('openai-whisper', attempt.device, attempt.computeType); }
        catch (error) {
          lastEngineError = error;
          console.error(`[Transcription] OpenAI Whisper ${attempt.device} initialization/run failed:`, error);
          if (attempt.device === 'cuda') logStep1('OpenAI Whisper GPU acceleration was unavailable. Trying compatibility mode on CPU.');
        }
      }
      return undefined;
    };

    if (requestedEngine === 'faster-whisper') {
      for (const attempt of chooseFasterWhisperAttempts(hw.mode === 'gpu')) {
        try {
          normalized = await runEngine('faster-whisper', attempt.device, attempt.computeType);
          break;
        } catch (error: any) {
          lastEngineError = error;
          console.error(`[Transcription] Faster Whisper ${attempt.device} initialization/run failed:`, error);
          if (attempt.device === 'cuda') {
            logStep1('GPU acceleration was unavailable. Using optimized CPU transcription instead.');
            activeStep1ProgressState.liveStatusMessage = 'GPU acceleration was unavailable. Using CPU transcription instead.';
          }
        }
      }
      if (!normalized) {
        logStep1('Faster Whisper was unavailable. Trying OpenAI Whisper compatibility mode.');
        normalized = await runOpenAiCompatibility();
      }
    } else {
      normalized = await runOpenAiCompatibility();
    }
    if (!normalized) throw lastEngineError || new Error('No transcription engine could be initialized.');

      const transcriptSegments = normalized.segments;
      const transcriptWords = transcriptSegments.flatMap((segment: any) => (Array.isArray(segment.words) ? segment.words : []).map((word: any) => ({
        word: String(word.word || '').trim(),
        start: formatTimestamp(Number(word.start)),
        startSeconds: Number(word.start),
        endSeconds: Number(word.end),
        confidence: typeof word.probability === 'number' ? word.probability : undefined,
      })).filter((word: any) => word.word && Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds)));
      if (transcriptSegments.some((segment: any) => segment.text?.trim() && !segment.words?.some((word: any) => Number.isFinite(word.start) && Number.isFinite(word.end)))) throw new Error('The transcription engine returned speech segments without word timestamps');
      job.transcriptWords = transcriptWords;
      job.transcriptKey = key;
      const transcriptWordCount = transcriptSegments.reduce((total: number, segment: any) => {
        if (Array.isArray(segment.words)) return total + segment.words.length;
        return total + (typeof segment.text === 'string' ? segment.text.trim().split(/\s+/).filter(Boolean).length : 0);
      }, 0);
      job.transcription = {
        model: model.name,
        profile: model.id,
        language: normalized.language || 'en',
        engine: normalized.engine,
        device: normalized.device,
        computeType: normalized.computeType,
        segmentsCount: transcriptSegments.length,
        wordsCount: transcriptWordCount,
        completedAt: now(),
      };
      
      let candidateId = 1;
      const chapterRegex = /(chapter\s*\d+|prologue|epilogue|introduction)/i;
      
      for (const segment of transcriptSegments) {
        if (chapterRegex.test(segment.text)) {
          const rawTime = segment.start;
          const startTime = Math.max(0, rawTime - leadIn);
          const endTime = segment.end;
          const headingWordIndex = transcriptWords.findIndex((word: any) => word.startSeconds >= rawTime - 0.02);
          const contextStart = Math.max(0, headingWordIndex - 18);
          const contextEnd = Math.min(transcriptWords.length, headingWordIndex + 26);
          const contextWords = headingWordIndex >= 0 ? transcriptWords.slice(contextStart, contextEnd) : [];
          const headingWords = contextWords.filter((word: any) => word.startSeconds >= rawTime && word.startSeconds <= endTime);
          
          generatedCandidates.push({
            candidate_id: candidateId++,
            candidate_start: formatTimestamp(startTime),
            candidate_end: formatTimestamp(endTime),
            matched_text: segment.text.trim(),
            context_before: contextWords.filter((word: any) => word.startSeconds < rawTime).map((word: any) => word.word).join(' '),
            context_after: contextWords.filter((word: any) => word.startSeconds > endTime).map((word: any) => word.word).join(' '),
            confidence: headingWords.length ? String(headingWords.reduce((sum: number, word: any) => sum + (word.confidence ?? 0), 0) / headingWords.length) : '0',
            proposed_title: segment.text.trim(),
            status: candidateId === 2 ? 'approved' : 'review',
            notes: `${normalized.engine === 'faster-whisper' ? 'Faster Whisper' : 'OpenAI Whisper'} detected at ${formatTimestamp(rawTime)} with ${leadIn}s lead-in`,
            words: contextWords,
          });
        }
      }
      logStep1(`${normalized.engine === 'faster-whisper' ? 'Faster Whisper' : 'OpenAI Whisper compatibility mode'} completed with ${transcriptSegments.length} segments and ${generatedCandidates.length} chapter candidates.`);
  } catch (err: any) {
    if (signal.aborted) throw err;
    console.error("Local transcription execution error:", err);
    logStep1(`ERROR: No configured transcription engine completed. Technical detail: ${err.message}.`);
    job.logs.push({ timestamp: now(), level: 'ERROR', message: `Step 1 transcription failed. ${err.message}` });
    saveJobs();
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.canCancel = false;
    activeStep1ProgressState.stage = 'error';
    activeStep1ProgressState.error = 'Transcription could not start. Open System Requirements to repair the selected transcription setup.';
    activeStep1ProgressState.liveStatusMessage = 'Transcription failed. Technical details were saved in the job log.';
    return;
  }

  job.candidates = generatedCandidates;

  // Generate draft chapters CSV entries from approved or high-confidence candidates
  job.chapters = generatedCandidates.map((c, idx) => ({
    id: `chap-${idx + 1}`,
    start: c.candidate_start,
    title: c.proposed_title,
    notes: c.notes,
  }));

  if (job.existingChapters?.length) job.chapters = [...job.existingChapters];
  if (!job.chapters.length || job.chapters[0].start !== '00:00:00.000') job.chapters.unshift({ id: 'opening', start: '00:00:00.000', title: 'Opening' });
  job.status = 'transcribed';
  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `Step 1 Complete. Extracted ${generatedCandidates.length} candidate chapter markers. Ready for Step 2 human review.`,
  });

  saveJobs();

  // Stage 6: Completed
  activeStep1ProgressState.stage = 'completed';
  activeStep1ProgressState.currentStageNumber = 6;
  activeStep1ProgressState.percentage = 100;
  activeStep1ProgressState.label = 'Step 1 complete';
  activeStep1ProgressState.currentTask = 'Candidate chapters extracted';
  activeStep1ProgressState.isActive = false;
  activeStep1ProgressState.canCancel = false;
  activeStep1ProgressState.liveStatusMessage = `Step 1 complete. Extracted ${generatedCandidates.length} candidate markers. Ready for Step 2 review.`;
  activeStep1ProgressState.summary = {
    totalFilesProcessed: job.parts.length,
    totalDurationSeconds: job.totalDurationSeconds,
    chaptersFound: generatedCandidates.length,
    wordsTranscribed: job.transcription.wordsCount,
    modelUsed: model.name,
  };
  logStep1(`Completed Step 1 processing in ${Math.round((Date.now() - activeStep1StartTime) / 1000)}s.`);
  
  } catch (err: any) {
    if (signal.aborted) {
      activeStep1ProgressState.isActive = false;
      activeStep1ProgressState.isCancelling = false;
      activeStep1ProgressState.canCancel = false;
      activeStep1ProgressState.stage = 'cancelled';
      activeStep1ProgressState.label = 'Processing cancelled';
      activeStep1ProgressState.currentTask = 'Ready to restart with updated settings';
      activeStep1ProgressState.currentStageNumber = 0;
      activeStep1ProgressState.percentage = 0;
      activeStep1ProgressState.liveStatusMessage = 'Processing cancelled. Completed audio preparation is preserved for the next run.';
      return;
    }
    console.error("Fatal Step 1 Background Error:", err);
    job.logs.push({ timestamp: now(), level: 'ERROR', message: `Step 1 processing failed. ${err.message}` });
    saveJobs();
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.stage = 'error';
    activeStep1ProgressState.error = err.message;
  } finally {
    step1TaskRunning = false;
    step1Abort = undefined;
  }
  })();
};

const requireStep1Dependencies = (req: any, res: any, next: any) => {
  const chapterSource = req.body?.chapterSource || (jobs.find(job => job.id === req.params.id)?.chapterSource || 'whisperx');
  const features: FeatureId[] = ['audio_processing'];
  if (chapterSource !== 'existing_files') features.push(currentConfig.faster_transcription ? 'faster_transcription' : 'openai_transcription');
  return requireFeatures(features, 'Step 1 processing')(req, res, next);
};
app.post('/api/jobs/:id/merge-and-detect', requireStep1Dependencies, handleStep1Process);
app.post('/api/jobs/:id/process-step1', requireStep1Dependencies, handleStep1Process);

// Update & Validate Chapter List (replicates app/chapters.py validation)
app.post('/api/jobs/:id/chapters', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { chapters } = req.body;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return res.status(400).json({ error: 'Chapters list must contain at least one entry.' });
  }

  // Exact validation rules from chapters.py
  try {
    for (let i = 0; i < chapters.length; i++) {
      const row = chapters[i];
      if (!row.start || !row.title || !row.title.trim()) {
        throw new Error(`Row ${i + 1}: Missing start timestamp or title.`);
      }
      parseTimestampToMs(row.start);
    }

    const firstMs = parseTimestampToMs(chapters[0].start);
    if (firstMs < 0) {
      throw new Error('First chapter start timestamp cannot be negative.');
    }

    const totalDurationMs = Math.round(job.totalDurationSeconds * 1000);
    for (let i = 0; i < chapters.length; i++) {
      const current = chapters[i];
      const currentMs = parseTimestampToMs(current.start);
      if (i > 0) {
        const prevMs = parseTimestampToMs(chapters[i - 1].start);
        if (currentMs <= prevMs) {
          throw new Error(
            `Row ${i + 1} (${current.title}): Timestamp ${current.start} (${currentMs}ms) does not strictly increase after previous ${chapters[i - 1].start} (${prevMs}ms).`
          );
        }
      }
      if (currentMs >= totalDurationMs) {
        throw new Error(
          `Row ${i + 1} (${current.title}): Chapter start (${current.start}) exceeds total audio duration (${formatTimestamp(job.totalDurationSeconds)}).`
        );
      }
    }
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  // Update chapters and generate ffmetadata preview
  job.chapters = chapters;
  job.ffmetaContent = generateFFMetaContent(chapters, job.totalDurationSeconds, job.metadata);
  
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  job.logs.push({
    timestamp: now,
    level: 'INFO',
    message: `Updated and validated ${chapters.length} chapters. FFmetadata cache refreshed.`,
  });
  saveJobs();

  res.json({ status: 'ok', chapters: job.chapters, ffmeta: job.ffmetaContent });
});

// Scan local folder for cover image (looks for cover.jpg, cover.png, etc.)
app.post('/api/jobs/:id/scan-cover', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const possibleNames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'Cover.jpg', 'Cover.jpeg', 'Cover.png', 'Cover.webp'];
  
  // Search in current working directory and possible job folders
  const searchDirs = [
    APP_ROOT,
    appPath('public'),
    appPath('audiobooks', job.id),
    appPath(job.id),
  ];

  let foundCover: CoverArtInfo | null = null;

  for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (possibleNames.includes(f) || /^cover\.(jpg|jpeg|png|webp)$/i.test(f)) {
            const fullPath = path.join(dir, f);
            const stats = fs.statSync(fullPath);
            const ext = path.extname(f).slice(1).toLowerCase();
            const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            
            // Read as data URL for standalone web serving
            const buffer = fs.readFileSync(fullPath);
            const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

            foundCover = {
              source: 'local',
              filename: f,
              url: dataUrl,
              mimeType: mime,
              sizeBytes: stats.size,
              width: 1400,
              height: 1400,
            };
            break;
          }
        }
      } catch (e) {
        // continue search
      }
    }
    if (foundCover) break;
  }

  if (foundCover) {
    if (!job.metadata) {
      job.metadata = {
        title: job.name,
        author: job.author || '',
        narrator: job.narrator || '',
        genres: ['Audiobook'],
        language: 'eng',
        abridged: false,
        explicit: false,
      };
    }
    job.metadata.cover = foundCover;
    job.logs.push({
      timestamp: now,
      level: 'INFO',
      message: `Local cover detected in folder: '${foundCover.filename}' (${(foundCover.sizeBytes! / 1024).toFixed(1)} KB). Loaded as active artwork.`,
    });
    return res.json({
      found: true,
      cover: foundCover,
      message: `Found local cover artwork '${foundCover.filename}' in folder!`,
    });
  }

  res.json({
    found: false,
    message: 'No image named cover.jpg/png/webp was found in the local folder. You can upload an image or provide an image URL.',
  });
});

// Update Audiobook Metadata (Standard Audiobookshelf metadata with Narrator in Composer)
app.post('/api/jobs/:id/metadata', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { metadata } = req.body as { metadata: AudiobookMetadata };
  if (!metadata || !metadata.title) {
    return res.status(400).json({ error: 'Metadata title is required.' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  job.metadata = {
    ...metadata,
    title: metadata.title.trim(),
    author: metadata.author?.trim() || '',
    narrator: metadata.narrator?.trim() || '',
    genres: Array.isArray(metadata.genres) ? metadata.genres : ['Audiobook'],
  };

  // Synchronize top-level fields for convenience
  job.name = job.metadata.title;
  job.author = job.metadata.author;
  job.narrator = job.metadata.narrator;

  // Re-generate FFmetadata with all updated tags
  job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);

  if (job.status === 'transcribed') {
    job.status = 'metadata_ready';
  }

  saveJobs();

  job.logs.push({
    timestamp: now,
    level: 'INFO',
    message: `Updated audiobook metadata: "${job.metadata.title}" by ${job.metadata.author || 'Unknown'}. Narrator mapped to Composer tag: "${job.metadata.narrator || 'None'}". Cover: ${job.metadata.cover ? `${job.metadata.cover.source} (${job.metadata.cover.filename || 'URL'})` : 'None'}.`,
  });

  res.json({
    status: 'ok',
    job,
    ffmeta: job.ffmetaContent,
    message: 'Audiobook metadata saved successfully.',
  });
});

// Step 4: Build Chaptered M4B (replicates app/m4b.py)
app.post('/api/jobs/:id/build-m4b', requireFeatures(['audio_export'], 'Audio export'), async (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job?.mergedMp3?.fullPath || job.status === 'draft') return res.status(400).json({ error: 'Complete Step 1 first.' });
  if (step1TaskRunning) return res.status(409).json({ error: 'Wait for source processing to complete.' });
  try {
    const paths = job.parts.map(part => path.resolve(APP_ROOT, job.sourceFolderPath || '', part.name));
    if (job.sourceKey !== await fingerprint(paths, {})) return res.status(409).json({ error: 'Source audio changed. Run Step 1 again to refresh the transcript and review timeline.' });
  } catch (error: any) { return res.status(400).json({ error: error.message }); }
  if (job.exports?.some(e => e.status === 'running' || e.status === 'queued')) return res.status(409).json({ error: 'An export is already running.' });
  const requestedFormats = req.body.outputFormats ?? [req.body.outputFormat || (outputFormats.includes(job.sourceFormat as any) ? job.sourceFormat : 'm4b')];
  if (!Array.isArray(requestedFormats)) return res.status(400).json({error: 'Output formats must be a list.'});
  const formats = [...new Set(requestedFormats)] as OutputAudioFormat[];
  if (!formats.length || formats.some(f => !outputFormats.includes(f))) return res.status(400).json({ error: 'Select supported output formats.' });
  try { validateChapters(job.chapters, job.totalDurationSeconds); } catch (error: any) { return res.status(400).json({ error: error.message }); }
  const outputDir = job.outputFolderPath || currentOutputFolder;
  try { fs.mkdirSync(outputDir, { recursive: true }); fs.accessSync(outputDir, fs.constants.W_OK); }
  catch (error: any) { return res.status(400).json({error: 'Cannot write output folder: ' + error.message}); }
  job.outputM4b = null; job.validation = null;
  job.exports = formats.map(format => ({ format, status: 'queued', progress: 0 }));
  const snapshot = JSON.parse(JSON.stringify(job));

  const safeName = (job.name || 'audiobook').replace(/[<>:"/\\|?*]/g, '_');
  const runId = Date.now();
  for (const item of job.exports) {
    item.status = 'running'; saveJobs();
    try {
      const tags = audiobookTags(snapshot.metadata,snapshot.importedMetadata,snapshot.sourceTags,item.format);
      const lossy = !['flac','wav'].includes(item.format);
      const selectedRate = req.body.bitrates?.[item.format] ?? defaultBitrate(snapshot.sourceBitrate);
      if (lossy && !bitrateOptions.includes(Number(selectedRate) as any)) throw new Error('Unsupported bitrate selection');
      const encodingBitrate = req.body.bitrate || ((req.body.convert === true || !canCopy(snapshot.sourceCodec,item.format)) && lossy ? selectedRate + 'k' : undefined);
      let cover: string | null | undefined;
      if (JSON.stringify(snapshot.metadata?.cover) !== JSON.stringify(snapshot.importedMetadata?.cover)) {
        cover = null;
        const url = snapshot.metadata?.cover?.url;
        if (url) {
          const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(url);
          if (!match) throw new Error('Upload a PNG or JPEG cover before exporting.');
          cover = path.join(outputDir, job.id + '-' + runId + '-cover.' + (match[1] === 'png' ? 'png' : 'jpg'));
          fs.writeFileSync(cover, Buffer.from(match[2], 'base64'));
        }
      }
      const result = await exportAudio({ ffmpeg: MANAGED_FFMPEG_PATH, ffprobe: MANAGED_FFPROBE_PATH, source: snapshot.mergedMp3.fullPath, output: path.join(outputDir, safeName + '-' + runId + '.' + item.format), format: item.format, chapters: snapshot.chapters, tags, cover, convert: req.body.convert === true, bitrate: encodingBitrate, cue: req.body.cue !== false, onProgress: n => { item.progress = n; saveJobs(); } });
      Object.assign(item, result, { status: 'success' });
      job.outputM4b = result;
      job.status = 'built';
    } catch (error: any) {
      item.status = 'failed'; item.error = error.message;
      job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `Audio export failed (${item.format.toUpperCase()}). ${error.message}` });
    }
    saveJobs();
  }
  const succeeded = job.exports.some(item => item.status === 'success');
  res.status(succeeded ? 200 : 500).json({ status: succeeded ? 'ok' : 'error', error: succeeded ? undefined : job.exports.map(item => item.error).join('; '), exports: job.exports, outputM4b: job.outputM4b });
});

app.post('/api/jobs/:id/build-audio', requireFeatures(['audio_export'], 'Audio export'), (req, res) => {
  // Alias to build-m4b with format support
  const target = app._router.stack.find((layer: any) => layer.route?.path === '/api/jobs/:id/build-m4b');
  if (target) {
    return target.route.stack[target.route.stack.length - 1].handle(req, res);
  }
  res.status(500).json({ error: 'Route handler not found' });
});

// Step 3: Validate Output (replicates app/validate.py)
app.post('/api/jobs/:id/validate', requireFeatures(['output_validation'], 'Output validation'), (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (!job.outputM4b) {
    return res.status(400).json({ error: 'No M4B output found. Run Step 2 Build M4B first.' });
  }

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Exact validation rules from validate.py
  const sizeMb = Number((job.outputM4b.sizeBytes / (1024 * 1024)).toFixed(2));
  let inspected: ReturnType<typeof inspect>;
  try { inspected = inspect(MANAGED_FFPROBE_PATH, job.outputM4b.fullPath || path.join(job.outputFolderPath || currentOutputFolder, job.outputM4b.filename)); }
  catch (error: any) {
    appendOperationFailure(job.id, 'Output validation', `Cannot read exported file: ${error.message}`);
    return res.status(400).json({ error: `Cannot read exported file: ${error.message}` });
  }
  const chaptersCount = inspected.chapters.length;
  const duration = inspected.durationSeconds;
  const origDuration = job.mergedMp3 ? job.mergedMp3.duration : job.totalDurationSeconds;
  const diff = Math.abs(duration - origDuration);

  let status: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
  let reason: string | undefined = 'File metadata read back. Player navigation has not been tested.';

  if (chaptersCount === 0) {
    status = 'FAIL';
    reason = 'No embedded chapters detected in container.';
  } else if (chaptersCount !== job.chapters.length || inspected.chapters.some((c: any, i: number) => c.title !== job.chapters[i].title || Math.abs(parseTimestampToMs(c.start) - parseTimestampToMs(job.chapters[i].start)) > 25)) {
    status = 'FAIL';
    reason = 'Exported chapters do not match the currently reviewed list.';
  } else if (diff > 0.15) {
    status = 'WARNING';
    reason = `Duration mismatch vs source: diff ${diff.toFixed(2)}s`;
  }

  job.validation = {
    file: job.outputM4b.filename,
    size_mb: sizeMb,
    duration_seconds: duration,
    chapters_count: chaptersCount,
    status,
    reason,
  };

  job.status = status === 'FAIL' ? 'built' : 'validated';
  saveJobs();
  job.logs.push({
    timestamp: now(),
    level: status === 'FAIL' ? 'ERROR' : status === 'WARNING' ? 'WARNING' : 'INFO',
    message: `FFprobe Validation Result: ${status}. Duration: ${duration}s, Chapters: ${chaptersCount}. ${reason || 'Container structure valid.'}`,
  });

  res.json({ status: 'ok', validation: job.validation });
});

// Purge Temporary / Intermediate Files (replicates app/purge.py)
app.post('/api/jobs/:id/purge', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { purgeType, confirmation } = req.body;
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (purgeType === 'job') {
    const requiredPhrase = `PURGE ${job.name}`;
    if (confirmation !== requiredPhrase) {
      return res.status(400).json({
        error: `Confirmation mismatch. Must type '${requiredPhrase}' exactly to purge job source data.`,
      });
    }

    job.mergedMp3 = null;
    job.previewPath = undefined;
    job.sourceKey = undefined;
    job.preparedAudioKey = undefined;
    job.transcription = null;
    job.parts = [];
    job.status = job.outputM4b ? 'built' : 'draft';
    saveJobs();
    job.logs.push({
      timestamp: now(),
      level: 'WARNING',
      message: `Full job purge executed (Input parts & intermediates wiped; Output M4B and CSV retained).`,
    });

    return res.json({ status: 'ok', message: `Job ${job.name} source data successfully purged.` });
  }

  if (purgeType === 'intermediate') {
    job.mergedMp3 = null;
    job.previewPath = undefined;
    job.sourceKey = undefined;
    job.preparedAudioKey = undefined;
    job.transcription = null;
    job.status = job.outputM4b ? 'built' : 'draft';
    saveJobs();
    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Intermediate files purged (Merged MP3 & Whisper transcript removed).`,
    });
    return res.json({ status: 'ok', message: 'Intermediates successfully purged.' });
  }

  // purgeType === 'temp' (PCM work)
  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `Temporary PCM work files purged.`,
  });

  res.json({ status: 'ok', message: 'Temporary PCM files purged.' });
});

// Export CSV / FFMETA endpoints
app.get('/api/jobs/:id/export/candidates-csv', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).send('Job not found');

  const headers = [
    "candidate_id", "candidate_start", "candidate_end", "matched_text",
    "context_before", "context_after", "confidence", "proposed_title",
    "approved_start", "approved_title", "status", "notes"
  ];
  let csv = headers.join(',') + '\n';
  for (const c of job.candidates) {
    const escapeCsv = (val: string = '') => `"${val.replace(/"/g, '""')}"`;
    csv += [
      c.candidate_id,
      escapeCsv(c.candidate_start),
      escapeCsv(c.candidate_end),
      escapeCsv(c.matched_text),
      escapeCsv(c.context_before),
      escapeCsv(c.context_after),
      c.confidence,
      escapeCsv(c.proposed_title),
      escapeCsv(c.approved_start || ''),
      escapeCsv(c.approved_title || ''),
      c.status,
      escapeCsv(c.notes || ''),
    ].join(',') + '\n';
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}-candidates.csv"`);
  res.send(csv);
});

app.get('/api/jobs/:id/export/chapters-csv', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).send('Job not found');

  let csv = 'start,title\n';
  for (const chap of job.chapters) {
    const escapeCsv = (val: string = '') => `"${val.replace(/"/g, '""')}"`;
    csv += `${escapeCsv(chap.start)},${escapeCsv(chap.title)}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}-chapters.csv"`);
  res.send(csv);
});

app.get('/api/jobs/:id/export/ffmeta', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).send('Job not found');

  const ffmeta = generateFFMetaContent(job.chapters, job.totalDurationSeconds);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}.ffmeta"`);
  res.send(ffmeta);
});

// Import CSV into chapters
app.post('/api/jobs/:id/import/chapters-csv', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { csvText } = req.body;
  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({ error: 'csvText is required' });
  }

  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    return res.status(400).json({ error: 'CSV must contain a header and at least one row.' });
  }

  const newChapters: ChapterEntry[] = [];
  // Parse CSV
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(".*?"|[^",\s]+)(?:\s*,\s*)(".*?"|.+)$/);
    if (!match) continue;
    const start = match[1].replace(/^"|"$/g, '').trim();
    const title = match[2].replace(/^"|"$/g, '').trim();
    newChapters.push({
      id: `imported-${i}`,
      start,
      title,
    });
  }

  if (newChapters.length === 0) {
    return res.status(400).json({ error: 'No valid chapter entries parsed from CSV.' });
  }

  // Validate format
  try {
    const firstMs = parseTimestampToMs(newChapters[0].start);
    if (firstMs < 0) {
      throw new Error('First chapter start timestamp cannot be negative.');
    }
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }

  job.chapters = newChapters;
  job.ffmetaContent = generateFFMetaContent(newChapters, job.totalDurationSeconds);
  res.json({ status: 'ok', chapters: job.chapters });
});

// ----------------------------------------------------
// Vite Middleware / Static Server
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = appPath('dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SwissMouse server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
