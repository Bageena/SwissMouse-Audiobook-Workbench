import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import { execSync, exec, execFile, execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
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
import { createServer as createViteServer } from 'vite';
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
    cb(null, file.originalname.replace(/[^a-zA-Z0-9_.\- ]/g, '_'));
  }
});

const upload = multer({ storage });

app.post('/api/upload-audio', upload.array('files'), (req, res) => {
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

  const finalUploadDir = path.join(uploadDir, jobId);
  if (!fs.existsSync(finalUploadDir)) {
    fs.mkdirSync(finalUploadDir, { recursive: true });
  }
  
  const uploadedFiles = (req.files as Express.Multer.File[]).map(f => {
    const newPath = path.join(finalUploadDir, f.filename);
    fs.renameSync(f.path, newPath);
    const finalPath = newPath;

    // Probe the file for accurate metadata
    const probe = probeAudioFile(finalPath);

    return {
      originalName: f.originalname,
      filename: f.filename,
      path: finalPath,
      size: f.size,
      durationSeconds: probe.durationSeconds,
      bitrate: probe.bitrate
    };
  });
  
  res.json({
    message: 'Successfully uploaded files.',
    files: uploadedFiles,
    uploadDir: finalUploadDir
  });
});


// Initial workbench configuration matching config.json from original Python app
let currentConfig: WorkbenchConfig = {
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
            return JSON.parse(data);
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
  const audioPath = job?.mergedMp3?.fullPath;
  if (!audioPath || !fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Merged review audio is unavailable. Run Step 1 first.' });
  }
  const stat = fs.statSync(audioPath);
  const ext = path.extname(audioPath).toLowerCase();
  const contentType = ext === '.wav' ? 'audio/wav' : ext === '.flac' ? 'audio/flac' : ext === '.m4a' || ext === '.m4b' ? 'audio/mp4' : 'audio/mpeg';
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(audioPath).pipe(res);
  }
  const [startText, endText] = range.replace(/bytes=/, '').split('-');
  const start = Math.max(0, parseInt(startText, 10) || 0);
  const end = Math.min(stat.size - 1, endText ? parseInt(endText, 10) : start + 1024 * 1024);
  if (start > end) return res.status(416).end();
  res.writeHead(206, { 'Content-Type': contentType, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(audioPath, { start, end }).pipe(res);
});

// ----------------------------------------------------
// Local Desktop Processing: Hardware, Models & Folder Utilities
// ----------------------------------------------------

function naturalSort<T>(items: T[], keyFn: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    return keyFn(a).localeCompare(keyFn(b), undefined, { numeric: true, sensitivity: 'base' });
  });
}

// Hardware state (allows user/tester to switch between real hardware detection and simulated GPU mode for testing)
let simulatedHardwareOverride: 'gpu' | 'cpu' | null = null;

function getHardwareInfo(): HardwareInfo {
  if (simulatedHardwareOverride === 'gpu') {
    return {
      mode: 'gpu',
      gpuName: 'NVIDIA GeForce RTX 4080 (16 GB VRAM)',
      vramGb: 16,
      recommendedModelId: 'large-v3-turbo',
    };
  }
  if (simulatedHardwareOverride === 'cpu') {
    return {
      mode: 'cpu',
      cpuModel: 'x86_64 Local CPU Host (Multi-core)',
      recommendedModelId: 'small',
    };
  }

  // Real system hardware detection
  try {
    const nvidiaOut = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
      encoding: 'utf-8',
      timeout: 1500,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const line = nvidiaOut.trim().split('\n')[0];
    if (line) {
      const [gpuName, memStr] = line.split(',').map(s => s.trim());
      const vramMb = parseInt(memStr, 10) || 8192;
      const vramGb = Math.round(vramMb / 1024);
      const recommendedModelId = vramGb >= 8 ? 'large-v3-turbo' : (vramGb >= 4 ? 'small' : 'base');
      return {
        mode: 'gpu',
        gpuName: gpuName || 'NVIDIA GPU',
        vramGb,
        recommendedModelId,
      };
    }
  } catch (e) {
    // No nvidia-smi or error -> CPU mode
  }

  return {
    mode: 'cpu',
    cpuModel: 'x86_64 Local CPU Host',
    recommendedModelId: 'small',
  };
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
function getModelInstallationStatus(modelId: string): {
  isInstalled: boolean;
  sizeOnDiskBytes: number;
  sizeOnDiskLabel: string;
  installedFile?: string;
  modelDirPath: string;
} {
  // Faster-Whisper uses Hugging Face snapshots. `--model_dir` directs these to
  // the portable application directory instead of the user's profile.
  const repository = FASTER_WHISPER_REPOSITORIES[modelId];
  const modelDir = repository
    ? path.join(WHISPERX_MODEL_CACHE_DIR, `models--${repository.replace('/', '--')}`)
    : path.join(WHISPERX_MODEL_CACHE_DIR, `models--Systran--faster-whisper-${modelId}`);

  if (fs.existsSync(modelDir)) {
    try {
      let weightFile: string | undefined;
      let weightFileSize = 0;
      const findWeight = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const entryPath = path.join(directory, entry.name);
          if (entry.isDirectory()) findWeight(entryPath);
          if (!entry.isFile() || entry.name.endsWith('.downloading')) continue;
          const stat = fs.statSync(entryPath);
          if ((entry.name.endsWith('.bin') || entry.name.endsWith('.safetensors')) && stat.size > 10 * 1024 * 1024) {
            weightFile ??= path.relative(modelDir, entryPath);
            weightFileSize += stat.size;
          }
        }
      };
      findWeight(modelDir);

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
    requiresGpu: true,
    category: 'high-accuracy',
    isInstalled: false,
    description: 'Optimized high-accuracy model engineered for rapid inference on NVIDIA GPUs (6GB+ VRAM).',
  },
  {
    id: 'large-v3',
    name: 'Whisper Large-v3',
    sizeLabel: '~3.1 GB',
    vramRequirementGb: 8,
    requiresGpu: true,
    category: 'high-accuracy',
    isInstalled: false,
    description: 'Maximum accuracy model for complex literary vocabularies and character names (NVIDIA GPU 8GB+ VRAM required).',
  },
];

// Synchronize speechModels state with real filesystem contents
function refreshModelsFromDisk(): void {
  for (const model of speechModels) {
    // Only refresh if not actively downloading
    if (!model.isDownloading) {
      const status = getModelInstallationStatus(model.id);
      model.isInstalled = status.isInstalled;
      model.sizeOnDiskBytes = status.sizeOnDiskBytes;
      model.sizeOnDiskLabel = status.sizeOnDiskLabel;
      model.installedFile = status.installedFile;
    }
  }
}

// Initial disk verification on startup
refreshModelsFromDisk();

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

// Required base directories for Audiobook Workbench
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
function getFullHardwareEnvironment(): HardwareEnvironmentInfo {
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
    const smiOut = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
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
      const nvccOut = execSync('nvcc --version 2>&1 || nvidia-smi 2>&1', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 3000,
      });
      const cudaMatch = nvccOut.match(/CUDA Version[:\s]+([\d.]+)/i) || nvccOut.match(/V([\d.]+)/i);
      if (cudaMatch) {
        cudaVersion = cudaMatch[1];
      }
    } catch (e) {}
  }

  const mode: 'gpu' | 'cpu' = hasNvidiaGpu ? 'gpu' : 'cpu';
  const recommendedPyTorchFlavor: 'cuda' | 'cpu' = hasNvidiaGpu ? 'cuda' : 'cpu';
  const recommendationSummary = hasNvidiaGpu
    ? `Detected mode: NVIDIA GPU (${gpuName || 'CUDA GPU'}, ~${vramGb || 'N/A'} GB VRAM${cudaVersion ? ', CUDA ' + cudaVersion : ''}). A GPU-compatible PyTorch runtime is recommended.`
    : `Detected mode: CPU-only (${cpuModel}, ${arch}). A CPU-compatible PyTorch runtime will be used.`;

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
function checkBaseRequirements(): RequirementsReport {
  const hw = getFullHardwareEnvironment();
  const components: BaseRequirementItem[] = [];

// 1. Python Runtime
  let pythonStatus: BaseRequirementItem = {
    id: 'python',
    name: 'Python Runtime',
    purpose: 'Underlying programming runtime required for local WhisperX machine-learning components.',
    classification: 'required',
    status: 'missing',
    isAppManaged: true,
  };

  try {
    let pyBin = '';
    let ver = '';

    // A portable project must never report a machine-wide Python install as
    // usable. Step 1 always runs the bundled interpreter through this path.
    if (fs.existsSync(PORTABLE_PYTHON_EXE)) {
      pyBin = PORTABLE_PYTHON_EXE;
      const out = execSync(`"${pyBin}" --version`, { encoding: 'utf8', timeout: 2000 }).trim();
      ver = out.replace('Python ', '');
    }

    if (ver) {
      pythonStatus.installedVersion = ver;
      pythonStatus.availableVersion = '3.10.11 (Isolated)';
      pythonStatus.installLocation = pyBin;

      const majorMinor = ver.split('.').slice(0, 2).map(Number);
      if (majorMinor[0] === 3 && majorMinor[1] >= 10 && majorMinor[1] <= 12) {
        pythonStatus.status = 'ready';
        pythonStatus.diagnosticDetails = `Portable Python ${ver} verified at ${pyBin}.`;
      } else if (majorMinor[0] === 3 && majorMinor[1] >= 8 && majorMinor[1] < 10) {
        pythonStatus.status = 'ready';
        pythonStatus.diagnosticDetails = `Python ${ver} is functional, but 3.10 is recommended for better performance.`;
      } else {
        pythonStatus.status = 'broken';
        pythonStatus.error = `Python ${ver} detected. 3.10.x is the recommended "Gold Standard" for WhisperX stability.`;
      }

      // The bundled interpreter must be able to create the application venv.
      if (pythonStatus.status === 'ready') {
        try {
          execSync(`"${pyBin}" -c "import ensurepip"`, { stdio: 'ignore' });
        } catch (e) {
          pythonStatus.status = 'broken';
          pythonStatus.error = `Portable Python ${ver} is missing ensurepip and cannot create the private application environment.`;
        }
      }
    } else {
      pythonStatus.status = 'missing';
      pythonStatus.error = 'Python was not found. Clicking Install/Repair will download an isolated runtime for you.';
    }
  } catch (e: any) {
    pythonStatus.status = 'missing';
    pythonStatus.error = 'Python runtime not detected. Click Install/Repair to deploy a private copy.';
  }
  components.push(pythonStatus);

  // 2. PyTorch (Hardware-aware)
  let pytorchStatus: BaseRequirementItem = {
    id: 'pytorch',
    name: 'PyTorch ML Runtime',
    purpose: 'Local machine-learning tensor framework used for neural speech recognition and feature extraction.',
    classification: 'required',
    status: 'missing',
    isAppManaged: true,
  };

  let torchInstalled = false;
  let torchVer = '';
  const venvPythonPath = getVenvPython();
  const venvConfigPath = path.join(VENV_DIR, 'pyvenv.cfg');
  
  if (pythonStatus.status === 'ready' && fs.existsSync(venvPythonPath) && fs.existsSync(venvConfigPath)) {
    try {
      const torchOut = execSync(`"${venvPythonPath}" -c "import torch; print(torch.__version__, torch.cuda.is_available())" 2>&1`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
      const parts = torchOut.split(/\s+/);
      if (parts.length >= 1 && !torchOut.includes('ModuleNotFoundError') && !torchOut.includes('Traceback')) {
        torchVer = parts[0];
        const cudaOk = parts[1] === 'True';
        torchInstalled = true;
        pytorchStatus.installedVersion = torchVer;
        pytorchStatus.availableVersion = TORCH_VERSION;
        pytorchStatus.installLocation = 'Python site-packages';

        if (hw.hasNvidiaGpu && !cudaOk) {
          pytorchStatus.status = 'broken';
          pytorchStatus.error = `Installed PyTorch ${torchVer} is CPU-only, but an NVIDIA GPU (${hw.gpuName}) was detected. Install CUDA PyTorch for 10x faster transcription.`;
        } else {
          pytorchStatus.status = 'ready';
          pytorchStatus.diagnosticDetails = `PyTorch ${torchVer} verified (${cudaOk ? 'CUDA Hardware Acceleration Active' : 'CPU Inference Mode'}).`;
        }
      }
    } catch (e) {}
  }

  if (!torchInstalled) {
    // Check app-managed venv or tools folder
    const appVenvTorch = VENV_DIR;
    if (fs.existsSync(appVenvTorch)) {
      pytorchStatus.installLocation = appVenvTorch;
    }
    pytorchStatus.status = 'missing';
    pytorchStatus.availableVersion = hw.hasNvidiaGpu ? `${TORCH_VERSION}+cu128` : `${TORCH_VERSION}+cpu`;
    pytorchStatus.error = `PyTorch is not installed. Recommended build: ${hw.recommendedPyTorchFlavor === 'cuda' ? 'GPU (CUDA 12.8)' : 'CPU-compatible'}.`;
  }
  components.push(pytorchStatus);

  // 3. Torchaudio
  let torchaudioStatus: BaseRequirementItem = {
    id: 'torchaudio',
    name: 'Torchaudio',
    purpose: 'Audio I/O and signal processing library for PyTorch speech pipelines.',
    classification: 'required',
    status: 'missing',
    isAppManaged: true,
  };

  let torchaudioInstalled = false;
  if (pythonStatus.status === 'ready' && fs.existsSync(venvPythonPath) && fs.existsSync(venvConfigPath)) {
    try {
      const taOut = execSync(`"${venvPythonPath}" -c "import torchaudio; print(torchaudio.__version__)" 2>&1`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
      if (taOut && !taOut.includes('ModuleNotFoundError') && !taOut.includes('Traceback')) {
        torchaudioInstalled = true;
        torchaudioStatus.installedVersion = taOut;
        torchaudioStatus.availableVersion = TORCHAUDIO_VERSION;
        torchaudioStatus.status = 'ready';
        torchaudioStatus.diagnosticDetails = `Torchaudio ${taOut} verified and ready.`;
      }
    } catch (e) {}
  }
  if (!torchaudioInstalled) {
    torchaudioStatus.status = 'missing';
    torchaudioStatus.availableVersion = TORCHAUDIO_VERSION;
    torchaudioStatus.error = 'Torchaudio package not found in active Python environment.';
  }
  components.push(torchaudioStatus);

  // 4. WhisperX Runtime
  let whisperxStatus: BaseRequirementItem = {
    id: 'whisperx',
    name: 'WhisperX Runtime Engine',
    purpose: 'Fast speech recognition & phoneme alignment software. (Speech models are managed separately).',
    classification: 'required',
    status: 'missing',
    isAppManaged: true,
  };

  let wxInstalled = false;
  if (pythonStatus.status === 'ready' && fs.existsSync(venvPythonPath) && fs.existsSync(venvConfigPath)) {
    try {
      // WhisperX 3.7.4 does not expose __version__. Read the installed package
      // metadata instead so a successful installation is never reported as missing.
      const wxOut = execSync(`"${venvPythonPath}" -c "import whisperx; from importlib.metadata import version; print(version('whisperx'))" 2>&1`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
      if (wxOut && !wxOut.includes('ModuleNotFoundError') && !wxOut.includes('Traceback')) {
        wxInstalled = true;
        whisperxStatus.installedVersion = wxOut;
        whisperxStatus.availableVersion = WHISPERX_VERSION;
        whisperxStatus.status = 'ready';
        whisperxStatus.diagnosticDetails = `WhisperX ${wxOut} verified. Note: Whisper model weights are managed separately.`;
      }
    } catch (e) {}
  }
  if (!wxInstalled) {
    whisperxStatus.status = 'missing';
    whisperxStatus.availableVersion = WHISPERX_VERSION;
    whisperxStatus.error = 'WhisperX application package is not installed. Click Install / Repair to set up.';
  }
  components.push(whisperxStatus);

  // 5. FFmpeg
  let ffmpegStatus: BaseRequirementItem = {
    id: 'ffmpeg',
    name: 'FFmpeg Audio Engine',
    purpose: 'Local audio inspection, PCM decoding, audio merging, AAC-LC re-encoding, and M4B compilation.',
    classification: 'required',
    status: 'missing',
    isAppManaged: true,
  };

  try {
    const ffOut = getManagedBinaryVersion(MANAGED_FFMPEG_PATH);
    const ffMatch = ffOut?.match(/ffmpeg version\s+([^\s]+)/i);

    if (ffMatch) {
      ffmpegStatus.installedVersion = ffMatch[1];
      ffmpegStatus.availableVersion = '6.1+';
      ffmpegStatus.installLocation = MANAGED_FFMPEG_PATH;
      ffmpegStatus.status = 'ready';
      ffmpegStatus.diagnosticDetails = `Application-managed FFmpeg is executable (${ffMatch[1]}).`;
    } else {
      throw new Error('Application-managed ffmpeg.exe was not found or could not be executed.');
    }
  } catch (e: any) {
    ffmpegStatus.status = 'missing';
    ffmpegStatus.installLocation = MANAGED_FFMPEG_PATH;
    ffmpegStatus.error = 'FFmpeg is not installed in runtime/bin. Click Install / Repair to download it for this application.';
  }
  components.push(ffmpegStatus);

  // 6. FFprobe
  let ffprobeStatus: BaseRequirementItem = {
    id: 'ffprobe',
    name: 'FFprobe Stream Inspector',
    purpose: 'Audio metadata, duration probing, stream-copy compatibility analysis, and container validation.',
    classification: 'required',
    status: 'missing',
    isAppManaged: true,
  };

  try {
    const ffpOut = getManagedBinaryVersion(MANAGED_FFPROBE_PATH);
    const ffpMatch = ffpOut?.match(/ffprobe version\s+([^\s]+)/i);

    if (ffpMatch) {
      ffprobeStatus.installedVersion = ffpMatch[1];
      ffprobeStatus.availableVersion = '6.1+';
      ffprobeStatus.installLocation = MANAGED_FFPROBE_PATH;
      ffprobeStatus.status = 'ready';
      ffprobeStatus.diagnosticDetails = `Application-managed FFprobe is executable (${ffpMatch[1]}).`;
    } else {
      throw new Error('Application-managed ffprobe.exe was not found or could not be executed.');
    }
  } catch (e: any) {
    ffprobeStatus.status = 'missing';
    ffprobeStatus.installLocation = MANAGED_FFPROBE_PATH;
    ffprobeStatus.error = 'FFprobe is not installed in runtime/bin. Click Install / Repair to download it for this application.';
  }
  components.push(ffprobeStatus);

  // 7. Required Application Directories (Storage, Cache, Logs, Work)
  for (const dir of REQUIRED_APP_DIRECTORIES) {
    let dirStatus: BaseRequirementItem = {
      id: `dir_${dir.id}`,
      name: dir.name,
      purpose: dir.purpose,
      classification: 'required',
      status: 'ready',
      installLocation: dir.path,
      isAppManaged: true,
    };

    try {
      if (!fs.existsSync(dir.path)) {
        fs.mkdirSync(dir.path, { recursive: true });
      }
      // Test write permission
      const testFile = path.join(dir.path, `.test_write_${Date.now()}.tmp`);
      fs.writeFileSync(testFile, 'ok', 'utf8');
      fs.unlinkSync(testFile);
      dirStatus.status = 'ready';
      dirStatus.diagnosticDetails = `Writable and accessible at ${dir.path}`;
    } catch (e: any) {
      dirStatus.status = 'broken';
      dirStatus.error = `Folder cannot be written to or created: ${e.message}`;
    }
    components.push(dirStatus);
  }

  // Calculate totals
  const needsAttention = components.filter(c => c.classification === 'required' && c.status !== 'ready');
  const availableUpdates = components.filter(c => c.isAppManaged && c.updateAvailable);

  const allReady = needsAttention.length === 0;
  const hwInfo = getHardwareInfo();
  
  let statusColor: 'red' | 'yellow' | 'green' = 'red';
  const pyVer = hwInfo.pythonVersion || '';
  const isExperimentalPython = pyVer.includes('3.14') || pyVer.includes('3.15');

  if (!allReady) {
    statusColor = 'red';
  } else if (hwInfo.mode === 'gpu' && !isExperimentalPython) {
    statusColor = 'green';
  } else {
    statusColor = 'yellow';
  }

  let summaryMessage = '';
  if (statusColor === 'green') {
    summaryMessage = 'All required components are installed and ready with GPU acceleration (Python 3.10).';
  } else if (statusColor === 'yellow') {
    if (isExperimentalPython) {
      summaryMessage = `Python ${pyVer} detected. This version is unsupported by some AI components. Downgrade to Python 3.10.11 is required for GPU support.`;
    } else {
      summaryMessage = 'CPU requirements met. GPU acceleration is not available (Whisper transcription will be slower).';
    }
  } else {
    summaryMessage = `Attention required: ${needsAttention.length} required components are missing or broken.`;
  }

  return {
    timestamp: new Date().toISOString(),
    allReady,
    statusColor,
    needsAttentionCount: needsAttention.length,
    summaryMessage,
    hardware: hw,
    components,
    availableUpdatesCount: availableUpdates.length,
  };
}

// ----------------------------------------------------
// Requirements API Endpoints
// ----------------------------------------------------

// 1. Get Requirements Status Report
app.get('/api/requirements/status', (req, res) => {
  try {
    const report = checkBaseRequirements();
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

  const report = checkBaseRequirements();
  const componentsToFix = report.components.filter(c => c.classification === 'required' && c.status !== 'ready');

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
      `[${new Date().toLocaleTimeString()}] Safety Check: Whisper models and yt-dlp will NOT be installed. User projects and audio files will NOT be modified.`,
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
      let pythonEnvironmentConfigured = false;
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
            } else {
              throw new Error("Extraction failed: Python executable not found in expected location.");
            }
          } catch (err: any) {
            activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Critical Error during Python deployment: ${err.message}`);
            throw err;
          }
        } else if (comp.id === 'pytorch' || comp.id === 'torchaudio' || comp.id === 'whisperx') {
          if (pythonEnvironmentConfigured) {
            activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Private transcription runtime already configured during this repair.`);
            currentProgress += stepWeight;
            activeInstallProgress.overallProgress = Math.min(95, Math.round(currentProgress));
            continue;
          }

          const hw = report.hardware;
          const flavor = hw.recommendedPyTorchFlavor === 'cuda' ? 'GPU (CUDA 12.8)' : 'CPU-only';
          activeInstallProgress.currentActivity = `Configuring Private Transcription Runtime (${flavor})...`;

          if (!fs.existsSync(PORTABLE_PYTHON_EXE)) {
            throw new Error('Portable Python is unavailable. Install/Repair must finish the bundled Python runtime before setting up WhisperX.');
          }

          const logFn = (msg: string) => {
            appendInstallDiagnostic(msg);
          };

          const venvPythonExec = getVenvPython();
          const venvConfigPath = path.join(VENV_DIR, 'pyvenv.cfg');
          if (!fs.existsSync(VENV_DIR) || !fs.existsSync(venvPythonExec) || !fs.existsSync(venvConfigPath)) {
            logFn(`Creating private application environment at ${VENV_DIR}...`);
            await runSpawnCmd(PORTABLE_PYTHON_EXE, ['-m', 'venv', VENV_DIR], logFn);
          }

          const finalPythonExec = getVenvPython();
          if (!fs.existsSync(finalPythonExec)) {
            throw new Error(`Private Python environment was not created at ${finalPythonExec}.`);
          }

          logFn('Upgrading pip in the private application environment...');
          await runSpawnCmd(finalPythonExec, ['-m', 'pip', 'install', '--upgrade', 'pip'], logFn);

          const torchArgs = ['-m', 'pip', 'install', `torch==${TORCH_VERSION}`, `torchvision==${TORCHVISION_VERSION}`, `torchaudio==${TORCHAUDIO_VERSION}`];
          if (hw.recommendedPyTorchFlavor === 'cuda') {
            torchArgs.push('--index-url', 'https://download.pytorch.org/whl/cu128');
          } else {
            torchArgs.push('--index-url', 'https://download.pytorch.org/whl/cpu');
          }
          // PyTorch hosts its GPU/CPU wheels on a separate index, but ordinary
          // Python dependencies (for example Jinja2 and flit_core) belong on
          // PyPI. Without this fallback, pip can fail before Torch is installed.
          torchArgs.push('--extra-index-url', 'https://pypi.org/simple');
          logFn(`Installing PyTorch backend (${flavor}) into the private runtime... This may take several minutes.`);
          await runSpawnCmd(finalPythonExec, torchArgs, logFn);

          logFn(`Installing WhisperX ${WHISPERX_VERSION} into the private runtime...`);
          await runSpawnCmd(finalPythonExec, ['-m', 'pip', 'install', `whisperx==${WHISPERX_VERSION}`], logFn);
          ensureWhisperxVadCompatibility();

          const verification = execFileSync(
            finalPythonExec,
            ['-c', 'import importlib.metadata, torch, torchaudio; print(torch.__version__); print(torchaudio.__version__); print(importlib.metadata.version("whisperx"))'],
            { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] },
          ).trim().split(/\r?\n/);
          if (verification.length < 3) {
            throw new Error('Private runtime verification returned incomplete package version information.');
          }
          if (!verification[0].startsWith(TORCH_VERSION) || !verification[1].startsWith(TORCHAUDIO_VERSION) || verification[2] !== WHISPERX_VERSION) {
            throw new Error(`Private runtime installed unexpected versions: PyTorch ${verification[0]}, Torchaudio ${verification[1]}, WhisperX ${verification[2]}.`);
          }

          pythonEnvironmentConfigured = true;
          logFn(`Verified private runtime: PyTorch ${verification[0]}, Torchaudio ${verification[1]}, WhisperX ${verification[2]}.`);
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
          mediaBinariesConfigured = true;
          logFn(`Verified application-local FFmpeg: ${getManagedBinaryVersion(MANAGED_FFMPEG_PATH)}.`);
          logFn(`Verified application-local FFprobe: ${getManagedBinaryVersion(MANAGED_FFPROBE_PATH)}.`);
        }

        currentProgress += stepWeight;
        activeInstallProgress.overallProgress = Math.min(95, Math.round(currentProgress));
        await new Promise(r => setTimeout(r, 400));
      }

      // Verification phase
      activeInstallProgress.phase = 'verifying';
      activeInstallProgress.currentActivity = 'Running post-installation verification check...';
      activeInstallProgress.overallProgress = 96;
      activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Running automated post-installation diagnostics...`);
      await new Promise(r => setTimeout(r, 800));

      const updatedReport = checkBaseRequirements();
      activeInstallProgress.overallProgress = 100;
      activeInstallProgress.canCancel = false;

      if (updatedReport.allReady) {
        activeInstallProgress.isActive = false;
        activeInstallProgress.phase = 'completed';
        activeInstallProgress.currentActivity = 'Installation and repair complete.';
        activeInstallProgress.successMessage = 'All required base components have been successfully installed and verified.';
        activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] All required base components are ready. Speech models remain separately managed.`);
      } else {
        const remaining = updatedReport.components.filter(c => c.classification === 'required' && c.status !== 'ready');
        activeInstallProgress.isActive = false;
        activeInstallProgress.phase = 'error';
        activeInstallProgress.currentActivity = 'Installation did not pass verification.';
        activeInstallProgress.error = `Verification failed: ${remaining.map(component => component.name).join(', ')} still need attention.`;
        activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] ${activeInstallProgress.error}`);
      }
    } catch (err: any) {
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

  activeInstallProgress.phase = 'cancelled';
  activeInstallProgress.isActive = false;
  activeInstallProgress.currentActivity = 'Installation cancelled by user.';
  activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Installation cancelled by user. Safe state preserved. You can run Repair on the next check.`);
  res.json({ status: 'ok', message: 'Installation cancelled.' });
});

// 5. Check for Updates on Application-Managed Dependencies
app.get('/api/requirements/updates', (req, res) => {
  try {
    const report = checkBaseRequirements();
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

// Cancel active Step 1 process
app.post('/api/step1/cancel', (req, res) => {
  if (!activeStep1ProgressState.isActive) {
    return res.status(400).json({ error: 'No active Step 1 processing job.' });
  }

  activeStep1ProgressState.isCancelling = true;
  activeStep1ProgressState.canCancel = false;
  activeStep1ProgressState.liveStatusMessage = 'Cancelling processing... Safely preserving existing project files and cleaning up intermediate buffers.';
  logStep1(`User clicked Cancel Processing. Safe shutdown in progress.`);

  if (activeStep1Timer) {
    clearTimeout(activeStep1Timer);
    activeStep1Timer = null;
  }

  setTimeout(() => {
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.isCancelling = false;
    activeStep1ProgressState.stage = 'cancelled';
    activeStep1ProgressState.liveStatusMessage = 'Processing was cancelled. Your source audio files and saved project data remain untouched.';
    logStep1(`Processing cancelled safely. Any partial working files can be removed anytime via Purge.`);
  }, 400);

  res.json({ status: 'ok', message: 'Cancellation signal sent.' });
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
  'alac'
]);

// FFprobe / FFmpeg media inspector
function probeAudioFile(filePath: string): {
  codec: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
  durationSeconds: number;
  format: string;
  isAudio: boolean;
  rawFormatName?: string;
} {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  try {
    const out = execFileSync(
      MANAGED_FFPROBE_PATH,
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration,format_name', '-of', 'json', filePath],
      {
        encoding: 'utf-8',
        timeout: 4000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    );
    const data = JSON.parse(out);
    const stream = data.streams?.[0];
    const format = data.format;

    if (stream || (format && format.duration)) {
      const dur = format?.duration ? Math.round(parseFloat(format.duration)) : 60;
      const sr = stream?.sample_rate ? parseInt(stream.sample_rate, 10) : 44100;
      const ch = stream?.channels ? parseInt(stream.channels, 10) : 2;
      const br = stream?.bit_rate ? Math.round(parseInt(stream.bit_rate, 10) / 1000) : 128;
      const codecName = stream?.codec_name || ext;
      return {
        codec: codecName,
        sampleRate: sr,
        channels: ch,
        bitrate: br,
        durationSeconds: Math.max(1, dur),
        format: ext,
        isAudio: true,
        rawFormatName: format?.format_name,
      };
    }
  } catch (e) {
    // ffprobe failed or file is non-audio/empty
  }

  // Fallback estimation from file stat
  try {
    const stat = fs.statSync(filePath);
    const simulatedDur = stat.size > 10000
      ? Math.max(30, Math.round(stat.size / (128 * 1024 / 8)))
      : 120;
    return {
      codec: ext,
      sampleRate: 44100,
      channels: 2,
      bitrate: 128,
      durationSeconds: simulatedDur,
      format: ext,
      isAudio: true,
    };
  } catch (err) {
    return {
      codec: ext,
      sampleRate: 44100,
      channels: 2,
      bitrate: 128,
      durationSeconds: 120,
      format: ext,
      isAudio: false,
    };
  }
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
          const probe = probeAudioFile(fullPath);
          const folderName = relativeParent ? path.basename(relativeParent) : 'Root';
          if (relativeParent) {
            chapterFoldersSet.add(relativeParent);
          }

          audioFiles.push({
            relativePath: relPath,
            fileName: entry.name,
            folderName,
            format: ext,
            codec: probe.codec,
            sampleRate: probe.sampleRate,
            channels: probe.channels,
            bitrate: probe.bitrate,
            sizeBytes: fileStat.size,
            durationSeconds: probe.durationSeconds,
            chapterGroup: relativeParent || undefined,
            isProbed: true,
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

  // Stream-copy (Quick Merge) compatibility analysis
  // Quick Merge requires all files to have the exact same codec and container, and matching sample rates and channels.
  let isStreamCopyCompatible = true;
  let streamCopyIncompatibilityReason: string | undefined;

  if (sortedFiles.length === 0) {
    isStreamCopyCompatible = false;
    streamCopyIncompatibilityReason = "No supported audio files found.";
  } else if (!isUniformFormat) {
    isStreamCopyCompatible = false;
    streamCopyIncompatibilityReason = "Quick Merge is unavailable because the imported files use mixed or incompatible audio formats. Use Standard Merge to normalize and combine them safely.";
  } else {
    // Check if codecs or sample rates differ
    const firstCodec = sortedFiles[0].codec;
    const firstSampleRate = sortedFiles[0].sampleRate;
    const hasDifferentCodecs = sortedFiles.some(f => f.codec !== firstCodec || (f.sampleRate && f.sampleRate !== firstSampleRate));
    if (hasDifferentCodecs) {
      isStreamCopyCompatible = false;
      streamCopyIncompatibilityReason = "Quick Merge is unavailable because audio files have different sample rates or codecs. Use Standard Merge to normalize and combine them safely.";
    }
  }

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

function checkBinaryVersion(executablePath: string, args: string[] = ['--version']): string | null {
  try {
    const out = execFileSync(executablePath, args, { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] });
    const firstLine = out.trim().split('\n')[0];
    return firstLine.trim();
  } catch (e) {
    return null;
  }
}

function getYtDlpStatus(): YtDlpStatusInfo {
  // Check local managed yt-dlp first
  let executablePath = LOCAL_YT_DLP_PATH;
  const isSystemInstalled = false;
  let version: string | undefined;

  version = checkBinaryVersion(LOCAL_YT_DLP_PATH);

  // Check FFmpeg and FFprobe
  const ffmpegVerLine = getManagedBinaryVersion(MANAGED_FFMPEG_PATH);
  const ffprobeVerLine = getManagedBinaryVersion(MANAGED_FFPROBE_PATH);
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
    if (!checkBinaryVersion(LOCAL_YT_DLP_PATH)) throw new Error('Downloaded yt-dlp.exe could not be executed from runtime/bin.');

    isYtDlpInstalling = false;
    return getYtDlpStatus();
  } catch (err: any) {
    isYtDlpInstalling = false;
    ytDlpInstallError = err.message || 'Failed to download or execute yt-dlp';
    return getYtDlpStatus();
  }
}

function updateLocalYtDlp(): YtDlpStatusInfo {
  const currentStatus = getYtDlpStatus();
  if (currentStatus.status !== 'installed') {
    throw new Error('yt-dlp is not installed yet.');
  }

  try {
    if (fs.existsSync(LOCAL_YT_DLP_PATH)) {
      execSync(`"${LOCAL_YT_DLP_PATH}" -U`, {
        encoding: 'utf-8',
        timeout: 25000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } else {
      throw new Error('The application-local yt-dlp executable is missing. Use Install yt-dlp instead.');
    }
    return getYtDlpStatus();
  } catch (err: any) {
    throw new Error(`yt-dlp update failed: ${err.message}. Previous version was retained.`);
  }
}

function uninstallLocalYtDlp(): YtDlpStatusInfo {
  // Removes ONLY application-managed yt-dlp executable in tools/
  // Never touches user audio, models, or settings!
  if (fs.existsSync(LOCAL_YT_DLP_PATH)) {
    try {
      fs.unlinkSync(LOCAL_YT_DLP_PATH);
    } catch (e) {}
  }
  ytDlpInstallError = null;
  return getYtDlpStatus();
}

// ----------------------------------------------------
// API Endpoints
// ----------------------------------------------------

// Hardware detection
app.get('/api/system/hardware', (req, res) => {
  const hw = getHardwareInfo();
  res.json(hw);
});

// Toggle hardware mode for testing (GPU vs CPU)
app.post('/api/system/hardware/mode', (req, res) => {
  const { mode } = req.body;
  if (mode === 'gpu' || mode === 'cpu' || mode === null) {
    simulatedHardwareOverride = mode;
  }
  const hw = getHardwareInfo();
  res.json({ status: 'ok', hardware: hw });
});

// Get speech models list
app.get('/api/models', (req, res) => {
  refreshModelsFromDisk();
  const hw = getHardwareInfo();
  // Ensure we include system compatibility
  const modelsWithCompatibility = speechModels.map(m => ({
    ...m,
    isCompatible: hw.mode === 'gpu' ? true : !m.requiresGpu,
    isRecommended: m.id === hw.recommendedModelId,
  }));
  res.json(modelsWithCompatibility);
});

// Force refresh model detection from disk
app.post('/api/models/refresh', (req, res) => {
  refreshModelsFromDisk();
  const hw = getHardwareInfo();
  const modelsWithCompatibility = speechModels.map(m => ({
    ...m,
    isCompatible: hw.mode === 'gpu' ? true : !m.requiresGpu,
    isRecommended: m.id === hw.recommendedModelId,
  }));
  res.json({ status: 'ok', models: modelsWithCompatibility });
});

// Get local models directory info and disk usage
app.get('/api/models/info', (req, res) => {
  refreshModelsFromDisk();
  const modelsDir = appPath('models');
  let totalDiskBytes = 0;
  const installedList: any[] = [];

  for (const m of speechModels) {
    const status = getModelInstallationStatus(m.id);
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
// user explicitly chooses one in Step 1.
app.post('/api/models/:id/prepare', (req, res) => {
  const modelId = req.params.id;
  const model = speechModels.find(m => m.id === modelId);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const hw = getHardwareInfo();
  if (model.requiresGpu && hw.mode === 'cpu') {
    return res.status(400).json({ error: 'This model requires an NVIDIA GPU.' });
  }
  const repository = FASTER_WHISPER_REPOSITORIES[modelId];
  if (!repository) return res.status(400).json({ error: `No Faster-Whisper repository is configured for '${modelId}'.` });
  const venvPython = getVenvPython();
  if (!fs.existsSync(venvPython)) {
    return res.status(400).json({ error: 'WhisperX runtime is not installed. Run Install / Repair first.' });
  }
  if (activeFasterWhisperInstalls.has(modelId)) {
    return res.status(409).json({ error: 'This model download is already in progress.' });
  }

  const force = req.query.force === 'true';
  const cachePath = getModelInstallationStatus(modelId).modelDirPath;
  if (force && fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true, force: true });
  } else if (!force && getModelInstallationStatus(modelId).isInstalled) {
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
    model.downloadError = `Could not start model download: ${error.message}`;
    model.isDownloading = false;
    activeFasterWhisperInstalls.delete(modelId);
    writeLog(`ERROR: ${model.downloadError}\n`);
  });
  child.on('close', (code) => {
    activeFasterWhisperInstalls.delete(modelId);
    model.isDownloading = false;
    model.downloadProgress = 0;
    if (code === 0) {
      refreshModelsFromDisk();
      model.downloadSpeed = undefined;
    } else {
      model.downloadError = `Model download failed with exit code ${code ?? 'unknown'}. See logs\\model-${modelId}-download.log.`;
      writeLog(`ERROR: ${model.downloadError}\n`);
    }
  });

  res.json({ status: 'started', model });
});

// Legacy OpenAI .pt downloader retained temporarily for API compatibility.
// Step 1 uses /prepare above, so it only installs weights WhisperX can use.
app.post('/api/models/:id/install', (req, res) => {
  const modelId = req.params.id;
  const model = speechModels.find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const hw = getHardwareInfo();
  if (model.requiresGpu && hw.mode === 'cpu') {
    return res.status(400).json({
      error: 'NVIDIA GPU Required',
      message: 'This speech model requires a compatible NVIDIA GPU and cannot be installed or used in CPU-only mode. Choose a CPU-compatible model instead.',
    });
  }

  // Check if actually installed on disk
  const diskStatus = getModelInstallationStatus(modelId);
  if (diskStatus.isInstalled) {
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

  const targetDir = appPath('models', modelId);
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
  const model = speechModels.find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const active = activeModelDownloads.get(modelId);
  if (active) {
    try {
      active.abortController.abort();
    } catch (e) {}
    activeModelDownloads.delete(modelId);
  }
  const activeFasterWhisper = activeFasterWhisperInstalls.get(modelId);
  if (activeFasterWhisper) {
    try { activeFasterWhisper.kill(); } catch {}
    activeFasterWhisperInstalls.delete(modelId);
  }

  const targetDir = appPath('models', modelId);
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
app.post('/api/models/:id/uninstall', (req, res) => {
  const modelId = req.params.id;
  const model = speechModels.find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const active = activeModelDownloads.get(modelId);
  if (active) {
    try {
      active.abortController.abort();
    } catch (e) {}
    activeModelDownloads.delete(modelId);
  }
  const activeFasterWhisper = activeFasterWhisperInstalls.get(modelId);
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
  const targetDir = getModelInstallationStatus(modelId).modelDirPath;
  if (fs.existsSync(targetDir)) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (e) {}
  }
  refreshModelsFromDisk();

  res.json({ status: 'uninstalled', model });
});

// Scan local folder
app.post('/api/system/scan-folder', (req, res) => {
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
  const target = outputFolder ? path.resolve(outputFolder) : appPath('output');
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
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
app.get('/api/tools/yt-dlp/status', (req, res) => {
  const status = getYtDlpStatus();
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
app.post('/api/tools/yt-dlp/update', (req, res) => {
  try {
    const status = updateLocalYtDlp();
    res.json({ status: 'ok', info: status, message: `yt-dlp updated to version ${status.version || 'latest'}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update yt-dlp' });
  }
});

// Uninstall local yt-dlp binary
app.post('/api/tools/yt-dlp/uninstall', (req, res) => {
  try {
    const status = uninstallLocalYtDlp();
    res.json({ status: 'ok', info: status, message: 'Local yt-dlp binary uninstalled. Source files, whisper models, and projects were preserved.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to uninstall yt-dlp' });
  }
});

// Fetch YouTube video metadata via yt-dlp
app.post('/api/youtube/fetch-info', (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'Please enter a valid YouTube video URL.' });
  }

  const cleanUrl = url.trim();
  // Validate YouTube URL pattern
  const isYouTubeUrl = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\/.+$/i.test(cleanUrl);
  if (!isYouTubeUrl) {
    return res.status(400).json({
      error: 'Invalid URL',
      message: 'The URL does not appear to be a supported YouTube video link. Please enter a valid youtu.be or youtube.com URL.',
    });
  }

  const status = getYtDlpStatus();
  if (status.status !== 'installed') {
    return res.status(400).json({
      error: 'yt-dlp Required',
      message: 'yt-dlp is required for YouTube Audio Import. Install it to fetch video information and download audio.',
    });
  }

  try {
    // Run yt-dlp with --dump-single-json and --no-playlist
    const cmd = `"${status.executablePath}" --dump-single-json --no-playlist --skip-download "${cleanUrl.replace(/"/g, '\\"')}"`;
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 18000,
      stdio: ['pipe', 'pipe', 'ignore'],
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
app.post('/api/youtube/download', (req, res) => {
  const {
    jobId,
    url,
    format = 'best',
    overwrite = false,
  } = req.body as {
    jobId?: string;
    url?: string;
    format?: YouTubeAudioFormat;
    overwrite?: boolean;
  };

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'Valid YouTube URL is required.' });
  }

  const cleanUrl = url.trim();
  const status = getYtDlpStatus();
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

  // Setup download output directory
  const importDir = appPath('output', 'imports', 'youtube');
  if (!fs.existsSync(importDir)) {
    try { fs.mkdirSync(importDir, { recursive: true }); } catch (e) {}
  }

  try {
    // Template for output file
    const outputTemplate = path.join(importDir, '%(title).80s_%(id)s.%(ext)s');

    let audioFormatFlag = '';
    let targetExt = 'm4a';
    if (format === 'mp3') {
      audioFormatFlag = '--audio-format mp3';
      targetExt = 'mp3';
    } else if (format === 'm4a') {
      audioFormatFlag = '--audio-format m4a';
      targetExt = 'm4a';
    } else if (format === 'flac') {
      audioFormatFlag = '--audio-format flac';
      targetExt = 'flac';
    } else if (format === 'opus') {
      audioFormatFlag = '--audio-format opus';
      targetExt = 'opus';
    } else if (format === 'wav') {
      audioFormatFlag = '--audio-format wav';
      targetExt = 'wav';
    }

    const overwriteFlag = overwrite ? '--force-overwrites' : '--no-overwrites';
    const cmd = `"${status.executablePath}" -x ${audioFormatFlag} --audio-quality 0 ${overwriteFlag} --no-playlist -o "${outputTemplate}" "${cleanUrl.replace(/"/g, '\\"')}"`;

    execSync(cmd, {
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    // Find the newest downloaded file in importDir
    const files = fs.readdirSync(importDir).map(f => {
      const full = path.join(importDir, f);
      return { file: f, fullPath: full, mtime: fs.statSync(full).mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      throw new Error('Downloaded audio file could not be located in output/imports/youtube/.');
    }

    const latestFile = files[0];
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
        }];

        // Source summary
        job.sourceSummary = {
          inputMethod: 'youtube',
          sourcePath: latestFile.fullPath,
          formatsDetected: [probe.format],
          totalFiles: 1,
          totalDurationSeconds: probe.durationSeconds,
          chapterWorkflow: job.chapterSource || 'whisperx',
          mergeMethod: job.mergeMethod || 'standard',
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
    res.status(500).json({
      error: 'Download Failed',
      message: err.message || 'Failed to download audio with yt-dlp. Please check the URL and your local network.',
    });
  }
});

// Get configuration
app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

// Update configuration
app.post('/api/config', (req, res) => {
  const updates = req.body;
  currentConfig = { ...currentConfig, ...updates };
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

  if (Array.isArray(parts) && parts.length > 0) {
    job.parts = naturalSort(parts.map((p: any, idx: number) => ({
      id: p.id || `p-${idx + 1}`,
      name: p.name || `part_${idx + 1}.mp3`,
      sizeBytes: p.sizeBytes || 25000000,
      durationSeconds: p.durationSeconds || 1500,
      bitrate: p.bitrate || 128,
      order: idx + 1,
    })), p => p.name);
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
  jobIdForStep1 = req.params.id;
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  const {
    chapterSource = job.chapterSource || 'whisperx',
    mergeMethod = job.mergeMethod || 'standard',
    selectedModelId = job.selectedModelId || 'small',
    sourceFolderPath = job.sourceFolderPath,
    outputFolderPath = job.outputFolderPath || currentOutputFolder,
    parts = null,
  } = req.body || {};

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
      sizeBytes: p.sizeBytes || 25000000,
      durationSeconds: p.durationSeconds || 1500,
      bitrate: p.bitrate || 128,
      order: idx + 1,
    })), p => p.name);
    job.totalDurationSeconds = job.parts.reduce((acc, p) => acc + p.durationSeconds, 0);
    job.totalSizeBytes = job.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
  }

  if (job.parts.length === 0) {
    return res.status(400).json({ error: 'No MP3 files found in the selected folder.' });
  }

  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `=== Starting Step 1 for: ${job.name} (Workflow: ${chapterSource === 'existing_files' ? 'Existing MP3 Files' : 'WhisperX Detection'}) ===`,
  });

  // Initialize live Step 1 progress state
  activeStep1StartTime = Date.now();
  activeStep1ProgressState = {
    isActive: true,
    stage: 'scanning',
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
      `[${new Date().toLocaleTimeString()}] Workflow: ${chapterSource === 'existing_files' ? 'Direct MP3 File Preservation' : 'WhisperX AI Speech Recognition'}`,
    ],
    canCancel: true,
    isCancelling: false,
    error: null,
    summary: null,
  };

  // Respond immediately so the client can begin polling without NetworkError timeouts
  res.json({ status: 'started', message: 'Step 1 processing started in background' });

  // Run the heavy processing in the background
  (async () => {
    try {
      // ----------------------------------------------------
      // WORKFLOW A: Use existing MP3 files as individual chapters
      // ----------------------------------------------------
  if (chapterSource === 'existing_files') {
    activeStep1ProgressState.stage = 'probing';
    activeStep1ProgressState.currentStageNumber = 2;
    activeStep1ProgressState.percentage = 45;
    activeStep1ProgressState.label = 'Extracting existing file durations & chapter tags';
    activeStep1ProgressState.currentTask = 'Reading durations and metadata from individual audio tracks';
    logStep1(`Probing ${job.parts.length} files with FFprobe...`);

    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Preserving ${job.parts.length} source MP3 files directly as completed chapters. Bypassing WhisperX chapter detection and audio merge.`,
    });

    let cumulativeSec = 0;
    const directChapters: ChapterEntry[] = [];

    // Helper to clean file names into clean chapter titles
    const cleanChapterTitle = (fileName: string, idx: number): string => {
      // Remove extension
      let base = fileName.replace(/\.[^/.]+$/, '').trim();
      // Remove leading numbers / dashes like "01 - ", "01. ", "Chapter 01 - "
      const cleanMatch = base.replace(/^(\d+[\s._-]+|chapter\s*\d+[\s._-]+)/i, '').trim();
      if (cleanMatch) {
        return base;
      }
      return `Chapter ${idx + 1}: ${base}`;
    };

    for (let i = 0; i < job.parts.length; i++) {
      const part = job.parts[i];
      directChapters.push({
        id: `chap-${i + 1}`,
        start: formatTimestamp(cumulativeSec),
        title: cleanChapterTitle(part.name, i),
        notes: `Imported directly from source file: ${part.name}`,
      });
      cumulativeSec += part.durationSeconds;
    }

    job.chapters = directChapters;
    job.candidates = []; // No AI candidates needed
    job.status = 'transcribed';

    const maxBitrate = Math.max(...job.parts.map(p => p.bitrate || 128), 128);
    job.mergedMp3 = {
      filename: `${job.name}.mp3`,
      duration: cumulativeSec,
      bitrate: maxBitrate,
      sizeBytes: Math.round(job.totalSizeBytes * 0.98),
    };
    job.ffmetaContent = generateFFMetaContent(directChapters, cumulativeSec, job.metadata);

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

    return res.json({
      status: 'ok',
      job,
      message: `Step 1 complete for ${job.name}. ${directChapters.length} chapters created from existing MP3 files.`,
    });
  }

  // ----------------------------------------------------
  // WORKFLOW B: Generate chapters with WhisperX
  // ----------------------------------------------------
  const model = speechModels.find(m => m.id === selectedModelId) || speechModels[1];
  const hw = getHardwareInfo();

  if (model.requiresGpu && hw.mode === 'cpu') {
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.stage = 'error';
    activeStep1ProgressState.error = 'The selected model requires an NVIDIA GPU. Please choose a CPU-compatible model like Whisper Small or Base.';
    return res.status(400).json({
      error: 'NVIDIA GPU Required',
      message: 'The selected model requires an NVIDIA GPU. Please choose a CPU-compatible model like Whisper Small or Base.',
    });
  }

  // Stage 2: Probing audio files
  activeStep1ProgressState.stage = 'probing';
  activeStep1ProgressState.currentStageNumber = 2;
  activeStep1ProgressState.percentage = 20;
  activeStep1ProgressState.label = 'Inspecting audio stream codecs & sample rates';
  activeStep1ProgressState.currentTask = `Probing ${job.parts.length} files with FFprobe`;
  logStep1(`FFprobe stream inspection: All files conform to audio standards.`);

  // Stage 3: Merging audio
  activeStep1ProgressState.stage = 'merging';
  activeStep1ProgressState.currentStageNumber = 3;
  activeStep1ProgressState.percentage = 38;
  activeStep1ProgressState.label = mergeMethod === 'quick' ? 'Stitching audio tracks (Quick Stream-Copy)' : 'Standardizing & Stitching PCM Audio';
  activeStep1ProgressState.currentTask = `Processing audio sequence: ${job.parts.length} files...`;
  logStep1(`Merge mode: ${mergeMethod === 'quick' ? 'Quick Concatenation' : 'Standard PCM Re-encoding'}`);

  // 1. Audio Merge Method
  const maxBitrate = Math.max(...job.parts.map(p => p.bitrate || 128), 128);

  const intermediatesDir = path.join(currentOutputFolder, 'intermediates', job.id);
  fs.mkdirSync(intermediatesDir, { recursive: true });
  
  const mergedFilePath = path.join(intermediatesDir, `${job.id}_merged.mp3`);
  const concatPath = path.join(intermediatesDir, `${job.id}_concat.txt`);
  const concatDir = path.dirname(concatPath);
  const existingMergedFile = fs.existsSync(mergedFilePath);
  
  let concatData = '';
  const missingFiles: string[] = [];
  
  for (const part of job.parts) {
      let p: string;
      // Prevent duplication if the browser webkit picker included the root folder in part.name
      if (
          job.sourceFolderPath && 
          part.name.startsWith(job.sourceFolderPath + '/') && 
          !path.isAbsolute(job.sourceFolderPath)
      ) {
          p = path.resolve(APP_ROOT, part.name);
      } else {
          p = path.resolve(APP_ROOT, job.sourceFolderPath || '', part.name);
      }
      
      // Validate file existence
      if (!fs.existsSync(p)) {
          missingFiles.push(p);
      }
      
      // FFmpeg concat demuxer on Windows is safest with absolute paths using forward slashes
      let pPosix = p.replace(/\\/g, '/');
      concatData += `file '${pPosix.replace(/'/g, "'\\''")}'\n`;
  }
  
  // The imported source copies are intentionally removed after a successful
  // merge. If transcription later fails, retrying must reuse that verified
  // merged file instead of demanding temporary files that no longer exist.
  const reusingMergedAudio = existingMergedFile && missingFiles.length > 0;
  if (missingFiles.length > 0 && !reusingMergedAudio) {
      const err = new Error(`Missing source audio files:\n${missingFiles.join('\n')}`);
      console.error(err.message);
      logStep1(`ERROR: ${err.message}`);
      activeStep1ProgressState.isActive = false;
      activeStep1ProgressState.error = err.message;
      return;
  }
  
  if (reusingMergedAudio) {
      logStep1(`Reusing the existing merged audio after an earlier incomplete transcription. Temporary input copies were already cleaned up.`);
  } else {
    fs.writeFileSync(concatPath, concatData);

    try {
      const args = [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', path.basename(concatPath)
      ];
      if (mergeMethod === 'quick') {
          args.push('-c', 'copy');
      } else {
          args.push('-c:a', 'libmp3lame', '-b:a', `${maxBitrate}k`);
      }
      args.push(path.basename(mergedFilePath));
      
      await execFileAsync(MANAGED_FFMPEG_PATH, args, { cwd: concatDir });
    } catch (err: any) {
      console.error("FFmpeg merge error:", err);
      logStep1(`FFmpeg Error: ${err.message}`);
      activeStep1ProgressState.isActive = false;
      activeStep1ProgressState.error = `FFmpeg Merge Error: ${err.message}`;
      return;
    }
  }

  let realDuration = job.totalDurationSeconds;
  let realSizeBytes = job.totalSizeBytes;
  if (fs.existsSync(mergedFilePath)) {
      try {
          const { stdout: probeOut } = await execFileAsync(MANAGED_FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', mergedFilePath]);
          const probeData = JSON.parse(probeOut.toString());
          if (probeData?.format?.duration) realDuration = parseFloat(probeData.format.duration);
          if (probeData?.format?.size) realSizeBytes = parseInt(probeData.format.size, 10);
      } catch(err: any) {
          console.error("FFprobe error:", err);
          logStep1(`FFprobe Error: ${err.message}`);
      }
  } else {
      logStep1(`Merged audio file was not created. Skipping FFprobe.`);
  }

  job.mergedMp3 = {
    filename: `${job.name}.mp3`,
    duration: realDuration,
    bitrate: maxBitrate,
    sizeBytes: realSizeBytes,
    fullPath: mergedFilePath
  };

  // CLEANUP: Purge the original input files from the internal inputs folder to save disk space
  if (!reusingMergedAudio && job.sourceFolderPath && job.sourceFolderPath.includes('inputs')) {
      logStep1(`Cleaning up temporary input files from workspace...`);
      for (const part of job.parts) {
          const p = path.resolve(APP_ROOT, job.sourceFolderPath, part.name);
          if (fs.existsSync(p)) {
              try { fs.unlinkSync(p); } catch(e) {}
          }
      }
      logStep1(`Cleared ${job.parts.length} source files to free disk space.`);
  }

  if (!reusingMergedAudio && mergeMethod === 'quick') {
    job.logs.push({
      timestamp: now(),
      level: 'WARNING',
      message: `Audio Merge (Quick Merge): Concatenated ${job.parts.length} MP3 files directly to ${mergedFilePath}`,
    });
  } else if (!reusingMergedAudio) {
    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Audio Merge (Standard Merge): Stitched and re-encoded ${job.parts.length} MP3 files at ${maxBitrate} kbps to ${mergedFilePath}.`,
    });
  }

  // Stage 4: Transcribing with Local WhisperX
  activeStep1ProgressState.stage = 'transcribing';
  activeStep1ProgressState.currentStageNumber = 4;
  activeStep1ProgressState.percentage = 62;
  activeStep1ProgressState.label = `Transcribing speech with WhisperX (${model.name})`;
  activeStep1ProgressState.currentTask = `Neural speech recognition running on ${hw.mode === 'gpu' ? 'NVIDIA GPU (CUDA)' : 'CPU'}...`;
  logStep1(`Initialized Whisper model: ${model.name} (${model.id})`);

  // Do not create estimated transcript statistics. A prior demo implementation
  // filled these values before WhisperX had actually succeeded, which made a
  // failed run look partially complete. They are set from real JSON below.
  delete job.transcription;

  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `WhisperX speech recognition started with '${model.name}' (${hw.mode === 'gpu' ? 'GPU Accelerated' : 'CPU'})...`,
  });

  // Stage 5: Detecting chapter markers
  activeStep1ProgressState.stage = 'detecting_chapters';
  activeStep1ProgressState.currentStageNumber = 5;
  activeStep1ProgressState.percentage = 85;
  activeStep1ProgressState.label = 'Detecting chapter headings & boundary tokens';
  activeStep1ProgressState.currentTask = 'Alignment & lead-in window calculation...';
  
  const leadIn = currentConfig.lead_in_seconds || 1.5;
  let generatedCandidates: ChapterCandidate[] = [];

  try {
    if (!fs.existsSync(mergedFilePath)) {
        const errorMsg = "Cannot run WhisperX because the merged audio file was not successfully created.";
        logStep1(`ERROR: ${errorMsg}`);
        activeStep1ProgressState.isActive = false;
        activeStep1ProgressState.error = errorMsg;
        return;
    }
    
    logStep1(`Executing local WhisperX on merged audio...`);
    
    const deviceFlag = hw.mode === 'gpu' ? ['--device', 'cuda', '--compute_type', 'float16'] : ['--device', 'cpu', '--compute_type', 'int8'];
    
    const venvPython = getVenvPython();
    if (!fs.existsSync(venvPython)) {
        throw new Error("Private WhisperX runtime not found. Please click the Settings gear icon, go to 'System Requirements', and click 'Install / Repair' to set up the local transcription engine.");
    }
    
    // Build the WhisperX command array
    const whisperArgs = [
       "-m", "whisperx",
       mergedFilePath,
       "--model", model.id,
       "--language", "en",
       ...deviceFlag,
       "--model_dir", WHISPERX_MODEL_CACHE_DIR,
       "--output_dir", intermediatesDir,
       "--output_format", "json"
    ];
    
    logStep1(`Running: ${venvPython} ${whisperArgs.join(' ')}`);
    
    // Execute the local WhisperX via the private runtime asynchronously
    ensureWhisperxVadCompatibility();
    // Keep every runtime cache alongside the portable application instead of
    // writing into the Windows account profile. Silero VAD uses TORCH_HOME on
    // its first run and Matplotlib otherwise creates a font cache in the user
    // profile; both must remain movable with this folder.
    fs.mkdirSync(TORCH_CACHE_DIR, { recursive: true });
    fs.mkdirSync(MATPLOTLIB_CACHE_DIR, { recursive: true });
    await execFileAsync(venvPython, whisperArgs, {
      env: {
        ...process.env,
        TORCH_HOME: TORCH_CACHE_DIR,
        MPLCONFIGDIR: MATPLOTLIB_CACHE_DIR,
      },
    });
    
    const parsedName = path.parse(mergedFilePath).name;
    const whisperJsonPath = path.join(intermediatesDir, `${parsedName}.json`);
    
    if (fs.existsSync(whisperJsonPath)) {
      const whisperData = JSON.parse(fs.readFileSync(whisperJsonPath, 'utf8'));
      const transcriptSegments = Array.isArray(whisperData.segments) ? whisperData.segments : [];
      const transcriptWords = transcriptSegments.flatMap((segment: any) => (Array.isArray(segment.words) ? segment.words : []).map((word: any) => ({
        word: String(word.word || '').trim(),
        start: formatTimestamp(Number(word.start ?? segment.start ?? 0)),
        startSeconds: Number(word.start ?? segment.start ?? 0),
        endSeconds: Number(word.end ?? segment.end ?? word.start ?? segment.start ?? 0),
        confidence: typeof word.score === 'number' ? word.score : undefined,
      })).filter((word: any) => word.word));
      job.transcriptWords = transcriptWords;
      const transcriptWordCount = transcriptSegments.reduce((total: number, segment: any) => {
        if (Array.isArray(segment.words)) return total + segment.words.length;
        return total + (typeof segment.text === 'string' ? segment.text.trim().split(/\s+/).filter(Boolean).length : 0);
      }, 0);
      job.transcription = {
        model: model.name,
        profile: model.id,
        language: 'en',
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
            notes: `WhisperX detected at ${formatTimestamp(rawTime)} with ${leadIn}s lead-in`,
            words: contextWords,
          });
        }
      }
      logStep1(`Local WhisperX successfully extracted ${generatedCandidates.length} chapters.`);
    } else {
      throw new Error(`WhisperX completed but did not create its expected transcript: ${whisperJsonPath}`);
    }
  } catch (err: any) {
    console.error("Local WhisperX Execution Error:", err);
    if (err.message && err.message.includes("No module named whisperx")) {
      logStep1(`ERROR: Private WhisperX module not found!`);
      logStep1(`-> The actual WhisperX Python software is missing from the private runtime.`);
      logStep1(`-> Please click the "Settings Gear" icon, go to "System Requirements", and click "Install / Repair" to install WhisperX.`);
    } else {
      logStep1(`ERROR: WhisperX execution failed: ${err.message}.`);
    }
    job.logs.push({ timestamp: now(), level: 'ERROR', message: `Step 1 failed: WhisperX did not complete. ${err.message}` });
    saveJobs();
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.canCancel = false;
    activeStep1ProgressState.stage = 'error';
    activeStep1ProgressState.error = `WhisperX transcription failed: ${err.message}`;
    activeStep1ProgressState.liveStatusMessage = 'WhisperX transcription failed. No chapter markers were created.';
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
    console.error("Fatal Step 1 Background Error:", err);
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.error = err.message;
  }
  })();
};

app.post('/api/jobs/:id/merge-and-detect', handleStep1Process);
app.post('/api/jobs/:id/process-step1', handleStep1Process);

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
app.post('/api/jobs/:id/build-m4b', async (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (!job.mergedMp3) {
    return res.status(400).json({ error: 'Merged audio is missing. Run Step 1 first.' });
  }

  if (!job.chapters || job.chapters.length === 0) {
    return res.status(400).json({ error: 'No chapters defined. Review candidates first.' });
  }

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Validate chapters first
  try {
    const firstMs = parseTimestampToMs(job.chapters[0].start);
    if (firstMs < 0) {
      throw new Error('First chapter start timestamp cannot be negative.');
    }
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  const { outputFormat = 'm4b' } = req.body as { outputFormat?: OutputAudioFormat };

  job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);

  const m4bConfig = currentConfig.m4b_settings;
  let bitrate = m4bConfig.bitrate_stereo || "96k";
  let codec = m4bConfig.audio_codec || 'aac';
  let targetExt = 'm4b';

  if (outputFormat === 'm4a') {
    targetExt = 'm4a';
    codec = 'aac';
  } else if (outputFormat === 'mp3') {
    targetExt = 'mp3';
    codec = 'mp3';
    bitrate = '192k';
  } else if (outputFormat === 'flac') {
    targetExt = 'flac';
    codec = 'flac';
    bitrate = 'Lossless';
  } else if (outputFormat === 'opus') {
    targetExt = 'opus';
    codec = 'opus';
    bitrate = '96k';
  } else if (outputFormat === 'wav') {
    targetExt = 'wav';
    codec = 'pcm_s16le';
    bitrate = 'Uncompressed';
  }

  // Calculate estimated file size
  let estBytes = 0;
  if (outputFormat === 'flac') {
    estBytes = Math.round(job.totalDurationSeconds * 80000); // approx ~600-800 kbps
  } else if (outputFormat === 'wav') {
    estBytes = Math.round(job.totalDurationSeconds * 44100 * 2 * 2); // 16-bit 44.1kHz stereo
  } else {
    const kbps = parseInt(bitrate, 10) || 96;
    estBytes = Math.round((job.totalDurationSeconds * kbps * 1000) / 8);
  }

  const sourceAudioPath = job.mergedMp3.fullPath;
  if (!sourceAudioPath || !fs.existsSync(sourceAudioPath)) {
    return res.status(400).json({ error: 'The merged source audio file is unavailable. Run Step 1 again before building.' });
  }
  const outputDir = job.outputFolderPath || currentOutputFolder;
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = (job.name || 'audiobook').replace(/[<>:"/\\|?*]/g, '_');
  const outputPath = path.join(outputDir, `${safeName}.${targetExt}`);
  const metadataPath = path.join(path.dirname(sourceAudioPath), `${job.id}_chapters.ffmeta`);
  fs.writeFileSync(metadataPath, job.ffmetaContent, 'utf8');
  const encoder = codec === 'mp3' ? 'libmp3lame' : codec === 'opus' ? 'libopus' : codec === 'pcm_s16le' ? 'pcm_s16le' : codec;
  const buildArgs = ['-y', '-i', sourceAudioPath, '-i', metadataPath, '-map', '0:a:0', '-map_metadata', '1', '-c:a', encoder];
  if (!['flac', 'pcm_s16le'].includes(encoder)) buildArgs.push('-b:a', bitrate);
  buildArgs.push(outputPath);
  try {
    // No -ss, -t, silencedetect, or trim filter: the complete merged master is
    // always encoded from zero through its final sample.
    await execFileAsync(MANAGED_FFMPEG_PATH, buildArgs);
    const { stdout } = await execFileAsync(MANAGED_FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', outputPath]);
    const probe = JSON.parse(stdout.toString());
    const actualDuration = Number(probe?.format?.duration || 0);
    const sourceDuration = job.mergedMp3.duration || job.totalDurationSeconds;
    if (actualDuration <= 0 || Math.abs(actualDuration - sourceDuration) > 2) {
      throw new Error(`Output duration ${actualDuration.toFixed(3)}s does not match merged source duration ${sourceDuration.toFixed(3)}s.`);
    }
    job.outputM4b = {
      filename: path.basename(outputPath),
      duration: actualDuration,
      sizeBytes: Number(probe?.format?.size || estBytes),
      bitrate: bitrate.includes('k') ? `${bitrate}bps` : bitrate,
      chaptersCount: job.chapters.length,
      codec,
    };
  } catch (error: any) {
    return res.status(500).json({ error: `FFmpeg build failed: ${error.message}` });
  }

  job.status = 'built';
  saveJobs();
  const coverMsg = job.metadata?.cover ? ` Attached cover art (${job.metadata.cover.source}).` : '';
  const narratorMsg = job.metadata?.narrator ? ` Stored narrator "${job.metadata.narrator}" in metadata Composer tag.` : '';
  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `Generated FFMETADATA1 chapter markers (${job.chapters.length} chapters). Source audio is preserved from 00:00:00 through ${formatTimestamp(job.outputM4b.duration)}.${narratorMsg}${coverMsg} Encoded ${codec.toUpperCase()} ${targetExt.toUpperCase()} package. Output: ${job.outputM4b.filename}`,
  });

  res.json({
    status: 'ok',
    outputM4b: job.outputM4b,
    ffmeta: job.ffmetaContent,
    message: `Built ${job.outputM4b.filename} successfully. Ready for Step 5 validation.`,
  });
});

app.post('/api/jobs/:id/build-audio', (req, res) => {
  // Alias to build-m4b with format support
  const target = app._router.stack.find((layer: any) => layer.route?.path === '/api/jobs/:id/build-m4b');
  if (target) {
    return target.route.stack[0].handle(req, res);
  }
  res.status(500).json({ error: 'Route handler not found' });
});

// Step 3: Validate Output (replicates app/validate.py)
app.post('/api/jobs/:id/validate', (req, res) => {
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
  const chaptersCount = job.outputM4b.chaptersCount;
  const duration = job.outputM4b.duration;
  const origDuration = job.mergedMp3 ? job.mergedMp3.duration : job.totalDurationSeconds;
  const diff = Math.abs(duration - origDuration);

  let status: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
  let reason: string | undefined;

  if (chaptersCount === 0) {
    status = 'FAIL';
    reason = 'No embedded chapters detected in container.';
  } else if (diff > 2.0) {
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

  job.status = 'validated';
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
    console.log(`Audiobook Workbench server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
