import { runFinalCheck, finalCheckSignature } from './tools/final-check';
import { writeMetadataSidecars } from './tools/metadata-sidecars';
import { extendedMetadata, cleanMemberships } from './src/utils/extendedMetadata';
// Copyright (C) 2026 SwissMouse contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { probeBackendCapabilities } from './tools/transcription-capabilities';
import { readAppearance, saveAppearance, validThemeId } from './tools/appearance-preferences';
import { transcriptionSettings, selectTranscriptionAttempt, capabilityLabel, type BackendCapabilities, type TranscriptionBackend } from './src/transcription';
import { DEFAULT_LIBRARY_TEMPLATE, finalOutputRoot, libraryRelativePath, validateLibraryTemplate } from './src/utils/libraryPath';
import { probableBookGroups } from './src/utils/bookGroups';
import { sourceProcessingKeys, transcriptionRequestKey, transcriptionResultKey, reusableTranscription, processingKey } from './tools/transcription-cache';
import { StatusCache } from './tools/status-cache';
import { rebuildAnalysis, ensureAnalysis, waveformSlice, retainWaveform } from './tools/audio-analysis';
import { detectMusicTransitions, MUSIC_DETECTOR_VERSION } from './tools/music-transitions';
import { detectTitleBoundaries, TITLE_DETECTOR_VERSION } from './tools/title-boundaries';
import { IMPROVED_DETECTOR_VERSION, structuralSuggestions, sourceBoundaries, reconcileSources, mergeDetectionSuggestions } from './tools/improved-chapter-detection';
import { recoveryWindows, recheckChapterWindows } from './tools/chapter-recovery';
import { initialDetectedChapters } from './src/utils/chapterSuggestions';
import type { AlignedWord } from './src/types';
import { detectChapterHeadings, CHAPTER_DETECTOR_VERSION } from './tools/chapter-detection';
import { buildTranscriptWords, findTranscriptWordIndex, missingWordTimestampSegments, formatTimestamp as formatTranscriptTimestamp } from './src/utils/wordAlignment';
import { PACKAGE_STATUS_SCRIPT } from './tools/package-status';
import { discoverRuntime, cleanPythonEnv, optionalPackages, optionalRemoval, removalImpact, PRIVATE_UNINSTALL_CHECK, assertManagedTarget, type RuntimeSelection } from './tools/runtime-selection';
import { youtubeUrl, youtubeBaseArgs, downloadYoutubeAudio } from './tools/youtube-audio';
import { mountLibriVox } from './tools/librivox-import';
import { inspectAsync, inspect, fingerprint, makePreview, exportAudio, validateChapters, writeAudioMetadata } from './tools/audio-engine';
import { LibraryMediaReader } from './tools/library-media';
import { recoverRelocatedOutput } from './tools/library-output-recovery';
import { archiveOriginals, restoreArchivedSources } from './tools/originals-archive';
import { prepareMaster, sourceReviewPreview } from './tools/source-audio';
import { existingChapterList } from './tools/existing-chapters';
import { parseChapterFile, type ChapterAudioSource } from './tools/chapter-file';
import { audiobookTags, metadataFromTags } from './tools/audiobook-metadata';
import { checkRelinkIdentity } from './tools/relink-identity';
import { transferProjectFiles, recoverTransferCopies, type TransferJournal } from './tools/project-transfer';
import { DurableProjectStore } from './tools/durable-project-store';
import { cloneProject } from './tools/project-store';
import { CatalogService } from './tools/catalog-service';
import { registerCatalogRoutes, isReadOnlyCatalogRequest } from './tools/catalog-routes';
import { projectCatalogRecord } from './tools/catalog-projection';
import { catalogArchiveCurrent, findAvailableM4b } from './tools/catalog-availability';
import { ListeningStore } from './tools/listening-store';
import { registerPlaybackRoutes } from './tools/playback-routes';
import { registerBookFilesRoutes, recoverBookFilesOperations } from './tools/book-files-routes';
import { buildBookPlaybackManifest } from './tools/book-playback';
import { asyncRoute } from './tools/api-route';
import { MediaCache } from './tools/media-cache';
import { mergeDetectedMetadata, recordMetadataEdit, retainMetadataOverrides } from './tools/metadata-state';
import { projectFiles, assertSidecarOwnership } from './tools/project-files';
import { contentHash, assertUnlinked, fileSignature, identifyBook, inventory, pathKey, scanRoot, stamp, within, type DiskBook, type MoveEntry, type CopiedFile } from './tools/library-filesystem';
import { findBookMatches, pairKey, type MatchBook } from './tools/library-matches';
import { mapScanWork } from './tools/scan-work';
import { isUntouchedDiscovery } from './tools/library-regrouping';
import { envelopeConfidence, sampledEnvelope } from './tools/audio-match';
import { audiobookshelfMetadata } from './src/utils/audiobookshelfMetadata';
import { QUICK_ADD_CATEGORIES, cleanQuickTags } from './src/utils/metadataQuickAdd';
import { hasExplicitSourceOrder, sourceOrderCompare, sourceChapterGroups, manualChapterGroups, setChapterGroup } from './src/utils/sourceStructure';
import { applyDefaultChapterEnds, parseChapterTimestamp, parseCsvRow, validateChapterEntries } from './src/utils/chapters';
import { beginStepRerun, canRerunStep, canReviewChapters, completeStepRerun, failStepRerun, hasManualChapterWork, markDependentResultsStale } from './src/utils/pipelineRerun';
import { outputFormats, canCopy, defaultBitrate, bitrateOptions, stitchCompatibility } from './src/audioFormats';
import { planChapterExport } from './src/utils/chapterExport';
import { transcriptionEngines, transcribeWithFallback, PYTHON_DLL_SETUP, type NormalizedTranscription, type TranscriptionEngineId } from './tools/transcription-engine';
import { evaluateRequirementReadiness, selectedMissingRequirements, pytorchBuildOptions, pytorchInstallPlan, parseNvidiaCudaVersion } from './tools/requirements';
import { missingDependencies, missingRequirementsTooltip } from './tools/feature-dependencies';
import { discoverCustomThemes, isSafeThemeAssetName } from './tools/custom-themes';
import type { FeatureId } from './tools/feature-dependencies';
import type { WorkbenchConfig, ChapterEntry, AudiobookMetadata, AudiobookJob, LibraryBook, HardwareInfo, SpeechModelInfo, InstallRepairProgress, Step1ProcessState, Step1ProcessStage, Step1ProgressStage, HardwareEnvironmentInfo, RequirementsReport, BaseRequirementItem, FolderScanResult, DiscoveredAudioFile, UnsupportedFileItem, YtDlpStatusInfo, YtDlpStatusState, YouTubeVideoInfo, YouTubeAudioFormat, ChapterCandidate, CoverArtInfo, OutputAudioFormat, RerunnablePipelineStep } from './src/types';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import { exec, execFile, execFileSync, spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import AdmZip from 'adm-zip';
import { installFfmpegDistribution } from './tools/ffmpeg-distribution';
import { pickAudioFile, pickAudioFiles, pickAudioFolder } from './tools/native-file-picker';
import { openFolderInForeground } from './tools/native-folder-opener';
import { createBookFolder, listBookDirectory, listBookTree, moveBookFiles, rebaseBookMembership, resolveBookAudio } from './tools/book-source-browser';
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
    const child = spawn(cmd, args, { shell: false, windowsHide: true, env: cleanPythonEnv() });
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
const CUSTOM_THEMES_DIR = appPath('themes');
const CUSTOM_THEME_LOG = appPath('logs', 'custom-themes.log');
const RUNTIME_DIR = appPath('runtime');
const PORTABLE_PYTHON_DIR = path.join(RUNTIME_DIR, 'python');
const isWin = os.platform() === 'win32';
const PORTABLE_PYTHON_EXE = isWin ? path.join(PORTABLE_PYTHON_DIR, 'tools', 'python.exe') : path.join(PORTABLE_PYTHON_DIR, 'bin', 'python3');
const RUNTIME_BIN_DIR = appPath('runtime', 'bin');
const MANAGED_FFMPEG_PATH = path.join(RUNTIME_BIN_DIR, isWin ? 'ffmpeg.exe' : 'ffmpeg');
const MANAGED_FFPROBE_PATH = path.join(RUNTIME_BIN_DIR, isWin ? 'ffprobe.exe' : 'ffprobe');

function scanCustomThemes() {
  const discovery = discoverCustomThemes(CUSTOM_THEMES_DIR);
  if (discovery.warnings.length > 0) {
    const timestamp = new Date().toISOString();
    const lines = discovery.warnings.map(warning => `[${timestamp}] WARNING ${warning}`);
    try {
      fs.mkdirSync(path.dirname(CUSTOM_THEME_LOG), { recursive: true });
      fs.appendFileSync(CUSTOM_THEME_LOG, `${lines.join('\n')}\n`, 'utf8');
    } catch (error) { console.warn('[Themes] Cannot write theme diagnostic log:', error); }
    for (const warning of discovery.warnings) console.warn(`[Themes] ${warning}`);
  }
  return discovery;
}

// FFmpeg.org links Windows users to this build provider. The installer verifies
// the published SHA-256 before extracting its two application-local binaries.
const WINDOWS_FFMPEG_ARCHIVE_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const WINDOWS_FFMPEG_ARCHIVE_SHA256_URL = `${WINDOWS_FFMPEG_ARCHIVE_URL}.sha256`;
const TORCH_VERSION = '2.8.0';
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
let runtimeSelection: RuntimeSelection | undefined;
let runtimeMutationRunning = false;
let runtimeDiscoveryRunning = false;
let runtimeRequests = 0;
const getFfmpeg = () => runtimeSelection?.ffmpeg.path || MANAGED_FFMPEG_PATH;
const getFfprobe = () => runtimeSelection?.ffprobe.path || MANAGED_FFPROBE_PATH;
const getBackendPython = (engine: TranscriptionBackend) => runtimeSelection?.backends[engine]?.path || getVenvPython();
async function refreshRuntimeSelection() {
  runtimeDiscoveryRunning = true;
  try {
    runtimeSelection = await discoverRuntime({ runtimeRoot: RUNTIME_DIR, python: getVenvPython(), ffmpeg: MANAGED_FFMPEG_PATH,
      ffprobe: MANAGED_FFPROBE_PATH, ytDlp: LOCAL_YT_DLP_PATH, mode: process.env.SWISSMOUSE_RUNTIME_MODE === 'managed' ? 'managed' : 'hybrid' });
    for (const key of ['python', 'ffmpeg', 'ffprobe', 'ytDlp'] as const) console.log(`[Runtime] ${key}: ${runtimeSelection[key].source} — ${runtimeSelection[key].path}`);
    for (const engine of ['faster-whisper', 'openai-whisper'] as const) console.log(`[Runtime] ${engine}: ${runtimeSelection.backends[engine] ? 'system' : 'app fallback'} — ${getBackendPython(engine)}`);
    for (const warning of runtimeSelection.warnings) console.warn(`[Runtime] ${warning}`);
    invalidateRequirements();
  } finally { runtimeDiscoveryRunning = false; }
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
    // JavaScript reader retains upstream companion files and installs the two
    // required application-local binaries without running an external extractor.
    const zip = new AdmZip(archivePath);
    const retained = installFfmpegDistribution(zip.getEntries(), RUNTIME_DIR, actual);
    onLog(`Preserved ${retained.preservedFiles} upstream FFmpeg distribution files in ${retained.noticesDirectory}.`);
    onLog('Wrote FFmpeg and FFprobe to runtime/bin.');
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

let libraryMoveRunning = false;
let libraryConfigSaving = false;
let libraryValidationRunning = false;
let activeLibraryMutations = 0;
const libraryMutationRequests = new Map<express.Response, string>();
let libraryScanRunning: Promise<void> | undefined;
let libraryScanWarnings: string[] = [];
const libraryRecoveryWarnings: string[] = [];
let libraryScanProgress = { operation: 'refresh', source: '', folders: 0, discovered: 0, processed: 0, phase: 'Idle' };
app.use('/api', asyncRoute(async (req, res, next) => {
  if (isReadOnlyCatalogRequest(req.method, req.path)) return next();
  // Personal checkpoints are independent of library and audio mutations.
  if (req.method === 'POST' && (/^\/jobs\/[^/]+\/final-check\/cancel$/.test(req.path) || /^\/jobs\/[^/]+\/listening$/.test(req.path) || req.path.endsWith('/book-files/details'))) return next();
  const scanRequest = req.path === '/library/refresh' || req.path === '/library/rescan' || req.path === '/library/rebuild';
  if (req.method !== 'GET' && !scanRequest && libraryScanRunning) {
    try { await libraryScanRunning; }
    catch { /* A failed scan rolls back before a waiting action runs. */ }
  }
  if (req.method !== 'GET' && (libraryMoveRunning || libraryConfigSaving || libraryValidationRunning) && !scanRequest)
    return res.status(409).json({ error: 'Library reconciliation or a verified move is in progress. Please retry when it finishes.' });
  if (req.method !== 'GET' && !scanRequest) {
    activeLibraryMutations++;
    libraryMutationRequests.set(res, `${req.method} ${req.path}`);
    let released = false;
    const release = () => { if (!released) { released = true; activeLibraryMutations--; libraryMutationRequests.delete(res); } };
    res.once('finish', release); res.once('close', release);
  }
  next();
}));
// Keep selected runtimes stable during work and prevent new work while they change.
app.use('/api', (req, res, next) => {
  if (isReadOnlyCatalogRequest(req.method, req.path)) return next();
  if (req.method === 'GET' || req.path.startsWith('/requirements/') || /^\/jobs\/[^/]+\/listening$/.test(req.path)) return next();
  if (runtimeMutationRunning || runtimeDiscoveryRunning) return res.status(409).json({ error: 'Wait for requirement changes to finish before starting another action.' });
  runtimeRequests++;
  let finished = false;
  const done = () => { if (!finished) { finished = true; runtimeRequests--; } };
  res.once('finish', done); res.once('close', done);
  next();
});

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

function importLog(jobId: string | undefined, level: 'INFO' | 'ERROR', message: string) {
  const job = projectStore.get(jobId);
  if (!job) return;
  job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level, message: `Audio import: ${message}` });
  saveJobs();
}

const uploadStorage: multer.StorageEngine = {
  _handleFile(req, file, cb) {
    const jobId = req.query.jobId as string | undefined;
    const name = file.originalname.replace(/\\/g, '/');
    let bytes = 0;
    let reported = 0;
    importLog(jobId, 'INFO', `Copying "${name}" into the internal workspace.`);
    file.stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes - reported >= 16 * 1024 * 1024) {
        reported = bytes;
        importLog(jobId, 'INFO', `Copying "${name}": ${(bytes / 1048576).toFixed(1)} MiB received.`);
      }
    });
    storage._handleFile(req, file, (error, info) => {
      if (error) importLog(jobId, 'ERROR', `Could not copy "${name}" after ${(bytes / 1048576).toFixed(1)} MiB: ${error.message}`);
      else importLog(jobId, 'INFO', `Staged "${name}": ${(bytes / 1048576).toFixed(1)} MiB copied to ${info.path}.`);
      cb(error, info);
    });
  },
  _removeFile(req, file, cb) { storage._removeFile(req, file, cb); },
};
const upload = multer({ storage: uploadStorage, preservePath: true });

function appendOperationFailure(jobId: string | undefined, operation: string, message: string) {
  const job = jobId ? projectStore.get(jobId) : undefined;
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

app.post('/api/upload-audio', requireFeatures(['file_import'], 'Import'), (req, res, next) => {
  const jobId = req.query.jobId as string | undefined;
  importLog(jobId, 'INFO', `Started receiving audio files${req.headers['content-length'] ? ` (${(Number(req.headers['content-length']) / 1048576).toFixed(1)} MiB multipart request)` : ''}.`);
  upload.fields([{ name: 'files' }, { name: 'cover', maxCount: 1 }])(req, res, error => {
    if (!error) return next();
    importLog(jobId, 'ERROR', `Transfer failed: ${error.message}. Multer removed staged files.`);
    res.status(400).json({ error: 'Import failed', message: error.message });
  });
}, (req, res) => {
  const received = req.files as { files?: Express.Multer.File[]; cover?: Express.Multer.File[] } | undefined;
  if (!received?.files?.length) {
    for (const file of received?.cover || []) { try { fs.unlinkSync(file.path); } catch {} }
    importLog(req.query.jobId as string | undefined, 'ERROR', 'No files were received.');
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const jobId = req.query.jobId as string;
  if (!jobId) {
    // Cleanup files if they were uploaded without a jobId
    [...received.files, ...(received.cover || [])].forEach(f => {
      try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) {}
    });
    return res.status(400).json({ error: 'No active project selected. Please create or open a book project first.' });
  }

  const staged = received.files;
  const stagedCover = received.cover?.[0];
  const finalUploadDir = path.join(uploadDir, jobId);
  const moved: string[] = [];
  try {
    if (stagedCover && (!/^cover\.(jpg|jpeg|png|webp)$/i.test(path.basename(stagedCover.originalname)) || stagedCover.size > 10 * 1024 * 1024)) {
      throw new Error('Folder cover must be named cover.jpg, cover.jpeg, cover.png, or cover.webp and be no larger than 10 MiB.');
    }
    // Validate every staged file before committing any of them to the project.
    const probes = staged.map((file, index) => {
      importLog(jobId, 'INFO', `Validating ${index + 1}/${staged.length}: "${file.originalname.replace(/\\/g, '/')}" with FFprobe.`);
      const probe = probeAudioFile(file.path);
      importLog(jobId, 'INFO', `Validated "${file.originalname.replace(/\\/g, '/')}": ${probe.format}, ${probe.codec}, ${probe.sampleRate} Hz, ${probe.channels} channel(s), ${probe.durationSeconds.toFixed(2)} s.`);
      return probe;
    });
    fs.mkdirSync(finalUploadDir, { recursive: true });
    const uploadedFiles = staged.map((file, index) => {
      const finalPath = path.join(finalUploadDir, file.filename);
      fs.renameSync(file.path, finalPath);
      moved.push(finalPath);
      importLog(jobId, 'INFO', `Committed ${index + 1}/${staged.length}: "${file.originalname.replace(/\\/g, '/')}" to ${finalPath}.`);
      const probe = probes[index];
      return {
        originalName: file.originalname.replace(/\\/g, '/'), filename: file.filename, path: finalPath, size: file.size,
        durationSeconds: probe.durationSeconds, bitrate: probe.bitrate, format: probe.format, codec: probe.codec,
        sampleRate: probe.sampleRate, channels: probe.channels, streamSignature: probe.streamSignature,
      };
    });
    if (stagedCover) {
      const coverPath = path.join(finalUploadDir, `cover-${randomUUID()}${path.extname(stagedCover.originalname).toLowerCase()}`);
      fs.renameSync(stagedCover.path, coverPath);
      moved.push(coverPath);
      importLog(jobId, 'INFO', `Stored source-folder artwork in the import workspace: ${coverPath}.`);
    }
    importLog(jobId, 'INFO', `Completed: ${uploadedFiles.length} file(s), ${(uploadedFiles.reduce((total, file) => total + file.size, 0) / 1048576).toFixed(1)} MiB, all validated and committed.`);
    res.json({ message: 'Successfully uploaded files.', files: uploadedFiles, uploadDir: finalUploadDir });
  } catch (error: any) {
    for (const file of [...staged, ...(stagedCover ? [stagedCover] : [])]) { try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {} }
    for (const file of moved) { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {} }
    try { if (fs.existsSync(finalUploadDir) && fs.readdirSync(finalUploadDir).length === 0) fs.rmdirSync(finalUploadDir); } catch {}
    const message = `${error.message || 'Audio validation failed'}. No files were imported; staged files were removed.`;
    appendOperationFailure(jobId, 'Import', message);
    importLog(jobId, 'ERROR', `Validation or commit failed; rolled back ${moved.length} committed file(s) and removed staged files. Cause: ${error.message || 'Audio validation failed'}`);
    res.status(400).json({ error: 'Import failed', message });
  }
});


// Initial workbench configuration matching config.json from original Python app
const CONFIG_PATH = appPath('config.json');
const defaultConfig: WorkbenchConfig = {
  audiobookshelf_metadata: false,
  save_cover_beside_audio: true,
  quick_tags: [...QUICK_ADD_CATEGORIES],
  pcm_retention: 'after_verified_export',
  inbox_folder: appPath('inbox'),
  library_folder: appPath('output'),
  library_template: DEFAULT_LIBRARY_TEMPLATE,
  faster_transcription: true,
  detect_musical_transitions: false,
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
    const endMs = parseChapterTimestamp(chap.end) ?? (i + 1 < chapters.length ? parseTimestampToMs(chapters[i + 1].start) - 1 : totalDurationMs);
    content += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${startMs}\nEND=${endMs}\ntitle=${escapeFFMeta(chap.title)}\n`;
  }
  return content;
}

const JOBS_FILE = appPath('jobs.json');
const MASTER_LOG_FILE = appPath('logs', 'workbench-events.jsonl');

function appendMasterEvent(source: string, message: string, level: 'INFO' | 'WARNING' | 'ERROR' = 'INFO') {
  const entry = { timestamp: new Date().toISOString(), level, message: `[${source}] ${message}` };
  if (level !== 'INFO' && /recover|interrupted|cleanup is incomplete/i.test(message)) libraryRecoveryWarnings.push(message);
  try {
    fs.mkdirSync(path.dirname(MASTER_LOG_FILE), { recursive: true });
    fs.appendFileSync(MASTER_LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (error) { console.error('Failed to write master technical log:', error); }
}

let catalog: CatalogService | undefined;
const projectStore = new DurableProjectStore(JOBS_FILE, message => appendMasterEvent('Project recovery', message, 'WARNING'));
function saveJobs() { persistJobsAtomically(); }
function persistJobsAtomically(backup = true): void {
  try { projectStore.save(jobs, backup); jobs = projectStore.view(); catalog?.invalidate(); }
  catch (error) {
    // Keep existing object references valid for in-flight operations while
    // restoring the last durable state. A failed save is never reported as OK.
    jobs = projectStore.rollback();
    throw error;
  }
}
let lastProgressSave = 0;
function saveJobProgress() {
  if (Date.now() - lastProgressSave < 15000) return;
  lastProgressSave = Date.now();
  try { projectStore.save(jobs, false); }
  catch (error: any) { appendMasterEvent('Project save', 'Progress could not be saved: ' + error.message, 'WARNING'); }
}
function loadJobs() {
  const saved = projectStore.load();
  for (const job of projectStore.interrupted()) for (const item of job.exports || []) if (['running', 'queued'].includes(item.status)) {
    item.status = 'failed'; item.error = 'Export interrupted by application shutdown. Start a new export.';
  }
  projectStore.save(saved);
  return saved;
}
let jobs: AudiobookJob[] = loadJobs();
const listeningStore = new ListeningStore(appPath('listening'), 'local', message => appendMasterEvent('Listening recovery', message, 'WARNING'));
registerPlaybackRoutes(app, { jobs: () => jobs, getJob: id => projectStore.get(id), saveJobs, listening: listeningStore, sourcePaths: sourceFilePaths,
  ffprobe: getFfprobe, inspect: (tool, file) => mediaCache.read(tool, file) });

// Stream the app-owned merged master for Chapter Review. Range support lets
// the browser seek directly to a word timestamp without loading a full book.
app.get('/api/jobs/:id/audio-preview', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (req.query.file !== undefined) {
    if (!job) return res.status(404).json({ error: 'Book not found.' });
    try {
      const root = bookSourceRoot(job);
      if (!root || typeof req.query.file !== 'string') throw new Error('Choose a local audio file.');
      const directory = typeof req.query.directory === 'string' ? listBookDirectory(req.query.directory, SUPPORTED_AUDIO_EXTENSIONS, knownIntermediatesRoots()).directory : root;
      const file = resolveBookAudio(directory, req.query.file, SUPPORTED_AUDIO_EXTENSIONS);
      if (knownIntermediatesRoots().some(workspace => within(workspace, file))) throw new Error('Processing files are not browse sources.');
      return res.set('Cache-Control', 'no-store').sendFile(file);
    } catch (error: any) { return res.status(400).json({ error: error.message }); }
  }
  const audioPath = job?.previewPath;
  if (audioPath && fs.existsSync(audioPath)) return res.type('audio/wav').sendFile(path.resolve(audioPath));
  // A finished single-file audiobook can be reviewed in place without first
  // preparing a PCM master. Express streams ranges from the original file.
  try {
    if (job && job.parts.length === 1) {
      const [file] = importedSourcePaths(job);
      return res.sendFile(file);
    }
  } catch { /* Keep missing sources as a normal unavailable preview. */ }
  return res.status(404).json({ error: 'Review audio is unavailable. Relink the source or run Step 1.' });
});

app.get('/api/jobs/:id/waveform', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  const retained = job?.retainedWaveform && job.retainedWaveform.sourceKey === job.sourceKey ? job.retainedWaveform.audio : undefined;
  const waveformAudio = job?.previewPath || retained;
  if (!waveformAudio || !job?.generateWaveform || !job.waveformReady || job.status === 'draft') return res.status(404).json({ error: 'Waveform is optional. Enable Generate waveform and run that step to create it.' });
  const start = Number(req.query.start), duration = Number(req.query.duration), pixels = Number(req.query.pixels);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(pixels) || pixels < 1 || pixels > 4096) return res.status(400).json({ error: 'Invalid waveform viewport' });
  try {
    res.set('Cache-Control', 'no-store').json(await waveformSlice(waveformAudio, start, duration, pixels, !!retained));
  } catch (e) {
    const message = `Waveform analysis unavailable: ${e.message}`;
    console.warn(`[${job.id}] ${message}`);
    job.logs.push({ timestamp: new Date().toISOString(), level: 'ERROR', message });
    saveJobs();
    res.status(503).json({ error: 'Waveform unavailable. Audio playback is still available.' });
  }
}));

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
let currentOutputFolder = path.resolve(APP_ROOT, currentConfig.library_folder || appPath('output'));
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

function recordInstallUiLine(line: string, mirror = true) {
  activeInstallProgress.logs.push(line);
  if (activeInstallProgress.logs.length > 50) activeInstallProgress.logs.shift();
  if (mirror) appendMasterEvent('System check', line, /error|failed/i.test(line) ? 'ERROR' : 'INFO');
}

function appendInstallDiagnostic(message: string, includeInUi = true) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  appendMasterEvent('System check', line, /error|failed/i.test(message) ? 'ERROR' : 'INFO');
  try {
    fs.mkdirSync(path.dirname(INSTALL_DIAGNOSTIC_LOG), { recursive: true });
    fs.appendFileSync(INSTALL_DIAGNOSTIC_LOG, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write installation diagnostic log:', error);
  }
  if (includeInUi) {
    recordInstallUiLine(line, false);
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
  stages: [],
  failedStage: null,
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

// Combine saved project activity with the section streams. The file retains
// Step 1 and system messages that otherwise disappear when progress resets.
app.get('/api/logs', (_req, res) => {
  let sectionLogs: AudiobookJob['logs'] = [];
  try {
    if (fs.existsSync(MASTER_LOG_FILE)) sectionLogs = fs.readFileSync(MASTER_LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (error) { console.error('Failed to read master technical log:', error); }
  const projectLogs = jobs.flatMap(job => (job.logs || []).map(log => ({ ...log, message: `[${job.name}] ${log.message}` })));
  res.json([...sectionLogs, ...projectLogs].sort((a, b) => a.timestamp.replace(' ', 'T').localeCompare(b.timestamp.replace(' ', 'T'))));
});

app.post('/api/logs/client', (req, res) => {
  const entry = req.body;
  if (entry?.level !== 'ERROR' || typeof entry.message !== 'string' || !entry.message.trim() || entry.message.length > 20000 || typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) {
    res.status(400).json({ error: 'Invalid client log entry.' }); return;
  }
  try {
    fs.mkdirSync(path.dirname(MASTER_LOG_FILE), { recursive: true });
    fs.appendFileSync(MASTER_LOG_FILE, JSON.stringify({ timestamp: entry.timestamp, level: 'ERROR', message: entry.message }) + '\n', 'utf8');
    res.json({ saved: true });
  } catch { res.status(500).json({ error: 'Could not save the client diagnostic.' }); }
});
let activeStep1StartTime = 0;

const speechRecognitionStages: Step1ProgressStage[] = [
  { key: 'scanning_folder', label: 'Inspect source audio', desc: 'Verify each input file and read its audio metadata.' },
  { key: 'merging_audio', label: 'Prepare master audio', desc: 'Normalize and stitch audio, or verify a direct stitch.' },
  { key: 'generating_waveform', label: 'Generate waveform (optional)', desc: 'Create waveform data for chapter review.' },
  { key: 'transcribing_whisper', label: 'Speech recognition', desc: 'Transcribe the recording with the selected local Whisper engine.' },
  { key: 'detecting_chapters', label: 'Detect chapter candidates', desc: 'Find headings and refine their timestamps from the transcript.' },
  { key: 'saving_project', label: 'Finalize for review', desc: 'Save the transcript and proposed chapter markers for review.' },
];

const directChapterStages: Step1ProgressStage[] = [
  { key: 'scanning_folder', label: 'Inspect source audio', desc: 'Verify each input file and read its audio metadata.' },
  { key: 'merging_audio', label: 'Prepare master audio', desc: 'Normalize and stitch audio, or verify a direct stitch.' },
  { key: 'generating_waveform', label: 'Generate waveform (optional)', desc: 'Create waveform data for chapter review.' },
  { key: 'extracting_chapters', label: 'Create chapters from files', desc: 'Derive chapter markers from the source-file structure.' },
  { key: 'saving_project', label: 'Finalize for review', desc: 'Save the chapter markers for review.' },
];

function buildChapterCandidates(
  transcriptSegments: NormalizedTranscription['segments'],
  transcriptWords: ReturnType<typeof buildTranscriptWords>,
  engine: TranscriptionEngineId,
): ChapterCandidate[] {
  const headings = detectChapterHeadings(transcriptSegments);
  return headings.map((heading, headingIndex) => {
    const rawTime = heading.start;
    const endTime = heading.end;
    const indexedWord = heading.transcriptWordIndex === undefined ? undefined : transcriptWords[heading.transcriptWordIndex];
    const headingWordIndex = indexedWord && Math.abs(indexedWord.startSeconds - rawTime) < 0.0005
      ? heading.transcriptWordIndex!
      : findTranscriptWordIndex(transcriptWords, rawTime - 0.0005);
    const hasHeadingWord = heading.transcriptWordIndex !== undefined && headingWordIndex < transcriptWords.length
      && Math.abs(transcriptWords[headingWordIndex].startSeconds - rawTime) < 0.0005;
    const contextStart = Math.max(0, headingWordIndex - 18);
    const contextEnd = Math.min(transcriptWords.length, headingWordIndex + 26);
    const contextWords = hasHeadingWord ? transcriptWords.slice(contextStart, contextEnd) : [];
    const headingEndIndex = findTranscriptWordIndex(transcriptWords, endTime + 0.000001);
    const headingWords = hasHeadingWord ? transcriptWords.slice(headingWordIndex, headingEndIndex) : [];
    // The word clicked in review and the detected heading share one timestamp.
    // A legacy wordless segment must not snap forward to unrelated narration.
    const refinedStartIndex = headingWordIndex;
    const refinedStart = hasHeadingWord ? transcriptWords[headingWordIndex].startSeconds : rawTime;
    return {
      candidate_id: headingIndex + 1,
      candidate_start: formatTimestamp(refinedStart),
      candidate_end: formatTimestamp(endTime),
      matched_text: heading.text,
      context_before: contextWords.filter(word => word.startSeconds < rawTime).map(word => word.word).join(' '),
      context_after: contextWords.filter(word => word.startSeconds > endTime).map(word => word.word).join(' '),
      confidence: headingWords.length ? String(headingWords.reduce((sum, word) => sum + (word.confidence ?? 0), 0) / headingWords.length) : '0',
      proposed_title: heading.text,
      headingType: heading.headingType,
      chapterNumber: heading.chapterNumber,
      recovered: heading.recovered,
      transcriptWordIndex: hasHeadingWord ? refinedStartIndex : undefined,
      status: headingIndex === 0 ? 'approved' : 'review',
      notes: `${engine === 'faster-whisper' ? 'Faster Whisper' : 'OpenAI Whisper'} heading at ${formatTimestamp(refinedStart)}${hasHeadingWord ? '; anchored to saved transcript word' : '; legacy segment timing'}`,
      words: contextWords,
    };
  });
}

function validatedTranscriptionSettingsMap(input: unknown): AudiobookJob['transcriptionSettings'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid transcription settings');
  return Object.fromEntries(Object.entries(input).map(([engine, value]) => {
    if (engine !== 'faster-whisper' && engine !== 'openai-whisper') throw new Error('Unknown transcription engine');
    return [engine, transcriptionSettings(engine, value)];
  }));
}

function chapterDetectionCacheKey(job: AudiobookJob, musicEnabled: boolean): string {
  let previewSignature: string | undefined;
  if (musicEnabled && job.previewPath && fs.existsSync(job.previewPath)) {
    const stat = fs.statSync(job.previewPath);
    previewSignature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  }
  // Version the decisions, not just the transcription request. Retranscribing
  // with identical settings can still produce a different word timeline.
  return processingKey('chapter-detection', job.transcriptKey || '', {
    spokenVersion: CHAPTER_DETECTOR_VERSION,
    segments: job.transcriptSegments,
    words: job.transcriptWords,
    ...(musicEnabled ? { improvedVersion: IMPROVED_DETECTOR_VERSION, musicVersion: MUSIC_DETECTOR_VERSION, titleVersion: TITLE_DETECTOR_VERSION, previewSignature,
      existingChapters: job.existingChapters, parts: job.parts, transcription: job.transcription, settings: job.transcriptionSettings } : {}),
  });
}

function logChapterDetectionResult(candidates: ChapterCandidate[], musicEnabled: boolean) {
  const musical = candidates.filter(candidate => candidate.headingType === 'music_transition').length;
  logStep1(`Chapter detection: ${candidates.filter(candidate => !candidate.suggestionOnly).length} chapter markers, ${candidates.filter(candidate => candidate.suggestionOnly).length} suggestions awaiting acceptance (${musical} unconfirmed acoustic cues); experimental detection ${musicEnabled ? 'enabled' : 'disabled'}.`);
  if (!candidates.length) logStep1(musicEnabled
    ? 'No supported chapter boundaries found. Review the transcript and audio; pauses alone do not establish chapters.'
    : 'No spoken chapter headings found. Improved Chapter Detection (Experimental) can suggest isolated titles, numbered sections and source boundaries for review.');
}

async function improvedChapterCandidates(job: AudiobookJob, words: AlignedWord[], spoken: ChapterCandidate[], signal: AbortSignal): Promise<ChapterCandidate[]> {
  const sources = sourceBoundaries(job.existingChapters || [], job.parts, job.totalDurationSeconds);
  let suggestions = structuralSuggestions(words, spoken, job.totalDurationSeconds, sources);
  logStep1(`Experimental structure detection: ${suggestions.length} isolated section/title suggestions.`);
  if (job.previewPath && fs.existsSync(job.previewPath)) {
    const titles = await detectTitleBoundaries(job.previewPath, words, spoken, { signal, log: logStep1 });
    const acoustic = await detectMusicTransitions(job.previewPath, words, titles, { signal, log: logStep1 });
    suggestions = mergeDetectionSuggestions(suggestions, acoustic.filter(candidate => candidate.suggestionOnly));
    const windows = recoveryWindows(words, spoken, suggestions, job.totalDurationSeconds, sources);
    if (windows.length) {
      const engine = job.transcription?.engine || requestEngine(undefined);
      const model = job.transcription?.profile || job.selectedModelId || currentConfig.selected_model;
      const installed = await getModelInstallationStatus(model, engine);
      if (!installed.isInstalled) logStep1('Heading recheck skipped: the original model is unavailable locally. No model was downloaded.');
      else {
        const settings = { ...transcriptionSettings(engine, job.transcriptionSettings?.[engine]), batching: 'off' as const };
        const capability = await getBackendCapabilities(engine, true);
        try {
          const recovered = await recheckChapterWindows({ audio: job.previewPath, directory: projectIntermediatesDir(job), windows, original: words,
            settingsKey: processingKey('heading-recheck', engine, { model, settings, runtime: capability.runtimeVersion }), signal, log: logStep1,
            run: (audioPath, outputPath) => transcribeWithFallback(capability, settings, model, attempt => transcriptionEngines[engine].transcribe({
              pythonPath: getBackendPython(engine), audioPath, outputPath, engine, ...attempt, batchSize: null,
              modelId: engine === 'openai-whisper' && model === 'large-v3-turbo' ? 'turbo' : model,
              fasterModelRepository: FASTER_WHISPER_REPOSITORIES[model], localFilesOnly: true,
              localModelFile: engine === 'openai-whisper' ? installed.installedFile : undefined,
              fasterCacheDir: WHISPERX_MODEL_CACHE_DIR, openAiCacheDir: path.join(OPENAI_WHISPER_MODEL_CACHE_DIR, model),
              beamSize: settings.beamSize, language: job.transcription?.language || settings.language, signal,
              env: { ...transcriptionRuntimeEnv(engine), HF_HUB_OFFLINE: '1', HF_HOME: WHISPERX_MODEL_CACHE_DIR, TORCH_HOME: TORCH_CACHE_DIR, MPLCONFIGDIR: MATPLOTLIB_CACHE_DIR },
            }), logStep1, signal),
          });
          suggestions = mergeDetectionSuggestions(suggestions, recovered);
        } catch (error) {
          signal.throwIfAborted();
          logStep1(`Heading recheck unavailable; keeping transcript-based results: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  } else logStep1('Acoustic checks and heading recheck skipped: prepared audio is unavailable.');
  signal.throwIfAborted();
  return mergeDetectionSuggestions([], reconcileSources(mergeDetectionSuggestions(spoken, suggestions), sources));
}
async function transcriptionPlan(job: AudiobookJob, preparedAudioKey: string, engine = requestEngine(undefined)) {
  const model = speechModels.find(item => item.id === (job.selectedModelId || 'small')) || speechModels[1];
  const settings = transcriptionSettings(engine, job.transcriptionSettings?.[engine]);
  const capability = await getBackendCapabilities(engine, true);
  const attempt = selectTranscriptionAttempt(capability, settings, model.id);
  const requestKey = transcriptionRequestKey(preparedAudioKey, model.id, settings, capability, attempt);
  logStep1(`${engine}: ${capabilityLabel(capability, settings.device)}; runtime ${capability.runtimeVersion || 'unknown'}; GPU initialization ${capability.initialization}.${capability.reason ? ' Reason: ' + capability.reason : ''}`);
  return { engine, model, settings, capability, requestKey };
}
async function transcribeExistingPreview(job: AudiobookJob, signal: AbortSignal, plan?: Awaited<ReturnType<typeof transcriptionPlan>>) {
  if (!job.previewPath || !fs.existsSync(job.previewPath)) throw new Error('Generate the review preview before rerunning transcription.');
  if (!plan) {
    const sources = job.parts.map(part => path.resolve(APP_ROOT, job.sourceFolderPath || '', part.name));
    const keys = await sourceProcessingKeys(sources, job.mergeMethod || 'standard', files => sourceFingerprint(job, files));
    if (keys.sourceKey !== job.sourceKey || keys.preparedAudioKey !== job.preparedAudioKey) throw new Error('Source audio or preparation settings changed. Run full source processing before retranscribing.');
    plan = await transcriptionPlan(job, keys.preparedAudioKey);
  }
  const { engine, model, settings, capability, requestKey } = plan;
  const python = getBackendPython(engine);
  if (!fs.existsSync(python)) throw new Error('The selected transcription runtime is not ready. Open System Requirements.');
  for (const dir of [TORCH_CACHE_DIR, MATPLOTLIB_CACHE_DIR, OPENAI_WHISPER_MODEL_CACHE_DIR]) fs.mkdirSync(dir, { recursive: true });
  const normalizedPath = path.join(path.dirname(job.previewPath), `${path.parse(job.previewPath).name}.rerun-${Date.now()}.transcript.json`);
  try {
    const env = { ...transcriptionRuntimeEnv(engine), HF_HOME: WHISPERX_MODEL_CACHE_DIR, TORCH_HOME: TORCH_CACHE_DIR, MPLCONFIGDIR: MATPLOTLIB_CACHE_DIR };
    logStep1(`Transcription runtime: ${runtimeSelection?.backends[engine] ? 'system' : 'app-managed'} — ${python}`);
    logStep1('Transcript cache: Miss (or explicit transcription rerun).');
    const normalized = await transcribeWithFallback(capability, settings, model.id, attempt =>
      transcriptionEngines[engine].transcribe({
        pythonPath: python, audioPath: job.previewPath!, outputPath: normalizedPath,
        modelId: engine === 'openai-whisper' && model.id === 'large-v3-turbo' ? 'turbo' : model.id,
        fasterModelRepository: FASTER_WHISPER_REPOSITORIES[model.id], engine, ...attempt,
        beamSize: settings.beamSize, language: settings.language, signal, env,
        fasterCacheDir: WHISPERX_MODEL_CACHE_DIR, openAiCacheDir: path.join(OPENAI_WHISPER_MODEL_CACHE_DIR, model.id),
      }), logStep1, signal);
    if (normalized.device === 'cuda') capability.initialization = 'verified';
    const untimedSegments = missingWordTimestampSegments(normalized.segments);
    if (untimedSegments.length) {
      logStep1(`WARNING: ${untimedSegments.length} speech segments have no word timestamps. Their text and segment ranges are saved for manual review; available timed words remain usable.`);
      for (const segment of untimedSegments) logStep1(`Missing word timestamps [${formatTranscriptTimestamp(segment.start)} – ${formatTranscriptTimestamp(segment.end)}]: ${segment.text.trim()}`);
    }
    const words = buildTranscriptWords(normalized.segments);
    const transcription = {
      model: model.name, profile: model.id, language: normalized.language || settings.language, engine: normalized.engine,
      device: normalized.device, computeType: normalized.computeType, batchSize: normalized.batchSize, beamSize: normalized.beamSize,
      segmentsCount: normalized.segments.length, wordsCount: words.length, requestKey,
      completedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    return { segments: normalized.segments, words, transcription, transcriptKey: transcriptionResultKey(requestKey, transcription) };
  } finally {
    if (fs.existsSync(normalizedPath)) fs.unlinkSync(normalizedPath);
  }
}

function setStep1Stage(stage: Step1ProcessStage, task: string, logDetail?: string) {
  const previousStage = activeStep1ProgressState.stage;
  const previousIndex = activeStep1ProgressState.stages.findIndex(item => item.key === previousStage);
  const index = activeStep1ProgressState.stages.findIndex(item => item.key === stage);
  const definition = activeStep1ProgressState.stages[index];
  if (previousIndex >= 0 && previousStage !== stage) {
    logStep1(`Stage ${previousIndex + 1}/${activeStep1ProgressState.totalStages} completed: ${activeStep1ProgressState.stages[previousIndex].label}.`);
  }
  activeStep1ProgressState.stage = stage;
  activeStep1ProgressState.currentStageNumber = index >= 0 ? index + 1 : 0;
  activeStep1ProgressState.label = definition?.label || task;
  activeStep1ProgressState.currentTask = task;
  activeStep1ProgressState.liveStatusMessage = task;
  if (logDetail) logStep1(`Stage ${index + 1}/${activeStep1ProgressState.totalStages} started: ${logDetail}`);
}

function failStep1Stage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const failedStage = activeStep1ProgressState.stage;
  const definition = activeStep1ProgressState.stages.find(item => item.key === failedStage);
  activeStep1ProgressState.isActive = false;
  activeStep1ProgressState.canCancel = false;
  activeStep1ProgressState.failedStage = failedStage;
  activeStep1ProgressState.stage = 'error';
  activeStep1ProgressState.error = `${definition?.label || 'Processing'} failed: ${detail}`;
  activeStep1ProgressState.liveStatusMessage = activeStep1ProgressState.error;
  logStep1(`ERROR: ${activeStep1ProgressState.error}`);
}

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
  let driverVersion: string | undefined;
  let computeCapability: number | undefined;

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
      const { stdout } = await execFileAsync('nvidia-smi', ['-i', '0', '--query-gpu=driver_version,compute_cap', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true });
      const [driver, compute] = stdout.trim().split(',').map(value => value.trim());
      driverVersion = driver;
      if (Number.isFinite(Number(compute))) computeCapability = Number(compute);
    } catch { /* Older drivers may not expose compute capability. */ }
    try {
      const smiOutput = (await execAsync('nvidia-smi', {
        encoding: 'utf8',
        timeout: 3000, windowsHide: true,
      })).stdout;
      cudaVersion = parseNvidiaCudaVersion(smiOutput);
      if (!cudaVersion) console.warn('[Hardware] Could not read NVIDIA driver CUDA compatibility: unrecognized or unavailable CUDA version header.');
    } catch (error: any) { console.warn('[Hardware] NVIDIA driver CUDA compatibility check failed:', error.message); }
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
    cudaVersion, driverVersion, computeCapability,
    mode,
    recommendedPyTorchFlavor,
    recommendationSummary,
  };
}

// Scan and test all base dependencies
function transcriptionRuntimeEnv(engine?: TranscriptionBackend): NodeJS.ProcessEnv {
  const privateSites = isWin ? [path.join(VENV_DIR, 'Lib', 'site-packages')] : fs.existsSync(path.join(VENV_DIR, 'lib'))
    ? fs.readdirSync(path.join(VENV_DIR, 'lib')).filter(name => /^python3\.\d+$/.test(name)).map(name => path.join(VENV_DIR, 'lib', name, 'site-packages')) : [];
  const external = engine && runtimeSelection?.backends[engine];
  const libraryPaths = external ? external.libraryPaths : privateSites.flatMap(site => ['cublas', 'cudnn'].map(name => path.join(site, 'nvidia', name, isWin ? 'bin' : 'lib'))).filter(dir => fs.existsSync(dir));
  return { ...cleanPythonEnv(), PATH: [path.dirname(getFfmpeg()), path.dirname(getFfprobe()), ...libraryPaths, process.env.PATH || ''].join(path.delimiter),
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
const backendSnapshots = new Map<TranscriptionBackend, StatusCache<BackendCapabilities>>();
async function getBackendCapabilities(engine: TranscriptionBackend, refresh = false) {
  if (!backendSnapshots.has(engine)) backendSnapshots.set(engine, new StatusCache<BackendCapabilities>(5 * 60_000));
  const cache = backendSnapshots.get(engine)!;
  const load = async () => probeBackendCapabilities(getBackendPython(engine), engine, (await getFullHardwareEnvironment()).hasNvidiaGpu, transcriptionRuntimeEnv(engine));
  return refresh ? cache.refresh(load) : cache.get(load);
}
function invalidateRequirements(includeHardware = false) {
  for (const cache of backendSnapshots.values()) cache.invalidate();
  pythonSnapshot.invalidate();
  for (const cache of binarySnapshots.values()) cache.invalidate();
  if (includeHardware) hardwareSnapshot.invalidate();
}
async function checkActiveRequirements(includeCapabilities = false): Promise<RequirementsReport> {
  const [hw, packages] = await Promise.all([getFullHardwareEnvironment(), pythonPackages()]);
  const packageEngine = (name: string): TranscriptionBackend => ['openai-whisper', 'torch'].includes(name) ? 'openai-whisper' : 'faster-whisper';
  const probe = (name: string): PythonProbe => {
    const external = runtimeSelection?.backends[packageEngine(name)];
    return (external ? external.packages[name] : packages[name]) || {ok:false};
  };
  const components: BaseRequirementItem[] = [];
  const item = (value: BaseRequirementItem) => { components.push(value); return value; };

  const systemPython = runtimeSelection?.python.source === 'system' ? runtimeSelection.python : undefined;
  const pythonPath = systemPython?.path || getVenvPython();
  const pythonCheck = systemPython ? { ok: true, output: systemPython.version } : packages.python || { ok: false };
  item({ id: 'python', name: 'Python Runtime', purpose: 'System Python when compatible; missing engines use an isolated app environment.', classification: 'required', group: 'core', status: pythonCheck.ok ? 'ready' : 'missing', installedVersion: pythonCheck.output, installLocation: pythonPath, isAppManaged: !systemPython, source: systemPython ? 'system' : 'app', error: pythonCheck.ok ? undefined : 'The application runtime is not ready.' });

  for (const [id, name, binary, purpose] of [
    ['ffmpeg', 'FFmpeg', getFfmpeg(), 'Required for audiobook processing, merging, encoding, and export.'],
    ['ffprobe', 'FFprobe', getFfprobe(), 'Required to inspect audio streams and validate output.'],
  ] as const) {
    let output = '';
    try { output = await managedBinaryStatus(binary); } catch {}
    const source = runtimeSelection?.[id].source || 'app';
    item({ id, name, purpose, classification: 'required', group: 'core', status: output ? 'ready' : 'missing', installedVersion: output.split(' ')[2], installLocation: binary, source, isAppManaged: source === 'app', error: output ? undefined : `${name} is unavailable. Check again to rediscover system tools or use the app fallback.` });
  }

  const ytDlp = await getYtDlpStatus();
  item({ id: 'yt_dlp', name: 'yt-dlp', purpose: 'Optional download tool used only for YouTube inspection and audio import.', classification: 'optional', group: 'compatibility', status: ytDlp.status === 'installed' ? 'ready' : ytDlp.status === 'error' ? 'broken' : 'missing', installedVersion: ytDlp.version, installLocation: ytDlp.executablePath, isAppManaged: !ytDlp.isSystemInstalled, source: ytDlp.isSystemInstalled ? 'system' : 'app', managedInstalled: fs.existsSync(LOCAL_YT_DLP_PATH), managedLocation: LOCAL_YT_DLP_PATH, error: ytDlp.error });

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
    const names = optionalPackages[component.id];
    if (names) {
      const external = runtimeSelection?.backends[packageEngine(names[0])];
      component.source = external ? 'system' : 'app';
      component.isAppManaged = !external && (component.id !== 'nvidia_acceleration' || hw.hasNvidiaGpu);
      component.installLocation = external?.path || getVenvPython();
      component.managedInstalled = names.some(name => packages[name]?.ok);
      component.managedLocation = VENV_DIR;
      if (external && component.id === 'nvidia_acceleration') component.diagnosticDetails = 'CUDA libraries for this system engine must be managed in its own Python environment.';
    }
    component.canUninstall = component.classification === 'optional' && !!component.managedInstalled;
    component.uninstallImpact = removalImpact[component.id];
    const error = compatibilityErrors.get(component.id);
    if (error && component.source !== 'system') { component.status = 'broken'; component.error = error; }
  }

  const readiness = evaluateRequirementReadiness(components, { hasNvidiaGpu: hw.hasNvidiaGpu, accelerationPackagesReady: cudaDevices > 0 });
  const statusColor = readiness.statusColor;
  return {
    runtimeMode: runtimeSelection?.mode || 'hybrid', runtimeWarnings: runtimeSelection?.warnings || [],
    timestamp: new Date().toISOString(), allReady: readiness.allReady, statusColor,
    needsAttentionCount: readiness.needsAttentionCount,
    summaryMessage: statusColor === 'red'
      ? 'Setup required: install the core tools and at least one transcription engine, then download a model for that engine in Models.'
      : statusColor === 'yellow'
        ? 'A complete workflow is available. Faster Whisper or GPU acceleration can improve performance.'
        : 'Runtime dependencies are ready. Manage downloaded transcription models in Models.',
    hardware: hw, components, availableUpdatesCount: 0, pytorchBuild: pytorchBuildOptions(hw),
    ...(includeCapabilities ? { backendCapabilities: Object.fromEntries(await Promise.all(
      (['faster-whisper', 'openai-whisper'] as const).map(async engine => [engine, await getBackendCapabilities(engine)]),
    )) } : {}),
  };
}

// ----------------------------------------------------
// Requirements API Endpoints
// ----------------------------------------------------

// 1. Get Requirements Status Report
app.get('/api/requirements/status', asyncRoute(async (req, res) => {
  try {
    if (req.query.refresh === 'true') {
      if (cleanupInProgress() || runtimeRequests || runtimeDiscoveryRunning) return res.status(409).json({ error: 'Wait for active work to finish before rescanning system tools.' });
      await refreshRuntimeSelection();
      invalidateRequirements(true);
    }
    const report = await checkActiveRequirements(true);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to inspect requirements' });
  }
}));

app.get('/api/transcription/capabilities', asyncRoute(async (req, res) => {
  const engine = req.query.engine;
  if (engine !== 'faster-whisper' && engine !== 'openai-whisper') return res.status(400).json({ error: 'Unknown transcription engine' });
  res.json(await getBackendCapabilities(engine, req.query.refresh === 'true'));
}));

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
app.post('/api/requirements/install-repair', asyncRoute(async (req, res) => {
  if (cleanupInProgress() || runtimeRequests || runtimeDiscoveryRunning) {
    return res.status(400).json({ error: 'An installation or repair task is already running.' });
  }

  const report = await checkActiveRequirements();
  if (cleanupInProgress() || runtimeRequests || runtimeDiscoveryRunning) return res.status(409).json({ error: 'Wait for active work to finish before changing requirements.' });
  let torchPlan: ReturnType<typeof pytorchInstallPlan>;
  try { torchPlan = pytorchInstallPlan(report, req.body?.pytorchFlavor, req.body?.confirmPytorchReplacement === true); }
  catch (error: any) { return res.status(400).json({ error: error.message }); }
  // Another request may have started an install while this one awaited probes.
  if (activeInstallProgress.isActive) return res.status(409).json({ error: 'An installation or repair task is already running.' });
  const selectedIds = Array.isArray(req.body?.selectedIds) ? req.body.selectedIds.filter((id: unknown) => typeof id === 'string') : [];
  const componentsToFix = selectedMissingRequirements(report.components, selectedIds).sort((a, b) => Number(b.id === 'pytorch') - Number(a.id === 'pytorch'));
  if (torchPlan && !componentsToFix.some(item => item.id === 'pytorch')) componentsToFix.unshift(report.components.find(item => item.id === 'pytorch')!);
  if (!torchPlan && componentsToFix.some(item => item.id === 'pytorch' && item.installedVersion)) return res.status(400).json({ error: 'Select a PyTorch build and confirm replacement before repairing the existing installation.' });
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

  runtimeMutationRunning = true;
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
        recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Starting repair/installation: ${comp.name}`);

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
              recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Created and verified folder permissions: ${targetDir}`);
            } catch (err: any) {
              recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Warning: ${err.message}`);
            }
          }
        } else if (comp.id === 'python') {
          activeInstallProgress.currentActivity = 'Deploying Isolated Python Runtime...';
          recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Downloading the application-managed Python 3.10.11 runtime...`);

          try {
            if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
            if (!fs.existsSync(PORTABLE_PYTHON_DIR)) fs.mkdirSync(PORTABLE_PYTHON_DIR, { recursive: true });

            const zipDest = path.join(RUNTIME_DIR, 'python.zip');
            await downloadFile(PORTABLE_PYTHON_URL, zipDest);
            recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Download complete. Extracting to ${PORTABLE_PYTHON_DIR}...`);

            // Extraction using system tools to keep binary count low
            if (isWin) {
              await execAsync(`powershell -Command "Expand-Archive -Path '${zipDest}' -DestinationPath '${PORTABLE_PYTHON_DIR}' -Force"`);
            } else {
              await execAsync(`tar -xzf "${zipDest}" -C "${PORTABLE_PYTHON_DIR}" --strip-components=1`);
            }
            
            // Cleanup zip
            try { fs.unlinkSync(zipDest); } catch(e) {}

            if (fs.existsSync(PORTABLE_PYTHON_EXE)) {
              recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Isolated Python runtime successfully deployed.`);
              await runSpawnCmd(PORTABLE_PYTHON_EXE, ['-m', 'venv', VENV_DIR], appendInstallDiagnostic);
              pythonSnapshot.invalidate();
            } else {
              throw new Error("Extraction failed: Python executable not found in expected location.");
            }
          } catch (err: any) {
            recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Critical Error during Python deployment: ${err.message}`);
            throw err;
          }
        } else if (['faster_whisper', 'ctranslate2', 'openai_whisper', 'pytorch', 'nvidia_acceleration'].includes(comp.id)) {
          const python = getVenvPython();
          if (!fs.existsSync(python) || !fs.existsSync(path.join(VENV_DIR, 'pyvenv.cfg'))) {
            const basePython = runtimeSelection?.python.source === 'system' ? runtimeSelection.python.path : PORTABLE_PYTHON_EXE;
            await runSpawnCmd(basePython, ['-m', 'venv', VENV_DIR], appendInstallDiagnostic);
          }
          // Recheck after parent installs: pip may have already supplied this dependency.
          if ((comp.id === 'pytorch' && torchPlan) || (await checkActiveRequirements()).components.find(item => item.id === comp.id)?.status !== 'ready') {
            const packages: Record<string, string[]> = {
              faster_whisper: ['faster-whisper'], ctranslate2: ['ctranslate2'],
              openai_whisper: ['openai-whisper'],
              pytorch: [`torch==${TORCH_VERSION}${process.platform === 'darwin' ? '' : '+' + (torchPlan?.index || 'cpu')}`, '--index-url', `https://download.pytorch.org/whl/${torchPlan?.index || 'cpu'}`],
              nvidia_acceleration: ['nvidia-cublas-cu12', 'nvidia-cudnn-cu12>=9,<10'],
            };
            await runSpawnCmd(python, ['-m', 'pip', 'install', ...packages[comp.id]], appendInstallDiagnostic);
            invalidateRequirements();
          }
        } else if (comp.id === 'ffmpeg' || comp.id === 'ffprobe') {
          if (mediaBinariesConfigured) {
            recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Application-local FFmpeg and FFprobe were already configured during this repair.`);
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

      // Verification is a bounded final check; cancellation stops between install steps.
      activeInstallProgress.canCancel = false;
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
      recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Running automated post-installation diagnostics...`);
      await new Promise(r => setTimeout(r, 800));

      invalidateRequirements();
      if (torchPlan) {
        const capability = await getBackendCapabilities('openai-whisper');
        if (torchPlan.flavor === 'cuda' && !capability.gpuAvailable) throw new Error('CUDA PyTorch was installed but GPU initialization failed: ' + capability.reason);
        if (torchPlan.flavor === 'cpu' && capability.cudaBuilt !== false) throw new Error('CPU PyTorch build verification failed.');
      }
      const updatedReport = await checkActiveRequirements(true);
      activeInstallProgress.overallProgress = 100;
      activeInstallProgress.canCancel = false;

      if (selectedMissingRequirements(updatedReport.components, selectedIds).length === 0) {
        activeInstallProgress.isActive = false;
        activeInstallProgress.phase = 'completed';
        activeInstallProgress.currentActivity = 'Installation and repair complete.';
        activeInstallProgress.successMessage = 'Selected components installed and verified. Download a speech model in Models if needed.';
        recordInstallUiLine(`[${new Date().toLocaleTimeString()}] All required base components are ready. Speech models remain separately managed.`);
      } else {
        const remaining = selectedMissingRequirements(updatedReport.components, selectedIds);
        activeInstallProgress.isActive = false;
        activeInstallProgress.phase = 'error';
        activeInstallProgress.currentActivity = 'Installation did not pass verification.';
        activeInstallProgress.error = `Verification failed: ${remaining.map(component => component.name).join(', ')} still need attention.`;
        recordInstallUiLine(`[${new Date().toLocaleTimeString()}] ${activeInstallProgress.error}`);
      }
    } catch (err: any) {
      invalidateRequirements();
      activeInstallProgress.isActive = false;
      activeInstallProgress.canCancel = false;
      activeInstallProgress.phase = 'error';
      activeInstallProgress.error = err.message || 'Installation error occurred.';
      recordInstallUiLine(`[${new Date().toLocaleTimeString()}] ERROR: ${err.message}`);
      appendInstallDiagnostic(`ERROR: ${err.stack || err.message}`, false);
    } finally {
      if (activeInstallProgress.phase === 'cancelled') {
        activeInstallProgress.isActive = false;
        activeInstallProgress.canCancel = false;
        activeInstallProgress.currentActivity = 'Installation cancelled. The current step has finished; run Check or Repair before using the tool.';
      }
      runtimeMutationRunning = false;
    }
  })();
}));

// Removal targets are an allowlist of private distributions, never request paths.
app.post('/api/requirements/uninstall', asyncRoute(async (req, res) => {
  if (cleanupInProgress() || runtimeRequests || runtimeDiscoveryRunning) return res.status(409).json({ error: 'Wait for active work to finish before removing requirements.' });
  const id = String(req.body?.id || '');
  let names: string[];
  try {
    const report = await checkActiveRequirements();
    names = optionalRemoval(id, req.body?.confirmed === true, !!report.components.find(item => item.id === id)?.canUninstall);
    assertManagedTarget(APP_ROOT, id === 'yt_dlp' ? LOCAL_YT_DLP_PATH : VENV_DIR);
  } catch (error: any) { return res.status(400).json({ error: error.message }); }
  if (cleanupInProgress() || runtimeRequests || runtimeDiscoveryRunning) return res.status(409).json({ error: 'Wait for active work to finish before removing requirements.' });
  runtimeMutationRunning = true;
  activeInstallProgress = { isActive: true, phase: 'in_progress', currentItemId: id, currentActivity: 'Removing app-managed component…', overallProgress: 10, logs: [], canCancel: false };
  res.json({ status: 'started' });
  void (async () => {
    try {
      appendInstallDiagnostic(`Uninstall requested: ${id}. Only the app-owned copy will be removed. Models, projects and system installations are preserved.`);
      if (id === 'yt_dlp') await uninstallLocalYtDlp();
      else {
        const python = getVenvPython();
        await execFileAsync(python, ['-c', PRIVATE_UNINSTALL_CHECK, VENV_DIR, JSON.stringify(names)], { env: cleanPythonEnv(), timeout: 15000, windowsHide: true });
        await runSpawnCmd(python, ['-m', 'pip', 'uninstall', '--yes', ...names], appendInstallDiagnostic);
        invalidateRequirements();
        const remaining = await pythonPackages();
        if (!remaining.python?.ok || names.some(name => remaining[name]?.ok)) throw new Error('Could not verify that the app-managed packages were removed. See the log.');
      }
      compatibilityErrors.delete(id);
      invalidateRequirements();
      activeInstallProgress.phase = 'completed';
      activeInstallProgress.overallProgress = 100;
      activeInstallProgress.successMessage = 'App-managed copy removed. Reinstall it here if needed. System tools, models and projects were kept.';
      appendInstallDiagnostic(activeInstallProgress.successMessage);
    } catch (error: any) {
      activeInstallProgress.phase = 'error';
      activeInstallProgress.error = String(error.stderr || error.message);
      appendInstallDiagnostic(`ERROR removing ${id}: ${error.stack || error.message}\n${error.stderr || ''}`);
    } finally {
      invalidateRequirements();
      activeInstallProgress.isActive = false;
      runtimeMutationRunning = false;
    }
  })();
}));

// 4. Cancel active installation
app.post('/api/requirements/cancel', (req, res) => {
  if (!activeInstallProgress.canCancel) return res.status(409).json({ error: 'This operation cannot be cancelled safely. Wait for it to finish.' });
  if (!activeInstallProgress.isActive) {
    return res.status(400).json({ error: 'No active installation task to cancel.' });
  }

  invalidateRequirements();
  activeInstallProgress.phase = 'cancelled';
  activeInstallProgress.canCancel = false;
  activeInstallProgress.currentActivity = 'Cancelling after the current installation step finishes…';
  recordInstallUiLine(`[${new Date().toLocaleTimeString()}] Cancellation requested. Waiting for the current step to finish safely; remaining steps will be skipped.`);
  res.json({ status: 'ok', message: 'Cancellation requested. Waiting for the current installation step.' });
});

// 5. Check for Updates on Application-Managed Dependencies
app.get('/api/requirements/updates', asyncRoute(async (req, res) => {
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
}));

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

// A desktop-only operation: do not let another machine or web origin open a
// dialog on the host computer. The selected path is validated again on use.
app.post('/api/system/pick-audio-file', asyncRoute(async (req, res) => {
  const remote = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return res.status(403).json({ error: 'File browsing is available only on this computer.' });
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'File browsing requires the SwissMouse window.' }); }
    catch { return res.status(403).json({ error: 'Invalid browser origin.' }); }
  }
  try { res.json({ path: await pickAudioFile(SUPPORTED_AUDIO_EXTENSIONS) }); }
  catch (error: any) { res.status(503).json({ error: error.message || 'Could not open the file browser.' }); }
}));

app.post('/api/system/pick-audio-files', asyncRoute(async (req, res) => {
  const remote = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return res.status(403).json({ error: 'File browsing is available only on this computer.' });
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'File browsing requires the SwissMouse window.' }); }
    catch { return res.status(403).json({ error: 'Invalid browser origin.' }); }
  }
  try { res.json({ paths: await pickAudioFiles(SUPPORTED_AUDIO_EXTENSIONS) }); }
  catch (error: any) { res.status(503).json({ error: error.message || 'Could not open the file browser.' }); }
}));

app.post('/api/system/pick-audio-folder', asyncRoute(async (req, res) => {
  const remote = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return res.status(403).json({ error: 'Folder browsing is available only on this computer.' });
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Folder browsing requires the SwissMouse window.' }); }
    catch { return res.status(403).json({ error: 'Invalid browser origin.' }); }
  }
  try { res.json({ path: await pickAudioFolder() }); }
  catch (error: any) { res.status(503).json({ error: error.message || 'Could not open the folder browser.' }); }
}));

// FFprobe / FFmpeg media inspector
function probeAudioFile(filePath: string) {
  return inspect(getFfprobe(), filePath);
}

// Local Recursive Directory Scanner (Supports Layout A, Layout B, and Layout C with natural sorting)
const mediaCache = new MediaCache(inspectAsync);
const libraryMedia = new LibraryMediaReader();
async function scanLocalFolder(folderPath: string): Promise<FolderScanResult> {
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
  const excludedWorkspaces = new Set(knownIntermediatesRoots().map(pathKey));

  async function walk(currentDir: string, relativeParent = '') {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    // Sort naturally: Chapter 2 before Chapter 10
    const sortedEntries = naturalSort(entries, e => e.name);

    await mapScanWork(sortedEntries.filter(entry => !entry.isDirectory()), 4, async entry => {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativeParent ? path.join(relativeParent, entry.name) : entry.name;

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().replace('.', '');
        const fileStat = await fs.promises.stat(fullPath);

        if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
          // Probe with FFprobe
          let probe: ReturnType<typeof probeAudioFile>;
          try { probe = await mediaCache.read(getFfprobe(), fullPath); } catch (error: any) {
            unsupportedFiles.push({ fileName: entry.name, relativePath: relPath, reason: error.message, sizeBytes: fileStat.size });
            return;
          }
          const folderName = relativeParent ? path.basename(relativeParent) : 'Root';
          if (relativeParent) {
            chapterFoldersSet.add(relativeParent);
          }

          const tagNumber = (keys: string[]) => {
            const value = Object.entries(probe.tags).find(([key]) => keys.includes(key.toLowerCase()))?.[1];
            const number = Number(/^\s*(\d+)/.exec(String(value || ''))?.[1]);
            return number > 0 ? number : undefined;
          };
          audioFiles.push({
            relativePath: relPath,
            tags: Object.fromEntries(Object.entries(probe.tags).map(([key, value]) => [key, String(value)])),
            discNumber: tagNumber(['disc', 'discnumber', 'disk', 'disknumber', 'tpos']),
            trackNumber: tagNumber(['track', 'tracknumber', 'trck']),
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
    });
    for (const entry of sortedEntries.filter(entry => entry.isDirectory())) {
      const fullPath = path.join(currentDir, entry.name);
      if (['.swissmouse-work', '.swissmouse'].includes(entry.name.toLowerCase()) || excludedWorkspaces.has(pathKey(fullPath))) continue;
      chapterFoldersSet.add(entry.name);
      await walk(fullPath, relativeParent ? path.join(relativeParent, entry.name) : entry.name);
    }
  }

  await walk(resolved);

  // Natural sort for files
  const sortedFiles = audioFiles.sort(sourceOrderCompare);
  const orderWarning = sortedFiles.length > 1 && sortedFiles.some(file => !hasExplicitSourceOrder(file))
    ? 'Some files have no clear disc or track number. Check the processing order before running.' : undefined;
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
    orderWarning,
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
  const executablePath = runtimeSelection?.ytDlp.path || LOCAL_YT_DLP_PATH;
  const isSystemInstalled = runtimeSelection?.ytDlp.source === 'system';
  let version: string | undefined;

  version = isSystemInstalled ? runtimeSelection?.ytDlp.version : (await ytDlpVersion.get(() => checkBinaryVersion(LOCAL_YT_DLP_PATH))) || undefined;

  // Check FFmpeg and FFprobe
  const ffmpegVerLine = await managedBinaryStatus(getFfmpeg());
  const ffprobeVerLine = await managedBinaryStatus(getFfprobe());
  const ffmpegAvailable = Boolean(ffmpegVerLine);
  const ffprobeAvailable = Boolean(ffprobeVerLine);

  let status: YtDlpStatusState = 'not_installed';
  if (isYtDlpInstalling) {
    status = 'downloading';
  } else if (ytDlpInstallError && !isSystemInstalled) {
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
    error: isSystemInstalled ? undefined : ytDlpInstallError || undefined,
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
    assertManagedTarget(APP_ROOT, LOCAL_YT_DLP_PATH);
    fs.unlinkSync(LOCAL_YT_DLP_PATH);
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
app.get('/api/system/hardware', asyncRoute(async (req, res) => {
  const hw = await getHardwareInfo();
  res.json(hw);
}));

// Get speech models list
app.get('/api/models', asyncRoute(async (req, res) => {
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
}));

// Force refresh model detection from disk
app.post('/api/models/refresh', asyncRoute(async (req, res) => {
  const backend: TranscriptionEngineId = requestEngine(req.query.engine);
  await ensureModels(backend, true);
  const hw = await getHardwareInfo();
  const modelsWithCompatibility = backendModels[backend].map(m => ({
    ...m,
    isCompatible: hw.mode === 'gpu' ? true : !m.requiresGpu,
    isRecommended: m.id === hw.recommendedModelId,
  }));
  res.json({ status: 'ok', models: modelsWithCompatibility });
}));

// Get local models directory info and disk usage
app.get('/api/models/info', asyncRoute(async (req, res) => {
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
}));

// Download a Faster-Whisper model snapshot into the portable app cache. This is
// separate from Runtime Repair because model weights are installed only when a
// user explicitly chooses one in the Models section.
app.post('/api/models/:id/prepare', requireFeatures(['faster_model_management'], 'Model download'), asyncRoute(async (req, res) => {
  const modelId = req.params.id;
  const model = backendModels['faster-whisper'].find(m => m.id === modelId);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const backend: TranscriptionEngineId = requestEngine(req.query.engine);
  if (backend === 'openai-whisper') {
    return res.status(400).json({ error: 'Use the compatibility model download action for OpenAI Whisper.' });
  }
  const repository = FASTER_WHISPER_REPOSITORIES[modelId];
  if (!repository) return res.status(400).json({ error: `No Faster-Whisper repository is configured for '${modelId}'.` });
  const venvPython = getBackendPython('faster-whisper');
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
  const child = spawn(venvPython, ['-c', pythonScript], { shell: false, windowsHide: true, env: transcriptionRuntimeEnv('faster-whisper') });
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
}));

// OpenAI Whisper downloads use their own PyTorch checkpoint cache.
app.post('/api/models/:id/install', requireFeatures(['openai_model_management'], 'Model download'), asyncRoute(async (req, res) => {
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
}));

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
app.post('/api/models/:id/uninstall', asyncRoute(async (req, res) => {
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
}));

// Scan local folder
app.post('/api/system/scan-folder', requireFeatures(['folder_scan'], 'Folder scan'), asyncRoute(async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ error: 'folderPath is required' });
  }

  try {
    const result = await scanLocalFolder(folderPath);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to scan folder' });
  }
}));

function bookSourceRoot(job: AudiobookJob): string | undefined {
  if (job.sourceFolderPath) return job.sourceFolderPath;
  if (job.source?.mode === 'folder') return job.source.path;
  return job.sourceFolderPath || (job.source?.mode === 'file' ? path.dirname(job.source.path) : undefined);
}
function sourceRelative(job: AudiobookJob, part: AudiobookJob['parts'][number]): string {
  return (part.sourceRelativePath || part.name).replace(/\\/g, '/');
}
function bookFileStamp(root: string, relative: string) {
  const file = path.resolve(root, relative);
  if (!within(root, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined;
  const stat = fs.statSync(file);
  return { sizeBytes: stat.size, modifiedMs: stat.mtimeMs, device: stat.dev, inode: stat.ino };
}
function sourceFingerprint(job: AudiobookJob, files: string[]) {
  const logical = job.parts.map((part, index) => job.sourcePathIdentity?.[sourceRelative(job, part)] || files[index]);
  return fingerprint(files, {}, logical);
}
function sourceFilesInvalidated(job: AudiobookJob) {
  retainMetadataOverrides(job);
  job.libraryScan = undefined;
  job.processingStatus = 'incomplete';
  job.sourceFilesChanged = true;
  job.retainedWaveform = undefined;
  job.sourceKey = undefined;
  job.preparedAudioKey = undefined;
  job.staleSteps = [...new Set([...(job.staleSteps || []), 'chapter_detection', 'chapter_review', 'export', 'validation'] as const)];
  job.pipelineSteps = Object.fromEntries(Object.entries(job.pipelineSteps || {}).map(([key, state]) =>
    [key, key !== 'metadata_processing' && state?.hasOutput ? { ...state, status: 'stale' } : state])) as AudiobookJob['pipelineSteps'];
}
function updateSourceTotals(job: AudiobookJob) {
  job.parts.forEach((part, index) => { part.order = index + 1; });
  job.totalSizeBytes = job.parts.length ? job.parts.reduce((sum, part) => sum + part.sizeBytes, 0) : job.outputM4b?.sizeBytes || 0;
  job.totalDurationSeconds = job.parts.length ? job.parts.reduce((sum, part) => sum + part.durationSeconds, 0) : job.outputM4b?.duration || 0;
  job.hasNestedChapterFolders = !!job.discoveredFiles?.some(file => !!file.chapterGroup);
  job.sourceOrderWarning = !job.sourceOrderManual && job.parts.length > 1 && job.parts.some(part =>
    !hasExplicitSourceOrder({ relativePath: sourceRelative(job, part), discNumber: part.discNumber, trackNumber: part.trackNumber }))
    ? 'Some files have no clear disc or track number. Check the processing order before running.' : undefined;
}
function bookSourceTree(job: AudiobookJob, root: string, directory?: string) {
  const durationByPath = new Map((job.discoveredFiles || []).map(file => [file.relativePath.replace(/\\/g, '/'), file.durationSeconds]));
  const included = new Set(job.parts.map(part => sourceRelative(job, part)));
  const listing = directory ? listBookDirectory(directory, SUPPORTED_AUDIO_EXTENSIONS, knownIntermediatesRoots()) : undefined;
  const entries = (listing ? listing.entries.map(entry => ({ ...entry, relativePath: path.relative(root, path.join(listing.directory, entry.name)).replace(/\\/g, '/') }))
    : listBookTree(root, SUPPORTED_AUDIO_EXTENSIONS, knownIntermediatesRoots())).map(entry => ({ ...entry, path: path.resolve(root, entry.relativePath),
    included: entry.type === 'file' ? included.has(entry.relativePath) : undefined, durationSeconds: durationByPath.get(entry.relativePath) }));
  const observed = new Map((job.sourceInventory || job.discoveredFiles || []).map(file => [file.relativePath.replace(/\\/g, '/'), file]));
  const excluded = new Set(job.excludedSourceFiles || []);
  const outputs = new Set([job.outputM4b?.fullPath, ...Object.values(job.exportedFiles || {}), ...(job.exports || []).map(item => item.fullPath)].filter(Boolean).map(file => pathKey(file!)));
  const groups = probableBookGroups(entries.filter(entry => entry.audio && !excluded.has(entry.relativePath) && !outputs.has(pathKey(path.join(root, entry.relativePath))))
    .map(entry => ({ ...observed.get(entry.relativePath), relativePath: entry.relativePath })), path.basename(root));
  return { directory: listing?.directory || root, parent: listing?.parent, canManage: !listing || pathKey(root) === pathKey(listing.directory) || within(root, listing.directory),
    missingFiles: job.parts.filter(part => !fs.existsSync(path.resolve(root, sourceRelative(job, part)))).map(part => sourceRelative(job, part)),
    membership: job.sourceMembership || 'automatic', review: job.sourceMembershipReview, root, scope: job.bookScope || { title: job.name }, groups, name: path.basename(root), entries, order: job.parts.map(part => sourceRelative(job, part)), summary: {
    audioFiles: job.parts.length,
    diskAudioFiles: entries.filter(entry => entry.audio).length,
    folders: entries.filter(entry => entry.type === 'folder').length,
    durationSeconds: job.parts.reduce((sum, part) => sum + part.durationSeconds, 0),
  } };
}

app.get('/api/jobs/:id/source-tree', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  const root = bookSourceRoot(job);
  if (!root) return res.status(400).json({ error: 'Select a local book source first.' });
  try {
    res.json(bookSourceTree(job, root, req.query.view === 'directory' ? (typeof req.query.directory === 'string' ? req.query.directory : root) : undefined));
  } catch (error: any) { res.status(400).json({ error: error.message || 'Could not read book files.' }); }
});

app.post('/api/jobs/:id/source-folder/open', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  const root = bookSourceRoot(job);
  if (!root) return res.status(400).json({ error: 'Select a local book source first.' });
  let directory: string;
  try {
    directory = listBookDirectory(typeof req.body?.directory === 'string' ? req.body.directory : root, SUPPORTED_AUDIO_EXTENSIONS, knownIntermediatesRoots()).directory;
    if (!fs.statSync(directory).isDirectory()) throw new Error('Source is not a folder.');
  } catch {
    return res.status(404).json({ error: 'The source folder is no longer available. Choose or relink the source folder first.' });
  }
  try { await launchFolder(directory); res.json({ status: 'ok', directory }); }
  catch (error: any) { res.status(500).json({ error: `Could not open the source folder: ${error.message}` }); }
}));


// Resolve ownership by physical path, independently of a project's browse root.
function sourceOwners(files: string[], except?: string) {
  const canonical = (file: string) => pathKey(fs.existsSync(file) ? fs.realpathSync(file) : file);
  const selected = new Set(files.map(canonical));
  return jobs.filter(job => job.id !== except && !job.libraryScan?.superseded).flatMap(job => {
    const paths = sourceFilePaths(job);
    const owned = job.parts.filter((_part, index) => selected.has(canonical(paths[index])));
    return owned.length ? [{ job, files: owned.map(part => sourceRelative(job, part)) }] : [];
  });
}
function removeSourceMembership(job: AudiobookJob, files: string[]) {
  const removed = new Set(files);
  job.parts = job.parts.filter(part => !removed.has(sourceRelative(job, part)));
  job.discoveredFiles = job.discoveredFiles?.filter(file => !removed.has(file.relativePath.replace(/\\/g, '/')));
  job.excludedSourceFiles = [...new Set([...(job.excludedSourceFiles || []), ...files])];
  job.explicitlyAddedSourceFiles = job.explicitlyAddedSourceFiles?.filter(file => !removed.has(file));
  for (const file of files) { delete job.sourceFileStamps?.[file]; delete job.sourcePathIdentity?.[file]; }
  job.sourceMembership = 'confirmed';
  if (!job.parts.length) job.sourceMembershipReview = 'All source files were reassigned. Select files before processing this project.';
  sourceFilesInvalidated(job);
  updateSourceTotals(job);
}

function bookFilesBusyReason(ownRequest = true): string | undefined {
  if (step1TaskRunning) return 'audio processing';
  if (sourceImports.size) return `source import or file verification (${[...sourceImports].join(', ')})`;
  const exporting = jobs.find(job => job.exports?.some(item => item.status === 'running' || item.status === 'queued'));
  if (exporting) return `export for ${exporting.name}`;
  if (libraryScanRunning) return 'the library scan';
  if (libraryMoveRunning) return 'the verified file move';
  if (activeLibraryMutations > (ownRequest ? 1 : 0)) return `file operations (${[...libraryMutationRequests.values()].join(', ')})`;
  if (metadataWriteJobs.size) return 'metadata writing';
  if (activeInstallProgress.isActive) return 'component installation';
  if (runtimeMutationRunning) return 'runtime changes';
  if (isYtDlpInstalling) return 'the downloader installation';
  if (activeModelDownloads.size || activeFasterWhisperInstalls.size) return 'speech model downloads';
}
app.get('/api/operations/status', (_req, res) => res.json({ busy: bookFilesBusyReason(false) || null }));

registerBookFilesRoutes(app, {
  jobs: () => jobs, getJob: id => projectStore.get(id), config: () => currentConfig, appRoot: APP_ROOT,
  root: bookSourceRoot, excluded: knownIntermediatesRoots,
  busy: () => !!bookFilesBusyReason(), busyReason: bookFilesBusyReason,
  lock: (id, locked) => { libraryMoveRunning = locked; if (locked) sourceImports.add(id); else sourceImports.delete(id); },
  persist: persistJobsAtomically, invalidate: sourceFilesInvalidated, totals: updateSourceTotals, remove: removeSourceMembership,
  select: localAudioSelection,
  thumbnail: file => libraryMedia.thumbnail(getFfmpeg(), getFfprobe(), file),
  read: file => mediaCache.read(getFfprobe(), file), ffmpeg: getFfmpeg, ffprobe: getFfprobe,
  probe: file => inspectAsync(getFfprobe(), file),
  log: (job, message, failed) => {
    job.logs.push({ timestamp: new Date().toISOString(), level: failed ? 'ERROR' : 'INFO', message: 'Book Files: ' + message });
    appendMasterEvent('Book Files', message, failed ? 'ERROR' : 'INFO');
  },
});

// Preview and commit the same plan. Confirmation binds file stamps and every
// affected manifest so a concurrent edit requires a fresh user-visible preview.
app.post('/api/jobs/:id/source-selection', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (cleanupBusyResponse(res)) return;
  if (sourceImports.size || step1TaskRunning || libraryScanRunning || activeLibraryMutations > 1 || metadataWriteJobs.size ||
      jobs.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status))))
    return res.status(409).json({ error: 'Wait for current processing or file operations to finish.' });
  libraryMoveRunning = true;
  let before: { job: AudiobookJob; snapshot: AudiobookJob }[] = [];
  let createdId: string | undefined;
  try {
    const root = bookSourceRoot(job);
    const action = req.body?.action;
    if (!root || !['create', 'replace'].includes(action)) throw new Error('Choose a local source and a manual grouping action.');
    if (!Array.isArray(req.body.files) || !req.body.files.length || req.body.files.some((file: unknown) => typeof file !== 'string')) throw new Error('Select audio files first.');
    const relativePaths = (req.body.files as string[]).map(file => file.replace(/\\/g, '/'));
    if (new Set(relativePaths).size !== relativePaths.length) throw new Error('Select each file only once.');
    const available = new Set(listBookTree(root, SUPPORTED_AUDIO_EXTENSIONS, knownIntermediatesRoots()).filter(entry => entry.audio).map(entry => entry.relativePath));
    if (relativePaths.some(file => !available.has(file))) throw new Error('Selected audio is unavailable. Refresh the file browser.');
    const selected: DiscoveredAudioFile[] = (await Promise.all(relativePaths.map(async relativePath => {
      const file = resolveBookAudio(root, relativePath, SUPPORTED_AUDIO_EXTENSIONS);
      const media = await mediaCache.read(getFfprobe(), file);
      const tags = Object.fromEntries(Object.entries(media.tags).map(([key, value]) => [key.toLowerCase(), String(value)]));
      const number = (value?: string) => Number(/^\s*(\d+)/.exec(value || '')?.[1]) || undefined;
      return { relativePath, fileName: path.basename(file), folderName: path.dirname(relativePath), tags,
        trackNumber: number(tags.track || tags.tracknumber), discNumber: number(tags.disc || tags.discnumber),
        format: media.format, codec: media.codec, sampleRate: media.sampleRate, channels: media.channels,
        streamSignature: media.streamSignature, isProbed: true, sizeBytes: fs.statSync(file).size,
        durationSeconds: media.durationSeconds, bitrate: media.bitrate };
    }))).sort(sourceOrderCompare);
    if (job.sourceOrderManual && selected.every(file => job.parts.some(part => sourceRelative(job, part) === file.relativePath))) {
      const order = new Map(job.parts.map((part, index) => [sourceRelative(job, part), index]));
      selected.sort((a, b) => order.get(a.relativePath)! - order.get(b.relativePath)!);
    }
    const owners = sourceOwners(selected.map(file => path.join(root, file.relativePath)), action === 'replace' ? job.id : undefined);
    const groups = probableBookGroups(selected);
    const coherent = groups.length === 1;
    const title = coherent ? groups[0].title : 'Selected audio � review title';
    const metadata = metadataFromTags(coherent ? selected[0].tags || {} : {}, title, selected.length === 1);
    if (coherent && !metadata.author) metadata.author = groups[0].author;
    const review = !coherent || !selected[0].tags?.album ? 'Review the inferred title and metadata for these manually selected files.' : undefined;
    const selectedPaths = selected.map(file => file.relativePath);
    const removed = action === 'replace' ? job.parts.map(part => sourceRelative(job, part)).filter(file => !selectedPaths.includes(file)) : [];
    const transfers = owners.map(owner => ({ id: owner.job.id, name: owner.job.name, files: owner.files, remaining: owner.job.parts.length - owner.files.length }));
    const token = createHash('sha256').update(JSON.stringify({ action, root, selectedPaths,
      stamps: selectedPaths.map(file => bookFileStamp(root, file)),
      affected: [job, ...owners.map(owner => owner.job)].map(item => ({ id: item.id, name: item.name, source: item.source, sourceFolderPath: item.sourceFolderPath, parts: item.parts, excluded: item.excludedSourceFiles, membership: item.sourceMembership, metadata: item.metadata, metadataDraft: item.metadataDraft })) })).digest('hex');
    const plan = { action, files: selectedPaths, removed, transfers, title: action === 'replace' ? job.name : metadata.title, review, token };
    if (!req.body.commit) return res.json(plan);
    if (req.body.token !== token) return res.status(409).json({ error: 'Files or project ownership changed. Review the selection again before confirming.' });
    before = [...new Set([job, ...owners.map(owner => owner.job)])].map(item => ({ job: item, snapshot: cloneProject(item) }));
    let target = job;
    if (action === 'create') {
      target = { id: `book-${randomUUID()}`, name: metadata.title, author: metadata.author, narrator: metadata.narrator,
        metadata, metadataDraft: cloneProject(metadata), importedMetadata: cloneProject(metadata), importInspected: true,
        importedAt: new Date().toISOString(), createdAt: new Date().toISOString(), status: 'draft', inputMethod: 'folder',
        source: { kind: 'external', path: root, mode: 'folder' }, sourceFolderPath: root, outputFolderPath: currentOutputFolder,
        parts: [], candidates: [], chapters: [{ id: `c-${randomUUID()}`, start: '00:00:00.000', title: 'Chapter 1' }], logs: [], totalDurationSeconds: 0, totalSizeBytes: 0,
        sourceMembershipReview: review };
      createdId = target.id;
      jobs.push(target);
    }
    for (const owner of owners) {
      removeSourceMembership(owner.job, owner.files);
      owner.job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Reassigned ${owner.files.length} source files to ${target.name}; files remain on disk.` });
    }
    if (action === 'replace') removeSourceMembership(target, removed);
    const oldParts = new Map(target.parts.map(part => [sourceRelative(target, part), part]));
    target.parts = selected.map((file, index) => ({ ...oldParts.get(file.relativePath), id: oldParts.get(file.relativePath)?.id || `p-${randomUUID()}`,
      name: file.relativePath, sourceRelativePath: file.relativePath, sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds,
      bitrate: file.bitrate || 0, discNumber: file.discNumber, trackNumber: file.trackNumber, order: index + 1 }));
    target.discoveredFiles = selected;
    target.excludedSourceFiles = (target.excludedSourceFiles || []).filter(file => !selectedPaths.includes(file));
    target.explicitlyAddedSourceFiles = selectedPaths;
    target.sourceMembership = 'confirmed';
    target.sourceOrderManual = !!job.sourceOrderManual;
    target.bookScope = { title: coherent ? groups[0].title : target.name };
    if (target.source?.mode === 'file' && (selected.length !== 1 || pathKey(target.source.path) !== pathKey(path.join(root, selectedPaths[0])))) target.source = { ...target.source, path: root, mode: 'folder' };
    target.sourceFileStamps = Object.fromEntries(selectedPaths.map(file => [file, bookFileStamp(root, file)!]));
    if (target.parts.length && target.sourceMembershipReview?.startsWith('All source files')) target.sourceMembershipReview = undefined;
    sourceFilesInvalidated(target); updateSourceTotals(target);
    target.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Manually confirmed ${selected.length} project files. No physical files moved or deleted.` });
    const tree = bookSourceTree(job, root, req.body.view === 'directory' ? (typeof req.body.directory === 'string' ? req.body.directory : root) : undefined);
    persistJobsAtomically();
    res.json({ job, ...tree, createdBook: action === 'create' ? { id: target.id, name: target.name, review: target.sourceMembershipReview } : undefined });
  } catch (error: any) {
    if (createdId) jobs = jobs.filter(item => item.id !== createdId);
    for (const { job: item, snapshot } of before) {
      for (const key of Object.keys(item) as (keyof AudiobookJob)[]) if (!(key in snapshot)) delete (item as any)[key];
      Object.assign(item, snapshot);
    }
    res.status(400).json({ error: error.message || 'Could not save manual grouping.' });
  } finally { libraryMoveRunning = false; }
}));

app.post('/api/jobs/:id/source-files', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (cleanupBusyResponse(res) || sourceImports.has(job.id) || step1TaskRunning || job.exports?.some(item => item.status === 'running' || item.status === 'queued') || libraryScanRunning || activeLibraryMutations > 1) return res.status(409).json({ error: 'Wait for current file operations to finish.' });
  let root = bookSourceRoot(job);
  if (!root) return res.status(400).json({ error: 'Select a local book source first.' });
  const before = cloneProject(job);
  const checkedBeforeSourceEdit = completionCurrent(job);
  let moved: ReturnType<typeof moveBookFiles> = [];
  let createdFolder: string | undefined;
  let copiedFile: string | undefined;
  sourceImports.add(job.id);
  try {
    if (req.body?.action === 'create-folder') {
      if (typeof req.body.parent !== 'string' || typeof req.body.name !== 'string') throw new Error('Choose a parent folder and enter a folder name.');
      const parent = path.resolve(root, req.body.parent || '');
      if (knownIntermediatesRoots().some(workspace => pathKey(parent) === pathKey(workspace) || within(workspace, parent)))
        throw new Error('SwissMouse processing folders cannot be changed here.');
      const created = createBookFolder(root, req.body.parent || '', req.body.name);
      createdFolder = path.join(root, created);
      job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Created source folder: ${created}` });
    } else if (req.body?.action === 'refresh') {
      const scan = await scanLocalFolder(root);
      job.sourceInventory = scan.files;
      const scanned = new Map(scan.files.map(file => [file.relativePath.replace(/\\/g, '/'), file]));
      let changed = false;
      for (const part of job.parts) {
        const relative = sourceRelative(job, part);
        const file = scanned.get(relative);
        if (!file) continue; // A missing source remains visible in the manifest for recovery.
        const current = bookFileStamp(root, relative);
        const prior = job.sourceFileStamps?.[relative];
        if (current && (prior ? current.sizeBytes !== prior.sizeBytes || current.modifiedMs !== prior.modifiedMs ||
          current.device !== prior.device || current.inode !== prior.inode : file.sizeBytes !== part.sizeBytes || Math.abs(file.durationSeconds - part.durationSeconds) > 0.02)) changed = true;
        part.sizeBytes = file.sizeBytes;
        part.durationSeconds = file.durationSeconds;
        part.bitrate = file.bitrate || part.bitrate;
      }
      if (changed) {
        if (!job.sourceOrderManual) job.parts.sort(sourceOrderCompare);
        sourceFilesInvalidated(job);
      }
      job.sourceFileStamps ||= {};
      for (const part of job.parts) {
        const relative = sourceRelative(job, part);
        const stamp = bookFileStamp(root, relative);
        if (stamp) job.sourceFileStamps[relative] = stamp;
      }
      job.discoveredFiles = job.parts.map(part => scanned.get(sourceRelative(job, part)) ||
        job.discoveredFiles?.find(file => file.relativePath.replace(/\\/g, '/') === sourceRelative(job, part))).filter((file): file is DiscoveredAudioFile => !!file);
      job.unsupportedFiles = scan.unsupportedFiles;
      updateSourceTotals(job);
      job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Rescanned source root; found ${scan.files.length} audio files on disk; project membership preserved${changed ? '; existing source details changed' : ''}.` });
    } else if (req.body?.action === 'add') {
      if (typeof req.body.file !== 'string' || !path.isAbsolute(req.body.file) || typeof req.body.destination !== 'string') throw new Error('Choose one local audio file and a destination.');
      const selected = path.resolve(req.body.file);
      const media = validatedAudioFile(selected);
      const destination = req.body.destination ? path.resolve(root, req.body.destination) : root;
      if (!fs.existsSync(destination) || !fs.statSync(destination).isDirectory() || (destination !== root && !within(root, destination))) throw new Error('Choose a folder inside this book.');
      if (fs.realpathSync(destination).toLowerCase() !== destination.toLowerCase()) throw new Error('Linked destination folders cannot be used.');
      const target = path.join(destination, path.basename(selected));
      const relative = path.relative(root, target).replace(/\\/g, '/');
      if (knownIntermediatesRoots().some(workspace => pathKey(target) === pathKey(workspace) || within(workspace, target))) throw new Error('SwissMouse processing folders cannot be source destinations.');
      if (job.parts.some(part => sourceRelative(job, part) === relative)) throw new Error('This file is already in the project.');
      if (pathKey(target) === pathKey(selected) && sourceOwners([selected], job.id).length) throw new Error('This file belongs to another project. Use the manual selection actions to review reassignment.');
      if (pathKey(target) !== pathKey(selected)) {
        if (pathEntryExists(target)) throw new Error('A file with that name already exists in the destination folder.');
        const stage = path.join(destination, `.swissmouse-${randomUUID()}.partial`);
        fs.copyFileSync(selected, stage, fs.constants.COPYFILE_EXCL);
        copiedFile = stage;
        if (fs.statSync(stage).size !== media.sizeBytes || await contentHash(stage) !== await contentHash(selected)) throw new Error('The source file copy did not verify.');
        if (pathEntryExists(target)) throw new Error('A file with that name appeared in the destination folder.');
        fs.renameSync(stage, target);
        copiedFile = target;
      }
      job.parts.push({ id: `p-${randomUUID()}`, name: relative, sourceRelativePath: relative, sizeBytes: media.sizeBytes,
        durationSeconds: media.media.durationSeconds, bitrate: media.media.bitrate || 0, order: job.parts.length + 1 });
      job.discoveredFiles = [...(job.discoveredFiles || []), { relativePath: relative, fileName: path.basename(relative),
        folderName: path.dirname(relative) === '.' ? 'Root' : path.basename(path.dirname(relative)), format: media.media.format,
        codec: media.media.codec, sampleRate: media.media.sampleRate, channels: media.media.channels,
        bitrate: media.media.bitrate, durationSeconds: media.media.durationSeconds, sizeBytes: media.sizeBytes,
        chapterGroup: path.dirname(relative) === '.' ? undefined : path.dirname(relative), isProbed: true, streamSignature: media.media.streamSignature }];
      job.sourceMembership = job.sourceMembership === 'confirmed' ? 'confirmed' : 'explicit';
      job.explicitlyAddedSourceFiles = [...new Set([...(job.explicitlyAddedSourceFiles || []), relative])];
      job.excludedSourceFiles = (job.excludedSourceFiles || []).filter(file => file !== relative);
      job.sourceFileStamps ||= {};
      job.sourceFileStamps[relative] = bookFileStamp(root, relative)!;
      if (job.source?.mode === 'file' && job.parts.length > 1) job.source = { ...job.source, mode: 'folder', path: path.dirname(job.source.path) };
      if (!job.sourceOrderManual) job.parts.sort(sourceOrderCompare);
      sourceFilesInvalidated(job); updateSourceTotals(job);
      job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Added source file to project: ${relative}` });
    } else if (req.body?.action === 'include' || req.body?.action === 'remove') {
      if (!Array.isArray(req.body.files) || !req.body.files.length || req.body.files.some((file: unknown) => typeof file !== 'string')) throw new Error('Select files in this book.');
      let chosen = new Set(req.body.files as string[]);
      if (req.body.action === 'remove') {
        if ([...chosen].some(file => !job.parts.some(part => sourceRelative(job, part) === file))) throw new Error('Selected files are not in the project.');
        const remaining = job.parts.filter(part => !chosen.has(sourceRelative(job, part)));
        if (remaining.length === job.parts.length) throw new Error('Selected files are not in the project.');
        const retainingFinishedBook = !remaining.length && job.validation?.status === 'PASS' &&
          !!job.outputM4b?.fullPath && fs.existsSync(job.outputM4b.fullPath);
        if (!remaining.length && !retainingFinishedBook) throw new Error('Keep at least one source file until a finished M4B has passed validation.');
        job.parts = remaining;
        job.discoveredFiles = job.discoveredFiles?.filter(file => !chosen.has(file.relativePath.replace(/\\/g, '/')));
        job.excludedSourceFiles = [...new Set([...(job.excludedSourceFiles || []), ...chosen])];
        for (const file of chosen) { delete job.sourcePathIdentity?.[file]; delete job.sourceFileStamps?.[file]; }
      } else {
        const directory = typeof req.body.directory === 'string' ? listBookDirectory(req.body.directory, SUPPORTED_AUDIO_EXTENSIONS, knownIntermediatesRoots()) : undefined;
        const selectedPaths = [...chosen].map(file => {
          if (!directory) return resolveBookAudio(root!, file, SUPPORTED_AUDIO_EXTENSIONS);
          const absolute = path.resolve(root!, file);
          if (!directory.entries.some(entry => entry.audio && pathKey(path.join(directory.directory, entry.name)) === pathKey(absolute)))
            throw new Error('Select available audio files in the current folder.');
          return resolveBookAudio(directory.directory, path.basename(absolute), SUPPORTED_AUDIO_EXTENSIONS);
        });
        if (selectedPaths.some(file => knownIntermediatesRoots().some(workspace => within(workspace, file)))) throw new Error('Processing files are not browse sources.');
        if (sourceOwners(selectedPaths, job.id).length) throw new Error('These files belong to another project. Use Create new book or Use as this book to review reassignment.');
        root = rebaseBookMembership(job, root, selectedPaths);
        chosen = new Set(selectedPaths.map(file => path.relative(root!, file).replace(/\\/g, '/')));
        const known = new Set(job.parts.map(part => sourceRelative(job, part)));
        const files: DiscoveredAudioFile[] = [...chosen].filter(file => !known.has(file)).map(relativePath => {
          const absolute = resolveBookAudio(root!, relativePath, SUPPORTED_AUDIO_EXTENSIONS);
          const media = probeAudioFile(absolute);
          const tags = Object.fromEntries(Object.entries(media.tags).map(([key, value]) => [key.toLowerCase(), String(value)]));
          const number = (value?: string) => Number(/^\s*(\d+)/.exec(value || '')?.[1]) || undefined;
          return { relativePath, fileName: path.basename(absolute), folderName: path.basename(path.dirname(absolute)), sizeBytes: fs.statSync(absolute).size,
            durationSeconds: media.durationSeconds, bitrate: media.bitrate, format: media.format, codec: media.codec, sampleRate: media.sampleRate, channels: media.channels,
            streamSignature: media.streamSignature, tags, isProbed: true, discNumber: number(tags.disc || tags.discnumber), trackNumber: number(tags.track || tags.tracknumber) };
        });
        if (!files.length) throw new Error('No new audio files were selected.');
        for (const file of files) job.parts.push({ id: `p-${randomUUID()}`, name: file.relativePath, sourceRelativePath: file.relativePath,
          sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds, bitrate: file.bitrate || 0, order: job.parts.length + 1,
          discNumber: file.discNumber, trackNumber: file.trackNumber });
        job.discoveredFiles = [...(job.discoveredFiles || []), ...files];
        job.excludedSourceFiles = (job.excludedSourceFiles || []).filter(file => !chosen.has(file));
        job.sourceFileStamps ||= {};
        for (const file of files) job.sourceFileStamps[file.relativePath.replace(/\\/g, '/')] = bookFileStamp(root, file.relativePath)!;
        if (!job.sourceOrderManual) job.parts.sort(sourceOrderCompare);
      }
      job.sourceMembership = job.sourceMembership === 'confirmed' ? 'confirmed' : 'explicit';
      job.explicitlyAddedSourceFiles = req.body.action === 'include' ? [...new Set([...(job.explicitlyAddedSourceFiles || []), ...chosen])] : (job.explicitlyAddedSourceFiles || []).filter(file => !chosen.has(file));
      if (job.source?.mode === 'file' && job.parts.length > 1) job.source = { ...job.source, mode: 'folder', path: path.dirname(job.source.path) };
      if (req.body.action === 'remove' && !job.parts.length) {
        job.sourceKey = undefined;
        job.preparedAudioKey = undefined;
        job.libraryScan = undefined;
        job.sourceFilesChanged = false;
        if (job.processingStatus === 'complete') job.completionSignature = await completionSignature(job);
      } else sourceFilesInvalidated(job);
      updateSourceTotals(job);
      job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `${req.body.action === 'remove' ? 'Removed from' : 'Added to'} project manifest: ${[...chosen].join(', ')}` });
    } else if (req.body?.action === 'group' || req.body?.action === 'ungroup') {
      setChapterGroup(job.parts, req.body.files, req.body.action === 'group' ? (req.body.title ?? '') : undefined, randomUUID());
      job.sourceOrderManual = true;
      if (job.chapterSource === 'grouped_files') {
        job.processingStatus = 'incomplete';
        job.staleSteps = [...new Set([...(job.staleSteps || []), 'chapter_review', 'export', 'validation'] as const)];
        job.pipelineSteps = { ...job.pipelineSteps, extracting_chapters: { ...job.pipelineSteps?.extracting_chapters, status: 'stale', hasOutput: !!job.chapters.length } };
      }
      job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: req.body.action === 'group' ? `Saved chapter group: ${req.body.title}` : 'Ungrouped selected chapter groups.' });
    } else if (req.body?.action === 'reorder') {
      if (!Array.isArray(req.body.files) || req.body.files.length !== job.parts.length ||
          new Set(req.body.files).size !== job.parts.length) throw new Error('Provide every source file once in the desired order.');
      const byPath = new Map(job.parts.map(part => [sourceRelative(job, part), part]));
      if (req.body.files.some((file: unknown) => typeof file !== 'string' || !byPath.has(file))) throw new Error('The source order changed. Refresh and retry.');
      const previous = job.parts.map(part => sourceRelative(job, part)).join('\0');
      const reordered = req.body.files.map((file: string) => byPath.get(file)!);
      manualChapterGroups(reordered);
      job.parts = reordered;
      const discovered = new Map((job.discoveredFiles || []).map(file => [file.relativePath.replace(/\\/g, '/'), file]));
      job.discoveredFiles = req.body.files.map((file: string) => discovered.get(file)).filter((file: DiscoveredAudioFile | undefined): file is DiscoveredAudioFile => !!file);
      job.sourceOrderManual = true;
      if (previous !== req.body.files.join('\0')) sourceFilesInvalidated(job);
      updateSourceTotals(job);
      job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Saved manual source-file order.' });
    } else if (req.body?.action === 'move') {
      if (!Array.isArray(req.body.files) || req.body.files.some((file: unknown) => typeof file !== 'string') || typeof req.body.destination !== 'string')
        throw new Error('Select files and a destination folder inside this book.');
      const selectedPaths = [...req.body.files, req.body.destination].map((value: string) => path.resolve(root, value));
      if (selectedPaths.some(file => knownIntermediatesRoots().some(workspace => pathKey(file) === pathKey(workspace) || within(workspace, file))))
        throw new Error('SwissMouse processing folders cannot be organized as source files.');
      if (sourceOwners((req.body.files as string[]).map(file => path.resolve(root, file)), job.id).length) throw new Error('Selected files belong to another project. Open that project to move its files.');
      const identity = new Map((req.body.files as string[]).map(file => { const stat = fs.statSync(path.resolve(root, file)); return [file.replace(/\\/g, '/'), { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }]; }));
      moved = moveBookFiles(root, req.body.files, req.body.destination);
      const sameFiles = moved.every(item => { const original = identity.get(item.oldRelativePath); const stat = fs.statSync(item.to);
        return !!original && stat.dev === original.dev && stat.ino === original.ino && stat.size === original.size && stat.mtimeMs === original.mtimeMs; });
      const changes = new Map(moved.map(item => [item.oldRelativePath.replace(/\\/g, '/'), item.relativePath]));
      for (const part of job.parts) {
        const old = (part.sourceRelativePath || part.name).replace(/\\/g, '/');
        const next = changes.get(old);
        if (next) { part.name = next; part.sourceRelativePath = next; }
      }
      for (const file of job.discoveredFiles || []) {
        const next = changes.get(file.relativePath.replace(/\\/g, '/'));
        if (next) { file.relativePath = next; file.storedName = next; file.fileName = path.basename(next); file.folderName = path.dirname(next) === '.' ? 'Root' : path.basename(path.dirname(next)); file.chapterGroup = path.dirname(next) === '.' ? undefined : path.dirname(next); }
      }
      for (const file of job.unsupportedFiles || []) {
        const next = changes.get(file.relativePath.replace(/\\/g, '/'));
        if (next) { file.relativePath = next; file.fileName = path.basename(next); }
      }
      if (job.source?.mode === 'file') {
        const next = changes.get(path.relative(root, job.source.path).replace(/\\/g, '/'));
        if (next) job.source.path = path.join(root, next);
      }
      for (const item of moved) {
        const old = item.oldRelativePath.replace(/\\/g, '/');
        const logical = job.sourcePathIdentity?.[old] || item.from;
        if (job.parts.some(part => sourceRelative(job, part) === item.relativePath)) {
          job.sourcePathIdentity ||= {};
          job.sourcePathIdentity[item.relativePath] = logical;
        }
        delete job.sourcePathIdentity?.[old];
        if (job.sourceFileStamps?.[old]) {
          job.sourceFileStamps[item.relativePath] = bookFileStamp(root, item.relativePath)!;
          delete job.sourceFileStamps[old];
        }
        job.explicitlyAddedSourceFiles = job.explicitlyAddedSourceFiles?.map(file => file === old ? item.relativePath : file);
        job.excludedSourceFiles = job.excludedSourceFiles?.map(file => file === old ? item.relativePath : file);
      }
      if (!sameFiles) sourceFilesInvalidated(job);
      updateSourceTotals(job);
      if (sameFiles && job.processingStatus === 'complete' && job.completionSignature) job.completionSignature = await completionSignature(job);
      if (sameFiles && job.processingStatus === 'complete') job.sourceReorganizationPending = true;
      if (sameFiles && checkedBeforeSourceEdit && job.finalCheck) job.finalCheck.inputSignature = currentFinalCheckSignature(job);
      job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Moved ${moved.length} source file${moved.length === 1 ? '' : 's'} within ${root}.` });
    } else throw new Error('Unknown source-file action.');
    const tree = bookSourceTree(job, root, req.body.view === 'directory' ? (typeof req.body.directory === 'string' ? req.body.directory : root) : undefined);
    persistJobsAtomically();
    res.json({ job, ...tree });
  } catch (error: any) {
    for (const item of moved.reverse()) { try { fs.renameSync(item.to, item.from); } catch (rollback: any) { appendMasterEvent('Source files', `Rollback failed for ${item.from}: ${rollback.message}`, 'ERROR'); } }
    if (createdFolder) { try { fs.rmdirSync(createdFolder); } catch { /* Keep any newly added contents. */ } }
    if (copiedFile) { try { fs.unlinkSync(copiedFile); } catch { /* Keep the copied file if rollback cannot remove it. */ } }
    for (const key of Object.keys(job) as (keyof AudiobookJob)[]) if (!(key in before)) delete (job as any)[key];
    Object.assign(job, before);
    appendOperationFailure(job.id, 'Source files', error.message);
    res.status(400).json({ error: error.message || 'Could not organize source files.' });
  } finally { sourceImports.delete(job.id); }
}));

// Output folder endpoints
app.get('/api/system/output-folder', (req, res) => {
  res.json({
    outputFolder: currentOutputFolder,
    defaultOutputFolder: currentOutputFolder,
    isWritable: fs.existsSync(currentOutputFolder),
  });
});

app.post('/api/system/output-folder', (req, res) => {
  const { outputFolder } = req.body;
  if (outputFolder !== undefined && typeof outputFolder !== 'string') return res.status(400).json({error: 'Output folder must be a path.'});
  const target = outputFolder ? path.resolve(APP_ROOT, outputFolder) : currentOutputFolder;
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    fs.accessSync(target, fs.constants.W_OK);
    res.json({
      outputFolder: target,
      defaultOutputFolder: currentOutputFolder,
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
app.get('/api/tools/yt-dlp/status', asyncRoute(async (req, res) => {
  const status = await getYtDlpStatus();
  res.json(status);
}));

// The separate YouTube panel obeys the same runtime mutation lock.
app.use('/api/tools/yt-dlp', (req, res, next) => {
  if (req.method !== 'POST' || !['/install', '/update', '/uninstall'].includes(req.path)) return next();
  if (cleanupInProgress() || runtimeRequests > 1) return res.status(409).json({ error: 'Wait for active work to finish before changing yt-dlp.' });
  runtimeMutationRunning = true;
  next();
});

// Install local yt-dlp binary
app.post('/api/tools/yt-dlp/install', asyncRoute(async (req, res) => {
  try {
    const status = await installLocalYtDlp();
    if (status.status === 'error') {
      return res.status(500).json({ error: status.error, status });
    }
    res.json({ status: 'ok', info: status, message: `yt-dlp installed successfully (${status.version || 'latest'}).` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to install yt-dlp' });
  } finally { runtimeMutationRunning = false; }
}));

// Update local yt-dlp binary
app.post('/api/tools/yt-dlp/update', asyncRoute(async (req, res) => {
  try {
    const status = await updateLocalYtDlp();
    res.json({ status: 'ok', info: status, message: `yt-dlp updated to version ${status.version || 'latest'}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update yt-dlp' });
  } finally { runtimeMutationRunning = false; }
}));

// Uninstall local yt-dlp binary
app.post('/api/tools/yt-dlp/uninstall', asyncRoute(async (req, res) => {
  try {
    const status = await uninstallLocalYtDlp();
    res.json({ status: 'ok', info: status, message: 'Local yt-dlp binary uninstalled. Source files, whisper models, and projects were preserved.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to uninstall yt-dlp' });
  } finally { runtimeMutationRunning = false; }
}));

// Fetch YouTube video metadata via yt-dlp
app.post('/api/youtube/fetch-info', requireFeatures(['youtube_inspection'], 'YouTube inspection', () => undefined), asyncRoute(async (req, res) => {
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
}));

// Download YouTube audio via yt-dlp & FFmpeg
const sourceImports = new Set<string>();
mountLibriVox(app, {
  get jobs() { return jobs; }, save: persistJobsAtomically, root: appPath('output', 'imports', 'librivox'), probe: probeAudioFile,
  locks: sourceImports, busy: () => step1TaskRunning || activeInstallProgress.isActive,
  requireImport: requireFeatures(['file_import'], 'LibriVox import', req => req.params.jobId),
});
// Source replacement commits as one transaction. Do not mutate or remove the
// same project while either remote importer is working.
app.use('/api/jobs/:id', (req, res, next) => {
  const job = projectStore.get(req.params.id);
  if (req.method === 'POST' && /\/(metadata|metadata-draft|metadata-json|finish-import)$/.test(req.path) && req.body?.expectedRevision !== undefined && req.body.expectedRevision !== (job?.metadataRevision || 0)) return res.status(409).json({ error: 'Book details changed in another view. Reopen the book before saving; your current edits have not been applied.' });
  if (req.method !== 'GET' && sourceImports.has(req.params.id)) return res.status(409).json({ error: 'Wait for the source import to finish, or cancel it first.' });
  next();
});
app.post('/api/youtube/download', (req, res, next) => requireFeatures(
  [req.body?.format && req.body.format !== 'best' ? 'youtube_conversion' : 'youtube_import'],
  'YouTube import', request => request.body?.jobId,
)(req, res, next), asyncRoute(async (req, res) => {
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
  const targetJob = jobId ? projectStore.get(jobId) : undefined;
  if (jobId && !targetJob) return res.status(404).json({error: 'Job not found'});
  if (sourceImports.has(jobId || '') || step1TaskRunning || targetJob?.exports?.some(e => ['queued','running'].includes(e.status))) return res.status(409).json({error: 'Wait for the active import, processing or export to complete.'});
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
  // Dependency inspection above is asynchronous; recheck before taking the lock.
  if (sourceImports.has(jobId || '') || step1TaskRunning || targetJob?.exports?.some(e => ['queued','running'].includes(e.status))) return res.status(409).json({ error: 'Wait for the active import, processing or export to complete.' });
  sourceImports.add(jobId || '');
  try {
    const latestFile = await downloadYoutubeAudio(status.executablePath, path.dirname(getFfmpeg()), importDir, cleanUrl, format);
    const probe = probeAudioFile(latestFile.fullPath);
    const fileStat = fs.statSync(latestFile.fullPath);

    // If active job provided, update job with this newly downloaded audio part
    let updatedJob: AudiobookJob | undefined;
    if (jobId) {
      const job = projectStore.get(jobId);
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
        job.existingChapters = []; job.chapterReviewBaseline = undefined; job.chapters = []; job.candidates = [];
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
  } finally { sourceImports.delete(jobId || ''); }
}));

// Get configuration
app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

// Update configuration
app.post('/api/config', asyncRoute(async (req, res) => {
  const updates = req.body;
  if (updates.pcm_retention !== undefined && !['after_verified_export', 'until_finalized', 'keep'].includes(updates.pcm_retention)) return res.status(400).json({ error: 'Choose a supported PCM retention setting.' });
  if (updates.detect_musical_transitions !== undefined && typeof updates.detect_musical_transitions !== 'boolean') return res.status(400).json({ error: 'Music transition detection must be a boolean.' });
  if (updates.library_folder !== undefined && typeof updates.library_folder !== 'string') return res.status(400).json({ error: 'Library folder must be a path.' });
  if (updates.inbox_folder !== undefined && typeof updates.inbox_folder !== 'string') return res.status(400).json({ error: 'Inbox folder must be a path.' });
  if (updates.library_template !== undefined && typeof updates.library_template !== 'string') return res.status(400).json({ error: 'Folder pattern must be text.' });
  if (updates.audiobookshelf_metadata !== undefined && typeof updates.audiobookshelf_metadata !== 'boolean') return res.status(400).json({ error: 'Audiobookshelf compatibility must be on or off.' });
  if (updates.save_cover_beside_audio !== undefined && typeof updates.save_cover_beside_audio !== 'boolean') return res.status(400).json({ error: 'Saving cover beside audiobook must be on or off.' });
  if (updates.quick_tags !== undefined && (!Array.isArray(updates.quick_tags) || updates.quick_tags.some((tag: unknown) => typeof tag !== 'string' || tag.length > 120) || updates.quick_tags.length > 500)) return res.status(400).json({ error: 'Quick Tags must be a list of up to 500 short names.' });
  const template = updates.library_template ?? currentConfig.library_template ?? DEFAULT_LIBRARY_TEMPLATE;
  const templateError = validateLibraryTemplate(template);
  if (templateError) return res.status(400).json({ error: templateError });
  const libraryFolder = updates.library_folder !== undefined ? updates.library_folder.trim() || appPath('output') : currentConfig.library_folder || appPath('output');
  const inboxFolder = updates.inbox_folder !== undefined ? updates.inbox_folder.trim() || appPath('inbox') : currentConfig.inbox_folder || appPath('inbox');
  if (activeLibraryMutations > 1 && (pathKey(libraryFolder) !== pathKey(currentOutputFolder) || pathKey(inboxFolder) !== pathKey(currentConfig.inbox_folder || appPath('inbox'))))
    return res.status(409).json({ error: 'Wait for current file operations before changing Inbox or Library locations.' });
  libraryConfigSaving = true;
  try {
    for (const folder of [libraryFolder, inboxFolder]) {
      if (!path.isAbsolute(folder) || folder.includes('\0') || (isWin && /[<>"|?*]/.test(folder))) throw new Error('Use an absolute folder path without invalid characters.');
      if ([appPath('.cache'), appPath('logs'), appPath('runtime'), appPath('models'), ...knownIntermediatesRoots()].some(reserved => pathKey(reserved) === pathKey(folder) || within(reserved, folder))) throw new Error('Choose a book folder outside SwissMouse runtime, cache, logs, models, and intermediates.');
      let ancestor = path.resolve(folder);
      while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
      await assertUnlinked(ancestor);
      if (!fs.statSync(ancestor).isDirectory()) throw new Error(`Not a folder: ${ancestor}`);
      fs.accessSync(ancestor, fs.constants.W_OK | fs.constants.R_OK);
    }
    if (pathKey(libraryFolder) === pathKey(inboxFolder) || within(libraryFolder, inboxFolder) || within(inboxFolder, libraryFolder)) throw new Error('Inbox and Library must be separate, non-overlapping folders.');
    for (const folder of [libraryFolder, inboxFolder]) fs.mkdirSync(folder, { recursive: true });
    const next = { ...currentConfig, ...updates, quick_tags: updates.quick_tags === undefined ? currentConfig.quick_tags : cleanQuickTags(updates.quick_tags), library_folder: path.resolve(libraryFolder), inbox_folder: path.resolve(inboxFolder), library_template: template };
    const temporary = CONFIG_PATH + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(temporary, CONFIG_PATH);
    currentConfig = next;
    currentOutputFolder = next.library_folder;
  } catch (error: any) { return res.status(400).json({ error: `Cannot save library locations: ${error.message}` }); }
  finally { libraryConfigSaving = false; }
  res.json({ status: 'ok', config: currentConfig });
}));

// Custom theme stylesheets are parsed as an allowlist of existing design
// tokens. The source CSS is never served or injected into the application.
app.get('/api/appearance', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(readAppearance(appPath('ui-preferences.json'))); }
  catch { res.status(500).json({ error: 'Could not read shared appearance preferences.' }); }
});
app.post('/api/appearance', (req, res) => {
  if (!validThemeId(req.body?.theme) || (req.body?.initialize !== undefined && typeof req.body.initialize !== 'boolean')) {
    res.status(400).json({ error: 'Choose a valid theme.' }); return;
  }
  try { res.json(saveAppearance(appPath('ui-preferences.json'), req.body.theme, req.body.initialize === true)); }
  catch { res.status(500).json({ error: 'Could not save shared appearance preferences.' }); }
});

app.get('/api/themes', (req, res) => {
  const discovery = scanCustomThemes();
  res.json({ ...discovery, directory: CUSTOM_THEMES_DIR });
});

function launchFolder(directory: string): Promise<void> {
  if (isWin) return openFolderInForeground(directory);
  return new Promise((resolve, reject) => {
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const opener = spawn(command, [directory], { detached: true, stdio: 'ignore', windowsHide: false });
    opener.once('error', reject);
    opener.once('spawn', () => { opener.unref(); resolve(); });
  });
}

app.post('/api/themes/open-folder', asyncRoute(async (req, res) => {
  try {
    fs.mkdirSync(CUSTOM_THEMES_DIR, { recursive: true });
    await launchFolder(CUSTOM_THEMES_DIR);
    res.json({ status: 'ok', directory: CUSTOM_THEMES_DIR });
  } catch (error: any) { res.status(500).json({ error: `Could not open the themes folder: ${error.message}` }); }
}));

app.get('/api/themes/assets/:themeId/:assetName', (req, res) => {
  const { themeId, assetName } = req.params;
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(themeId) || !isSafeThemeAssetName(assetName)) {
    return res.status(400).json({ error: 'Invalid theme asset path.' });
  }
  const discovery = discoverCustomThemes(CUSTOM_THEMES_DIR);
  if (!discovery.themes.some(theme => theme.id === themeId)) return res.status(404).json({ error: 'Theme not found.' });
  const assetPath = path.join(CUSTOM_THEMES_DIR, themeId, 'assets', assetName);
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) return res.status(404).json({ error: 'Theme asset not found.' });
  const assetRelative = path.relative(fs.realpathSync(path.join(CUSTOM_THEMES_DIR, themeId)), fs.realpathSync(assetPath));
  if (assetRelative.startsWith('..') || path.isAbsolute(assetRelative)) return res.status(404).json({ error: 'Theme asset is outside its theme folder.' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(assetPath);
});

function libraryBook(job: AudiobookJob): LibraryBook {
  const metadata = { title: job.name, author: job.author || '', narrator: job.narrator || '', genres: [], language: 'eng', abridged: false, explicit: false, ...job.metadata };
  const coverUrl = metadata.cover?.url;
  const formats = bookFormats(job);
  const originalSourceMissing = sourceMissing(job);
  const availableM4b = originalSourceMissing ? survivingLibraryM4b(job) : undefined;
  return { personalRating: job.personalRating, sourceFileCount: job.parts.length, importFinished: job.importFinished, metadataRevision: job.metadataRevision, canMoveToLibrary: canMoveInboxBook(job), id: job.id, name: job.name, status: job.status, createdAt: job.createdAt, metadataUpdatedAt: job.metadataUpdatedAt,
    formats, representations: [{ id: job.id, path: availableM4b || job.source?.path || job.sourceFolderPath || '', formats }],
    rootType: availableM4b ? 'library' : bookRootType(job), identificationWarning: job.sourceMembershipReview || job.libraryScan?.warning,
    processingStatus: completionCurrent(job) ? 'complete' : 'incomplete',
    sourceLocation: availableM4b ? 'managed' : sourceLocation(job), sourceMissing: !availableM4b && (originalSourceMissing || !!job.libraryScan?.missing),
    originalSourceMissing: originalSourceMissing && !!availableM4b, availableM4bPath: availableM4b,
    metadata: { ...metadata, cover: undefined },
    coverUrl: coverUrl && !coverUrl.startsWith('data:') ? coverUrl : coverUrl ? `/api/library/${encodeURIComponent(job.id)}/cover?v=${encodeURIComponent(job.metadataUpdatedAt || job.createdAt)}` : undefined };
}

function bookFormats(job: AudiobookJob): string[] {
  let files: string[] = [];
  try { files = [...sourceFilePaths(job).filter(file => fs.existsSync(file) && fs.statSync(file).isFile()), ...exportedAudioPaths(job)]; }
  catch { return [...new Set([job.sourceFormat, ...Object.keys(job.exportedFiles || {})].filter((value): value is string => !!value).map(value => value.toUpperCase()))].sort(); }
  return [...new Set(files.map(file => path.extname(file).slice(1).toUpperCase()).filter(Boolean))].sort();
}
function matchInput(job: AudiobookJob, formats = [...new Set(job.parts.map(part => path.extname(part.name).slice(1).toUpperCase()))]): MatchBook {
  return { id: job.id, metadata: job.metadata || { title: job.name, author: '', narrator: '', genres: [], language: 'eng', abridged: false, explicit: false },
    durationSeconds: job.totalDurationSeconds || job.libraryScan?.durationSeconds || undefined, chapterCount: job.chapters?.length || undefined,
    formats, fileSizes: job.parts.map(part => part.sizeBytes), missing: job.libraryScan?.missing && !survivingLibraryM4b(job), logicalBookId: job.logicalBookId };
}
function matchSourceSignature(job: AudiobookJob): string {
  try { return sourceFilePaths(job).map(file => { const info = fs.statSync(file); return `${pathKey(file)}:${info.size}:${info.mtimeMs}`; }).join('|'); }
  catch { return ''; }
}
function reviewMatches(summaries?: Map<string, LibraryBook>) {
  const available = jobs.filter(job => !job.importPending && !job.libraryScan?.superseded && (!job.libraryScan?.missing || !!survivingLibraryM4b(job)));
  const byId = new Map(jobs.map(job => [job.id, job]));
  const groups = new Map<string, AudiobookJob[]>();
  for (const job of available) { const key = job.logicalBookId || job.id; const group = groups.get(key); if (group) group.push(job); else groups.set(key, [job]); }
  const primary = new Map<string, AudiobookJob>();
  for (const [key, group] of groups) primary.set(key, group.find(job => job.id === key) || group[0]);
  const representative = (id: string) => { const job = byId.get(id); return job ? primary.get(job.logicalBookId || job.id)?.id || id : id; };
  const dismissed = new Set<string>();
  for (const job of available) for (const otherId of Object.keys(job.matchDecisions || {})) dismissed.add(pairKey(representative(job.id), representative(otherId)));
  return findBookMatches([...primary.values()].map(job => matchInput(job, summaries?.get(job.id)?.formats)), dismissed).map(match => {
    const a = byId.get(match.a)!;
    const b = byId.get(match.b)!;
    const forward = a.confirmedMatches?.[b.id], reverse = b.confirmedMatches?.[a.id];
    const confirmed = forward || reverse ? (forward?.leftSignature === matchSourceSignature(a) && forward?.rightSignature === matchSourceSignature(b) ? forward
      : reverse?.leftSignature === matchSourceSignature(b) && reverse?.rightSignature === matchSourceSignature(a) ? reverse : undefined) : undefined;
    return { ...match, kind: confirmed ? 'audio' as const : match.kind, evidence: confirmed?.kind };
  });
}
function visibleLibraryBooks(): LibraryBook[] {
  const available = jobs.filter(job => !job.importPending && !job.libraryScan?.superseded);
  const groups = new Map<string, AudiobookJob[]>();
  for (const job of available) {
    const key = job.logicalBookId || job.id;
    const group = groups.get(key); if (group) group.push(job); else groups.set(key, [job]);
  }
  const summaries = new Map(available.map(job => [job.id, libraryBook(job)]));
  const matches = reviewMatches(summaries);
  const kindsById = new Map<string, Set<'book' | 'audio' | 'uncertain'>>();
  const evidenceById = new Map<string, 'exact' | 'fingerprint'>();
  for (const match of matches) for (const id of [match.a, match.b]) {
    const kinds = kindsById.get(id) || new Set<'book' | 'audio' | 'uncertain'>(); kinds.add(match.kind); kindsById.set(id, kinds);
    if (match.evidence) evidenceById.set(id, match.evidence);
  }
  return [...groups.values()].map(group => {
    const primary = group.find(job => job.id === (job.logicalBookId || job.id)) || group[0];
    const book = summaries.get(primary.id)!;
    book.rootTypes = [...new Set(group.map(job => summaries.get(job.id)!.rootType).filter((value): value is 'inbox' | 'library' => !!value))];
    book.formats = [...new Set(group.flatMap(job => summaries.get(job.id)!.formats || []))].sort();
    book.representations = group.map(job => ({ id: job.id, path: summaries.get(job.id)!.availableM4bPath || job.source?.path || job.sourceFolderPath || '', formats: summaries.get(job.id)!.formats || [] }));
    book.matchKinds = [...(kindsById.get(primary.id) || [])];
    book.audioMatchEvidence = evidenceById.get(primary.id);
    return book;
  });
}

const libraryThumbnails = new Map<string, Buffer>();
const pendingThumbnails = new Map<string, Promise<Buffer>>();
const thumbnailQueue: (() => void)[] = [];
let activeThumbnails = 0;
function renderLibraryThumbnail(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const start = () => {
      activeThumbnails++;
      let child: ReturnType<typeof spawn>;
      try { child = spawn(getFfmpeg(), ['-v', 'error', '-i', 'pipe:0', '-vf', 'scale=320:320:force_original_aspect_ratio=decrease', '-frames:v', '1', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1'], { windowsHide: true }); }
      catch (error) { activeThumbnails--; thumbnailQueue.shift()?.(); reject(error); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        activeThumbnails--;
        thumbnailQueue.shift()?.();
        if (error || !bytes) reject(error || new Error('Could not resize cover.'));
        else resolve(Buffer.concat(chunks));
      };
      const timeout = setTimeout(() => { child.kill(); finish(new Error('Cover resize timed out.')); }, 15000);
      child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) { child.kill(); finish(new Error('Cover thumbnail is too large.')); } else chunks.push(chunk); });
      child.stderr.resume();
      child.on('error', finish);
      child.on('close', code => finish(code === 0 ? undefined : new Error('Could not resize cover.')));
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    };
    if (activeThumbnails < 2) start(); else thumbnailQueue.push(start);
  });
}
catalog = new CatalogService(appPath('catalog.sqlite'), () => jobs, job => {
  const record = projectCatalogRecord(job, bookRootType(job), APP_ROOT);
  record.book.sourceLocation = sourceLocation(job);
  let sourcePaths: string[] = [], invalidSource = false;
  try { sourcePaths = sourceFilePaths(job); } catch { invalidSource = true; }
  record.observation = { sourcePaths,invalidSource,sourceKey:job.sourceKey,archive:job.originalsArchive,libraryRoot:currentOutputFolder,
    m4bCandidates:[job.outputM4b?.fullPath,job.exportedFiles?.m4b,...(job.exports || []).filter(item => item.format === 'm4b' && item.status === 'success').map(item => item.fullPath)] };
  record.book.canMoveToLibrary = canMoveInboxBook(job);
  record.book.processingStatus = completionCurrent(job) ? 'complete' : 'incomplete';
  return record;
}, message => appendMasterEvent('Catalog', message, 'WARNING'), undefined, projectStore);
registerCatalogRoutes(app, catalog, async ids => {
  for (let offset=0; offset<ids.length; offset+=500) {
    const batch=ids.slice(offset,offset+500);
    const rows=await catalog.call('collectionMembershipRows',batch) as {project_id:string;id:string;name:string}[];
    for(const id of batch) {
      const job=projectStore.get(id); if(!job?.metadata) continue;
      const collections=rows.filter(row=>row.project_id===id).map(row=>({id:row.id,name:row.name}));
      job.metadata={...job.metadata,collections};
      job.metadataRevision=(job.metadataRevision || 0)+1; job.metadataUpdatedAt=new Date().toISOString();
      const files=savedAudiobookshelfPaths(job);
      if(files.length) try { writeAudiobookshelfJson(job,files); } catch(error:any) { job.logs.push({timestamp:new Date().toISOString(),level:'WARNING',message:`Collection saved; exmetadata.json could not be updated: ${error.message}`}); }
    }
    saveJobs();
  }
});
// Compatibility endpoint for older clients. The current UI uses bounded catalog queries.
app.get('/api/library', asyncRoute(async (req, res) => {
  res.json((await catalog!.call('query', { limit: req.query.limit === undefined ? 100 : Number(req.query.limit) })).items);
}));
app.get('/api/library/scan-status', (_req, res) => res.json({ scanning: !!libraryScanRunning, warnings: [...libraryRecoveryWarnings, ...libraryScanWarnings], progress: libraryScanProgress }));
app.get('/api/library/matches', asyncRoute(async (req, res) => {
  const page = await catalog!.call('matches', { root:req.query.root, limit:100 }); res.json(page.items);
}));
app.get('/api/library/matches/reviewed', asyncRoute(async (_req, res) => res.json((await catalog!.call('matches', { reviewed:true,limit:100 })).items)));
app.post('/api/library/matches/reopen', async (req, res) => {
  const job = projectStore.get(req.body?.a);
  if (!job?.matchDecisions?.[req.body?.b]) return res.status(404).json({ error: 'Review choice not found.' });
  const previous = job.matchDecisions;
  job.matchDecisions = { ...previous }; delete job.matchDecisions[req.body.b];
  try { persistJobsAtomically(); await catalog!.publish([job.id]); res.json({ matches: (await catalog!.call('matches')).items }); }
  catch (error: any) { job.matchDecisions = previous; res.status(500).json({ error: error.message }); }
});
async function cachedFileHash(job: AudiobookJob, file: string): Promise<string> {
  const info = await fs.promises.stat(file);
  const signature = `${info.size}:${info.mtimeMs}`;
  const key = pathKey(file);
  if (job.matchHashes?.[key]?.signature === signature) return job.matchHashes[key].sha256;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  job.matchHashes = { ...job.matchHashes, [key]: { signature, sha256 } };
  return sha256;
}
async function cachedEnvelope(job: AudiobookJob, file: string, duration: number): Promise<number[][]> {
  const info = await fs.promises.stat(file);
  const signature = `${info.size}:${info.mtimeMs}:${duration}`;
  const key = pathKey(file);
  if (job.audioFingerprints?.[key]?.signature === signature) return job.audioFingerprints[key].envelope;
  const envelope = await sampledEnvelope(getFfmpeg(), file, duration);
  job.audioFingerprints = { ...job.audioFingerprints, [key]: { signature, envelope } };
  return envelope;
}
async function comparisonDetails(job: AudiobookJob) {
  const files = sourceFilePaths(job).filter(file => fs.existsSync(file));
  const first = files[0];
  let audio: any = {}, artwork: any = {}, format: any = {}, chapterCount = job.chapters?.length || undefined;
  if (first) {
    try {
      const result = await execFileAsync(getFfprobe(), ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,sample_rate,channels,channel_layout,bit_rate,width,height:format=duration,bit_rate:chapter=start_time', '-of', 'json', first], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
      const parsed = JSON.parse(result.stdout); audio = parsed.streams?.find((stream: any) => stream.codec_type === 'audio') || {}; artwork = parsed.streams?.find((stream: any) => stream.codec_type === 'video') || {}; format = parsed.format || {}; chapterCount = parsed.chapters?.length || chapterCount;
    } catch { /* Technical details remain optional. */ }
  }
  const metadata = job.metadata || { title: job.name, author: '', narrator: '', cover: undefined };
  return { id: job.id, title: metadata.title, author: metadata.author, narrator: metadata.narrator,
    runtimeSeconds: Number(format.duration) || job.totalDurationSeconds || undefined, formats: bookFormats(job),
    codec: audio.codec_name, bitrate: Number(audio.bit_rate || format.bit_rate) || undefined,
    sampleRate: Number(audio.sample_rate) || undefined, channels: audio.channels, channelLayout: audio.channel_layout,
    lossless: ['flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'wavpack'].includes(audio.codec_name),
    fileSize: files.reduce((sum, file) => sum + fs.statSync(file).size, 0), chapterCount,
    metadataFields: Object.values(metadata).filter(value => typeof value === 'string' && value.trim()).length,
    cover: !!metadata.cover || !!artwork.width, coverResolution: artwork.width && artwork.height ? `${artwork.width}×${artwork.height}` : undefined, paths: files };
}
app.post('/api/library/matches/compare', asyncRoute(async (req, res) => {
  const a = projectStore.get(req.body?.a), b = projectStore.get(req.body?.b);
  if (!a || !b || a.id === b.id) return res.status(404).json({ error: 'Select two existing books.' });
  appendMasterEvent('Library matches', `Comparing ${a.id} and ${b.id} on demand.`);
  try {
    const [left, right] = await Promise.all([comparisonDetails(a), comparisonDetails(b)]);
    const filesA = sourceFilePaths(a), filesB = sourceFilePaths(b);
    let exact = false;
    let confidence: number | undefined;
    if (filesA.length && filesA.length === filesB.length && filesA.every((file, index) => fs.statSync(file).size === fs.statSync(filesB[index]).size)) {
      const [hashesA, hashesB] = await Promise.all([
        Promise.all(filesA.map(file => cachedFileHash(a, file))), Promise.all(filesB.map(file => cachedFileHash(b, file))),
      ]);
      exact = hashesA.every((hash, index) => hash === hashesB[index]);
      if (exact) a.confirmedMatches = { ...a.confirmedMatches, [b.id]: { kind: 'exact', leftSignature: matchSourceSignature(a), rightSignature: matchSourceSignature(b) } };
      else if (a.confirmedMatches?.[b.id]?.kind === 'exact') delete a.confirmedMatches[b.id];
    }
    const plausible = !exact && filesA.length === 1 && filesB.length === 1 && left.runtimeSeconds && right.runtimeSeconds
      && Math.abs(left.runtimeSeconds - right.runtimeSeconds) < Math.max(5, left.runtimeSeconds * .01)
      && (!a.metadata?.narrator || !b.metadata?.narrator || a.metadata.narrator.trim().toLowerCase() === b.metadata.narrator.trim().toLowerCase());
    let analysisWarning: string | undefined;
    if (plausible) {
      try {
        const [envelopeA, envelopeB] = await Promise.all([cachedEnvelope(a, filesA[0], left.runtimeSeconds!), cachedEnvelope(b, filesB[0], right.runtimeSeconds!)]);
        confidence = envelopeConfidence(envelopeA, envelopeB);
        if (confidence >= .94) a.confirmedMatches = { ...a.confirmedMatches, [b.id]: { kind: 'fingerprint', leftSignature: matchSourceSignature(a), rightSignature: matchSourceSignature(b) } };
        else if (a.confirmedMatches?.[b.id]?.kind === 'fingerprint') delete a.confirmedMatches[b.id];
      } catch (error: any) { analysisWarning = `Sampled audio comparison unavailable: ${error.message}`; }
    }
    persistJobsAtomically();
    await catalog!.publish([a.id,b.id]);
    appendMasterEvent('Library matches', `Compared ${a.id} and ${b.id}: ${exact ? 'exact file hash match' : confidence !== undefined ? `sampled audio similarity ${Math.round(confidence * 100)}%` : 'no audio identity established'}.`);
    res.json({ left, right, exact, confidence, evidence: exact ? 'SHA-256 hashes match for every source file' : confidence !== undefined ? `Sampled audio activity similarity: ${Math.round(confidence * 100)}%. ${confidence >= .94 ? 'Likely same recording; review before merging.' : 'Not enough evidence to call this the same recording.'}` : analysisWarning || 'No exact file match established. Audio fingerprinting needs single-file recordings with similar runtime.' });
  } catch (error: any) { res.status(409).json({ error: error.message || 'Could not compare these files.' }); }
}));
app.post('/api/library/matches/decision', async (req, res) => {
  const a = projectStore.get(req.body?.a), b = projectStore.get(req.body?.b);
  if (!a || !b || a.id === b.id) return res.status(404).json({ error: 'Select two existing books.' });
  const decision = req.body?.decision;
  if (!['keep-a', 'keep-b', 'keep-both', 'different', 'ignore', 'merge'].includes(decision)) return res.status(400).json({ error: 'Unknown review choice.' });
  const affected = decision === 'merge' ? projectStore.group([a.logicalBookId || a.id,b.logicalBookId || b.id]) : [a];
  const previous = affected.map(job => ({ job, logicalBookId: job.logicalBookId, matchDecisions: job.matchDecisions }));
  try {
    if (decision === 'merge') {
      const primaryId = req.body?.primaryId === b.id ? b.id : a.id;
      for (const job of affected) job.logicalBookId = primaryId;
    } else a.matchDecisions = { ...a.matchDecisions, [b.id]: decision };
    persistJobsAtomically();
    appendMasterEvent('Library matches', `${decision} choice saved for ${a.id} and ${b.id}; source files stayed in place.`);
    await catalog!.publish(affected.map(job=>job.id));
    res.json({ books: req.get('X-SwissMouse-Catalog') === '1' ? [] : (await catalog!.call('query',{limit:100})).items, matches: (await catalog!.call('matches')).items });
  } catch (error: any) {
    for (const item of previous) { item.job.logicalBookId = item.logicalBookId; item.job.matchDecisions = item.matchDecisions; }
    res.status(500).json({ error: error.message || 'Could not save review choice.' });
  }
});
app.post('/api/library/refresh', asyncRoute(async (_req, res) => {
  if (libraryMoveRunning) return res.status(409).json({ error: 'Wait for the Library move to finish.' });
  try { await reconcileLibrary(); res.json({ books: _req.get('X-SwissMouse-Catalog') === '1' ? [] : visibleLibraryBooks(), warnings: libraryScanWarnings }); }
  catch (error: any) { res.status(500).json({ error: error.message }); }
}));
// Retained for older clients; normal UI exposes only Refresh.
app.post('/api/library/rescan', asyncRoute(async (_req, res) => {
  try {
    await reconcileLibrary(false, true);
    const recovered = jobs.filter(job => sourceMissing(job) && !!survivingLibraryM4b(job)).length;
    res.json({ books: visibleLibraryBooks(), warnings: libraryScanWarnings, recovered });
  }
  catch (error: any) { res.status(500).json({ error: error.message }); }
}));
app.post('/api/library/rebuild', asyncRoute(async (req, res) => {
  const sources = req.body?.sources;
  if (req.body?.confirmed !== true || !Array.isArray(sources) || !sources.length || sources.some(source => !['inbox', 'library'].includes(source)))
    return res.status(400).json({ error: 'Select Inbox and/or Library and confirm the rebuild.' });
  if (libraryScanRunning || libraryMoveRunning) return res.status(409).json({ error: 'Wait for the current library operation to finish.' });
  try {
    await reconcileLibrary(false, true, [...new Set(sources)] as ('inbox' | 'library')[]);
    res.json({ books: req.get('X-SwissMouse-Catalog') === '1' ? [] : visibleLibraryBooks(), warnings: libraryScanWarnings });
  } catch (error: any) {
    appendMasterEvent('Library', `Rebuild failed; previous stored information retained: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
}));
app.post('/api/library/:id/open-folder', asyncRoute(async (req, res) => {
  const job = [projectStore.get(req.params.id)].find(item => item && !item.importPending);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  const representedPath = libraryBook(job).representations?.[0]?.path;
  const candidates = [representedPath, survivingLibraryM4b(job)];
  let directory: string | undefined;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = fs.realpathSync(candidate);
      directory = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
      break;
    } catch { /* Try the surviving export if the original source was removed. */ }
  }
  if (!directory) return res.status(404).json({ error: 'The book folder is no longer available. Refresh or relink the book.' });
  try { await launchFolder(directory); res.json({ status: 'ok', directory }); }
  catch (error: any) { res.status(500).json({ error: `Could not open the folder: ${error.message}` }); }
}));
app.get('/api/library/:id/cover', asyncRoute(async (req, res) => {
  const url = projectStore.get(req.params.id)?.metadata?.cover?.url;
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(url || '');
  if (!match) return res.status(404).end();
  const key = createHash('sha256').update(url!).digest('hex');
  const input = Buffer.from(match[2], 'base64');
  if (input.length > 20 * 1024 * 1024) return res.status(413).end();
  let thumbnail = libraryThumbnails.get(key);
  if (!thumbnail) {
    let task = pendingThumbnails.get(key);
    if (!task) { task = renderLibraryThumbnail(input); pendingThumbnails.set(key, task); }
    try {
      thumbnail = await task;
      if (libraryThumbnails.size >= 256) libraryThumbnails.delete(libraryThumbnails.keys().next().value!);
      libraryThumbnails.set(key, thumbnail);
    } catch (error) {
      appendMasterEvent('Library cover', `Could not make a thumbnail for ${req.params.id}: ${error instanceof Error ? error.message : String(error)}`, 'WARNING');
      return res.status(500).end();
    } finally { pendingThumbnails.delete(key); }
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.type('image/jpeg').send(thumbnail);
}));

// List jobs
app.get('/api/jobs', asyncRoute(async (req, res) => {
  res.json((await catalog!.call('query',{limit:req.query.limit === undefined ? 100 : Number(req.query.limit),cursor:req.query.cursor})).items);
}));

// Create new job
app.post('/api/jobs', (req, res) => {
  const { name, author, narrator, parts } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Job name is required' });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'book';
  const id = `${slug}-${randomUUID().slice(0, 8)}`;
  
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
    : req.body.importPending ? [] : [
        { id: 'p-1', name: '01.mp3', sizeBytes: 35000000, durationSeconds: 1800, bitrate: 128, order: 1 },
        { id: 'p-2', name: '02.mp3', sizeBytes: 36500000, durationSeconds: 1920, bitrate: 128, order: 2 },
      ];

  const totalDur = formattedParts.reduce((acc, p) => acc + p.durationSeconds, 0);
  const totalBytes = formattedParts.reduce((acc, p) => acc + p.sizeBytes, 0);

  const newJob: AudiobookJob = {
    id,
    importPending: req.body.importPending === true,
    name: name.trim(),
    outputFolderPath: currentOutputFolder,
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
  const job = projectStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (!job.sourceBitrate && job.mergedMp3?.fullPath) {
    try {
      const media = job.parts.map(part=>inspect(getFfprobe(),path.resolve(APP_ROOT,job.sourceFolderPath || '',part.name)));
      job.sourceBitrate = Math.max(...media.map(m=>m.bitrate));
    } catch { /* Keep unknown explicit until the source can be inspected. */ }
  }
  res.json({ ...job, sourceMissing: sourceMissing(job), canMoveToLibrary: canMoveInboxBook(job), libraryBook: libraryBook(job) });
});

function resolvedOutputRoot(job?: AudiobookJob): string {
  const configured = job?.outputFolderPath?.trim() || currentOutputFolder;
  if (job && bookRootType(job) === 'inbox' && pathKey(path.resolve(APP_ROOT, configured)) === pathKey(currentOutputFolder))
    return path.join(currentConfig.inbox_folder || appPath('inbox'), '.swissmouse-work');
  return path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(APP_ROOT, configured);
}

function projectIntermediatesDir(job: AudiobookJob): string {
  return path.join(resolvedOutputRoot(job), 'intermediates', job.id);
}

function knownIntermediatesRoots(): string[] {
  return [...new Set([
    path.join(path.resolve(currentOutputFolder), 'intermediates'),
    ...projectStore.outputRoots().map(root => path.join(path.resolve(APP_ROOT, root), 'intermediates')),
  ])];
}

function isManagedChild(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pathEntryExists(candidate: string): boolean {
  try { fs.lstatSync(candidate); return true; } catch (error: any) { if (error?.code === 'ENOENT') return false; throw error; }
}

function ensureUnlinkedLibraryParent(root: string, parent: string): void {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('The configured Library folder is a linked path.');
  let current = root;
  for (const segment of path.relative(root, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!pathEntryExists(current)) fs.mkdirSync(current);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked Library folder is not a safe copy destination: ${current}`);
  }
}

function isInboxPath(candidate: string): boolean {
  const root = currentConfig.inbox_folder || appPath('inbox');
  return !!candidate && (pathKey(root) === pathKey(path.resolve(APP_ROOT, candidate)) || within(root, path.resolve(APP_ROOT, candidate)));
}

function bookRootType(job: AudiobookJob): 'inbox' | 'library' | undefined {
  const candidate = job.source?.path || job.sourceFolderPath;
  if (candidate && isInboxPath(candidate)) return 'inbox';
  if (candidate && within(currentOutputFolder, path.resolve(APP_ROOT, candidate))) return 'library';
  if (job.outputM4b?.fullPath && within(currentOutputFolder, job.outputM4b.fullPath)) return 'library';
  return undefined;
}

function completionCurrent(job: AudiobookJob) {
  return (!job.finalCheck || (job.finalCheck.state === 'complete' && job.finalCheck.inputSignature === currentFinalCheckSignature(job))) && job.processingStatus === 'complete' && job.validation?.status === 'PASS' && !job.libraryScan?.missing && !(job.staleSteps || []).some(step => ['export', 'validation', 'chapter_review'].includes(step));
}

function canMoveInboxBook(job: AudiobookJob) {
  return sourceLocation(job) !== 'managed' && completionCurrent(job) && job.validation?.status === 'PASS' && !!job.outputM4b?.fullPath;
}

async function completionSignature(job: AudiobookJob) {
  const files = [...new Set([...availableOriginalPaths(job), ...(archiveCurrent(job) ? [job.originalsArchive!.path] : []), ...exportedAudioPaths(job)])].sort();
  return fileSignature(await Promise.all(files.map(async (file, index) => stamp(file, String(index)))));
}

function remapBookPaths(job: AudiobookJob, from: string, to: string) {
  const remap = (value: string | undefined) => value && (pathKey(value) === pathKey(from) || within(from, value)) ? path.resolve(to, path.relative(from, value)) : value;
  if (job.source) job.source.path = remap(job.source.path)!;
  job.sourceFolderPath = remap(job.sourceFolderPath);
  job.outputFolderPath = remap(job.outputFolderPath);
  job.previewPath = remap(job.previewPath);
  job.downloadedAudioFile = remap(job.downloadedAudioFile);
  if (job.sourceSummary) job.sourceSummary = { ...job.sourceSummary, sourcePath: remap(job.sourceSummary.sourcePath)! };
  if (job.mergedMp3) job.mergedMp3.fullPath = remap(job.mergedMp3.fullPath);
  if (job.outputM4b) job.outputM4b.fullPath = remap(job.outputM4b.fullPath);
  for (const item of job.exports || []) { item.fullPath = remap(item.fullPath); item.coverPath = remap(item.coverPath); }
  for (const [format, file] of Object.entries(job.exportedFiles || {})) job.exportedFiles![format as OutputAudioFormat] = remap(file)!;
  for (const part of job.parts) if (path.isAbsolute(part.name)) part.name = remap(part.name)!;
  job.associatedFiles = job.associatedFiles?.map(file => ({ ...file, path: remap(file.path)! }));
  if (job.originalsArchive) job.originalsArchive = { ...job.originalsArchive, path: remap(job.originalsArchive.path)!, files: job.originalsArchive.files.map(file => ({ ...file, source: remap(file.source)! })) };
}

function reconcileLibrary(afterMove = false, fullRescan = false, rebuildSources?: ('inbox' | 'library')[]): Promise<void> {
  if (libraryScanRunning) return libraryScanRunning;
  if (activeLibraryMutations > (afterMove ? 1 : 0) || libraryMoveRunning || libraryConfigSaving || libraryValidationRunning || sourceImports.size || step1TaskRunning || metadataWriteJobs.size || jobs.some(job => job.exports?.some(item => ['running', 'queued'].includes(item.status))))
    return Promise.reject(new Error('Wait for current audio or file operations to finish before refreshing folders.'));
  libraryScanRunning = (async () => {
    libraryScanWarnings = [];
    libraryScanProgress = { operation: rebuildSources ? 'rebuild' : 'refresh', source: '', folders: 0, discovered: 0, processed: 0, phase: 'Scanning folders' };
    // Commit discovery in small recoverable batches. Durable user state is
    // never copied or discarded by a catalog rebuild.
    try {
    // Keep only identity/path indexes for reconciliation. Hydrate each project
    // lazily, and yield between small batches so browsing remains responsive.
    const scanProjects = async function* () {
      let count=0;
      for (const job of jobs) { yield job; if (++count % 64 === 0) await new Promise<void>(resolve=>setImmediate(resolve)); }
    };
    const activeSources = new Set<string>();
    const retained = new Map<string,NonNullable<AudiobookJob['retainedSourceFiles']>[number]>();
    const untouched = new Set<string>();
    const savedOwners = new Map<string,Set<string>>(), indexedOwners = new Map<string,Set<string>>(), automaticOwners = new Map<string,Set<string>>();
    const savedById = new Map<string,AudiobookJob>();
    for await (const job of scanProjects()) {
      savedById.set(job.id,job);
      let sources:string[]=[]; try { sources=sourceFilePaths(job); } catch { /* Invalid legacy paths remain recoverable. */ }
      for (const file of sources) activeSources.add(pathKey(file));
      for (const file of job.retainedSourceFiles || []) retained.set(pathKey(file.path),file);
      if (isUntouchedDiscovery(job) && !listeningStore.has(job.id)) untouched.add(job.id);
      if (job.libraryScan?.superseded) continue;
      for (const file of projectFiles(job,sources)) {
        const key=pathKey(file.path);
        for (const owners of [savedOwners,untouched.has(job.id)?automaticOwners:indexedOwners]) {
          const ids=owners.get(key) || new Set<string>(); ids.add(job.id); owners.set(key,ids);
        }
      }
    }
    for (const key of retained.keys()) if (activeSources.has(key)) retained.delete(key);
    activeSources.clear();
    const roots = [{ type: 'inbox' as const, root: path.resolve(currentConfig.inbox_folder || appPath('inbox')) }, { type: 'library' as const, root: path.resolve(currentOutputFolder) }].filter(item => !rebuildSources || rebuildSources.includes(item.type));
    const incompleteRoots = new Set<string>();
    const unavailableRoots = new Set<string>();
    const found: { type: 'inbox' | 'library'; root: string; books: DiskBook[] }[] = [];
    const joinedFragments = new Set<string>();
    for (const { type, root } of roots) {
      libraryScanProgress.source = type === 'inbox' ? 'Inbox' : 'Library';
      appendMasterEvent('Library', `${libraryScanProgress.source} ${rebuildSources ? 'rebuild' : 'scan'} started: ${root}`);
      try {
        const unreadable: string[] = [];
        const scannedBooks = await scanRoot(root, SUPPORTED_AUDIO_EXTENSIONS, [...knownIntermediatesRoots(), uploadDir], {
          onFolder: () => { libraryScanProgress.folders++; },
          onError: (file, error) => {
            incompleteRoots.add(root); unreadable.push(file);
            const warning = `Could not read ${file}: ${error.message}. Existing records retained for unreadable paths.`;
            libraryScanWarnings.push(warning); appendMasterEvent('Library', warning, 'WARNING');
          },
        });
        // A source plus its known exports can share a book sidecar even though
        // the generic M4B scanner treats each file as an independent book. Only
        // restore saved companions when every audio file here has that owner.
        const folderBooks = new Map<string, DiskBook[]>();
        for (const disk of scannedBooks) {
          const key = pathKey(disk.folder), siblings = folderBooks.get(key) || [];
          siblings.push(disk); folderBooks.set(key, siblings);
        }
        for (const siblings of folderBooks.values()) {
          if (siblings.some(disk => disk.metadataFile)) continue;
          const ownerIds = siblings.flatMap(disk => disk.files.map(file => savedOwners.get(pathKey(path.join(disk.folder, file.name)))));
          const owner = ownerIds[0]?.size === 1 ? [...ownerIds[0]][0] : undefined;
          if (!owner || !ownerIds.every(ids => ids?.size === 1 && ids.has(owner))) continue;
          const companions = savedById.get(owner)?.associatedFiles?.filter(file =>
            pathKey(path.dirname(file.path)) === pathKey(siblings[0].folder) && /^((?:exmetadata|metadata)\.json|cover\.(png|jpe?g|webp))$/i.test(path.basename(file.path))) || [];
          const present = [];
          for (const file of companions) {
            try { present.push({ file, stamp: await stamp(file.path) }); } catch { /* Missing companions are optional. */ }
          }
          for (const disk of siblings) if (present.length) {
            disk.metadataFile = present.find(item => item.file.kind === 'metadata')?.file.path;
            disk.associatedFiles = present.map(item => ({ path: item.file.path, kind: item.file.kind as 'metadata' | 'cover' }));
            disk.signature = fileSignature([...disk.files, ...present.map(item => item.stamp)]);
          }
        }
        for (const book of scannedBooks) book.files = book.files.filter(file => {
          const original = retained.get(pathKey(path.join(book.folder, file.name)));
          return !original || original.identity !== file.identity || original.size !== file.size || original.mtime !== file.mtime;
        });
        const explicitById = savedById;
        const partitioned = scannedBooks.flatMap(disk => {
          const diskMembers = new Set(disk.files.map(file => pathKey(path.join(disk.folder, file.name))));
          const owners = [...new Set([...diskMembers].flatMap(file => [...(indexedOwners.get(file) || [])]))].map(id => explicitById.get(id)!).filter(job =>
            job.sourceMembership === 'confirmed' || job.sourceMembership === 'explicit' || !!job.outputM4b ||
            !!job.libraryScan?.path && within(disk.path, job.libraryScan.path));
          if (!owners.length || (owners.length === 1 && disk.files.every(file => indexedOwners.get(pathKey(path.join(disk.folder, file.name)))?.has(owners[0].id)))) return [disk];
          const assigned = new Set<string>();
          const groups: DiskBook[] = owners.map(job => {
            const memberPaths = new Set([...sourceFilePaths(job), ...exportedAudioPaths(job)].map(pathKey));
            const files = disk.files.filter(file => memberPaths.has(pathKey(path.join(disk.folder, file.name))));
            files.forEach(file => assigned.add(file.name));
            const sidecars = disk.associatedFiles?.filter(file => job.associatedFiles?.some(own => pathKey(own.path) === pathKey(file.path)));
            const folder = job.sourceFolderPath && files.every(file => within(job.sourceFolderPath!, path.join(disk.folder, file.name))) ? job.sourceFolderPath : disk.folder;
            const relativeFiles = files.map(file => ({ ...file, name: path.relative(folder, path.join(disk.folder, file.name)) }));
            return { ...disk, folder, files: relativeFiles, path: job.libraryScan?.path && within(disk.path, job.libraryScan.path) ? job.libraryScan.path : path.join(disk.folder, files[0].name), grouped: true,
              signature: fileSignature(relativeFiles), identity: createHash('sha256').update(JSON.stringify(files.map(file => file.identity))).digest('hex'),
              metadataFile: sidecars?.find(file => file.kind === 'metadata')?.path, associatedFiles: sidecars, title: job.name };
          });
          const remaining = disk.files.filter(file => !assigned.has(file.name));
          if (remaining.length) groups.push({ ...disk, files: remaining, path: path.join(disk.folder, remaining[0].name), metadataFile: undefined, associatedFiles: [], grouped: true });
          return groups;
        });
        const books = partitioned.filter(book => book.files.length > 0).filter(book => !unreadable.some(file => pathKey(file) === pathKey(book.path) || within(book.path, file) || within(file, book.path)));
        libraryScanProgress.discovered += books.length;
        // Prefer the book's own sidecar/source over a nested export directory.
        books.sort((a, b) => a.path.split(path.sep).length - b.path.split(path.sep).length || a.path.localeCompare(b.path));
        found.push({ type, root, books });
      } catch (error: any) {
        unavailableRoots.add(root);
        const warning = `${type === 'inbox' ? 'Inbox' : 'Library'} scan unavailable: ${error.message}. Saved records retained.`;
        libraryScanWarnings.push(warning); appendMasterEvent('Library', warning, 'WARNING');
      }
    }
    const diskPaths = new Set(found.flatMap(group => group.books.map(book => pathKey(book.path))));
    const used = new Set<string>();
    const byPath = new Map<string, AudiobookJob>();
    const byFile = new Map<string, AudiobookJob>();
    const byIdentity = new Map<string, AudiobookJob[]>();
    const bySignature = new Map<string, AudiobookJob[]>();
    // Retain old automatic collection projects for recovery, but do not let
    // their file indexes swallow the newly separated book entries.
    const superseded = new Set<string>();
    // Named disc folders used to create independent records. Replace only
    // untouched fragments; saved work was partitioned above and stays visible.
    const automaticById = savedById;
    for (const group of found) if (!incompleteRoots.has(group.root)) for (const disk of group.books) {
      const members = new Set(disk.files.map(file => pathKey(path.join(disk.folder, file.name))));
      const fragments = [...new Set([...members].flatMap(file => [...(automaticOwners.get(file) || [])]))].map(id => automaticById.get(id)!);
      for (const fragment of fragments) if (fragment.libraryScan?.root === group.root && within(disk.folder, fragment.libraryScan.path) &&
        !diskPaths.has(pathKey(fragment.libraryScan.path)) && sourceFilePaths(fragment).every(file => members.has(pathKey(file)))) {
        superseded.add(fragment.id); joinedFragments.add(fragment.id);
      }
    }
    for await (const job of scanProjects()) {
      const previousPath = job.libraryScan?.path || job.source?.path || job.sourceFolderPath;
      if (!previousPath || job.importPending || job.personalRating !== undefined || listeningStore.has(job.id) || (job.sourceMembership && job.sourceMembership !== 'automatic') || diskPaths.has(pathKey(previousPath))) continue;
      const exports = new Set(exportedAudioPaths(job).map(pathKey));
      if (found.some(group => !incompleteRoots.has(group.root) && (!rebuildSources || rebuildSources.includes(job.libraryScan?.type || bookRootType(job)!)) &&
        group.books.filter(book => within(previousPath, book.path) && !book.files.every(file => exports.has(pathKey(path.join(book.folder, file.name))))).length > 1)) superseded.add(job.id);
    }
    for await (const job of scanProjects()) {
      if (superseded.has(job.id) || job.libraryScan?.superseded) continue;
      // A shared browse folder is not the identity of a loose multipart book.
      for (const value of job.libraryScan ? [job.libraryScan.path] : [job.source?.path, job.sourceFolderPath]) if (value) byPath.set(pathKey(value), job);
      try { for (const file of [...sourceFilePaths(job), ...exportedAudioPaths(job)]) byFile.set(pathKey(file), job); } catch { /* Invalid legacy paths remain recoverable. */ }
      if (job.libraryScan) byIdentity.set(job.libraryScan.identity, [...(byIdentity.get(job.libraryScan.identity) || []), job]);
      if (job.libraryScan) bySignature.set(job.libraryScan.signature, [...(bySignature.get(job.libraryScan.signature) || []), job]);
    }
    let changed = false;
    for (const { type, root, books } of found) {
      libraryScanProgress.source = type === 'inbox' ? 'Inbox' : 'Library';
      libraryScanProgress.phase = 'Identifying books and grouping files';
      let added = 0, updated = 0, removed = 0, uncertain = 0;
      // Inspect a small window concurrently, then reconcile in stable order.
      // Only changed observations are read; project mutations stay serial.
      for (let offset = 0; offset < books.length; offset += 4) {
      const batch = books.slice(offset, offset + 4);
      const detectedBatch = await mapScanWork(batch, 4, async disk => {
        const candidate = byPath.get(pathKey(disk.path)) || disk.files.map(file => byFile.get(pathKey(path.join(disk.folder, file.name)))).find(Boolean);
        if (candidate && (used.has(candidate.id) || candidate.importPending || (candidate.libraryScan && unavailableRoots.has(candidate.libraryScan.root)) ||
          (rebuildSources && !rebuildSources.includes(candidate.libraryScan?.type || bookRootType(candidate)!)))) return undefined;
        const old = candidate?.libraryScan;
        if (candidate && !fullRescan && old?.coverScanVersion === 1 && old?.identificationVersion === 1 && old.signature === disk.signature && !old.missing && old.path === disk.path && old.root === root) return undefined;
        const detected = await identifyBook(disk, file => libraryMedia.tags(getFfprobe(), file),
          old || rebuildSources ? undefined : candidate?.metadata, file => libraryMedia.cover(getFfmpeg(), getFfprobe(), file));
        const durationSeconds = disk.files.length === 1 ? await libraryMedia.duration(getFfprobe(), path.join(disk.folder, disk.files[0].name)).catch(() => undefined) : undefined;
        return { ...detected, durationSeconds };
      });
      for (const [index, disk] of batch.entries()) {
        libraryScanProgress.processed++;
        const diskFiles = new Set(disk.files.map(file => pathKey(path.join(disk.folder, file.name))));
        let job = byPath.get(pathKey(disk.path)) || [...diskFiles].map(file => byFile.get(file)).find(Boolean);
        if (job?.libraryScan && unavailableRoots.has(job.libraryScan.root)) { used.add(job.id); continue; }
        // Shared projects retain their owning source's state during a targeted rebuild.
        if (job && rebuildSources && !rebuildSources.includes(job.libraryScan?.type || bookRootType(job)!)) { used.add(job.id); continue; }
        if (job && used.has(job.id)) continue;
        if (!job) {
          const identityMatches = byIdentity.get(disk.identity) || [];
          const candidates = identityMatches.filter(item => (!rebuildSources || rebuildSources.includes(item.libraryScan!.type)) && !used.has(item.id) && !diskPaths.has(pathKey(item.libraryScan!.path)) && !fs.existsSync(item.libraryScan!.path));
          if (candidates.length === 1) {
            job = candidates[0];
            remapBookPaths(job, job.source?.mode === 'folder' ? job.source.path : job.libraryScan!.path, disk.mode === 'folder' ? disk.folder : disk.path);
            appendMasterEvent('Library', `Relinked moved book: ${job.name} -> ${disk.path}`);
          }
        }
        if (job?.importPending) { used.add(job.id); continue; }
        // An export and its Inbox original remain one project, never duplicate entries.
        if (job && type === 'library') {
          try {
            const relocated = await recoverRelocatedOutput(job, disk, file => mediaCache.read(getFfprobe(), file), file => {
              const owner = byFile.get(pathKey(file)); return !!owner && owner.id !== job!.id;
            });
            if (relocated) { changed = true; byFile.set(pathKey(relocated), job); appendMasterEvent('Library', 'Recovered relocated export: ' + relocated); }
          } catch (error: any) { appendMasterEvent('Library', 'Could not verify a relocated export for ' + job.name + ': ' + error.message, 'WARNING'); }
        }
        const old = job?.libraryScan;
        const newRecord = !job;
        if (detectedBatch[index]) {
          const detected = detectedBatch[index]!;
          if (!job) {
            job = { id: `book-${randomUUID()}`, name: detected.metadata.title, createdAt: new Date().toISOString(), status: 'draft', parts: [], totalSizeBytes: 0, totalDurationSeconds: 0, candidates: [], chapters: [], logs: [], importedAt: new Date().toISOString(), metadata: detected.metadata, outputFolderPath: type === 'inbox' ? path.join(root, '.swissmouse-work') : currentOutputFolder };
            jobs.push(job); job = projectStore.adopt(job.id)!; added++;
          } else {
            updated++;
            const next = mergeDetectedMetadata(job, detected.metadata);
            if (JSON.stringify(next) !== JSON.stringify(job.metadata)) job.metadataRevision = (job.metadataRevision || 0) + 1;
            job.metadata = next;
          }
          // The index is derived data; retain project IDs, explicit edits, drafts,
          // transcripts and confirmed membership while rebuilding disk-derived data.
          job.sourceInventory = undefined;
          job.name = job.metadata?.title || job.name;
          // Do not replace a processed project's original parts with its exports.
          const sourceMatches = newRecord || (old?.path === disk.path && job.source?.mode === 'folder' && pathKey(job.source.path) === pathKey(disk.folder)) || (job.source
            ? pathKey(job.source.path) === pathKey(disk.path)
            : sourceFilePaths(job).some(file => diskFiles.has(pathKey(file))));
          if (sourceMatches) {
            job.source = { kind: type === 'inbox' ? 'inbox' : 'managed', path: disk.mode === 'folder' ? disk.folder : disk.path, mode: disk.mode };
            job.sourceFolderPath = disk.folder;
            // Refresh displayed file sizes without silently changing project membership.
            const sizes = new Map(disk.files.map(file => [file.name.replace(/\\/g, '/'), file.size]));
            for (const part of job.parts) {
              const size = sizes.get(sourceRelative(job, part));
              if (size !== undefined) part.sizeBytes = size;
            }
            job.totalSizeBytes = job.parts.reduce((sum, part) => sum + part.sizeBytes, 0);
            const groups = probableBookGroups(disk.files.map(file => ({ relativePath: file.name })), path.basename(disk.folder));
            if (!job.sourceMembership || job.sourceMembership === 'automatic') {
              job.bookScope = { ...job.bookScope, title: groups.length === 1 ? groups[0].title : 'Choose a probable book group' };
              if (groups.length > 1) detected.warning ||= 'Several probable books found. Review Files to select a book before processing.';
            }
            if (newRecord && !job.outputM4b) {
            const owned = disk.grouped || groups.length === 1 ? disk.files : [];
            if (!owned.length) detected.warning = 'Several probable books found. Review Files to select a book before processing.';
            job.bookScope = { title: groups.length === 1 ? groups[0].title : 'Choose a probable book group' };
            job.parts = owned.map((file, index) => ({ ...job!.parts.find(part => part.name === file.name), id: job!.parts.find(part => part.name === file.name)?.id || `p-${index + 1}`, name: file.name, sizeBytes: file.size, durationSeconds: job!.parts.find(part => part.name === file.name)?.durationSeconds || 0, bitrate: job!.parts.find(part => part.name === file.name)?.bitrate || 0, order: index + 1 }));
            job.totalSizeBytes = owned.reduce((sum, file) => sum + file.size, 0);
            }
          }
          if (old && old.signature !== disk.signature && job.processingStatus === 'complete') {
            let sameCompletedFiles = false;
            if (job.sourceReorganizationPending) {
              try { sameCompletedFiles = job.completionSignature === await completionSignature(job); } catch { /* Missing audio is incomplete. */ }
            }
            if (!sameCompletedFiles) {
              job.processingStatus = 'incomplete';
              appendMasterEvent('Library', `Processing status changed to needs work after filesystem changes: ${job.name}`);
            }
          }
          job.sourceReorganizationPending = false;
          job.libraryScan = { root, type, path: disk.path, signature: disk.signature, identity: disk.identity, warning: detected.warning, coverScanVersion: 1, identificationVersion: 1, durationSeconds: detected.durationSeconds,
            detectedMetadata: { ...detected.metadata, cover: undefined }, coverSignature: createHash('sha256').update(JSON.stringify(detected.metadata.cover || null)).digest('hex') };
          job.metadataUpdatedAt = new Date().toISOString();
          changed = true;
          if (detected.warning) { uncertain++; appendMasterEvent('Library', `${disk.path}: ${detected.warning}`, 'WARNING'); }
        }
        const memberPaths = new Set(sourceFilePaths(job!).map(pathKey));
        if (disk.associatedFiles?.length && disk.files.every(file => memberPaths.has(pathKey(path.join(disk.folder, file.name))))) {
          const associated = new Map((job!.associatedFiles || []).map(file => [pathKey(file.path), file]));
          for (const file of disk.associatedFiles) if (!associated.has(pathKey(file.path))) { associated.set(pathKey(file.path), file); changed = true; }
          job!.associatedFiles = [...associated.values()];
        }
        used.add(job!.id);
        if (job!.sourceReorganizationPending) { job!.sourceReorganizationPending = false; changed = true; }
        if (job!.processingStatus === 'complete') {
          let valid = false;
          try { valid = job!.completionSignature === await completionSignature(job!); } catch { /* Missing audio invalidates completion. */ }
          if (!valid) { job!.processingStatus = 'incomplete'; changed = true; appendMasterEvent('Library', `Processing status changed to needs work: ${job!.name}`); }
        }
      }
      if (offset % 100 === 96 && changed) { persistJobsAtomically(); changed = false; }
      }
      for await (const job of scanProjects()) {
        // Archiving intentionally removes source audio; the verified ZIP and
        // export in the work folder keep this project available for finalization.
        if (archiveCurrent(job) && exportedAudioPaths(job).some(file => fs.existsSync(file))) {
          if (job.libraryScan?.missing) { job.libraryScan.missing = false; changed = true; }
          continue;
        }
        if (incompleteRoots.has(root)) continue;
        if (rebuildSources && !rebuildSources.includes(job.libraryScan?.type || bookRootType(job)!)) continue;
        const source = job.source?.path || job.sourceFolderPath;
        if (!job.libraryScan && !job.importPending && !used.has(job.id) && source && within(root, source)) {
          job.libraryScan = { root, type, path: source, signature: '', identity: '', missing: true };
          job.processingStatus = 'incomplete'; changed = true; removed++;
        }
        if (job.libraryScan?.root === root && !used.has(job.id) && !diskPaths.has(pathKey(job.libraryScan.path)) && !job.libraryScan.missing) {
          job.libraryScan.missing = true; job.processingStatus = 'incomplete'; changed = true; removed++;
        }
        if (superseded.has(job.id) && job.libraryScan?.root === root) {
          const warning = joinedFragments.has(job.id)
            ? 'This automatic disc entry was replaced by a complete book entry. Its saved project data is retained for recovery.'
            : 'This automatic collection entry was replaced by separate book entries. Its saved project data is retained for recovery.';
          if (!job.libraryScan.superseded || job.libraryScan.warning !== warning) { job.libraryScan.superseded = true; job.libraryScan.warning = warning; changed = true; }
        }
      }
      appendMasterEvent('Library', `${type === 'inbox' ? 'Inbox' : 'Library'} reconciliation: ${books.length} books, ${added} discovered, ${updated} changed, ${removed} removed from view, ${uncertain} need metadata verification.`);
    }
    if (changed) {
      try { persistJobsAtomically(); }
      catch (error) { jobs = projectStore.rollback(); throw error; }
    }
    } catch (error) { jobs = projectStore.rollback(); throw error; }
  })().finally(async () => { catalog?.invalidate(true); try { await catalog?.ready(); } finally { libraryScanProgress.phase = 'Finished'; libraryScanRunning = undefined; } });
  return libraryScanRunning;
}

function sourceLocation(job: AudiobookJob): LibraryBook['sourceLocation'] {
  if (job.source) return isInboxPath(job.source.path) ? 'inbox' : within(currentOutputFolder, job.source.path) ? 'managed' : 'external';
  if (!job.parts.length) return 'unknown';
  if (!job.sourceFolderPath) return job.parts.every(part => path.isAbsolute(part.name)) ? 'external' : 'unknown';
  // Old jobs load without migration; their stable IDs and original paths stay intact.
  return isInboxPath(job.sourceFolderPath) ? 'inbox' : 'external';
}

function sourceFilePaths(job: AudiobookJob): string[] {
  if (!job.parts.length) return [];
  if (!job.sourceFolderPath) return job.parts.every(part => path.isAbsolute(part.name)) ? job.parts.map(part => path.resolve(part.name)) : [];
  const root = path.resolve(APP_ROOT, job.sourceFolderPath);
  return job.parts.map(part => {
    if (!job.source && path.isAbsolute(part.name)) return path.resolve(part.name); // Older path-based jobs.
    const candidate = path.resolve(root, part.name);
    if (!isManagedChild(root, candidate)) throw new Error(`Unsafe source part path: ${part.name}`);
    return candidate;
  });
}

function archiveCurrent(job: AudiobookJob): boolean {
  try { return catalogArchiveCurrent(job.originalsArchive,job.sourceKey,sourceFilePaths(job)); } catch { return false; }
}
function availableOriginalPaths(job: AudiobookJob): string[] {
  const files = sourceFilePaths(job);
  return archiveCurrent(job) ? files.filter(file => fs.existsSync(file)) : files;
}
function sourceMissing(job: AudiobookJob): boolean {
  if (archiveCurrent(job)) return false;
  try { const paths = sourceFilePaths(job); return paths.length > 0 && paths.some(file => !fs.existsSync(file) || !fs.statSync(file).isFile()); }
  catch { return true; }
}

function survivingLibraryM4b(job: AudiobookJob): string | undefined {
  return findAvailableM4b(currentOutputFolder,[job.outputM4b?.fullPath,job.exportedFiles?.m4b,
    ...(job.exports || []).filter(item => item.format === 'm4b' && item.status === 'success').map(item => item.fullPath)]);
}

function removeManagedChild(root: string, target: string): boolean {
  if (!isManagedChild(root, target)) throw new Error(`Refusing to remove a path outside the managed cleanup area: ${target}`);
  const inbox = currentConfig.inbox_folder || appPath('inbox');
  if ((pathKey(root) === pathKey(uploadDir) || pathKey(root) === pathKey(appPath('audiobooks'))) &&
      (pathKey(target) === pathKey(inbox) || within(inbox, target) || within(target, inbox))) return false;
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function clearManagedDirectory(root: string): number {
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
    return 0;
  }
  let removed = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (removeManagedChild(root, path.join(root, entry.name))) removed += 1;
  }
  return removed;
}

function cleanupInProgress(): boolean {
  return step1TaskRunning || sourceImports.size > 0 || activeInstallProgress.isActive || runtimeMutationRunning || isYtDlpInstalling ||
    activeModelDownloads.size > 0 || activeFasterWhisperInstalls.size > 0 ||
    jobs.some(job => job.exports?.some(item => item.status === 'queued' || item.status === 'running'));
}

function cleanupBusyResponse(res: express.Response): express.Response | null {
  if (!cleanupInProgress()) return null;
  return res.status(409).json({ error: 'Wait for active importing, processing, exporting, installation, or downloads to finish before cleaning up files.' });
}

function resetGeneratedJobState(job: AudiobookJob): void {
  job.processingStatus = 'incomplete';
  job.mergedMp3 = null;
  job.previewPath = undefined;
  job.sourceKey = undefined;
  job.preparedAudioKey = undefined;
  job.transcriptKey = undefined;
  job.transcription = null;
  job.transcriptWords = undefined;
  job.transcriptSegments = undefined;
  job.candidates = [];
  job.chapterDetectionKey = undefined;
  job.pipelineSteps = undefined;
  job.status = job.outputM4b ? 'built' : 'draft';
}

function resetImportedJobState(job: AudiobookJob): void {
  resetGeneratedJobState(job);
  // Cleanup may remove working copies, but not an existing referenced Inbox,
  // Library, or external source. Keep its paths and metadata record intact.
  if (job.source && !sourceMissing(job) && sourceFilePaths(job).length) return;
  job.libraryScan = undefined;
  job.source = undefined;
  job.parts = [];
  job.totalDurationSeconds = 0;
  job.totalSizeBytes = 0;
  job.sourceFolderPath = undefined;
  job.discoveredFiles = undefined;
  job.unsupportedFiles = undefined;
  job.detectedFormats = undefined;
  job.isStreamCopyCompatible = undefined;
  job.streamCopyIncompatibilityReason = undefined;
  job.downloadedAudioFile = undefined;
  job.sourceSummary = undefined;
}

function removeProjectManagedFiles(job: AudiobookJob, includeImportedSource: boolean): number {
  let removed = 0;
  const intermediatesRoot = path.join(resolvedOutputRoot(job), 'intermediates');
  if (removeManagedChild(intermediatesRoot, path.join(intermediatesRoot, job.id))) removed += 1;
  if (includeImportedSource) {
    for (const root of [uploadDir, appPath('audiobooks')]) {
      if (removeManagedChild(root, path.join(root, job.id))) removed += 1;
    }
  }
  return removed;
}

function removeOrphanedProjectFolders(): number {
  const activeJobIds = new Set(jobs.map(job => job.id));
  let removed = 0;
  for (const root of [uploadDir, appPath('audiobooks'), ...knownIntermediatesRoots()]) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && activeJobIds.has(entry.name)) continue;
      if (removeManagedChild(root, path.join(root, entry.name))) removed += 1;
    }
  }
  return removed;
}

function removeProjectTemporaryFiles(job: AudiobookJob): number {
  const root = projectIntermediatesDir(job);
  if (!fs.existsSync(root)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const disposableFile = entry.isFile() && (
      /^part-\d+\.wav$/i.test(entry.name) || entry.name === 'concat.txt' ||
      /^analysis\.wav\.analysis\.json\.tmp-[0-9a-f-]{36}$/i.test(entry.name)
    );
    const candidate = path.join(root, entry.name);
    const disposableDirectory = entry.isDirectory() && /^analysis\.wav\.analysis-[0-9a-f-]{36}$/i.test(entry.name) &&
      fs.existsSync(path.join(candidate, 'features.bin')) &&
      fs.readdirSync(candidate, { withFileTypes: true }).every(child => child.isFile() && /^(features|level-\d+)\.bin$/i.test(child.name));
    if ((disposableFile || disposableDirectory) && removeManagedChild(root, candidate)) removed += 1;
  }
  return removed;
}

function managedPcmFiles(job: AudiobookJob): string[] {
  const root = projectIntermediatesDir(job);
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory() || pathKey(fs.realpathSync(root)) !== pathKey(root)) return [];
  let protectedPaths: Set<string>;
  try { protectedPaths = new Set([...sourceFilePaths(job), ...exportedAudioPaths(job)].map(pathKey)); }
  catch { return []; }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(analysis|master|part-\d+)\.wav$/i.test(entry.name))
    .map(entry => path.join(root, entry.name))
    .filter(file => !protectedPaths.has(pathKey(file)) && !fs.lstatSync(file).isSymbolicLink());
}

function clearProjectPcm(job: AudiobookJob): number {
  let bytes = 0;
  for (const file of managedPcmFiles(job)) {
    if (job.previewPath && pathKey(job.previewPath) === pathKey(file) && retainWaveform(file)) job.retainedWaveform = { audio: file, sourceKey: job.sourceKey };
    bytes += fs.statSync(file).size;
    fs.unlinkSync(file);
    if (job.previewPath && pathKey(job.previewPath) === pathKey(file)) job.previewPath = undefined;
  }
  if (bytes) {
    job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Cleared ${bytes} bytes of SwissMouse PCM cache. Transcript, chapter, and metadata state was kept.` });
    appendMasterEvent('Processing storage', `Cleared ${bytes} bytes of PCM for ${job.name}.`);
  }
  return bytes;
}

function processingStorage() {
  const totals = { pcm: 0, transcripts: 0, waveform: 0, other: 0 };
  const directoryBytes = (folder: string): number => fs.readdirSync(folder, { withFileTypes: true }).reduce((sum, entry) => {
    if (entry.isSymbolicLink()) return sum;
    const file = path.join(folder, entry.name);
    return sum + (entry.isDirectory() ? directoryBytes(file) : entry.isFile() ? fs.statSync(file).size : 0);
  }, 0);
  for (const job of jobs) {
    const root = projectIntermediatesDir(job);
    if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory() || pathKey(fs.realpathSync(root)) !== pathKey(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && /^analysis\.wav\.analysis-[0-9a-f-]{36}$/i.test(entry.name)) {
        totals.waveform += directoryBytes(path.join(root, entry.name));
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const file = path.join(root, entry.name);
      const bytes = fs.statSync(file).size;
      if (/^(analysis|master|part-\d+)\.wav$/i.test(entry.name)) totals.pcm += bytes;
      else if (/transcript|word|chapter/i.test(entry.name) && /\.json$/i.test(entry.name)) totals.transcripts += bytes;
      else if (/waveform|peaks|analysis/i.test(entry.name)) totals.waveform += bytes;
      else totals.other += bytes;
    }
  }
  return totals;
}

app.get('/api/storage/processing', (_req, res) => {
  try { res.json(processingStorage()); }
  catch (error: any) { res.status(500).json({ error: error.message || 'Could not inspect processing storage.' }); }
});

// Delete job
app.delete('/api/jobs/:id', (req, res) => {
  const index = jobs.findIndex(j => j.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const job = jobs[index];
  if (cleanupBusyResponse(res)) return;
  try {
    removeProjectManagedFiles(job, true);
  } catch (error: any) {
    return res.status(500).json({ error: `The project could not be deleted because its working files could not be removed: ${error.message}` });
  }

  jobs.splice(index, 1);
  saveJobs();
  res.json({ status: 'ok' });
});

// Step 1: Save Step 1 Options & Settings
app.post('/api/jobs/:id/step1-settings', (req, res) => {
  const job = projectStore.get(req.params.id);
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

  if (job.sourceMembership === 'confirmed' && !(sourceFolderPath === '' && Array.isArray(parts) && parts.length === 0) &&
      ((sourceFolderPath !== undefined && sourceFolderPath !== job.sourceFolderPath) || (Array.isArray(parts) && JSON.stringify(parts.map((part: any) => part.name).sort()) !== JSON.stringify(job.parts.map(part => part.name).sort()))))
    return res.status(409).json({ error: 'Manual file membership must be changed in Review Files.' });
  if (sourceFolderPath !== undefined && sourceFolderPath !== job.sourceFolderPath) {
    job.libraryScan = undefined; job.processingStatus = 'incomplete';
  }

  if (req.body.transcriptionSettings !== undefined) {
    try { job.transcriptionSettings = validatedTranscriptionSettingsMap(req.body.transcriptionSettings); }
    catch (error: any) { return res.status(400).json({ error: error.message }); }
  }
  if (job.status === 'draft' && Array.isArray(parts) && parts.length > 0 &&
      (sourceFolderPath !== job.sourceFolderPath || JSON.stringify(parts.map((part: any) => [part.name, part.sizeBytes])) !== JSON.stringify(job.parts.map(part => [part.name, part.sizeBytes])))) {
    job.importInspected = false;
    job.importedMetadata = undefined;
    if (job.importPending) job.metadataDraft = undefined;
  }
  if (sourceFolderPath !== undefined) job.sourceFolderPath = sourceFolderPath;
  if (sourceFolderPath === '' && Array.isArray(parts) && parts.length === 0) { job.source = undefined; job.sourceMembership = undefined; job.explicitlyAddedSourceFiles = []; job.sourceMembershipReview = undefined; job.bookScope = undefined; job.sourceInventory = undefined; job.excludedSourceFiles = []; }
  if (req.body.inputMethod !== undefined) job.inputMethod = req.body.inputMethod;
  if (req.body.hasNestedChapterFolders !== undefined) job.hasNestedChapterFolders = req.body.hasNestedChapterFolders;
  if (outputFolderPath !== undefined) job.outputFolderPath = outputFolderPath;
  if (chapterSource !== undefined) job.chapterSource = chapterSource;
  if (req.body.generateTranscript !== undefined) job.generateTranscript = req.body.generateTranscript === true;
  if (req.body.generateWaveform !== undefined) { job.generateWaveform = req.body.generateWaveform === true; if(!job.generateWaveform)job.waveformReady=false; }
  if (mergeMethod !== undefined) job.mergeMethod = mergeMethod;
  if (selectedModelId !== undefined) job.selectedModelId = selectedModelId;
  if (Array.isArray(req.body.discoveredFiles)) job.discoveredFiles = req.body.discoveredFiles;

  if (Array.isArray(parts)) {
    job.parts = parts.map((p: any, idx: number) => ({
      id: p.id || `p-${idx + 1}`,
      name: p.name || `part_${idx + 1}.mp3`,
      sourceRelativePath: p.sourceRelativePath,
      chapterGroup: job.parts.find(part => part.name === p.name)?.chapterGroup,
      discNumber: p.discNumber,
      trackNumber: p.trackNumber,
      sizeBytes: p.sizeBytes || 25000000,
      durationSeconds: p.durationSeconds || 1500,
      bitrate: p.bitrate || 128,
      order: idx + 1,
    })).sort(job.sourceOrderManual ? (a, b) => a.order - b.order : sourceOrderCompare);
    job.totalDurationSeconds = job.parts.reduce((acc, p) => acc + p.durationSeconds, 0);
    job.totalSizeBytes = job.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
    if (sourceFolderPath && (!job.source || path.resolve(job.sourceFolderPath || '') !== path.resolve(APP_ROOT, sourceFolderPath))) {
      const resolved = path.resolve(APP_ROOT, sourceFolderPath);
      job.source = { kind: isInboxPath(resolved) ? 'inbox' : 'external', path: resolved, mode: 'folder' };
    }
  }

  if (job.importPending && Array.isArray(parts) && parts.length === 0 && sourceFolderPath === '') {
    job.importInspected = false;
    job.importedMetadata = undefined;
    job.sourceTags = undefined;
    job.sourceFormat = undefined;
    job.sourceCodec = undefined;
    job.existingChapters = [];
    job.chapterReviewBaseline = undefined; job.chapters = [{ id: `c-${Date.now()}`, start: '00:00:00.000', title: 'Chapter 1' }];
    job.metadataDraft = undefined;
    job.metadataUpdatedAt = undefined;
    job.sourceSummary = undefined;
    job.youtubeUrl = undefined;
    job.youtubeVideoInfo = undefined;
    job.librivox = undefined;
    job.downloadedAudioFile = undefined;
    job.metadata = { title: 'New book', author: '', narrator: '', genres: [], language: 'eng', abridged: false, explicit: false };
    job.name = 'New book';
    job.author = '';
    job.narrator = '';
  }

  saveJobs();
  res.json({ status: 'ok', job });
});

function importedSourcePaths(job: AudiobookJob): string[] {
  const files = sourceFilePaths(job);
  if (!files.length) throw new Error('Choose an audio source first.');
  for (const file of files) if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Source audio is missing: ${file}`);
  return files;
}

function validatedAudioFile(value: unknown) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Select an absolute local audiobook path.');
  const file = path.resolve(value);
  const extension = path.extname(file).slice(1).toLowerCase();
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) throw new Error('This audio file type is not supported.');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Source audio is missing. Select an existing file.');
  const media = inspect(getFfprobe(), file);
  return { file, media, sizeBytes: fs.statSync(file).size };
}

app.post('/api/jobs/:id/source-file', asyncRoute(async (req, res) => {
  const index = jobs.findIndex(item => item.id === req.params.id);
  const job = jobs[index];
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  const relink = req.body?.relink === true;
  if (relink) {
    if (job.importPending || !sourceMissing(job) || !job.parts.length) return res.status(409).json({ error: 'Only a missing source can be relinked here.' });
  } else if (!job.importPending || job.status !== 'draft') return res.status(409).json({ error: 'Start an Import Book before selecting a source.' });
  if (sourceImports.has(job.id) || step1TaskRunning || job.exports?.some(item => ['queued', 'running'].includes(item.status))) return res.status(409).json({ error: 'Wait for the current file operation to finish.' });
  if (relink && job.parts.length > 1) {
    const previous = cloneProject(job);
    sourceImports.add(job.id);
    try {
      const root = listBookDirectory(req.body?.path, SUPPORTED_AUDIO_EXTENSIONS, knownIntermediatesRoots()).directory;
      const sourceTags: Record<string, unknown>[] = [];
      const parts = await Promise.all(job.parts.map(async part => {
        const relative = sourceRelative(job, part), file = path.resolve(root, relative);
        if (!within(root, file)) throw new Error('Source member lies outside the selected folder.');
        await assertUnlinked(file);
        const media = await mediaCache.read(getFfprobe(), file);
        sourceTags.push(media.tags);
        return { ...part, name: relative, sourceRelativePath: relative, sizeBytes: (await fs.promises.stat(file)).size, durationSeconds: media.durationSeconds, bitrate: media.bitrate };
      }));
      const identity = checkRelinkIdentity(job.metadataDraft || job.metadata || {}, sourceTags, false);
      if (identity && (identity.code !== 'RELINK_CONFIRM_IDENTITY' || req.body?.confirmSameRecording !== true)) return res.status(409).json(identity);
      sourceFilesInvalidated(job);
      job.source = { kind: 'external', mode: 'folder', path: root }; job.sourceFolderPath = root; job.parts = parts;
      job.sourceInventory = undefined; job.discoveredFiles = undefined; job.sourceFileStamps = undefined; job.sourcePathIdentity = undefined;
      updateSourceTotals(job); persistJobsAtomically();
      return res.json({ job: { ...job, sourceMissing: false }, book: libraryBook(job) });
    } catch (error: any) { restoreProject(job, previous); return res.status(400).json({ error: 'Could not relink all selected parts: ' + error.message }); }
    finally { sourceImports.delete(job.id); }
  }
  let selected: ReturnType<typeof validatedAudioFile>;
  try { selected = validatedAudioFile(req.body?.path); }
  catch (error: any) { return res.status(400).json({ error: error.message || 'Could not use selected audio file.' }); }
  const previous = cloneProject(job);
  try {
    const { file, media, sizeBytes } = selected;
    if (relink) {
      const identity = checkRelinkIdentity(job.metadataDraft || job.metadata || {}, [media.tags], true);
      if (identity && (identity.code !== 'RELINK_CONFIRM_IDENTITY' || req.body?.confirmSameRecording !== true)) return res.status(409).json(identity);
    }
    if (relink) { sourceFilesInvalidated(job); job.sourceFileStamps = undefined; job.sourcePathIdentity = undefined; }
    const name = path.basename(file);
    job.libraryScan = undefined; job.processingStatus = 'incomplete';
    job.source = { kind: 'external', path: file, mode: 'file' };
    job.sourceFolderPath = path.dirname(file);
    job.parts = [{ id: job.parts[0]?.id || 'p-1', name, sourceRelativePath: name, sizeBytes, durationSeconds: media.durationSeconds, bitrate: media.bitrate, order: 1 }];
    job.totalDurationSeconds = media.durationSeconds;
    job.totalSizeBytes = sizeBytes;
    job.inputMethod = 'folder';
    job.discoveredFiles = [{ relativePath: name, fileName: name, folderName: 'Root', format: media.format, codec: media.codec, sampleRate: media.sampleRate, channels: media.channels, bitrate: media.bitrate, sizeBytes, durationSeconds: media.durationSeconds, isProbed: true, streamSignature: media.streamSignature }];
    job.sourceMembership = 'explicit';
    job.explicitlyAddedSourceFiles = [name];
    job.sourceMembershipReview = undefined;
    job.sourceInventory = job.discoveredFiles;
    job.bookScope = { title: path.basename(name, path.extname(name)) };
    if (!relink) { job.excludedSourceFiles = []; job.sourceFileStamps = undefined; job.sourcePathIdentity = undefined; job.sourceOrderManual = false; job.importInspected = false; job.importedMetadata = undefined; job.metadataDraft = undefined; job.chapterReviewBaseline = undefined; job.chapters = [{ id: `c-${Date.now()}`, start: '00:00:00.000', title: 'Chapter 1' }]; }
    job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `${relink ? 'Relinked' : 'Referenced'} external source: ${file}` });
    persistJobsAtomically();
    res.json({ job: { ...job, sourceMissing: false }, book: libraryBook(job) });
  } catch (error: any) {
    jobs[index] = previous;
    res.status(500).json({ error: `Could not save source reference: ${error.message}` });
  }
}));

async function localAudioSelection(value: unknown, groupId?: string) {
  const paths = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(paths) || !paths.length || paths.some(item => typeof item !== 'string' || !path.isAbsolute(item)))
    throw new Error('Enter an existing absolute local file or folder path.');
  const selected = [...new Set((paths as string[]).map(item => path.resolve(item)))];
  if (selected.some(item => !fs.existsSync(item))) throw new Error(`Path does not exist: ${selected.find(item => !fs.existsSync(item))}`);
  if (selected.length === 1 && fs.statSync(selected[0]).isDirectory()) {
    const scanned = await scanLocalFolder(selected[0]);
    if (!scanned.files.length) throw new Error('No supported audio was found in that folder.');
    const groups = probableBookGroups(scanned.files, path.basename(selected[0]));
    const group = groupId ? groups.find(item => item.id === groupId) : groups.length === 1 ? groups[0] : undefined;
    if (groupId && !group) throw new Error('The candidate book changed. Scan the folder again.');
    return { root: selected[0], mode: 'folder' as const, files: group ? scanned.files.filter(file => group.files.includes(file.relativePath.replace(/\\/g, '/'))) : scanned.files,
      groups, group, needsGroup: !group, orderWarning: scanned.orderWarning };

  }
  if (selected.some(item => !fs.statSync(item).isFile())) throw new Error('Select one folder or supported audio files from one folder.');
  const root = path.dirname(selected[0]);
  if (selected.some(item => path.dirname(item) !== root)) throw new Error('Selected audio files must be in the same folder.');
  const files = (await Promise.all(naturalSort(selected, item => path.basename(item)).map(async file => {
    const extension = path.extname(file).slice(1).toLowerCase();
    if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) throw new Error(`Unsupported audio file: ${path.basename(file)}`);
    const media = await mediaCache.read(getFfprobe(), file);
    const tagNumber = (keys: string[]) => {
      const value = Object.entries(media.tags).find(([key]) => keys.includes(key.toLowerCase()))?.[1];
      const number = Number(/^\s*(\d+)/.exec(String(value || ''))?.[1]);
      return number > 0 ? number : undefined;
    };
    return { relativePath: path.basename(file), fileName: path.basename(file), folderName: 'Root',
      tags: Object.fromEntries(Object.entries(media.tags).map(([key, value]) => [key, String(value)])),
      discNumber: tagNumber(['disc', 'discnumber', 'disk', 'disknumber', 'tpos']), trackNumber: tagNumber(['track', 'tracknumber', 'trck']),
      format: media.format, codec: media.codec, sampleRate: media.sampleRate, channels: media.channels,
      bitrate: media.bitrate, sizeBytes: fs.statSync(file).size, durationSeconds: media.durationSeconds,
      isProbed: true, streamSignature: media.streamSignature };
  }))).sort(sourceOrderCompare);
  return { root, mode: selected.length === 1 ? 'file' as const : 'folder' as const, files, groups: probableBookGroups(files), group: undefined, needsGroup: false,
    orderWarning: files.length > 1 && files.some(file => !hasExplicitSourceOrder(file))
      ? 'Some files have no clear disc or track number. Check the processing order before running.' : undefined };
}

function localLibraryTarget(selection: Awaited<ReturnType<typeof localAudioSelection>>) {
  const root = path.resolve(currentOutputFolder);
  const name = selection.mode === 'file'
    ? path.basename(selection.files[0].fileName, path.extname(selection.files[0].fileName))
    : path.basename(selection.root);
  const base = path.resolve(root, name);
  if (!isManagedChild(root, base)) throw new Error('The Library destination is outside the selected location.');
  let target = base;
  for (let number = 2; pathEntryExists(target); number++) target = `${base} (${number})`;
  if (!isManagedChild(root, target) || isManagedChild(selection.root, target))
    throw new Error('Choose audio outside its destination Library folder.');
  ensureUnlinkedLibraryParent(root, path.dirname(target));
  return { root, base, target };
}

app.post('/api/jobs/:id/local-source', asyncRoute(async (req, res) => {
  const index = jobs.findIndex(item => item.id === req.params.id);
  const job = jobs[index];
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (!job.importPending || job.status !== 'draft') return res.status(409).json({ error: 'Start an Import Book before selecting audio.' });
  if (sourceImports.has(job.id) || step1TaskRunning || job.exports?.some(item => ['queued', 'running'].includes(item.status)))
    return res.status(409).json({ error: 'Wait for the current file operation to finish.' });
  sourceImports.add(job.id);
  try {
  const move = req.body?.move === true;
  const commit = req.body?.commit === true;
  let selection: Awaited<ReturnType<typeof localAudioSelection>>;
  let destination: ReturnType<typeof localLibraryTarget> | undefined;
  try {
    selection = await localAudioSelection(req.body?.paths ?? req.body?.path, req.body?.groupId);
    if (selection.needsGroup) {
      if (commit) return res.status(409).json({ error: 'This folder contains several probable books. Choose a candidate book first.', groups: selection.groups });
      return res.json({ files: selection.files, groups: selection.groups, needsGroup: true, sourcePath: selection.root });
    }
    if (move) {
      if (fs.lstatSync(selection.root).isSymbolicLink()) throw new Error('A linked source folder cannot be moved safely.');
      destination = localLibraryTarget(selection);
      for (const file of selection.files) {
        const source = path.join(selection.root, file.relativePath);
        if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Linked audio cannot be moved safely: ${source}`);
        if (jobs.some(other => other.id !== job.id && sourceFilePaths(other).some(otherPath => path.resolve(otherPath) === path.resolve(source))))
          throw new Error(`This audio is already used by another book: ${source}`);
      }
    }
    if (!commit) return res.json({ files: selection.files, groups: selection.groups, orderWarning: selection.orderWarning, sourcePath: selection.mode === 'file' ? path.join(selection.root, selection.files[0].fileName) : selection.root,
      destination: destination?.target, collision: destination ? destination.base !== destination.target : false });
    if (move && req.body?.destination !== destination?.target) return res.status(409).json({ error: 'The Library destination changed. Check the move again before confirming.' });
  } catch (error: any) { return res.status(400).json({ error: error.message || 'Could not validate local audio.' }); }

  const previous = cloneProject(job);
  sourceImports.add(job.id);
  libraryMoveRunning = true;
  try {
    const commitSelection = () => {
    const sourceRoot = destination?.target || selection.root;
    job.libraryScan = undefined; job.processingStatus = 'incomplete';
    job.source = { kind: move ? 'managed' : 'external',
      path: selection.mode === 'file' ? path.join(sourceRoot, selection.files[0].fileName) : sourceRoot, mode: selection.mode };
    job.sourceFolderPath = sourceRoot;
    job.parts = selection.files.map((file, i) => ({ id: `p-${i + 1}`, name: file.relativePath,
      sourceRelativePath: file.relativePath, discNumber: file.discNumber, trackNumber: file.trackNumber,
      sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds,
      bitrate: file.bitrate || 0, order: i + 1 }));
    job.totalDurationSeconds = job.parts.reduce((sum, part) => sum + part.durationSeconds, 0);
    job.totalSizeBytes = job.parts.reduce((sum, part) => sum + part.sizeBytes, 0);
    job.discoveredFiles = selection.files;
    job.sourceMembership = selection.group ? 'automatic' : 'explicit';
    job.explicitlyAddedSourceFiles = selection.group ? [] : selection.files.map(file => file.relativePath);
    job.sourceMembershipReview = undefined;
    job.sourceInventory = selection.files;
    job.bookScope = selection.group ? { title: selection.group.title, directory: selection.group.directory } : { title: path.basename(selection.files[0].fileName, path.extname(selection.files[0].fileName)) };
    job.excludedSourceFiles = [];
    job.sourceFileStamps = undefined;
    job.sourcePathIdentity = undefined;
    job.sourceOrderManual = false;
    job.sourceOrderWarning = selection.orderWarning;
    job.hasNestedChapterFolders = selection.files.some(file => Boolean(file.chapterGroup));
    job.inputMethod = 'folder';
    job.importInspected = false;
    job.importedMetadata = undefined;
    job.metadataDraft = undefined;
    job.sourceSummary = undefined;
    job.youtubeUrl = undefined;
    job.youtubeVideoInfo = undefined;
    job.librivox = undefined;
    job.chapterReviewBaseline = undefined; job.chapters = [{ id: `c-${Date.now()}`, start: '00:00:00.000', title: 'Chapter 1' }];
    job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `${move ? 'Moved' : 'Referenced'} local audio: ${job.source.path}` });
    persistJobsAtomically();
    };
    let warning: string | undefined;
    if (destination) {
      const entries: MoveEntry[] = await Promise.all(selection.files.map(async file => ({ source: path.join(selection.root, file.relativePath), name: file.relativePath, stamp: await stamp(path.join(selection.root, file.relativePath)) })));
      warning = await transferProjectFiles({ root: destination.root, journal: appPath('library-move-' + randomUUID() + '.json'),
        intent: { version: 2, id: job.id, operation: 'import', source: previous.source?.path || selection.root, target: destination.target, mode: 'move', entries },
        boundaries: [destination.root], protectedFiles: new Set(), log: message => appendMasterEvent('Import', message),
        commit: commitSelection, rollback: () => restoreProject(job, previous) });
    } else commitSelection();
    res.json({ job: { ...job, sourceMissing: false }, warning });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Could not select local audio.' });
  } finally { libraryMoveRunning = false; }
  } finally { sourceImports.delete(job.id); }
}));

app.post('/api/jobs/:id/inspect-import', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  sourceImports.add(job.id);
  try {
    const files = importedSourcePaths(job);
    const media = await mediaCache.read(getFfprobe(), files[0]);
    const fallback = job.bookScope?.title || (files.length === 1 ? path.basename(files[0], path.extname(files[0])) : path.basename(job.sourceFolderPath!));
    await backfillProjectCompanions(job);
    const folder = bookSourceRoot(job)!;
    const fileStamps = await Promise.all(files.map(file => stamp(file, path.relative(folder, file))));
    const companions = (job.associatedFiles || []).filter((file): file is { path: string; kind: 'metadata' | 'cover' } => file.kind === 'metadata' || file.kind === 'cover');
    const imported = (await identifyBook({ path: job.source?.path || folder, folder, mode: job.source?.mode || 'folder', title: fallback,
      files: fileStamps, signature: fileSignature(fileStamps), identity: '', metadataFile: companions.find(file => file.kind === 'metadata')?.path, associatedFiles: companions },
      async file => (await mediaCache.read(getFfprobe(), file)).tags)).metadata;
    if (media.artwork && !imported.cover) {
      const coverPath = path.join(projectIntermediatesDir(job), media.artwork.codec_name === 'png' ? 'import-cover.png' : 'import-cover.jpg');
      fs.mkdirSync(path.dirname(coverPath), { recursive: true });
      execFileSync(getFfmpeg(), ['-v', 'error', '-y', '-i', files[0], '-map', `0:${media.artwork.index}`, '-c', 'copy', coverPath], { windowsHide: true });
      imported.cover = { source: 'local', filename: path.basename(coverPath), url: `data:image/${coverPath.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(coverPath).toString('base64')}` };
    }
    const previous = job.importedMetadata;
    const current = job.metadataDraft || job.metadata;
    const merged = { ...imported };
    for (const key of new Set([...Object.keys(imported), ...Object.keys(current || {})]) as Set<keyof AudiobookMetadata>) {
      if (previous && current && JSON.stringify(current[key]) !== JSON.stringify(previous[key])) (merged as any)[key] = current[key];
      else if (!job.importPending && current && current[key] !== undefined) (merged as any)[key] = current[key];
      else if (job.inputMethod === 'librivox' && current && current[key] && !(key === 'title' && current.title === 'New book')) (merged as any)[key] = current[key];
    }
    job.importedMetadata = imported;
    job.sourceTags = Object.fromEntries(Object.entries(media.tags).map(([key, value]) => [key, String(value)]));
    job.sourceFormat = media.format;
    job.sourceCodec = media.codec;
    const existing = await chaptersForJob(job, files.map(file => ({ file, ...inspect(getFfprobe(), file) })));
    job.existingChapters = existing.chapters;
    job.existingChapterSource = existing.source;
    if (existing.sidecar) associateProjectFile(job, existing.sidecar, 'chapters');
    if (job.importPending && !job.importInspected && job.existingChapters.length) job.chapters = applyDefaultChapterEnds(job.existingChapters, job.totalDurationSeconds);
    job.metadataDraft = merged;
    job.metadata = merged;
    job.importInspected = true;
    job.name = merged.title;
    job.author = merged.author;
    job.narrator = merged.narrator;
    saveJobs();
    res.json(job);
  } catch (error: any) { res.status(400).json({ error: error.message || 'Could not inspect source audio.' }); }
  finally { sourceImports.delete(job.id); }
}));

const logStep1 = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    activeStep1ProgressState.logs.push(formatted);
    appendMasterEvent(`Step 1 ${jobIdForStep1 || ''}`.trim(), msg, msg.startsWith('ERROR:') ? 'ERROR' : 'INFO');
    const terminalMessage = `[Step1: ${jobIdForStep1 || 'Global'}] ${formatted}`;
    if (msg.startsWith('ERROR:')) console.error(terminalMessage);
    else console.log(terminalMessage);
};

// Step 1: Process Step 1 (Supports both 'whisperx' and 'existing_files' workflows)
const handleStep1Process = async (req: any, res: any) => {
  if (activeInstallProgress.isActive) return res.status(409).json({ error: 'Wait for runtime installation to finish.' });
  if (step1TaskRunning) return res.status(409).json({ error: 'Another source is being processed or finishing cancellation.' });
  jobIdForStep1 = req.params.id;
  const job = projectStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (sourceImports.has(job.id) || job.exports?.some(e => ['running','queued'].includes(e.status))) return res.status(409).json({error: 'Wait for import or export to finish.'});

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  const requestedEngine = requestEngine(undefined);
  const {
    chapterSource = job.chapterSource || 'whisperx',
    mergeMethod = job.mergeMethod || 'standard',
    generateTranscript = job.generateTranscript || false,
    generateWaveform = job.generateWaveform || false,
    selectedModelId = job.selectedModelId || 'small',
    sourceFolderPath = job.sourceFolderPath,
    outputFolderPath = job.outputFolderPath || currentOutputFolder,
    parts = null,
  } = req.body || {};

  if (req.body?.transcriptionSettings !== undefined) {
    try { job.transcriptionSettings = validatedTranscriptionSettingsMap(req.body.transcriptionSettings); }
    catch (error: any) { return res.status(400).json({ error: error.message }); }
  }
  // A run may reorder the manifest, but must not silently attach a stale browser
  // inventory. Membership changes go through the source-file actions.
  if (job.source) {
    const saved = job.parts.map(part => part.name).sort();
    const requested = Array.isArray(parts) ? parts.map((part: any) => part.name).sort() : saved;
    if (sourceFolderPath !== job.sourceFolderPath || JSON.stringify(saved) !== JSON.stringify(requested))
      return res.status(409).json({ error: 'Project files changed. Refresh Review Files before processing.' });
  }
  if (!['whisperx', 'existing_files', 'grouped_files', 'existing_chapters', 'manual'].includes(chapterSource)) return res.status(400).json({ error: 'Choose a supported chapter source.' });
  if (!['standard', 'quick', 'skip'].includes(mergeMethod)) return res.status(400).json({ error: 'Choose a supported audio preparation method.' });
  const runTranscript = chapterSource === 'whisperx' || generateTranscript === true;
  if (chapterSource === 'grouped_files') {
    try { manualChapterGroups(job.parts); } catch (error: any) { return res.status(400).json({ error: error.message }); }
  }
  const previousChapterSource = job.chapterSource;
  const selectedTranscriptionSettings = job.transcriptionSettings;
  const previousMergeMethod = job.mergeMethod;
  const previousPreparedDurations = job.parts.map(part => part.durationSeconds);

  // Update job settings
  job.chapterSource = chapterSource;
  job.mergeMethod = mergeMethod;
  job.generateTranscript = generateTranscript === true;
  job.generateWaveform = generateWaveform === true;
  if (!job.generateWaveform) job.waveformReady = false;
  job.selectedModelId = selectedModelId;
  if (sourceFolderPath) job.sourceFolderPath = sourceFolderPath;
  if (outputFolderPath) job.outputFolderPath = outputFolderPath;
  job.outputFolderPath = resolvedOutputRoot(job);

  // Update parts if provided from folder import
  if (Array.isArray(parts) && parts.length > 0) {
    job.parts = parts.map((p: any, idx: number) => ({
      id: p.id || `p-${idx + 1}`,
      name: p.name || `part_${idx + 1}.mp3`,
      sourceRelativePath: p.sourceRelativePath,
      chapterGroup: job.parts.find(part => part.name === p.name)?.chapterGroup,
      discNumber: p.discNumber,
      trackNumber: p.trackNumber,
      sizeBytes: p.sizeBytes || 25000000,
      durationSeconds: p.durationSeconds || 1500,
      bitrate: p.bitrate || 128,
      order: idx + 1,
    })).sort(job.sourceOrderManual ? (a, b) => a.order - b.order : sourceOrderCompare);
    job.totalDurationSeconds = job.parts.reduce((acc, p) => acc + p.durationSeconds, 0);
    job.totalSizeBytes = job.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
  }

  if (job.parts.length === 0) {
    return res.status(400).json({ error: 'No MP3 files found in the selected folder.' });
  }
  try { importedSourcePaths(job); }
  catch (error: any) { return res.status(409).json({ error: error.message }); }

  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `=== Starting Step 1 for: ${job.name} (Workflow: ${chapterSource !== 'whisperx' ? 'Existing Audio Files' : 'Speech Recognition'}) ===`,
  });

  // Initialize live Step 1 progress state
  activeStep1StartTime = Date.now();
  const stages = (chapterSource === 'whisperx' ? speechRecognitionStages : [
    ...directChapterStages.slice(0, 3),
    ...(runTranscript ? speechRecognitionStages.filter(stage => stage.key === 'transcribing_whisper') : []),
    ...directChapterStages.slice(3),
  ]).filter(stage => !(mergeMethod === 'skip' && stage.key === 'merging_audio') &&
    !(stage.key === 'generating_waveform' && !runTranscript && !generateWaveform && job.parts.length === 1))
    .map(stage=>stage.key==='generating_waveform'&&!generateWaveform?{...stage,label:'Create review preview',desc:'Prepare audio for playback or transcription without waveform data.'}:stage);
  activeStep1ProgressState = {
    jobId: job.id,
    isActive: true,
    stage: 'scanning_folder',
    label: chapterSource !== 'whisperx' ? 'Scanning & validating input audio files' : 'Scanning input audio files',
    currentTask: `Verifying ${job.parts.length} source audio files...`,
    currentStageNumber: 1,
    totalStages: stages.length,
    stages,
    failedStage: null,
    percentage: 0,
    isDeterminate: false,
    elapsedSeconds: 0,
    liveStatusMessage: `Discovered ${job.parts.length} input files. Checking format & integrity.`,
    logs: [
      `[${new Date().toLocaleTimeString()}] Step 1 initiated for: ${job.name}`,
      `[${new Date().toLocaleTimeString()}] Target output folder: ${job.outputFolderPath || currentOutputFolder}`,
      `[${new Date().toLocaleTimeString()}] Workflow: ${chapterSource !== 'whisperx' ? 'Direct Audio File Preservation' : 'Whisper Speech Recognition'}`,
      `[${new Date().toLocaleTimeString()}] Stage 1/${stages.length} started: Inspect source audio`,
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
      job.parts.sort((a, b) => (a.order || 0) - (b.order || 0));
      let sourcePaths = importedSourcePaths(job);
      let media = sourcePaths.map(p => inspect(getFfprobe(), p));
      const numberTag = (tags: Record<string, string>, keys: string[]) => {
        const value = Object.entries(tags).find(([key]) => keys.includes(key.toLowerCase()))?.[1];
        const number = Number(/^\s*(\d+)/.exec(String(value || ''))?.[1]);
        return number > 0 ? number : undefined;
      };
      const ordered = job.parts.map((part, index) => {
        part.discNumber = numberTag(media[index].tags, ['disc', 'discnumber', 'disk', 'disknumber', 'tpos']) ?? part.discNumber;
        part.trackNumber = numberTag(media[index].tags, ['track', 'tracknumber', 'trck']) ?? part.trackNumber;
        return { part, file: sourcePaths[index], info: media[index] };
      }).sort((a, b) => (a.part.order || 0) - (b.part.order || 0));
      job.parts = ordered.map(item => item.part);
      sourcePaths = ordered.map(item => item.file);
      media = ordered.map(item => item.info);
      job.parts.forEach((part, index) => { part.order = index + 1; });
      job.sourceOrderWarning = job.parts.length > 1 && job.parts.some(part => !hasExplicitSourceOrder({ relativePath: part.sourceRelativePath || part.name, discNumber: part.discNumber, trackNumber: part.trackNumber }))
        ? 'Some files have no clear disc or track number. Check the processing order before running.' : undefined;
      if (job.sourceOrderWarning) logStep1(job.sourceOrderWarning);
      job.discoveredFiles = job.parts.map((part,i)=>({
        relativePath: part.sourceRelativePath || part.name,
        storedName: part.name, fileName: path.basename(part.sourceRelativePath || part.name), folderName: path.dirname(part.sourceRelativePath || part.name),
        format: media[i].format, codec: media[i].codec, sampleRate: media[i].sampleRate, channels: media[i].channels,
        bitrate: media[i].bitrate, durationSeconds: media[i].durationSeconds, sizeBytes: fs.statSync(sourcePaths[i]).size,
        isProbed: true, streamSignature: media[i].streamSignature,
      }));
      const { sourceKey, preparedAudioKey } = await sourceProcessingKeys(sourcePaths, mergeMethod,
        files => sourceFingerprint(job, files));
      signal.throwIfAborted();
      const existing = await chaptersForJob(job, sourcePaths.map((file, index) => ({ file, ...media[index] })), sourceKey);
      if (chapterSource === 'existing_chapters' && !existing.chapters.length) throw new Error('No confidently matched existing chapters were found. Choose manual editing or another chapter source.');
      if (existing.sidecar) associateProjectFile(job, existing.sidecar, 'chapters');
      const plan = !runTranscript ? undefined : await transcriptionPlan({ ...job, selectedModelId, transcriptionSettings: selectedTranscriptionSettings }, preparedAudioKey, requestedEngine);
      const cachedTranscript = plan && reusableTranscription(job, plan.requestKey);
      const musicEnabled = currentConfig.detect_musical_transitions === true;
      const detectionKey = chapterDetectionCacheKey(job, musicEnabled);
      if (chapterSource === 'whisperx' && cachedTranscript && (!generateWaveform || job.waveformReady) && previousChapterSource === chapterSource && job.chapterDetectionKey === detectionKey && !job.staleSteps?.includes('chapter_detection') && job.previewPath && fs.existsSync(job.previewPath) && job.mergedMp3?.fullPath && fs.existsSync(job.mergedMp3.fullPath)) {
        logStep1(`Transcript cache: Hit; ${job.transcription!.engine}, ${job.transcription!.profile}, ${job.transcription!.device}, ${job.transcription!.computeType}, batch ${job.transcription!.batchSize ?? 'Off'}, beam ${job.transcription!.beamSize ?? 'native'}. Reusing reviewed chapters.`);
        saveJobs();
        activeStep1ProgressState.isActive = false;
        activeStep1ProgressState.canCancel = false;
        activeStep1ProgressState.stage = 'completed';
        activeStep1ProgressState.percentage = 100;
        return;
      }
      const sameSource = job.sourceKey === sourceKey;
      const savedBookMetadata = job.metadataUpdatedAt ? job.metadata : undefined;
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
      if (chapterSource !== 'manual' || (job.sourceFilesChanged && !sameSource)) { job.chapters = []; job.chapterReviewBaseline = undefined; }
      job.candidates = [];
      if (!sameSource) { job.transcriptWords = []; job.transcriptSegments = []; job.transcription = null; job.transcriptKey = undefined; }
      if (!sameSource) { job.existingChapters = []; job.sourceTags = {}; job.importedMetadata = undefined; }
      const intermediatesDir = projectIntermediatesDir(job);
      if (sourcePaths.some(p => { const relative = path.relative(intermediatesDir,p); return !relative.startsWith('..') && !path.isAbsolute(relative); })) throw new Error('Move source files outside this project’s intermediate directory before processing.');
      fs.mkdirSync(intermediatesDir, { recursive: true });
      if (mergeMethod !== 'skip') setStep1Stage('merging_audio', reusePreparedAudio
        ? 'Using the previously prepared master audio.'
        : 'Preparing a single review master from the source audio.',
        reusePreparedAudio ? 'Reuse prepared master audio' : 'Prepare master audio');
      const prepared = mergeMethod === 'skip'
        ? { master: sourcePaths.length === 1 ? sourcePaths[0] : path.join(intermediatesDir, 'master.wav'),
            media, durations: media.map(info => info.durationSeconds), normalized: false }
        : reusePreparedAudio
        ? {
            master: existingMaster!,
            media,
            durations: job.parts.map((part, index) => previousPreparedDurations[index] || part.durationSeconds || media[index].durationSeconds),
            normalized: mergeMethod === 'standard',
          }
        : await prepareMaster(getFfmpeg(), getFfprobe(), sourcePaths, intermediatesDir, mergeMethod, logStep1, signal);
      if (reusePreparedAudio) logStep1('Reusing prepared master audio; skipping PCM conversion and stitching.');
      const master = prepared.master;
      job.sourceBitrate = Math.max(...media.map(m => m.bitrate));
      const masterInfo = mergeMethod === 'skip' && sourcePaths.length > 1
        ? { ...media[0], durationSeconds: prepared.durations.reduce((sum, duration) => sum + duration, 0) }
        : inspect(getFfprobe(), master);
      job.sourceCodec = masterInfo.codec;
      job.sourceFormat = media.every(m => m.format === media[0].format) ? media[0].format : 'wav';
      job.totalDurationSeconds = masterInfo.durationSeconds;
      job.totalSizeBytes = sourcePaths.reduce((sum,p)=>sum+fs.statSync(p).size,0);
      job.parts.forEach((part, i) => { part.durationSeconds = prepared.durations[i]; part.bitrate = media[i].bitrate; });
      job.mergedMp3 = { filename: path.basename(master), fullPath: master, duration: masterInfo.durationSeconds, bitrate: masterInfo.bitrate, sizeBytes: fs.existsSync(master) ? fs.statSync(master).size : job.totalSizeBytes };
      job.sourceKey = sourceKey;
      job.preparedAudioKey = preparedAudioKey;
      saveJobs();
      if (!sameSource && sourcePaths.length === 1 && job.inputMethod !== 'librivox') {
        job.existingChapters = media[0].chapters;
        const tags = Object.fromEntries(Object.entries(media[0].tags).map(([k,v])=>[k.toLowerCase(),String(v)]));
        job.sourceTags = media[0].tags;
        const importedMetadata: AudiobookMetadata = { title: tags.album || tags.title || job.name, author: tags.artist || tags.album_artist || '', narrator: tags.composer || '', genres: (tags.genre || '').split(/[;,]/).map(value => value.trim()).filter(Boolean), language: tags.language || 'eng', abridged: tags.abridged === '1', explicit: tags.explicit === '1', subtitle: tags.subtitle || tags.tit3, series: tags.series, seriesSequence: tags['series-part'], publishedYear: tags.date, releaseDate: tags.releasetime, publisher: tags.publisher, description: tags.description || tags.desc || tags.comment, copyright: tags.copyright, isbn: tags.isbn, asin: tags.asin };
        job.importedMetadata = JSON.parse(JSON.stringify(importedMetadata));
        job.metadata = {
          ...importedMetadata,
          ...savedBookMetadata,
          title: savedBookMetadata?.title?.trim() || job.metadata?.title?.trim() || job.name,
          author: savedBookMetadata?.author?.trim() || job.metadata?.author?.trim() || job.author || importedMetadata.author,
          narrator: savedBookMetadata?.narrator?.trim() || job.metadata?.narrator?.trim() || job.narrator || importedMetadata.narrator,
        };
        if (media[0].artwork && job.metadata.cover === undefined) {
          const coverPath = path.join(intermediatesDir, media[0].artwork.codec_name === 'png' ? 'original-cover.png' : 'original-cover.jpg');
          await execFileAsync(getFfmpeg(), ['-v', 'error', '-y', '-i', master, '-map', '0:' + media[0].artwork.index, '-c', 'copy', coverPath]);
          job.metadata.cover = { source: 'local', filename: path.basename(coverPath), url: 'data:image/' + (coverPath.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(coverPath).toString('base64') };
        }
      }
      const reusablePreview = reusePreparedAudio && job.previewPath && fs.existsSync(job.previewPath);
      const needsPreview = generateWaveform || runTranscript || sourcePaths.length > 1;
      if (needsPreview) {
      setStep1Stage('generating_waveform', reusablePreview
        ? `Reusing the review preview${generateWaveform ? ' and preparing waveform data' : ''}.`
        : `Creating a review preview${generateWaveform ? ' with waveform data' : ' without waveform data'}.`,
        generateWaveform ? 'Generate waveform and review preview' : 'Prepare review preview');
      if (reusablePreview) {
        logStep1('Reusing existing review preview.');
      } else {
        job.previewPath = path.join(intermediatesDir, 'analysis.wav');
        if (mergeMethod === 'skip') await sourceReviewPreview(getFfmpeg(), sourcePaths, job.previewPath, signal, logStep1, generateWaveform);
        else await makePreview(getFfmpeg(), master, job.previewPath, signal, logStep1, generateWaveform, generateWaveform);
        logStep1(`Review preview created${generateWaveform ? ' with waveform data' : '; waveform generation skipped'}.`);
      }
      signal.throwIfAborted();
      if(generateWaveform){await ensureAnalysis(job.previewPath!,true);job.waveformReady=true;job.pipelineSteps=completeStepRerun(job.pipelineSteps,'generating_waveform',now());}
      else {job.waveformReady=false;if(job.pipelineSteps)delete job.pipelineSteps.generating_waveform;}
      }
      job.existingChapters = existing.chapters;
      job.existingChapterSource = existing.source;
      saveJobs();
      // WORKFLOW A: Use existing MP3 files as individual chapters
      // ----------------------------------------------------
  if (chapterSource !== 'whisperx') {
    if (runTranscript) {
      setStep1Stage('transcribing_whisper', 'Generating a transcript without changing chapter markers.', 'Generate transcript only');
      if (!cachedTranscript) {
        const replacement = await transcribeExistingPreview(job, signal, plan);
        signal.throwIfAborted();
        job.transcriptWords = replacement.words; job.transcriptSegments = replacement.segments;
        job.transcription = replacement.transcription; job.transcriptKey = replacement.transcriptKey;
      }
      job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'transcribing_whisper', now());
    }
    setStep1Stage('extracting_chapters', 'Creating chapter markers from source-file order and embedded chapters.', 'Create chapters from source files');
    logStep1(`Using durations and embedded chapter tags from ${job.parts.length} inspected files.`);

    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Chapter source: ${chapterSource}. Audio preparation: ${mergeMethod}. Transcript: ${runTranscript ? 'generated separately' : 'skipped'}. All chapter entries remain editable.`,
    });

    const relativeNames = job.parts.map(part => part.sourceRelativePath || (path.isAbsolute(part.name) ? path.relative(job.sourceFolderPath || path.dirname(part.name),part.name) : part.name));
    const structure = job.chapterSource === 'grouped_files' ? manualChapterGroups(job.parts) : sourceChapterGroups(relativeNames);
    job.chapterStructure = structure.mode;
    const starts: number[] = [];
    let cumulativeSec = 0;
    for (const duration of prepared.durations) { starts.push(cumulativeSec); cumulativeSec += duration; }
    const directChapters: ChapterEntry[] = structure.groups.map((group,index) => ({
      id: 'chap-' + (index+1), start: formatTimestamp(starts[group.indices[0]]), title: group.title,
      notes: group.indices.map(i => relativeNames[i]).join(' → '),
    }));
    job.chapters = chapterSource === 'manual' ? job.chapters : chapterSource === 'existing_chapters' ? [...job.existingChapters!] : directChapters;
    job.chapterDetectionKey = undefined;
    job.candidates = []; // No AI candidates needed
    job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'extracting_chapters', now());
    job.status = 'transcribed';
    job.staleSteps = [];
    job.sourceFilesChanged = false;

    if (chapterSource === 'existing_files' && sourcePaths.length === 1 && job.existingChapters?.length) job.chapters = [...job.existingChapters];
    if (chapterSource !== 'manual') job.chapterReviewBaseline = cloneProject(job.chapters);
    job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);

    setStep1Stage('saving_project', 'Saving chapter markers for review.', 'Finalize direct chapter workflow');
    logStep1(`Chapter list ready for editing (${job.chapters.length} total).`);
    activeStep1ProgressState.summary = {
      totalFilesProcessed: job.parts.length,
      totalDurationSeconds: cumulativeSec,
      chaptersFound: job.chapters.length,
      wordsTranscribed: runTranscript ? job.transcription?.wordsCount || 0 : 0,
      modelUsed: runTranscript ? plan!.model.name : 'No transcription',
    };
    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Step 1 Complete: ${job.chapters.length} editable chapters (${chapterSource}). Total duration: ${formatTimestamp(cumulativeSec)}. Ready for review.`,
    });

    saveJobs();
    activeStep1ProgressState.stage = 'completed';
    activeStep1ProgressState.currentStageNumber = activeStep1ProgressState.totalStages;
    activeStep1ProgressState.percentage = 0;
    activeStep1ProgressState.label = 'Ready for chapter review';
    activeStep1ProgressState.currentTask = 'Chapter markers saved successfully';
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.canCancel = false;
    activeStep1ProgressState.liveStatusMessage = `${job.chapters.length} chapters ready for editing. You can add, remove, rename, and adjust chapter markers.`;
    logStep1(`Stage ${activeStep1ProgressState.totalStages}/${activeStep1ProgressState.totalStages} completed: Direct chapter markers saved.`);
    logStep1(`Step 1 completed in ${Math.round((Date.now() - activeStep1StartTime) / 1000)}s.`);
    return;
  }

  // ----------------------------------------------------
  // WORKFLOW B: Generate chapters with WhisperX
  // ----------------------------------------------------
  const model = plan!.model;
  setStep1Stage('transcribing_whisper', `Using ${plan!.engine} with ${model.name}...`, 'Speech recognition');
  let generatedCandidates: ChapterCandidate[] = [];
  try {
      if (!cachedTranscript) {
        const replacement = await transcribeExistingPreview(job, signal, plan);
        signal.throwIfAborted();
        job.transcriptWords = replacement.words;
        job.transcriptSegments = replacement.segments;
        job.transcription = replacement.transcription;
        job.transcriptKey = replacement.transcriptKey;
      } else logStep1('Transcript cache: Hit; reusing aligned words for chapter detection.');
      const transcriptSegments = job.transcriptSegments!;
      const transcriptWords = job.transcriptWords!;
      const transcriptWordCount = job.transcription!.wordsCount;
      job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'transcribing_whisper', now());
      logStep1(`Speech recognition completed: ${transcriptSegments.length} segments and ${transcriptWordCount} words aligned.`);
      setStep1Stage('detecting_chapters', 'Finding chapter headings and refining their timestamps.', 'Detect chapter candidates');
      generatedCandidates = buildChapterCandidates(transcriptSegments, transcriptWords, job.transcription!.engine!);
      if (musicEnabled) {
        generatedCandidates = await improvedChapterCandidates(job, transcriptWords, generatedCandidates, signal);
      }
      job.chapterDetectionKey = chapterDetectionCacheKey(job, musicEnabled);
      logChapterDetectionResult(generatedCandidates, musicEnabled);
      job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'detecting_chapters', now());
  } catch (err: any) {
    if (signal.aborted) throw err;
    console.error('Step 1 processing stage failed:', err);
    const failedStage = activeStep1ProgressState.stage;
    const failedLabel = activeStep1ProgressState.stages.find(item => item.key === failedStage)?.label || 'Processing';
    job.logs.push({ timestamp: now(), level: 'ERROR', message: `${failedLabel} failed. ${err.message}` });
    saveJobs();
    failStep1Stage(err);
    return;
  }

  job.candidates = generatedCandidates;

  // Every detected candidate is included for human review, regardless of confidence.
  job.chapters = initialDetectedChapters(generatedCandidates);

  if (!job.chapters.length || job.chapters[0].start !== '00:00:00.000') job.chapters.unshift({ id: 'opening', start: '00:00:00.000', title: 'Prologue' });
  job.chapterReviewBaseline = cloneProject(job.chapters);
  setStep1Stage('saving_project', 'Saving transcript and candidate chapter markers for review.', 'Finalize chapter review data');
  job.status = 'transcribed';
  job.staleSteps = [];
  job.sourceFilesChanged = false;
  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `Step 1 Complete. Extracted ${generatedCandidates.length} candidate chapter markers. Ready for Step 2 human review.`,
  });

  saveJobs();

  activeStep1ProgressState.stage = 'completed';
  activeStep1ProgressState.currentStageNumber = activeStep1ProgressState.totalStages;
  activeStep1ProgressState.percentage = 0;
  activeStep1ProgressState.label = 'Ready for chapter review';
  activeStep1ProgressState.currentTask = 'Transcript and candidate chapters saved successfully';
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
  logStep1(`Stage ${activeStep1ProgressState.totalStages}/${activeStep1ProgressState.totalStages} completed: Chapter review data saved.`);
  logStep1(`Step 1 completed in ${Math.round((Date.now() - activeStep1StartTime) / 1000)}s.`);
  
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
    console.error('Fatal Step 1 background error:', err);
    const failedStage = activeStep1ProgressState.stage;
    const failedLabel = activeStep1ProgressState.stages.find(item => item.key === failedStage)?.label || 'Processing';
    job.logs.push({ timestamp: now(), level: 'ERROR', message: `${failedLabel} failed. ${err.message}` });
    saveJobs();
    failStep1Stage(err);
  } finally {
    step1TaskRunning = false;
    step1Abort = undefined;
  }
  })();
};

const requireStep1Dependencies = (req: any, res: any, next: any) => {
  const chapterSource = req.body?.chapterSource || (projectStore.get(req.params.id)?.chapterSource || 'whisperx');
  const features: FeatureId[] = ['audio_processing'];
  if (chapterSource === 'whisperx' || (req.body?.generateTranscript ?? projectStore.get(req.params.id)?.generateTranscript)) features.push(currentConfig.faster_transcription ? 'faster_transcription' : 'openai_transcription');
  return requireFeatures(features, 'Step 1 processing')(req, res, next);
};
app.post('/api/jobs/:id/merge-and-detect', requireStep1Dependencies, handleStep1Process);
app.post('/api/jobs/:id/process-step1', requireStep1Dependencies, handleStep1Process);

const rerunnableSteps = new Set<RerunnablePipelineStep>(['generating_waveform', 'transcribing_whisper', 'detecting_chapters', 'extracting_chapters', 'metadata_processing']);
app.post('/api/jobs/:id/rerun/:step', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  const step = req.params.step as RerunnablePipelineStep;
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!rerunnableSteps.has(step)) return res.status(400).json({ error: 'This processing step cannot be run independently.' });
  if (activeInstallProgress.isActive) return res.status(409).json({ error: 'Wait for runtime installation to finish.' });
  if (step1TaskRunning) return res.status(409).json({ error: 'Another processing step is already running.' });
  if (!canRerunStep(job, step)) return res.status(400).json({ error: 'Required input for this step is unavailable.' });
  if ((step === 'detecting_chapters' || step === 'extracting_chapters') && hasManualChapterWork(job) && req.body?.confirmReplaceManualChapters !== true) {
    return res.status(409).json({
      error: 'Running this step will replace chapter names, Start and End timestamps, inserted chapters, and missing placeholders. Confirm to continue.',
      requiresConfirmation: true,
    });
  }

  const definition = [...speechRecognitionStages, ...directChapterStages].find(item => item.key === step)
    || { key: step as Step1ProcessStage, label: 'Process metadata', desc: 'Regenerate chapter metadata from the current reviewed data.' };
  const inferredOutput = step === 'generating_waveform' ? !!job.waveformReady
    : step === 'transcribing_whisper' ? !!job.transcription
    : step === 'detecting_chapters' ? job.candidates.length > 0
    : step === 'extracting_chapters' ? job.chapters.length > 0
    : ['metadata_ready', 'built', 'validated'].includes(job.status);
  const previousStepState = job.pipelineSteps?.[step] || (inferredOutput ? { status: 'current' as const, hasOutput: true } : undefined);
  const isRerun = previousStepState?.hasOutput === true;
  const action = isRerun ? 'Rerun' : 'Run';
  job.pipelineSteps = { ...job.pipelineSteps, [step]: beginStepRerun(previousStepState) };
  if (step === 'transcribing_whisper' && job.candidates.length && !job.pipelineSteps.detecting_chapters) {
    job.pipelineSteps.detecting_chapters = { status: 'current', hasOutput: true };
  }
  saveJobs();
  jobIdForStep1 = job.id;
  activeStep1StartTime = Date.now();
  activeStep1ProgressState = {
    jobId: job.id, rerunStep: step,
    isActive: true, stage: definition.key, label: `${isRerun ? 'Rerunning' : 'Running'} ${definition.label}`,
    currentTask: definition.desc, currentStageNumber: 1, totalStages: 1, stages: [definition], failedStage: null,
    percentage: 0, isDeterminate: false, elapsedSeconds: 0,
    liveStatusMessage: `${isRerun ? 'Rerunning' : 'Running'} ${definition.label}.${isRerun ? ' Previous successful output is preserved until completion.' : ''}`,
    logs: [`[${new Date().toLocaleTimeString()}] ${action} started: ${definition.label}`],
    canCancel: true, isCancelling: false, error: null, summary: null,
  };
  const controller = new AbortController();
  step1Abort = controller;
  step1TaskRunning = true;
  res.json({ status: 'started', step });

  void (async () => {
    try {
      if ((step === 'transcribing_whisper' || step === 'generating_waveform') && (!job.previewPath || !fs.existsSync(job.previewPath))) {
        const sources = importedSourcePaths(job);
        if (job.sourceKey !== await sourceFingerprint(job, sources)) throw new Error('Source audio changed. Run source processing again before generating a preview.');
        const preview = path.join(projectIntermediatesDir(job), 'analysis.wav');
        await sourceReviewPreview(getFfmpeg(), sources, preview, controller.signal, logStep1, step === 'generating_waveform');
        controller.signal.throwIfAborted(); job.previewPath = preview;
      }
      if (step === 'generating_waveform') {
        await rebuildAnalysis(job.previewPath!);
        job.generateWaveform=true;job.waveformReady=true;
      } else if (step === 'transcribing_whisper') {
        const replacement = await transcribeExistingPreview(job, controller.signal);
        controller.signal.throwIfAborted();
        job.transcriptSegments = replacement.segments;
        job.transcriptWords = replacement.words;
        job.transcription = replacement.transcription;
        job.transcriptKey = replacement.transcriptKey;
      } else if (step === 'detecting_chapters') {
        const words = job.transcriptWords?.length ? job.transcriptWords : buildTranscriptWords(job.transcriptSegments!);
        const musicEnabled = currentConfig.detect_musical_transitions === true;
        let candidates = buildChapterCandidates(job.transcriptSegments!, words, job.transcription?.engine || 'openai-whisper');
        if (musicEnabled) {
          candidates = await improvedChapterCandidates(job, words, candidates, controller.signal);
        }
        const chapters = initialDetectedChapters(candidates);
        if (!chapters.length || chapters[0].start !== '00:00:00.000') chapters.unshift({ id: 'opening', start: '00:00:00.000', title: 'Prologue' });
        const replacementChapters = applyDefaultChapterEnds(chapters, job.totalDurationSeconds);
        const replacementMetadata = generateFFMetaContent(replacementChapters, job.totalDurationSeconds, job.metadata);
        controller.signal.throwIfAborted();
        job.chapterDetectionKey = chapterDetectionCacheKey(job, musicEnabled);
        logChapterDetectionResult(candidates, musicEnabled);
        job.candidates = candidates;
        job.chapters = replacementChapters;
        job.chapterReviewBaseline = cloneProject(replacementChapters);
        job.ffmetaContent = replacementMetadata;
      } else if (step === 'extracting_chapters') {
        const relativeNames = job.parts.map(part => part.sourceRelativePath || part.name);
        const structure = job.chapterSource === 'grouped_files' ? manualChapterGroups(job.parts) : sourceChapterGroups(relativeNames);
        const starts: number[] = [];
        let cumulative = 0;
        for (const part of job.parts) { starts.push(cumulative); cumulative += part.durationSeconds; }
        const chapters = structure.groups.map((group, index) => ({
          id: `chap-${index + 1}`, start: formatTimestamp(starts[group.indices[0]]), title: group.title,
          notes: group.indices.map(i => relativeNames[i]).join(' → '),
        }));
        const existing = job.chapterSource === 'existing_chapters'
          ? await chaptersForJob(job, importedSourcePaths(job).map(file => ({ file, ...inspect(getFfprobe(), file) }))) : undefined;
        if (existing && !existing.chapters.length) throw new Error('No confidently matched existing chapters were found.');
        const replacementChapters = applyDefaultChapterEnds(existing?.chapters || chapters, job.totalDurationSeconds);
        const replacementMetadata = generateFFMetaContent(replacementChapters, job.totalDurationSeconds, job.metadata);
        controller.signal.throwIfAborted();
        job.chapterStructure = structure.mode;
        job.chapterDetectionKey = undefined;
        job.candidates = [];
        job.chapters = replacementChapters;
        job.chapterReviewBaseline = cloneProject(replacementChapters);
        job.ffmetaContent = replacementMetadata;
      } else if (step === 'metadata_processing') {
        const replacement = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);
        controller.signal.throwIfAborted();
        job.ffmetaContent = replacement;
      }

      const completedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const independentTranscript = step === 'transcribing_whisper' && job.chapterSource !== 'whisperx';
      const priorDetection = job.pipelineSteps?.detecting_chapters;
      job.pipelineSteps = completeStepRerun(job.pipelineSteps, step, completedAt);
      if (independentTranscript) job.pipelineSteps = { ...job.pipelineSteps, detecting_chapters: priorDetection };
      if (step === 'detecting_chapters') job.staleSteps = (job.staleSteps || []).filter(item => item !== 'chapter_detection');
      if (!independentTranscript) job.staleSteps = markDependentResultsStale(job.staleSteps, step);
      if ((step === 'detecting_chapters' || step === 'extracting_chapters') && job.status === 'draft' && canReviewChapters(job)) job.status = 'transcribed';
      job.logs.push({ timestamp: completedAt, level: 'INFO', message: `${action} completed: ${definition.label}.` });
      saveJobs();
      activeStep1ProgressState = {
        ...activeStep1ProgressState, isActive: false, stage: 'completed', label: `${definition.label} ${isRerun ? 'rerun' : 'run'} complete`,
        currentTask: `${isRerun ? 'Replacement output' : 'Output'} saved successfully.`, percentage: 100, isDeterminate: true,
        canCancel: false, liveStatusMessage: `${definition.label} is current.`,
        summary: { rerunStep: step },
      };
      logStep1(`${action} completed successfully: ${definition.label}.`);
    } catch (error: any) {
      const message = controller.signal.aborted ? `${action} cancelled.${isRerun ? ' Previous successful output was preserved.' : ''}` : error.message || String(error);
      job.pipelineSteps = { ...job.pipelineSteps, [step]: failStepRerun(previousStepState, message) };
      job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `${action} failed: ${definition.label}. ${message}` });
      saveJobs();
      activeStep1ProgressState.failedStage = definition.key;
      activeStep1ProgressState.stage = controller.signal.aborted ? 'cancelled' : 'error';
      activeStep1ProgressState.isActive = false;
      activeStep1ProgressState.canCancel = false;
      activeStep1ProgressState.error = message;
      activeStep1ProgressState.liveStatusMessage = message;
      logStep1(`${action} failed: ${message}`);
    } finally {
      step1TaskRunning = false;
      step1Abort = undefined;
    }
  })();
}));

// Update & Validate Chapter List (replicates app/chapters.py validation)
app.post('/api/jobs/:id/chapters', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { chapters: submittedChapters } = req.body;
  const chapters = Array.isArray(submittedChapters) ? applyDefaultChapterEnds(submittedChapters, job.totalDurationSeconds) : submittedChapters;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return res.status(400).json({ error: 'Chapters list must contain at least one entry.' });
  }

  // Exact validation rules from chapters.py
  try {
    const chapterError = validateChapterEntries(chapters, job.totalDurationSeconds);
    if (chapterError) throw new Error(chapterError);
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
  job.staleSteps = (job.staleSteps || []).filter(step => step !== 'chapter_review');
  job.staleSteps = [...new Set([...job.staleSteps, 'export' as const, 'validation' as const])];
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
  const job = projectStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // A path import points to the original folder. A browser folder import stores
  // its selected cover beside the copied audio because browsers hide local paths.
  const sourceDir = job.sourceFolderPath && path.resolve(APP_ROOT, job.sourceFolderPath);
  let foundCover: CoverArtInfo | null = null;
  if (sourceDir && fs.existsSync(sourceDir) && fs.statSync(sourceDir).isDirectory()) {
    const files = fs.readdirSync(sourceDir)
      .filter(name => /^cover(?:-[a-f0-9-]+)?\.(jpg|jpeg|png|webp)$/i.test(name))
      .map(name => ({ name, fullPath: path.join(sourceDir, name) }))
      .filter(file => fs.lstatSync(file.fullPath).isFile())
      .sort((a, b) => fs.statSync(b.fullPath).mtimeMs - fs.statSync(a.fullPath).mtimeMs);
    const selected = files[0];
    if (selected) {
      const stats = fs.statSync(selected.fullPath);
      if (stats.size > 10 * 1024 * 1024) return res.status(400).json({ error: 'Source cover exceeds the 10 MiB limit.' });
      const ext = path.extname(selected.name).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      foundCover = {
        source: 'local', filename: selected.name,
        url: `data:${mime};base64,${fs.readFileSync(selected.fullPath).toString('base64')}`,
        mimeType: mime, sizeBytes: stats.size, width: 1400, height: 1400,
      };
      associateProjectFile(job, selected.fullPath, 'cover');
      saveJobs();
    }
  }

  if (foundCover) {
    return res.json({
      found: true,
      cover: foundCover,
      message: `Found '${foundCover.filename}' in the imported audio folder. Added to your metadata draft.`,
    });
  }

  res.json({
    found: false,
    message: 'No cover.jpg/png/webp was found in the imported audio folder. You can upload an image or provide an image URL.',
  });
});

// Preserve in-progress Metadata screen edits locally without marking the step complete.
app.post('/api/jobs/:id/metadata-draft', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.importPending && !job.importInspected) return res.status(409).json({ error: 'Choose a source before editing metadata.' });
  const { metadata } = req.body as { metadata?: AudiobookMetadata };
  if (!metadata || typeof metadata !== 'object') return res.status(400).json({ error: 'Metadata draft is required.' });
  job.metadataDraft = metadata;
  saveJobs();
  res.json({ status: 'ok' });
});

function exportedAudioPaths(job: AudiobookJob): string[] {
  return [...new Set([
    ...Object.values(job.exportedFiles || {}),
    ...(job.exports || []).filter(item => item.status === 'success').map(item => item.fullPath),
    job.outputM4b?.fullPath,
  ].filter((file): file is string => typeof file === 'string' && fs.existsSync(file) && fs.statSync(file).isFile()))];
}

function savedAudiobookshelfPaths(job: AudiobookJob): string[] {
  const exports = exportedAudioPaths(job);
  return exports.length ? exports : sourceLocation(job) === 'managed' ? sourceFilePaths(job).filter(file => fs.existsSync(file)) : [];
}

function writeAudiobookshelfJson(job: AudiobookJob, files = exportedAudioPaths(job)): string[] {
  if (!job.metadata) throw new Error('Save book metadata before updating exmetadata.json.');
  if (!files.length) throw new Error('Export an audiobook before updating exmetadata.json.');
  let chapters: ChapterEntry[] = [];
  try { chapters = planChapterExport(job.chapters, job.totalDurationSeconds).chapters as ChapterEntry[]; }
  catch { /* Metadata remains usable if chapter edits have not been finalized. */ }
  return writeMetadataSidecars(job.metadata, chapters, files.map(file=>path.dirname(path.resolve(file))), {
    audiobookshelf:currentConfig.audiobookshelf_metadata, resourceId:job.id,
    assertOwnership:folder=>assertSidecarOwnership(job,folder,jobs,sourceFilePaths,SUPPORTED_AUDIO_EXTENSIONS),
    associate:file=>associateProjectFile(job,file,'metadata'),
  });
}

function planSingleExportFolderMove(job: AudiobookJob) {
  const root = path.resolve(APP_ROOT, finalOutputRoot(job.outputFolderPath, currentOutputFolder));
  const files = exportedAudioPaths(job);
  if (!files.length) throw new Error('Export an audiobook before updating its folder location.');
  const parts = libraryRelativePath(currentConfig.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata);
  const desired = path.resolve(root, ...parts);
  if (!isManagedChild(root, desired)) throw new Error('The folder pattern resolves outside the library.');
  const sources = [...new Set(files.map(file => path.dirname(path.resolve(file))))].sort();
  const rejectLinkedPath = (target: string) => {
    let current = path.resolve(root);
    const relative = path.relative(current, target);
    for (const segment of relative.split(path.sep)) {
      if (!segment || segment === '..') continue;
      current = path.join(current, segment);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked library path cannot be moved safely: ${current}`);
    }
  };
  for (const source of sources) {
    if (!isManagedChild(root, source) || !fs.statSync(source).isDirectory()) throw new Error(`Export folder is outside the library: ${source}`);
    rejectLinkedPath(source);
    for (const other of jobs) {
      if (other.id === job.id) continue;
      const referenced = [...exportedAudioPaths(other), other.mergedMp3?.fullPath,
        ...other.parts.map(part => path.resolve(APP_ROOT, other.sourceFolderPath || '', part.name))].filter((file): file is string => !!file);
      if (referenced.some(file => path.resolve(file) === source || isManagedChild(source, file))) throw new Error(`Another project uses this folder: ${source}`);
    }
    if (job.mergedMp3?.fullPath && (path.resolve(job.mergedMp3.fullPath) === source || isManagedChild(source, job.mergedMp3.fullPath))) throw new Error(`The source audio is inside this folder and cannot be moved as an export: ${source}`);
    if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Cannot move a linked export folder: ${source}`);
  }
  const ordered = sources.includes(desired) ? [desired, ...sources.filter(source => source !== desired)] : sources;
  const moves = ordered.map((from, index) => ({ from, to: index ? `${desired} (${index + 1})` : desired })).filter(move => move.from !== move.to);
  for (const move of moves) {
    if (!isManagedChild(root, move.to)) throw new Error('Destination is outside the library.');
    if (isManagedChild(move.from, move.to)) throw new Error(`Destination cannot be inside the current export folder: ${move.to}`);
    rejectLinkedPath(path.dirname(move.to));
    const caseOnlyRename = isWin && move.from.toLowerCase() === move.to.toLowerCase();
    if (fs.existsSync(move.to) && !caseOnlyRename) throw new Error(`Destination already exists. No files were moved: ${move.to}`);
  }
  return { root, moves };
}

function planExportFolderMove(job: AudiobookJob) {
  const first = planSingleExportFolderMove(job);
  const series = job.metadata?.series?.trim();
  if (!series) return { root: first.root, moves: first.moves.map(move => ({ jobId: job.id, ...move })) };
  const desiredParent = path.dirname(path.resolve(first.root, ...libraryRelativePath(currentConfig.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata)));
  const related = jobs.filter(other => other.id !== job.id && other.metadata?.series?.trim() === series &&
    resolvedOutputRoot(other) === first.root && exportedAudioPaths(other).length &&
    path.dirname(path.resolve(first.root, ...libraryRelativePath(currentConfig.library_template || DEFAULT_LIBRARY_TEMPLATE, other.metadata))) === desiredParent);
  const planned = [job, ...related].sort((a, b) => a.id.localeCompare(b.id))
    .map(book => ({ jobId: book.id, ...planSingleExportFolderMove(book) }));
  const moves = planned.flatMap(item => item.moves.map(move => ({ jobId: item.jobId, ...move })));
  const targets = new Set<string>();
  for (const move of moves) {
    const key = isWin ? move.to.toLowerCase() : move.to;
    if (targets.has(key)) throw new Error(`More than one book would move to the same folder: ${move.to}`);
    targets.add(key);
  }
  return { root: first.root, moves };
}

app.get('/api/jobs/:id/export-folder-move', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (!job.metadata) return res.status(400).json({ error: 'Save book metadata first.' });
  try { res.json(planExportFolderMove(job)); }
  catch (error: any) { res.status(409).json({ error: error.message }); }
});

app.post('/api/jobs/:id/export-folder-move', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (activeLibraryMutations > 1 || sourceImports.size || step1TaskRunning || metadataWriteJobs.size || jobs.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status)))) return res.status(409).json({ error: 'Wait for current file operations to finish.' });
  libraryMoveRunning = true;
  const moved: { jobId: string; from: string; to: string }[] = [];
  const warnings: string[] = [];
  try {
    const plan = planExportFolderMove(job);
    if (JSON.stringify(req.body?.confirmedMoves) !== JSON.stringify(plan.moves)) return res.status(409).json({ error: 'Folder locations changed. Review the move again.' });
    for (const move of plan.moves) {
      const book = projectStore.get(move.jobId)!;
      const warning = await transferAssociatedProject(book, move.to, 'move', { onlyFolder: move.from });
      moved.push(move); if (warning) warnings.push(warning);
    }
    res.json({ moved, warnings });
  } catch (error: any) { res.status(409).json({ moved, warnings, error: 'Could not finish moving export folders: ' + error.message + (moved.length ? '. Earlier verified moves were saved; refresh to see their locations.' : '') }); }
  finally { libraryMoveRunning = false; }
}));

function applySavedMetadata(job: AudiobookJob, metadata: AudiobookMetadata) {
  const seriesAddedAt = metadata.series?.trim() !== job.metadata?.series?.trim() ? new Date().toISOString() : job.metadata?.seriesAddedAt || metadata.seriesAddedAt;
  recordMetadataEdit(job, metadata);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  job.metadata = {
    ...metadata,
    seriesAddedAt,
    title: metadata.title.trim(),
    author: metadata.author?.trim() || '',
    narrator: metadata.narrator?.trim() || '',
    genres: Array.isArray(metadata.genres) ? metadata.genres : ['Audiobook'],
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    ...(metadata.collections !== undefined ? { collections:cleanMemberships(metadata.collections) } : {}),
    ...(metadata.additionalSeries !== undefined ? { additionalSeries:cleanMemberships(metadata.additionalSeries) } : {}),
  };
  job.metadataDraft = undefined;
  job.metadataUpdatedAt = new Date().toISOString();
  if (job.libraryScan) job.libraryScan.warning = job.metadata.author ? undefined : 'Metadata incomplete: author is missing';

  // Synchronize top-level fields for convenience
  job.name = job.metadata.title;
  job.author = job.metadata.author;
  job.narrator = job.metadata.narrator;

  // Re-generate FFmetadata with all updated tags
  job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);
  job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'metadata_processing', now);
  job.staleSteps = markDependentResultsStale(job.staleSteps, 'metadata_processing');

  if (job.status === 'transcribed') {
    job.status = 'metadata_ready';
  }

  job.logs.push({
    timestamp: now,
    level: 'INFO',
    message: `Updated audiobook metadata: "${job.metadata.title}" by ${job.metadata.author || 'Unknown'}. Narrator mapped to Composer tag: "${job.metadata.narrator || 'None'}". Cover: ${job.metadata.cover ? `${job.metadata.cover.source} (${job.metadata.cover.filename || 'URL'})` : 'None'}.`,
  });
}

// Update Audiobook Metadata (Standard Audiobookshelf metadata with Narrator in Composer)
app.post('/api/jobs/:id/metadata', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const { metadata } = req.body as { metadata: AudiobookMetadata };
  if (!metadata || !metadata.title?.trim()) return res.status(400).json({ error: 'Metadata title is required.' });
  applySavedMetadata(job, metadata);
  let metadataJsonPaths: string[] = [];
  let sidecarError: string | undefined;
  try {
    const audioFiles = savedAudiobookshelfPaths(job);
    if (audioFiles.length) metadataJsonPaths = writeAudiobookshelfJson(job, audioFiles);
  } catch (error: any) { sidecarError = error.message; }
  // Save the metadata and its sidecar associations in one durable transaction.
  saveJobs();
  if (sidecarError) return res.status(500).json({ error: 'Book details were saved, but exmetadata.json could not be updated: ' + sidecarError });

  res.json({
    status: 'ok',
    job,
    ffmeta: job.ffmetaContent,
    metadataJsonPaths,
    libraryBook: libraryBook(job),
    message: 'Audiobook metadata saved successfully.',
  });
});

// Finish import without running the audio pipeline. The persisted job JSON is
// SwissMouse's book record; embedded tags are an explicit, separate operation.
app.post('/api/jobs/:id/finish-import', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (!job.importPending && (job.status !== 'draft' || job.sourceKey || job.mergedMp3)) return res.status(409).json({ error: 'This book is already being processed.' });
  const metadata = req.body?.metadata as AudiobookMetadata;
  if (!metadata?.title?.trim()) return res.status(400).json({ error: 'Book title is required.' });
  let files: string[];
  try { files = importedSourcePaths(job); }
  catch (error: any) { return res.status(400).json({ error: error.message }); }
  if (sourceImports.has(job.id)) return res.status(409).json({ error: 'Wait for the source import to finish.' });
  const writeSource = req.body?.writeSource === true;
  const process = req.body?.process === true;
  if (writeSource && files.some(file => !outputFormats.includes(path.extname(file).slice(1).toLowerCase() as OutputAudioFormat)))
    return res.status(400).json({ error: 'One or more source formats do not support safe metadata writing. Keep the option off to save SwissMouse metadata only.' });
  sourceImports.add(job.id);
  try {
    if (writeSource) for (const file of files) {
      const format = path.extname(file).slice(1).toLowerCase() as OutputAudioFormat;
      const original = inspect(getFfprobe(), file);
      const tags = audiobookTags(metadata, undefined, Object.fromEntries(Object.entries(original.tags).map(([key, value]) => [key, String(value)])), format);
      const trackTitle = Object.entries(original.tags).find(([key]) => key.toLowerCase() === 'title')?.[1];
      if (files.length > 1 && trackTitle) tags[['flac', 'ogg', 'opus'].includes(format) ? 'TITLE' : 'title'] = String(trackTitle);
      let cover: string | null | undefined;
      const changedCover = JSON.stringify(metadata.cover || null) !== JSON.stringify(job.importedMetadata?.cover || null);
      if (changedCover && ['m4b', 'm4a', 'mp3', 'flac'].includes(format)) {
        if (!metadata.cover) cover = null;
        else {
          cover = await writeCoverImage(projectIntermediatesDir(job), metadata.cover.url, 'metadata-cover-' + randomUUID());
        }
      }
      try { await writeAudioMetadata({ ffmpeg: getFfmpeg(), ffprobe: getFfprobe(), file, format, tags, cover }); }
      finally { if (typeof cover === 'string' && fs.existsSync(cover)) fs.rmSync(cover, { force: true }); }
    }
    applySavedMetadata(job, metadata);
    job.importPending = false;
    job.importFinished = !process;
    try { if (sourceLocation(job) === 'managed') writeAudiobookshelfJson(job, files); } catch (error: any) { job.logs.push({ timestamp:new Date().toISOString(),level:'WARNING',message:`Book saved; exmetadata.json could not be written: ${error.message}` }); }
    job.importedAt = new Date().toISOString();
    job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'INFO', message: process ? 'Import saved; ready for processing.' : 'Import finished without audio processing.' });
    saveJobs();
    await catalog!.publish([job.id]);
    res.json({ job, book: libraryBook(job) });
  } catch (error: any) { res.status(500).json({ error: error.message || 'Could not finish import.' }); }
  finally { sourceImports.delete(job.id); }
}));

async function writeCoverImage(folder: string, url: string, basename: string): Promise<string> {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!match) throw new Error('Save a PNG, JPEG or WebP cover before exporting.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Cover image is empty or too large.');
  await fs.promises.mkdir(folder, { recursive: true });
  const output = path.join(folder, basename + (match[1] === 'jpeg' ? '.jpg' : '.png'));
  const stage = output + '.' + randomUUID() + '.tmp';
  const input = path.join(folder, '.swissmouse-cover-' + randomUUID() + '.webp');
  try {
    if (match[1] === 'webp') {
      await fs.promises.writeFile(input, bytes, { flag: 'wx' });
      await execFileAsync(getFfmpeg(), ['-v', 'error', '-i', input, '-frames:v', '1', '-c:v', 'png', '-f', 'image2', stage], { windowsHide: true, timeout: 30000 });
    } else await fs.promises.writeFile(stage, bytes, { flag: 'wx' });
    await fs.promises.rename(stage, output);
    return output;
  } finally {
    await fs.promises.unlink(input).catch(() => {}); await fs.promises.unlink(stage).catch(() => {});
  }
}

function associateProjectFile(job: AudiobookJob, file: string, kind: NonNullable<AudiobookJob['associatedFiles']>[number]['kind']) {
  job.associatedFiles = [...(job.associatedFiles || []).filter(item => pathKey(item.path) !== pathKey(file)), { path: file, kind }];
}

function projectFilePaths(job: AudiobookJob): string[] {
  return projectFiles(job, availableOriginalPaths(job)).map(file => file.path);
}

async function backfillProjectCompanions(job: AudiobookJob) {
  const sourceRoot = bookSourceRoot(job);
  if (!sourceRoot || !fs.existsSync(sourceRoot)) return;
  const owned = new Set(projectFilePaths(job).map(pathKey));
  const extensions = new Set([...SUPPORTED_AUDIO_EXTENSIONS, ...sourceFilePaths(job).map(file => path.extname(file).slice(1).toLowerCase())]);
    // Older exports predate associatedFiles. Only accept scanner-owned companions
    // when every audio member is already explicitly attached to this project.
    for (const folder of new Set([sourceRoot, ...exportedAudioPaths(job).map(file => path.dirname(file))])) {
      // Only this directory's companions need legacy backfill; do not rescan a collection.
      const subfolders = (await fs.promises.readdir(folder, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(folder, entry.name));
      const diskBooks = await scanRoot(folder, extensions, subfolders);
      for (const disk of diskBooks) if (disk.files.length && disk.files.every(file => owned.has(pathKey(path.join(disk.folder, file.name))))) {
        for (const file of disk.associatedFiles || []) associateProjectFile(job, file.path, file.kind);
      }
    }
    for (const output of exportedAudioPaths(job)) if (fs.existsSync(output + '.cue')) associateProjectFile(job, output + '.cue', 'chapters');

}

function restoreProject(job: AudiobookJob, previous: AudiobookJob) {
  Object.keys(job).forEach(key => delete (job as any)[key]); Object.assign(job, previous);
}

/** An existing final export may be adopted, but never an unrelated folder. */
async function ownedProjectDestination(job: AudiobookJob, target: string): Promise<CopiedFile[] | undefined> {
  if (!pathEntryExists(target)) return undefined;
  const outputs = [job.outputM4b, ...(job.exports || []).filter(output => output.status === 'success')]
    .filter(output => output?.fullPath && pathKey(path.dirname(output.fullPath)) === pathKey(target));
  if (!outputs.length) return undefined;
  for (const output of outputs) {
    const expected = output!.fileIdentity;
    if (!expected || (await stamp(output!.fullPath!)).identity !== expected) return undefined;
  }
  const owned = new Set(projectFilePaths(job).map(pathKey));
  const shared = new Set(jobs.filter(other => other.id !== job.id).flatMap(projectFilePaths).map(pathKey));
  const files = await inventory(target);
  if (!files.length || files.some(file => !owned.has(pathKey(path.join(target, file.name))) || shared.has(pathKey(path.join(target, file.name))))) return undefined;
  return Promise.all(files.map(async file => ({ name: file.name, stamp: file, hash: await contentHash(path.join(target, file.name)) })));
}

async function transferAssociatedProject(job: AudiobookJob, target: string, mode: 'copy' | 'move', options: { finishedOnly?: boolean; finalCheck?: boolean; onlyFolder?: string; allowMissingSources?: boolean; destinationRoot?: string; destinationKind?: 'inbox' | 'managed' } = {}) {
  const previous = cloneProject(job);
  const source = job.source?.path || job.sourceFolderPath || '';
  const sourceRoot = bookSourceRoot(job) || path.dirname(job.outputM4b?.fullPath || target);
  const sources = sourceFilePaths(job);
  const generated = await fs.promises.mkdtemp(appPath('.swissmouse-transfer-'));
  const log = (message: string) => appendMasterEvent('Library transfer', message);
  try {
    if (!options.finishedOnly && !options.onlyFolder) await backfillProjectCompanions(job);
    const existingTarget = await ownedProjectDestination(job, target);
    const members = new Set(sources.map(pathKey));
    const files = projectFiles(job, options.finishedOnly ? [] : availableOriginalPaths(job)).filter(file => !options.onlyFolder || within(options.onlyFolder, file.path));
    const exportFolders = new Set(exportedAudioPaths(job).filter(file => !members.has(pathKey(file))).map(file => pathKey(path.dirname(file))));
    const separateOutput = (file: string) => !within(sourceRoot, file) || (!members.has(pathKey(file)) && exportFolders.has(pathKey(path.dirname(file))) && pathKey(path.dirname(file)) !== pathKey(sourceRoot));
    const entries: MoveEntry[] = [];
    // Finished audio and companions belong at the book root. Preserve colliding
    // original names in a separate subfolder instead of overwriting either file.
    for (const file of [...files].sort((a, b) => Number(b.roles.includes('output')) - Number(a.roles.includes('output')) || Number(within(target, b.path)) - Number(within(target, a.path)))) {
      if ((options.finishedOnly || (options.allowMissingSources && members.has(pathKey(file.path)))) && !fs.existsSync(file.path)) continue;
      let name = file.roles.includes('output') || file.path === job.originalsArchive?.path || separateOutput(file.path) ? path.basename(file.path)
        : options.onlyFolder ? path.relative(options.onlyFolder, file.path) : path.relative(sourceRoot, file.path);
      if (entries.some(entry => pathKey(entry.name) === pathKey(name))) {
        if (file.roles.includes('output')) throw new Error('Several finished files have the same name. Rename them before transferring.');
        const prefix = file.roles.includes('source') ? 'Original audio' : 'Original sidecars';
        name = path.join(prefix, path.basename(file.path));
        for (let index = 2; entries.some(entry => pathKey(entry.name) === pathKey(name)); index++) name = path.join(prefix, String(index), path.basename(file.path));
      }
      entries.push({ source: file.path, name, stamp: await stamp(file.path) });
    }
    if (!entries.length) throw new Error('No associated book files are available.');
    // Keep superseded physical sidecars as associated originals. The root sidecar
    // and root cover always describe the saved book that the user sees.
    const generatedFiles: { file: string; name: string; kind: 'metadata' | 'cover' }[] = [];
    let chapters: ChapterEntry[] = [];
    try { chapters = planChapterExport(job.chapters, job.totalDurationSeconds).chapters as ChapterEntry[]; } catch { /* Imported books need no processing. */ }
    if (job.metadata) {
      const sidecars = [['exmetadata.json', extendedMetadata(job.metadata, chapters, job.id)], ...(currentConfig.audiobookshelf_metadata ? [['metadata.json', audiobookshelfMetadata(job.metadata, chapters)]] : [])] as const;
      for (const [name, data] of sidecars) {
        const file = path.join(generated, name as string);
        await fs.promises.writeFile(file, JSON.stringify(data, null, 2) + '\n');
        generatedFiles.push({ file, name: name as string, kind: 'metadata' });
      }
    }
    const cover = job.metadata?.cover;
    if (cover && currentConfig.save_cover_beside_audio !== false) {
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(cover.url);
      if (!match) throw new Error('Save a local PNG, JPEG or WebP cover before transferring this book.');
      const name = 'cover.' + (match[1] === 'jpeg' ? 'jpg' : match[1]);
      const file = path.join(generated, name);
      await fs.promises.writeFile(file, Buffer.from(match[2], 'base64'));
      generatedFiles.push({ file, name, kind: 'cover' });
    }
    // Already-published companions were saved with the verified export. Keep
    // those files in place; transfer must not rewrite or archive them again.
    if (existingTarget) for (let index = generatedFiles.length - 1; index >= 0; index--) {
      if (entries.some(entry => pathKey(entry.source) === pathKey(path.join(target, generatedFiles[index].name)) && pathKey(entry.source) === pathKey(path.join(target, entry.name)))) generatedFiles.splice(index, 1);
    }
    for (const entry of entries) if (/^((?:exmetadata|metadata)\.json|cover\.(png|jpe?g|webp))$/i.test(entry.name)) {
      const replacement = generatedFiles.find(file => file.name.toLowerCase() === entry.name.toLowerCase());
      if (replacement && await contentHash(replacement.file) === await contentHash(entry.source)) {
        generatedFiles.splice(generatedFiles.indexOf(replacement), 1);
      } else if (replacement) {
        let name = path.join('Original sidecars', entry.name), suffix = 2;
        while (entries.some(other => other !== entry && pathKey(other.name) === pathKey(name))) name = path.join('Original sidecars', String(suffix++), entry.name);
        entry.name = name;
      }
    }
    for (const file of generatedFiles) entries.push({ source: file.file, name: file.name, stamp: await stamp(file.file) });
    const originals = entries.filter(entry => !within(generated, entry.source) && !within(target, entry.source));
    const protectedFiles = new Set(jobs.filter(other => other.id !== job.id).flatMap(other => [...projectFilePaths(other), ...(other.retainedSourceFiles || []).map(file => file.path)]).map(pathKey));
    const root = path.resolve(options.destinationRoot || currentOutputFolder);
    const intent: TransferJournal = { version: 2, id: job.id, source, target, mode, entries, destinationRoot: root, operation: options.onlyFolder || options.finishedOnly ? 'exports' : 'project' };
    const warning = await transferProjectFiles({ root, journal: appPath('library-move-' + randomUUID() + '.json'), intent, existingTarget,
      cleanupEntries: originals, boundaries: [path.resolve(currentConfig.inbox_folder || appPath('inbox')), root], protectedFiles, log,
      rollback: () => restoreProject(job, previous), commit: async () => {
        if (options.finalCheck && job.completionSignature !== await completionSignature(job)) throw new Error('Audio changed after the final check. Original files were retained.');
        const mapping = new Map(entries.map(entry => [pathKey(entry.source), path.join(target, entry.name)]));
        if (options.allowMissingSources || previous.originalsArchive) for (const file of sources) if (!mapping.has(pathKey(file)) && within(sourceRoot, file)) {
          let name = path.relative(sourceRoot, file);
          const occupied = (relative: string) => [...mapping.values()].some(value => pathKey(value) === pathKey(path.join(target, relative)));
          if (occupied(name)) {
            name = path.join('Original audio', path.basename(file));
            for (let index = 2; occupied(name); index++) name = path.join('Original audio', String(index), path.basename(file));
          }
          mapping.set(pathKey(file), path.join(target, name));
        }
        const remap = (file: string | undefined) => file ? mapping.get(pathKey(file)) || file : file;
        if (!options.finishedOnly && !options.onlyFolder) {
          job.parts = job.parts.map((part, index) => { const relative = path.relative(target, remap(sources[index])!); return { ...part, name: relative, sourceRelativePath: relative.replace(/\\/g, '/') }; });
          job.source = { kind: options.destinationKind || 'managed', mode: previous.source?.mode === 'file' && sources.length === 1 ? 'file' : 'folder', path: previous.source?.mode === 'file' && sources.length === 1 ? remap(sources[0])! : target };
          job.sourceFolderPath = target;
          if (job.sourceSummary) job.sourceSummary.sourcePath = job.source.path;
          job.sourceInventory = undefined; job.discoveredFiles = undefined; job.sourceFileStamps = undefined;
          job.explicitlyAddedSourceFiles = undefined;
          if (job.sourceKey) {
            job.sourcePathIdentity = Object.fromEntries(job.parts.map((part, index) => [sourceRelative(job, part), previous.sourcePathIdentity?.[sourceRelative(previous, previous.parts[index])] || sources[index]]));
          }
        }
        if (job.outputM4b) {
          job.outputM4b.fullPath = remap(job.outputM4b.fullPath);
          if (job.outputM4b.fullPath) job.outputM4b.fileIdentity = (await stamp(job.outputM4b.fullPath)).identity;
        }
        if (job.originalsArchive) {
          job.originalsArchive.path = remap(job.originalsArchive.path)!;
          job.originalsArchive.stamp = await stamp(job.originalsArchive.path);
          job.originalsArchive.files = job.originalsArchive.files.map(file => ({ ...file, source: remap(file.source)! }));
        }
        if (job.mergedMp3) job.mergedMp3.fullPath = remap(job.mergedMp3.fullPath);
        if (job.finalCheck) job.finalCheck.files = job.finalCheck.files.map(file => ({ ...file, file: remap(file.file)! }));
        for (const report of job.validations || []) report.file = remap(report.file)!;
        job.previewPath = remap(job.previewPath); job.downloadedAudioFile = remap(job.downloadedAudioFile);
        for (const output of job.exports || []) { output.fullPath = remap(output.fullPath); output.coverPath = remap(output.coverPath); }
        for (const [format, file] of Object.entries(job.exportedFiles || {})) job.exportedFiles![format as OutputAudioFormat] = remap(file)!;
        job.associatedFiles = (job.associatedFiles || []).map(file => ({ ...file, path: remap(file.path)! }));
        for (const file of files) {
          const kind = file.roles.find(role => role !== 'source' && role !== 'output');
          if (kind) associateProjectFile(job, remap(file.path)!, kind);
        }
        for (const file of generatedFiles) associateProjectFile(job, path.join(target, file.name), file.kind);
        job.retainedSourceFiles = [...(job.retainedSourceFiles || []), ...originals.map(entry => ({ path: entry.source, ...entry.stamp }))];
        job.libraryScan = undefined;
        if (options.finalCheck && job.sourceKey && !job.originalsArchive) { job.sourcePathIdentity = undefined; job.sourceKey = await fingerprint(sourceFilePaths(job), {}); if(job.retainedWaveform)job.retainedWaveform.sourceKey=job.sourceKey; }
        if (job.processingStatus === 'complete') { job.completionSignature = await completionSignature(job); job.sourceReorganizationPending = true; }
        job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Verified ' + mode + ' of ' + entries.length + ' associated files to ' + target });
        persistJobsAtomically();
      } });
    // Cleanup can change hard-link ctimes after the transaction commits. Stamp
    // the verified destination only after cleanup, while the transfer lock holds.
    if (options.finalCheck && job.finalCheck && job.processingStatus === 'complete'
      && job.completionSignature === await completionSignature(job)) {
      const previousSignature = job.finalCheck.inputSignature;
      job.finalCheck.inputSignature = currentFinalCheckSignature(job);
      try { persistJobsAtomically(); }
      catch (error: any) {
        job.finalCheck.inputSignature = previousSignature;
        log(`Transferred files retained; Final Check state could not be saved: ${error.message}`);
        return [warning, 'Files transferred. Run Final Check again; its updated state could not be saved.'].filter(Boolean).join(' ');
      }
    }
    return warning;
  } finally { await fs.promises.rm(generated, { recursive: true, force: true }); }
}

async function moveCompletedProject(req: express.Request, res: express.Response, allowUnchecked = false) {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  const mode = req.body?.mode;
  if (mode !== 'copy' && mode !== 'move') return res.status(400).json({ error: 'Choose Copy & Keep or Move & Clean Up.' });
  if (job.importPending || !job.metadata?.title?.trim()) return res.status(409).json({ error: 'Finish importing and save book details first.' });
  if (sourceLocation(job) === 'managed') return res.status(409).json({ error: 'This book is already in the managed Library.' });
  if (!allowUnchecked && !canMoveInboxBook(job)) return res.status(409).json({ error: 'Run a successful final check before moving this book.' });
  if (activeLibraryMutations > 1 || sourceImports.size || step1TaskRunning || metadataWriteJobs.size || jobs.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status)))) return res.status(409).json({ error: 'Wait for current file operations to finish.' });
  libraryMoveRunning = true;
  try {
    const checkedCurrent = completionCurrent(job) && job.completionSignature === await completionSignature(job).catch(() => undefined);
    if (!allowUnchecked && !checkedCurrent) throw new Error('Audio changed since the final check. Check the audiobook again before moving.');
    const target = path.resolve(currentOutputFolder, ...libraryRelativePath(currentConfig.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata!));
    if (allowUnchecked && !checkedCurrent) { job.processingStatus = 'incomplete'; job.completionSignature = undefined; }
    const warning = await transferAssociatedProject(job, target, mode, { finalCheck: checkedCurrent });
    appendMasterEvent('Library move', 'Move success: verified project saved at ' + target);
    res.json({ job: { ...job, canMoveToLibrary: false, sourceMissing: false }, book: libraryBook(job), books: req.get('X-SwissMouse-Catalog') === '1' ? [] : visibleLibraryBooks(), path: target, mode, warning });
  } catch (error: any) { appendMasterEvent('Library move', 'Move failed; original files retained: ' + error.message, 'ERROR'); res.status(409).json({ error: error.message || 'Could not transfer the book. Original files were retained.' }); }
  finally { libraryMoveRunning = false; }
}
app.get('/api/jobs/:id/move-to-library', asyncRoute(async (req, res) => {
  const saved = projectStore.get(req.params.id);
  if (!saved) return res.status(404).json({ error: 'Book not found.' });
  try {
    const job = cloneProject(saved); await backfillProjectCompanions(job);
    const destination = path.resolve(currentOutputFolder, ...libraryRelativePath(currentConfig.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata!));
    const files = projectFilePaths(job), owned = new Set(files.map(pathKey));
    const protectedFiles = new Set(jobs.filter(other => other.id !== job.id).flatMap(projectFilePaths).map(pathKey));
    const root = bookSourceRoot(job);
    // A preview must not recursively walk a collection or processing workspace.
    const kept = root && fs.existsSync(root) ? (await fs.promises.readdir(root, { withFileTypes: true })).map(entry => path.join(root, entry.name))
      .filter(file => (!owned.has(pathKey(file)) && !files.some(member => within(file, member))) || protectedFiles.has(pathKey(file))) : [];
    res.json({ destination, files, kept, keptOverview: true, conflict: pathEntryExists(destination) && !(await ownedProjectDestination(job, destination)) });
  } catch (error: any) { res.status(409).json({ error: error.message }); }
}));
app.post('/api/jobs/:id/move-to-library', asyncRoute((req, res) => moveCompletedProject(req, res)));

function organizeLibraryPlan(job: AudiobookJob) {
  if (job.importPending || !job.metadata?.title?.trim()) throw new Error('Save book details before organizing the Library folder.');
  const managedBookFolder = !!job.source?.path && isManagedChild(currentOutputFolder, job.source.path) &&
    fs.existsSync(job.source.path) && fs.statSync(job.source.path).isDirectory();
  const finishedOnly = !managedBookFolder && (sourceMissing(job) || !job.parts.length) ? survivingLibraryM4b(job) : undefined;
  const savedSource = finishedOnly || job.source?.path || job.sourceFolderPath;
  if (!savedSource) throw new Error('Choose a book source before organizing the Library folder.');
  const source = path.resolve(savedSource);
  if (!fs.existsSync(source)) throw new Error('The current book source is unavailable. Relink or add it before organizing.');
  const folder = fs.statSync(source).isDirectory();
  if (!folder && !fs.statSync(source).isFile()) throw new Error('The current book source is not a regular file or folder.');
  if (!finishedOnly && sourceFilePaths(job).some(file => pathKey(file) !== pathKey(source) && !(folder && within(source, file)))) throw new Error('This project uses files outside its source folder. Place its selected files together before organizing the book.');
  const root = path.resolve(currentOutputFolder);
  if (pathKey(source) === pathKey(root) || knownIntermediatesRoots().some(workspace => pathKey(source) === pathKey(workspace) || within(workspace, source)))
    throw new Error('Choose a book source folder outside SwissMouse workspaces and the Library root.');
  const base = path.resolve(root, ...libraryRelativePath(currentConfig.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata));
  if (!isManagedChild(root, base)) throw new Error('The Library folder pattern resolves outside the configured Library.');
  const alreadyOrganized = folder ? pathKey(source) === pathKey(base) : pathKey(path.dirname(source)) === pathKey(base);
  let target = base;
  if (!alreadyOrganized) for (let copy = 2; pathEntryExists(target); copy++) target = `${base} (${copy})`;
  if (!isManagedChild(root, target)) throw new Error('The Library destination is outside the configured folder.');
  const mode = 'move' as const;
  if (folder && !within(root, source) && within(source, target)) throw new Error('The Library destination is inside the current book folder. Move the book folder outside the Library root first.');
  return { source, root, base, target, folder, mode, alreadyOrganized, collision: target !== base, finishedOnly: !!finishedOnly };
}

function removeOrganizeScaffold(source: string, target: string) {
  if (!within(source, target)) return;
  let folder = path.dirname(target);
  while (pathKey(folder) === pathKey(source) || within(source, folder)) {
    fs.rmdirSync(folder); // Refuse to remove a folder that gained user files.
    if (pathKey(folder) === pathKey(source)) break;
    folder = path.dirname(folder);
  }
}

app.get('/api/jobs/:id/organize-library', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  try { res.json(organizeLibraryPlan(job)); }
  catch (error: any) { res.status(409).json({ error: error.message }); }
});

async function chaptersForJob(job: AudiobookJob, sources: ChapterAudioSource[], sourceKey?: string): Promise<{chapters: ChapterEntry[];source?:string;sidecar?:string}> {
  if (!job.importedChapterFile) return existingChapterList(sources, SUPPORTED_AUDIO_EXTENSIONS);
  const imported = job.importedChapterFile;
  const current = sourceKey || await sourceFingerprint(job, sources.map(source => source.file));
  if (current !== imported.sourceKey) return {chapters:[],source:'Imported chapter file no longer matches the project audio. Import it again or clear it.'};
  const parsed = parseChapterFile(imported.name, imported.content, sources, bookSourceRoot(job) || path.dirname(sources[0].file));
  return {chapters:parsed.chapters,source:`Imported ${parsed.kind === 'tracks' ? 'playlist track boundaries' : 'chapters'}: ${imported.name}`};
}

app.post('/api/jobs/:id/chapter-file', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({error:'Book not found.'});
  if (step1TaskRunning || sourceImports.has(job.id) || job.exports?.some(item=>['running','queued'].includes(item.status))) return res.status(409).json({error:'Wait for file processing to finish before changing chapter sources.'});
  try {
    if (typeof req.body?.name !== 'string' || typeof req.body?.content !== 'string') throw new Error('Choose a chapter or playlist file.');
    const name = path.basename(req.body.name); if(name.length>255)throw new Error('The filename is too long.');
    const files = importedSourcePaths(job);
    const sourceKey = await sourceFingerprint(job, files);
    const sources = await Promise.all(files.map(async file=>({file,...await mediaCache.read(getFfprobe(),file)})));
    const parsed = parseChapterFile(name, req.body.content, sources, bookSourceRoot(job) || path.dirname(files[0]));
    if (sourceKey !== await sourceFingerprint(job, files)) throw new Error('Audio changed while importing. Check the project files and try again.');
    const previous = {file:job.importedChapterFile,source:job.chapterSource};
    job.importedChapterFile = {name,content:req.body.content,sourceKey};
    job.chapterSource = 'existing_chapters';
    try { persistJobsAtomically(); } catch(error) {job.importedChapterFile=previous.file;job.chapterSource=previous.source;throw error;}
    res.json({count:parsed.chapters.length,source:`Imported ${parsed.kind === 'tracks' ? 'playlist track boundaries' : 'chapters'}: ${name}`,importedName:name,kind:parsed.kind});
  } catch(error:any) {res.status(400).json({error:error.message||'Could not import chapter file.'});}
}));

app.delete('/api/jobs/:id/chapter-file', (req,res)=>{
  const job=projectStore.get(req.params.id);if(!job)return res.status(404).json({error:'Book not found.'});
  if(step1TaskRunning||sourceImports.has(job.id)||job.exports?.some(item=>['running','queued'].includes(item.status)))return res.status(409).json({error:'Wait for file processing to finish.'});
  const previous=job.importedChapterFile;job.importedChapterFile=undefined;
  try {persistJobsAtomically();}catch(error){job.importedChapterFile=previous;throw error;}
  res.json({cleared:true});
});

app.get('/api/jobs/:id/existing-chapters', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  try {
    const files = importedSourcePaths(job);
    const sources = await Promise.all(files.map(async file => ({ file, ...await mediaCache.read(getFfprobe(), file) })));
    const existing = await chaptersForJob(job, sources);
    res.json({ count: existing.chapters.length, source: existing.source, importedName:job.importedChapterFile?.name });
  } catch (error: any) { res.status(409).json({ error: error.message || 'Could not read existing chapters.' }); }
}));

app.post('/api/jobs/:id/organize-library', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (activeLibraryMutations > 1 || sourceImports.size || step1TaskRunning || metadataWriteJobs.size || jobs.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status)))) return res.status(409).json({ error: 'Wait for current file operations to finish.' });
  libraryMoveRunning = true;
  try {
    const plan = organizeLibraryPlan(job);
    if (plan.alreadyOrganized) return res.json({ job, target: plan.target, alreadyOrganized: true });
    if (req.body?.source !== plan.source || req.body?.target !== plan.target) return res.status(409).json({ error: 'The book location changed. Review the destination again.' });
    const warning = await transferAssociatedProject(job, plan.target, plan.mode, { finishedOnly: plan.finishedOnly, allowMissingSources: true });
    res.json({ job, target: plan.target, copied: false, warning });
  } catch (error: any) { res.status(409).json({ error: error.message || 'Could not organize the book.' }); }
  finally { libraryMoveRunning = false; }
}));

// Explicitly copy a referenced book into the configured Library. The source
// remains untouched; only after every copied file is present does the stable
// book record switch to the managed path.
app.post('/api/library/:id/send-to-library', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (req.body?.mode) return moveCompletedProject(req, res, true);
  if (job.importPending || !job.metadata?.title?.trim()) return res.status(409).json({ error: 'Finish importing and save book details first.' });
  if (sourceLocation(job) === 'managed') return res.status(409).json({ error: 'This book is already in the managed Library.' });
  if (activeLibraryMutations > 1 || sourceImports.size || step1TaskRunning || metadataWriteJobs.size || jobs.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status)))) return res.status(409).json({ error: 'Wait for current file operations to finish.' });
  libraryMoveRunning = true;
  try {
    const plan = organizeLibraryPlan(job);
    const warning = await transferAssociatedProject(job, plan.target, 'copy');
    res.json({ job: { ...job, sourceMissing: false }, book: libraryBook(job), path: plan.target, warning });
  } catch (error: any) { res.status(409).json({ error: error.message || 'Could not copy book to Library.' }); }
  finally { libraryMoveRunning = false; }
}));

app.post('/api/jobs/:id/metadata-json', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (step1TaskRunning || sourceImports.size || libraryValidationRunning || job.exports?.some(item => item.status === 'queued' || item.status === 'running')) return res.status(409).json({ error: 'Wait for current processing to finish.' });
  const files = exportedAudioPaths(job).length ? exportedAudioPaths(job) : sourceFilePaths(job).filter(file => fs.existsSync(file));
  if (!files.length) return res.status(400).json({ error: 'No audiobook file is available for exmetadata.json.' });
  const metadata = req.body?.metadata as AudiobookMetadata | undefined;
  if (metadata && !metadata.title?.trim()) return res.status(400).json({ error: 'Metadata title is required.' });
  if (!metadata && !job.metadata) return res.status(400).json({ error: 'Save book metadata first.' });
  if (metadata) { applySavedMetadata(job, metadata); saveJobs(); }
  try {
    const written = writeAudiobookshelfJson(job, files);
    job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'INFO', message: `Updated exmetadata.json: ${written.join('; ')}` });
    saveJobs();
    res.json({ written });
  } catch (error: any) { res.status(500).json({ error: `Could not update exmetadata.json: ${error.message}` }); }
});

const editableLibraryFields = new Set(['title', 'subtitle', 'author', 'narrator', 'series', 'seriesSequence', 'edition', 'description', 'genres', 'tags', 'collections', 'additionalSeries', 'publishedYear', 'publisher', 'language', 'isbn', 'asin', 'releaseDate', 'copyright', 'abridged', 'explicit']);
app.post('/api/library/metadata', asyncRoute(async (req, res) => {
  const changes = req.body?.changes as { id: string; fields: Partial<AudiobookMetadata> }[];
  if (!Array.isArray(changes) || !changes.length || changes.length > 10000) return res.status(400).json({ error: 'Select books and fields to update.' });
  const planned: { job: AudiobookJob; metadata: AudiobookMetadata; fields: Partial<AudiobookMetadata> }[] = [];
  const ids = new Set<string>();
  for (const change of changes) {
    const job = projectStore.get(change?.id);
    if (!job || ids.has(change.id) || !change.fields || typeof change.fields !== 'object' || Array.isArray(change.fields)) return res.status(400).json({ error: 'Invalid book update.' });
    ids.add(change.id);
    const fields = Object.keys(change.fields);
    if (!fields.length || fields.some(field => !editableLibraryFields.has(field))) return res.status(400).json({ error: 'Select supported metadata fields.' });
    for (const field of fields) {
      const value = (change.fields as Record<string, unknown>)[field];
      if (field === 'genres' || field === 'tags' ? !Array.isArray(value) || value.some(item => typeof item !== 'string') : ['abridged', 'explicit'].includes(field) ? typeof value !== 'boolean' : typeof value !== 'string') return res.status(400).json({ error: `Invalid ${field} value.` });
    }
    const metadata = { ...job.metadata, title: job.metadata?.title || job.name, author: job.metadata?.author || job.author || '', narrator: job.metadata?.narrator || job.narrator || '', genres: job.metadata?.genres || [], language: job.metadata?.language || 'eng', abridged: job.metadata?.abridged || false, explicit: job.metadata?.explicit || false, ...change.fields } as AudiobookMetadata;
    if (!metadata.title.trim()) return res.status(400).json({ error: 'Metadata title is required.' });
    planned.push({ job, metadata, fields: change.fields });
  }
  for (const { job, metadata, fields } of planned) {
    const originalDraft = job.metadataDraft;
    applySavedMetadata(job, metadata);
    if (originalDraft) job.metadataDraft = { ...originalDraft, ...fields };
  }
  saveJobs();
  const jsonFailures: string[] = [];
  for (const { job } of planned) {
    const files = savedAudiobookshelfPaths(job);
    if (!files.length) continue;
    try { writeAudiobookshelfJson(job, files); }
    catch (error: any) {
      jsonFailures.push(`${job.name}: ${error.message}`);
      job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `Could not update exmetadata.json: ${error.message}` });
    }
  }
  saveJobs();
  await catalog!.publish([...ids]);
  res.json({ books: planned.map(({ job }) => libraryBook(job)), jsonFailures });
}));

const metadataWriteJobs = new Set<string>();
app.post('/api/library/:id/write-audio-metadata', requireFeatures(['audio_export'], 'Audio metadata write'), asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  if (!job.metadata) return res.status(400).json({ error: 'Save book metadata before writing an audio file.' });
  if (step1TaskRunning || sourceImports.size || libraryValidationRunning || job.exports?.some(item => item.status === 'queued' || item.status === 'running')) return res.status(409).json({ error: 'Wait for current processing to finish.' });
  if (metadataWriteJobs.has(job.id)) return res.status(409).json({ error: 'Metadata is already being written to this book.' });
  const exported = (job.exports || []).filter(item => item.status === 'success' && item.fullPath);
  const writingSources = !exported.length;
  const originalPaths = sourceFilePaths(job);
  const sourceWasCurrent = !writingSources || !job.sourceKey || job.sourceKey === await sourceFingerprint(job,originalPaths).catch(()=>undefined);
  const outputs = exported.length ? exported : originalPaths.filter(file => fs.existsSync(file)).map(file => ({ fullPath: file, format: path.extname(file).slice(1).toLowerCase() as OutputAudioFormat, status: 'success' as const }));
  if (!outputs.length) return res.status(400).json({ error: 'No audiobook file is available for metadata writing.' });
  metadataWriteJobs.add(job.id);
  const written: string[] = [];
  const failures: string[] = [];
  try {
  for (const item of outputs) {
    const file = path.resolve(item.fullPath!);
    try {
      if (jobs.some(other => other.id !== job.id && sourceFilePaths(other).some(source => pathKey(source) === pathKey(file)))) throw new Error('This file is shared with another project. Keep it unchanged or export a separate copy first.');
      if (job.mergedMp3?.fullPath && file === path.resolve(job.mergedMp3.fullPath) && !writingSources) throw new Error('The processing master cannot be changed here.');
      const tagFormat = item.format === ('mp4' as string) ? 'm4b' : item.format;
      if (!outputFormats.includes(tagFormat)) throw new Error('This source format does not support metadata writing.');
      const original = inspect(getFfprobe(), file);
      const tags = audiobookTags(job.metadata, undefined, Object.fromEntries(Object.entries(original.tags).map(([key, value]) => [key, String(value)])), tagFormat);
      if (writingSources && outputs.length > 1 && original.tags.title) tags[['flac','ogg','opus'].includes(tagFormat)?'TITLE':'title'] = String(original.tags.title);
      let cover:string|null|undefined;
      if (['m4b','m4a','mp3','flac'].includes(tagFormat)) cover = job.metadata.cover?.url ? await writeCoverImage(projectIntermediatesDir(job),job.metadata.cover.url,'tag-cover-'+randomUUID()) : job.metadata.cover === null ? null : undefined;
      let result:Awaited<ReturnType<typeof writeAudioMetadata>>;
      try {result = await writeAudioMetadata({ ffmpeg: getFfmpeg(), ffprobe: getFfprobe(), file, format: tagFormat, tags, cover });}
      finally {if(typeof cover==='string')fs.rmSync(cover,{force:true});}
      const outputStamp = await stamp(file);
      if ('fileIdentity' in item) item.fileIdentity = outputStamp.identity;
      if (job.outputM4b?.fullPath === file) job.outputM4b.fileIdentity = outputStamp.identity;
      if (writingSources) {
        const index=originalPaths.findIndex(source=>pathKey(source)===pathKey(file));
        if(index>=0){job.parts[index].sizeBytes=result.sizeBytes;const root=bookSourceRoot(job);const relative=sourceRelative(job,job.parts[index]);if(root){const observed=bookFileStamp(root,relative);if(observed){job.sourceFileStamps ||= {};job.sourceFileStamps[relative]=observed;}}}
        if(job.mergedMp3?.fullPath && pathKey(job.mergedMp3.fullPath)===pathKey(file))job.mergedMp3.sizeBytes=result.sizeBytes;
      }
      if ('verifiedTags' in item) item.verifiedTags = result.verifiedTags;
      if (job.outputM4b?.fullPath === item.fullPath) job.outputM4b.sizeBytes = result.sizeBytes;
      written.push(file);
      job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'INFO', message: `Wrote metadata to audiobook file: ${file}` });
    } catch (error: any) {
      failures.push(`${item.format.toUpperCase()}: ${error.message}`);
      job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `Could not write metadata to ${file}: ${error.message}` });
    }
    saveJobs();
  }
  if (written.length) {
    job.validation = null;job.processingStatus='incomplete';
    if(writingSources && sourceWasCurrent){job.sourceKey=await sourceFingerprint(job,originalPaths);if(job.retainedWaveform)job.retainedWaveform.sourceKey=job.sourceKey;}
    job.staleSteps = failures.length ? job.staleSteps : (job.staleSteps || []).filter(step => step !== 'export');
    saveJobs();
  }
  res.status(written.length ? 200 : 500).json({ written, failures, error: failures.length ? failures.join('; ') : undefined });
  } finally { metadataWriteJobs.delete(job.id); }
}));

// Progress polling must not serialize covers and entire word timelines every second.
const activeExports = new Set<string>();
const activeExportMessages = new Map<string, string>();
app.get('/api/jobs/:id/export-progress', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Book not found.' });
  res.json({ running: activeExports.has(job.id), message: activeExportMessages.get(job.id), exports: job.exports || [], status: job.status });
});

// Step 4: Build Chaptered M4B (replicates app/m4b.py)
app.post('/api/jobs/:id/build-m4b', requireFeatures(['audio_export'], 'Audio export'), asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  const rejectExport = (status: number, message: string) => {
    appendOperationFailure(job?.id, 'Audio export', message);
    console.error(`[Audio export] ${message}`);
    return res.status(status).json({ error: message });
  };
  if (!job?.mergedMp3?.fullPath || job.status === 'draft') return rejectExport(400, 'Complete Step 1 first.');
  if (job.staleSteps?.some(step => step === 'chapter_detection' || step === 'chapter_review')) return rejectExport(409, 'Rerun and review chapter detection before exporting.');
  const preparedChapters = applyDefaultChapterEnds(job.chapters, job.totalDurationSeconds);
  const chapterError = validateChapterEntries(preparedChapters, job.totalDurationSeconds);
  if (chapterError) return rejectExport(400, `Fix chapter timestamps before exporting: ${chapterError}`);
  job.chapters = preparedChapters;
  if (step1TaskRunning) return rejectExport(409, 'Wait for source processing to complete.');
  if (activeExports.has(job.id)) return rejectExport(409, 'An export is already running.');
  activeExports.add(job.id);
  try {
  let exportSampleRateCeiling: number;
  try {
    const paths = job.parts.map(part => path.resolve(APP_ROOT, job.sourceFolderPath || '', part.name));
    if (archiveCurrent(job) && paths.some(file => !fs.existsSync(file))) return rejectExport(400, 'Original audio is in Originals.zip. Restore those audio files before creating another export.');
    if (job.sourceKey !== await sourceFingerprint(job, paths)) return rejectExport(409, 'Source audio changed. Run Step 1 again to refresh the transcript and review timeline.');
    // Also cap older, higher-rate cached masters against the original inputs.
    const rates: number[] = [];
    for (const file of paths) rates.push((await inspectAsync(getFfprobe(), file)).sampleRate);
    exportSampleRateCeiling = Math.min(...rates);
    if (!Number.isSafeInteger(exportSampleRateCeiling) || exportSampleRateCeiling <= 0) throw new Error('Cannot detect a valid source sample rate.');
  } catch (error: any) { return rejectExport(400, error.message); }
  if (job.exports?.some(e => e.status === 'running' || e.status === 'queued')) return rejectExport(409, 'An export is already running.');
  if (metadataWriteJobs.has(job.id)) return rejectExport(409, 'Wait for metadata to finish writing to the exported file.');
  if (req.body.zipOriginals !== undefined && typeof req.body.zipOriginals !== 'boolean') return rejectExport(400, 'Choose whether to zip original audio.');
  const requestedFormats = req.body.outputFormats ?? [req.body.outputFormat || 'm4b'];
  if (!Array.isArray(requestedFormats)) return rejectExport(400, 'Output formats must be a list.');
  const formats = [...new Set(requestedFormats)] as OutputAudioFormat[];
  if (!formats.length || formats.some(f => !outputFormats.includes(f))) return rejectExport(400, 'Select supported output formats.');
  if ((job.mergeMethod === 'skip' && job.parts.length > 1) || !fs.existsSync(job.mergedMp3.fullPath)) {
    const cacheMaster = path.join(projectIntermediatesDir(job), 'master.wav');
    if (job.mergeMethod !== 'skip' && pathKey(job.mergedMp3.fullPath) !== pathKey(cacheMaster)) return rejectExport(400, 'Prepared audio is missing. Run Step 1 again before exporting.');
    try {
      const sources = sourceFilePaths(job);
      const sourceMedia = sources.map(file => inspect(getFfprobe(), file));
      const method = job.mergeMethod === 'skip' && stitchCompatibility(sourceMedia.map(info => ({ ...info, isProbed: true }))).compatible ? 'quick' : 'standard';
      const prepared = await prepareMaster(getFfmpeg(), getFfprobe(), sources, projectIntermediatesDir(job), method,
        message => job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Rebuilding PCM for another export: ${message}` }));
      job.mergedMp3.fullPath = prepared.master;
      job.mergedMp3.duration = prepared.durations.reduce((sum, value) => sum + value, 0);
      job.mergedMp3.sizeBytes = fs.statSync(prepared.master).size;
      job.sourceCodec = inspect(getFfprobe(), prepared.master).codec;
      saveJobs();
    } catch (error: any) { return rejectExport(400, `Could not rebuild PCM for another export: ${error.message}`); }
  }
  try { validateChapters(job.chapters, job.totalDurationSeconds); } catch (error: any) { return rejectExport(400, error.message); }
  const outputDir = path.resolve(APP_ROOT, finalOutputRoot(job.outputFolderPath, currentOutputFolder));
  try { fs.mkdirSync(outputDir, { recursive: true }); fs.accessSync(outputDir, fs.constants.W_OK); }
  catch (error: any) { return rejectExport(400, 'Cannot write output folder: ' + error.message); }
  const previousExports = job.exports || [];
  const previousOutput = job.outputM4b;
  const previousValidation = job.validation;
  const snapshot = JSON.parse(JSON.stringify(job));
  const saveCoverBesideAudio = currentConfig.save_cover_beside_audio !== false;
  const exportPlan = planChapterExport(snapshot.chapters, job.totalDurationSeconds);
  // Record provenance at export time; later chapter edits cannot establish it.
  let playbackSource: Awaited<ReturnType<typeof buildBookPlaybackManifest>> | undefined;
  if (!exportPlan.trimmed) {
    try { playbackSource = await buildBookPlaybackManifest(snapshot, { sourcePaths: sourceFilePaths(snapshot), ffprobe: getFfprobe(), preferFinalized: false, inspect: (tool, file) => mediaCache.read(tool, file) }); }
    catch { /* Export can continue; listening positions will restart safely without provenance. */ }
  }

  let libraryParts: string[];
  try { libraryParts = libraryRelativePath(currentConfig.library_template || DEFAULT_LIBRARY_TEMPLATE, snapshot.metadata); }
  catch (error: any) { return rejectExport(400, error.message); }
  const desiredDir = path.resolve(outputDir, ...libraryParts);
  const relativeExportDir = path.relative(outputDir, desiredDir);
  if (relativeExportDir.startsWith('..') || path.isAbsolute(relativeExportDir)) return rejectExport(400, 'Folder pattern resolves outside the library.');
  const safeName = libraryParts[libraryParts.length - 1];
  // Prefer this project's prior export, then check the selected library path.
  const existingOutputs = new Map<OutputAudioFormat, string>();
  for (const format of formats) {
    const previous = previousExports.find(item => item.format === format && item.status === 'success' && item.fullPath && fs.existsSync(item.fullPath));
    const recordedPath = [job.exportedFiles?.[format], previous?.fullPath,
      previousOutput?.format === format ? previousOutput.fullPath : undefined,
      path.join(desiredDir, safeName + '.' + format)].map(file => file && path.resolve(file)).find(file => {
        if (!file || !fs.existsSync(file)) return false;
        const relative = path.relative(outputDir, file);
        return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.statSync(file).isFile();
      });
    if (!recordedPath) continue;
    existingOutputs.set(format, recordedPath);
  }
  const conflictPaths = [...existingOutputs.values()];
  if (conflictPaths.length && (req.body.overwriteExisting !== true ||
    JSON.stringify(req.body.confirmedOverwritePaths) !== JSON.stringify(conflictPaths))) {
    return res.status(409).json({ error: 'An exported audiobook already exists for this book.', requiresOverwriteConfirmation: true, existingFiles: conflictPaths });
  }
  job.outputM4b = null; job.validation = null;
  job.exports = formats.map(format => ({ format, status: 'queued', progress: 0 }));
  // New formats still get a new directory; existing formats keep their recorded paths.
  let exportDir = desiredDir;
  for (let copy = 2; fs.existsSync(exportDir); copy++) exportDir = `${desiredDir} (${copy})`;
  for (const item of job.exports) {
    const existingTarget = existingOutputs.get(item.format);
    let stagingDir: string | undefined;
    let temporaryCover: string | undefined;
    try {
      item.status = 'running'; saveJobs();
      stagingDir = existingTarget ? fs.mkdtempSync(path.join(path.dirname(existingTarget), '.swissmouse-export-')) : undefined;
      const destinationDir = stagingDir || exportDir;
      // Export the saved screen values, including defaults such as language.
      // Preserve unrelated source tags, but do not skip unchanged imported fields.
      const tags = audiobookTags(snapshot.metadata,undefined,snapshot.sourceTags,item.format);
      const lossy = !['flac','wav'].includes(item.format);
      const selectedRate = req.body.bitrates?.[item.format] ?? defaultBitrate(snapshot.sourceBitrate);
      if (lossy && !bitrateOptions.includes(Number(selectedRate) as any)) throw new Error('Unsupported bitrate selection');
      const encodingBitrate = req.body.bitrate || ((exportPlan.trimmed || req.body.convert === true || !canCopy(snapshot.sourceCodec,item.format)) && lossy ? selectedRate + 'k' : undefined);
      let cover: string | null | undefined;
      let coverPath: string | undefined;
      const coverUrl = snapshot.metadata?.cover?.url;
      if (coverUrl && saveCoverBesideAudio) {
        coverPath = await writeCoverImage(destinationDir, coverUrl, 'cover');
      }
      if (JSON.stringify(snapshot.metadata?.cover) !== JSON.stringify(snapshot.importedMetadata?.cover)) {
        cover = null;
        if (coverPath) cover = coverPath;
        else if (coverUrl) {
          temporaryCover = await writeCoverImage(projectIntermediatesDir(job), coverUrl, 'export-cover-' + randomUUID());
          cover = temporaryCover;
        }
      }
      fs.mkdirSync(destinationDir, { recursive: true });
      const output = path.join(destinationDir, existingTarget ? path.basename(existingTarget) : safeName + '.' + item.format);
      const result = await exportAudio({ ffmpeg: getFfmpeg(), ffprobe: getFfprobe(), source: snapshot.mergedMp3.fullPath, output, format: item.format, chapters: snapshot.chapters, tags, cover, convert: req.body.convert === true, bitrate: encodingBitrate, cue: req.body.cue !== false, sampleRateCeiling: exportSampleRateCeiling, onLog: message => { job.logs.push({timestamp:new Date().toISOString().replace('T',' ').slice(0,19),level:'INFO',message:`${item.format.toUpperCase()} export: ${message}`}); saveJobProgress(); }, onProgress: n => { item.progress = n; saveJobProgress(); } });
      if (existingTarget) {
        const replacements: { from?: string; to: string }[] = [{ from: output, to: existingTarget }, { from: fs.existsSync(output + '.cue') ? output + '.cue' : undefined, to: existingTarget + '.cue' }];
        if (coverPath) replacements.push({ from: coverPath, to: path.join(path.dirname(existingTarget), path.basename(coverPath)) });
        const backups: { backup: string; to: string }[] = [];
        const installed: string[] = [];
        try {
          for (const replacement of replacements) {
            if (fs.existsSync(replacement.to)) {
              const backup = replacement.to + '.' + randomUUID() + '.backup';
              fs.renameSync(replacement.to, backup);
              backups.push({ backup, to: replacement.to });
            }
            if (replacement.from) { fs.renameSync(replacement.from, replacement.to); installed.push(replacement.to); }
          }
        } catch (error) {
          for (const installedPath of installed.reverse()) fs.rmSync(installedPath, { force: true });
          for (const { backup, to } of backups.reverse()) fs.renameSync(backup, to);
          throw error;
        }
        for (const { backup } of backups) fs.rmSync(backup, { force: true });
        if (coverPath) coverPath = path.join(path.dirname(existingTarget), path.basename(coverPath));
        result.fullPath = existingTarget;
      }
      Object.assign(result, { fileIdentity: (await stamp(result.fullPath)).identity,
        ...(playbackSource && Math.abs(result.duration - playbackSource.manifest.totalDurationSeconds) <= 0.15
          ? { playbackSourceSignature: playbackSource.manifest.signature } : {}) });
      Object.assign(item, result, { coverPath, status: 'success' });
      if (coverPath) associateProjectFile(job, coverPath, 'cover');
      job.exportedFiles = { ...job.exportedFiles, [item.format]: result.fullPath };
      job.outputM4b = result;
      job.status = 'built';
      try {
        for (const file of writeAudiobookshelfJson({ ...job, metadata: snapshot.metadata, chapters: snapshot.chapters }, [result.fullPath])) associateProjectFile(job, file, 'metadata');
        if (fs.existsSync(result.fullPath + '.cue')) associateProjectFile(job, result.fullPath + '.cue', 'chapters');
      } catch (error: any) {
        item.warnings = [...(item.warnings || []), `Audiobook exported, but exmetadata.json could not be written: ${error.message}`];
        job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: item.warnings[item.warnings.length - 1] });
      }
      fs.rmSync(result.fullPath + '.ffmeta', { force: true });
    } catch (error: any) {
      item.status = 'failed'; item.error = error.message;
      console.error(`[Export ${item.format}] ${error.stack || error.message}`);
      job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `Audio export failed (${item.format.toUpperCase()}). ${error.message}` });
    } finally {
      if (temporaryCover) fs.rmSync(temporaryCover, { force: true });
      if (stagingDir) {
        try { fs.rmSync(stagingDir, { recursive: true, force: true }); }
        catch (error: any) { job.logs.push({ timestamp: new Date().toISOString(), level: 'WARNING', message: 'Export temporary folder retained: ' + error.message }); }
      }
    }
    saveJobs();
  }
  const succeeded = job.exports.some(item => item.status === 'success');
  const attemptedExports = job.exports;
  if (!succeeded && (previousOutput || previousExports.length)) {
    job.exports = previousExports;
    job.outputM4b = previousOutput;
    job.validation = previousValidation;
    saveJobs();
  }
  if (succeeded) job.staleSteps = (job.staleSteps || []).filter(step => step !== 'export');
  if (attemptedExports.length && attemptedExports.every(item => item.status === 'success') && (currentConfig.pcm_retention || 'after_verified_export') === 'after_verified_export') {
    try {
      for (const item of attemptedExports) {
        if (!item.fullPath || !fs.statSync(item.fullPath).isFile()) throw new Error('Export file is missing.');
        const checked = await inspectAsync(getFfprobe(), item.fullPath);
        if (Math.abs(checked.durationSeconds - exportPlan.durationSeconds) > 0.15) throw new Error('Export duration differs from the reviewed timeline.');
      }
      clearProjectPcm(job);
    } catch (error: any) {
      job.logs.push({ timestamp: new Date().toISOString(), level: 'WARNING', message: `PCM kept because export read-back verification did not pass: ${error.message}` });
    }
    saveJobs();
  }
  if (req.body.zipOriginals === true && attemptedExports.every(item => item.status === 'success')) {
    libraryMoveRunning = true;
    job.originalsArchiveError = undefined;
    try {
      // Establish sidecar ownership while source audio is still present. After
      // archiving removes it, a folder scan cannot safely infer those links.
      await backfillProjectCompanions(job);
      const outputs = new Set(exportedAudioPaths(job).map(pathKey));
      const originals = sourceFilePaths(job);
      if (originals.some(file => outputs.has(pathKey(file)))) throw new Error('An original is also a finished output. It was not archived or deleted.');
      const protectedFiles = new Set(jobs.filter(other => other.id !== job.id && !other.libraryScan?.superseded).flatMap(other => projectFilePaths(other)).map(pathKey));
      const { warning } = await archiveOriginals({ folder: path.dirname(job.outputM4b!.fullPath!), sourceKey: job.sourceKey!,
        sources: originals.map((source, index) => ({ source, name: sourceRelative(job, job.parts[index]) })), protectedFiles,
        journal: appPath('originals-archive-' + randomUUID() + '.json'),
        log: message => { activeExportMessages.set(job.id, message); job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message }); },
        commit: archive => {
          const previousArchive = job.originalsArchive, previousFiles = job.associatedFiles;
          job.originalsArchive = archive; associateProjectFile(job, archive.path, 'sidecar');
          try { saveJobs(); } catch (error) { job.originalsArchive = previousArchive; job.associatedFiles = previousFiles; throw error; }
        } });
      if (warning) job.originalsArchiveError = warning;
    } catch (error: any) {
      job.originalsArchiveError = error.message;
      job.logs.push({ timestamp: new Date().toISOString(), level: 'ERROR', message: 'Originals archive: ' + error.message });
    } finally { libraryMoveRunning = false; }
    saveJobs();
  }
  res.status(succeeded ? 200 : 500).json({ status: succeeded ? 'ok' : 'error', error: succeeded ? undefined : attemptedExports.map(item => item.error).join('; '), exports: attemptedExports, outputM4b: job.outputM4b });
  } finally {
    activeExports.delete(job.id);
    activeExportMessages.delete(job.id);
    // Setup, persistence and cleanup failures must never leave queued/running
    // records blocking every future conversion and library operation.
    const current = projectStore.get(job.id);
    const unfinished = current?.exports?.filter(item => ['running', 'queued'].includes(item.status)) || [];
    for (const item of unfinished) { item.status = 'failed'; item.error = 'Export stopped before completion. Check the technical log and retry.'; }
    if (unfinished.length) {
      try { projectStore.save(jobs); catalog?.invalidate(); }
      catch (error: any) { appendMasterEvent('Audio export', 'Could not persist stopped export: ' + error.message, 'ERROR'); }
    }
  }
}));

app.post('/api/jobs/:id/build-audio', requireFeatures(['audio_export'], 'Audio export'), (req, res) => {
  // Alias to build-m4b with format support
  const target = app._router.stack.find((layer: any) => layer.route?.path === '/api/jobs/:id/build-m4b');
  if (target) {
    return target.route.stack[target.route.stack.length - 1].handle(req, res);
  }
  res.status(500).json({ error: 'Route handler not found' });
});

// Final Check uses the same source-preserving audio inspection as processing.
const finalCheckRuns = new Map<string, { controller: AbortController; message: string; items: import('./src/types').FinalCheckItem[] }>();
function finalCheckFiles(job: AudiobookJob) {
  return job.outputM4b ? [...new Set(projectFiles(job, []).filter(file => file.roles.includes('output')).map(file => file.path))] : sourceFilePaths(job);
}
function currentFinalCheckSignature(job: AudiobookJob) {
  return finalCheckSignature(job, currentConfig, finalCheckFiles(job), availableOriginalPaths(job), [...(job.previewPath ? [job.previewPath, job.previewPath + '.analysis.json'] : []), ...(job.originalsArchive?.path ? [job.originalsArchive.path] : []), ...(job.retainedWaveform ? [job.retainedWaveform.audio + '.analysis.json'] : [])]);
}
app.get('/api/jobs/:id/final-check', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({error:'Book not found.'});
  const run = finalCheckRuns.get(job.id);
  res.json({ running:!!run, message:run?.message, items:run?.items, report:job.finalCheck,
    outdated:!!job.finalCheck && job.finalCheck.inputSignature !== currentFinalCheckSignature(job) });
});
app.post('/api/jobs/:id/final-check/cancel', (req, res) => {
  const run = finalCheckRuns.get(req.params.id);
  if (run) { run.message = 'Cancelling…'; run.controller.abort(); }
  res.json({status:'ok'});
});
app.post('/api/jobs/:id/final-check/repair', asyncRoute(async (req, res) => {
  const job=projectStore.get(req.params.id);
  if(!job) return res.status(404).json({error:'Book not found.'});
  if(libraryValidationRunning || step1TaskRunning || sourceImports.size || metadataWriteJobs.size || activeLibraryMutations>1 || jobs.some(item=>item.exports?.some(output=>['running','queued'].includes(output.status)))) return res.status(409).json({error:'Wait for current file operations to finish.'});
  if(!job.outputM4b) return res.status(400).json({error:'Convert into a dedicated book folder before repairing sidecars.'});
  const files=finalCheckFiles(job);
  metadataWriteJobs.add(job.id);
  try {
  if(req.body.kind==='sidecar') writeAudiobookshelfJson(job,files);
  else if(req.body.kind==='cover') {
    if(currentConfig.save_cover_beside_audio===false || !job.metadata?.cover?.url) return res.status(400).json({error:'Enable cover saving and select a cover in Metadata first.'});
    for(const folder of [...new Set(files.map(file=>path.dirname(file)))]) {
      assertSidecarOwnership(job,folder,jobs,sourceFilePaths,SUPPORTED_AUDIO_EXTENSIONS);
      if(['cover.jpg','cover.png'].some(name=>{try{return fs.statSync(path.join(folder,name)).size>0;}catch{return false;}})) continue;
      associateProjectFile(job,await writeCoverImage(folder,job.metadata.cover.url,'cover'),'cover');
    }
  } else return res.status(400).json({error:'Unsupported repair. Return to Metadata, Chapters, or Processing.'});
  job.processingStatus='incomplete'; saveJobs();
  res.json({status:'ok'});
  } finally { metadataWriteJobs.delete(job.id); }
}));
type FinishLocation = 'current' | 'inbox' | 'library';
function assertFinishReady(job: AudiobookJob) {
  if (!job.finalCheck || job.finalCheck.state !== 'complete' || job.finalCheck.items.some(item => item.status === 'failed') || job.finalCheck.inputSignature !== currentFinalCheckSignature(job)) throw new Error('Run a current Final Check and fix required items before finishing.');
}
function finishPlan(job: AudiobookJob, location: FinishLocation) {
  assertFinishReady(job);
  if (location === 'current') return { location, target: bookSourceRoot(job) || path.dirname(job.outputM4b?.fullPath || ''), alreadyOrganized: true, conflict: false, files: projectFilePaths(job) };
  const root = path.resolve(location === 'inbox' ? currentConfig.inbox_folder || appPath('inbox') : currentOutputFolder);
  const target = path.resolve(root, ...libraryRelativePath(currentConfig.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata!));
  if (!isManagedChild(root,target)) throw new Error('The folder pattern resolves outside the configured location.');
  const sourceRoot = bookSourceRoot(job);
  const folders = [...new Set(projectFilePaths(job).filter(file => fs.existsSync(file)).map(file => path.dirname(file)))];
  const alreadyOrganized = !!sourceRoot && pathKey(sourceRoot) === pathKey(target) && folders.every(folder => pathKey(folder) === pathKey(target) || within(target,folder));
  return { location, root, target, alreadyOrganized, conflict: !alreadyOrganized && pathEntryExists(target), files: projectFilePaths(job) };
}
app.get('/api/jobs/:id/finish', asyncRoute(async (req,res) => {
  const job=projectStore.get(req.params.id);if(!job)return res.status(404).json({error:'Book not found.'});
  const location=req.query.location as FinishLocation;
  if(!['current','inbox','library'].includes(location))return res.status(400).json({error:'Choose a finish location.'});
  try{const plan=finishPlan(job,location);if(location==='library'&&plan.conflict&&await ownedProjectDestination(job,plan.target))plan.conflict=false;res.json(plan);}catch(error:any){res.status(409).json({error:error.message});}
}));
app.post('/api/jobs/:id/finish', asyncRoute(async(req,res)=>{
  const job=projectStore.get(req.params.id);if(!job)return res.status(404).json({error:'Book not found.'});
  const location=req.body.location as FinishLocation;
  if(!['current','inbox','library'].includes(location))return res.status(400).json({error:'Choose a finish location.'});
  if(activeLibraryMutations>1 || step1TaskRunning || sourceImports.size || metadataWriteJobs.size || jobs.some(item=>item.exports?.some(output=>['running','queued'].includes(output.status))))return res.status(409).json({error:'Wait for current file operations to finish.'});
  try {
    const plan=finishPlan(job,location);
    if(plan.target!==req.body.target) return res.status(409).json({error:'The destination changed. Review the location again.'});
    if(plan.conflict && !(location==='library' && await ownedProjectDestination(job,plan.target))) return res.status(409).json({error:'Destination already exists; existing files were kept.'});
    libraryMoveRunning=true;
    let warning:string|undefined;
    job.processingStatus='complete';job.completionSignature=await completionSignature(job);
    if(location!=='current'&&!plan.alreadyOrganized) {
      warning=await transferAssociatedProject(job,plan.target,'move',{finalCheck:true,destinationRoot:plan.root,destinationKind:location==='inbox'?'inbox':'managed'});
    }
    // Only disposable SwissMouse PCM is removed. Analysis levels and transcript
    // state remain in the project's processing workspace for later use.
    const clearedBytes=clearProjectPcm(job);
    job.finishedAt=new Date().toISOString();job.finishLocation=location;job.importFinished=true;
    job.lastCompletedAt=job.finishedAt;
    job.completionSignature=await completionSignature(job);
    if(job.finalCheck){job.finalCheck.inputSignature=currentFinalCheckSignature(job);}
    job.logs.push({timestamp:job.finishedAt,level:'INFO',message:`Finished in ${location}; cleared ${clearedBytes} bytes of temporary PCM. Waveform and transcript retained.`});
    saveJobs();await catalog!.publish([job.id]);
    res.json({job:{...job,canMoveToLibrary:canMoveInboxBook(job)},warning,clearedBytes,path:plan.target});
  }catch(error:any){res.status(409).json({error:error.message||'Could not finish. Original files were kept if transfer verification failed.'});}
  finally{libraryMoveRunning=false;}
}));
app.post('/api/jobs/:id/validate', requireFeatures(['audio_processing'], 'Final check'), asyncRoute(async (req, res) => {
  const job=projectStore.get(req.params.id);
  if(!job) return res.status(404).json({error:'Book not found.'});
  if(libraryValidationRunning || activeLibraryMutations>1 || sourceImports.size || step1TaskRunning || metadataWriteJobs.size || jobs.some(item=>item.exports?.some(output=>['running','queued'].includes(output.status)))) return res.status(409).json({error:'Wait for current file operations before the final check.'});
  const run={controller:new AbortController(),message:'Starting final check…',items:[] as import('./src/types').FinalCheckItem[]};
  finalCheckRuns.set(job.id,run); libraryValidationRunning=true; job.processingStatus='incomplete';
  const initialSignature=currentFinalCheckSignature(job);
  try {
    const snapshot=cloneProject(job);
    const report=await runFinalCheck({job:snapshot,config:{...currentConfig},files:finalCheckFiles(job),originals:availableOriginalPaths(job),artifacts:{},ffmpeg:getFfmpeg(),ffprobe:getFfprobe(),signal:run.controller.signal,
      progress:(message,items)=>{run.message=message;run.items=[...items];} });
    if(initialSignature!==currentFinalCheckSignature(job)) report.items.push({id:'changed',label:'Files or settings changed',status:'failed',detail:'Inputs changed while checking. Save your work and run Final Check again.'});
    job.finalCheck=report;
    job.validations=report.files.map(file=>{
      const index=finalCheckFiles(job).indexOf(file.file);
      const failures=report.items.filter(item=>item.status==='failed' && (item.id.startsWith(`file-${index}-`) || !item.id.startsWith('file-')));
      return {file:file.file,size_mb:Number(((fs.existsSync(file.file)?fs.statSync(file.file).size:0)/1048576).toFixed(2)),duration_seconds:file.duration,chapters_count:file.chapters,status:failures.length?'FAIL' as const:'PASS' as const,reason:failures.map(item=>item.detail).join('\n') || 'Full decoding, timestamps, metadata, chapters, sidecars and duration checked. Player navigation has not been tested.'};
    });
    const failed=report.items.some(item=>item.status==='failed');
    const summary=job.validations.find(item=>item.status==='FAIL') || job.validations[job.validations.length-1] || {file:job.name,size_mb:0,duration_seconds:report.expectedDuration,chapters_count:job.chapters.length,status:'FAIL' as const,reason:'No readable audio files.'};
    job.validation={...summary,file:job.outputM4b?.filename || summary.file,status:failed?'FAIL':summary.status};
    let {status,reason}=job.validation;
    if(job.outputM4b) {
  job.status = status === 'FAIL' ? 'built' : 'validated';
  if (status !== 'FAIL') job.staleSteps = (job.staleSteps || []).filter(step => step !== 'validation');
  job.processingStatus = 'incomplete';
  if (status === 'PASS' && !(job.staleSteps || []).some(step => ['export', 'chapter_review', 'chapter_detection'].includes(step))) {
    try {
      if (job.sourceKey && !archiveCurrent(job) && job.sourceKey !== await sourceFingerprint(job, sourceFilePaths(job))) throw new Error('Source audio changed since processing. Run Step 1 and export again before finalizing.');
      job.completionSignature = await completionSignature(job);
      job.processingStatus = 'complete';
      job.lastCompletedAt = new Date().toISOString();
      appendMasterEvent('Library', `Processing status changed to complete: ${job.name}`);
    } catch (error: any) {
      status = 'FAIL'; reason = error.message; job.validation.status = status; job.validation.reason = reason; job.status = 'built';
      report.items.push({id:'completion',label:'Source identity',status:'failed',detail:error.message,fix:'processing'});
      appendOperationFailure(job.id, 'Completion', error.message);
    }
  }
  if (job.processingStatus === 'complete' && currentConfig.pcm_retention === 'until_finalized') {
    try { clearProjectPcm(job); }
    catch (error: any) { job.logs.push({ timestamp: new Date().toISOString(), level: 'WARNING', message: `PCM cleanup did not finish: ${error.message}` }); }
  }

    } else { job.processingStatus='incomplete'; }
    // Cleanup can remove preview PCM. Stamp the final filesystem state, so the
    // successful check does not invalidate itself immediately after cleanup.
    if ((!job.previewPath || !fs.existsSync(job.previewPath)) && !job.retainedWaveform) { const waveform=report.items.find(item=>item.id==='waveform'); if(waveform) {waveform.status='optional';waveform.detail='Waveform cache is unavailable or was cleared by your storage setting.';} }
    report.inputSignature=currentFinalCheckSignature(job);
    job.logs.push({timestamp:new Date().toISOString(),level:job.validation.status==='FAIL'?'ERROR':'INFO',message:`Final Check: ${job.validation.status}. ${report.files.length} audio files, ${report.removedSeconds.toFixed(3)} seconds intentionally cut.`});
    saveJobs(); await catalog!.publish([job.id]);
    res.json({status:'ok',validation:job.validation,validations:job.validations,finalCheck:job.finalCheck});
  } catch(error:any) {
    if(run.controller.signal.aborted) {
      job.finalCheck={checkedAt:new Date().toISOString(),inputSignature:initialSignature,state:'cancelled',items:run.items,files:[],sourceDuration:job.totalDurationSeconds,expectedDuration:job.totalDurationSeconds,removedSeconds:0};
      job.processingStatus='incomplete';saveJobs();return res.json({status:'cancelled'});
    }
    job.finalCheck={checkedAt:new Date().toISOString(),inputSignature:initialSignature,state:'complete',items:[...run.items,{id:'check-error',label:'Check could not finish',status:'failed',detail:error.message,fix:'processing'}],files:[],sourceDuration:job.totalDurationSeconds,expectedDuration:job.totalDurationSeconds,removedSeconds:0};
    job.processingStatus='incomplete'; saveJobs();
    res.status(500).json({error:error.message});
  } finally { finalCheckRuns.delete(job.id);libraryValidationRunning=false; }
}));

app.post('/api/jobs/:id/export/open-folder', asyncRoute(async (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Project not found.' });
  const exportedFile = job.outputM4b?.fullPath || (job.outputM4b?.filename
    ? path.join(job.outputFolderPath || currentOutputFolder, job.outputM4b.filename)
    : undefined);
  if (!job.validation || !exportedFile || job.validation.file !== job.outputM4b?.filename) {
    return res.status(400).json({ error: 'Complete the final check before opening the export folder.' });
  }
  let directory: string;
  try {
    if (!fs.statSync(exportedFile).isFile()) throw new Error('Export is not a file.');
    directory = path.dirname(fs.realpathSync(exportedFile));
  } catch {
    return res.status(404).json({ error: 'The exported file is no longer at its saved location.' });
  }
  try { await launchFolder(directory); res.json({ status: 'ok', directory }); }
  catch (error: any) { res.status(500).json({ error: `Could not open the folder: ${error.message}` }); }
}));

// Global storage cleanup. These actions only touch SwissMouse-managed folders.
app.post('/api/cleanup', (req, res) => {
  if (cleanupBusyResponse(res)) return;
  const { cleanupType, confirmation } = req.body || {};

  try {
    if (['pcm', 'completed-temp', 'all-temp'].includes(cleanupType)) {
      let removedBytes = 0;
      for (const job of jobs) {
        if (cleanupType === 'completed-temp' && job.processingStatus !== 'complete') continue;
        removedBytes += clearProjectPcm(job);
        if (cleanupType !== 'pcm') {
          const root = projectIntermediatesDir(job);
          if (fs.existsSync(root) && pathKey(fs.realpathSync(root)) === pathKey(root))
            for (const entry of fs.readdirSync(root, { withFileTypes: true }))
              if (entry.isFile() && !entry.isSymbolicLink() && (entry.name === 'concat.txt' || /^analysis\.wav\.analysis\.json\.tmp-[0-9a-f-]{36}$/i.test(entry.name))) {
                const file = path.join(root, entry.name);
                removedBytes += fs.statSync(file).size; fs.unlinkSync(file);
              }
        }
      }
      saveJobs();
      return res.json({ status: 'ok', message: `Cleared ${(removedBytes / 1024 ** 3).toFixed(2)} GB of known processing files. Source audio, exports, transcripts, and book state remain.`, jobs, storage: processingStorage() });
    }
    if (cleanupType === 'cache') {
      const removed = clearManagedDirectory(appPath('.cache'));
      fs.mkdirSync(appPath('.cache', 'work'), { recursive: true });
      return res.json({ status: 'ok', message: `Cache cleared${removed ? ` (${removed} item${removed === 1 ? '' : 's'} removed)` : ''}.`, jobs });
    }

    if (cleanupType === 'logs') {
      const removed = clearManagedDirectory(appPath('logs'));
      return res.json({ status: 'ok', message: `Saved technical logs cleared${removed ? ` (${removed} item${removed === 1 ? '' : 's'} removed)` : ''}.`, jobs });
    }

    if (cleanupType === 'orphans') {
      const removed = removeOrphanedProjectFolders();
      return res.json({
        status: 'ok',
        message: removed ? `Removed ${removed} orphaned working folder${removed === 1 ? '' : 's'}.` : 'No orphaned project files were found.',
        jobs,
      });
    }

    if (cleanupType === 'all-working') {
      if (confirmation !== 'CLEAR ALL WORKING FILES') {
        return res.status(400).json({ error: "Confirmation mismatch. Type 'CLEAR ALL WORKING FILES' exactly to continue." });
      }
      let removed = clearManagedDirectory(uploadDir) + clearManagedDirectory(appPath('audiobooks'));
      for (const root of knownIntermediatesRoots()) removed += clearManagedDirectory(root);
      removed += clearManagedDirectory(appPath('.cache'));
      fs.mkdirSync(appPath('.cache', 'work'), { recursive: true });
      for (const job of jobs) {
        resetImportedJobState(job);
        job.logs.push({
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          level: 'WARNING',
          message: 'All managed source copies and generated working files were removed with Free up space. Book details, chapter edits, and finished exports were kept.',
        });
      }
      saveJobs();
      return res.json({ status: 'ok', message: `All working files and cache were cleared${removed ? ` (${removed} item${removed === 1 ? '' : 's'} removed)` : ''}.`, jobs });
    }

    return res.status(400).json({ error: 'Unknown cleanup option.' });
  } catch (error: any) {
    return res.status(500).json({ error: `Cleanup could not be completed: ${error.message}` });
  }
});

// Cleanup files for one saved book.
app.post('/api/jobs/:id/purge', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (cleanupBusyResponse(res)) return;

  const { purgeType, confirmation } = req.body;
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  try {
  if (purgeType === 'source') {
    const requiredPhrase = `PURGE ${job.name}`;
    if (confirmation !== requiredPhrase) {
      return res.status(400).json({
        error: `Confirmation mismatch. Type '${requiredPhrase}' exactly to remove this book's source copies.`,
      });
    }

    const removed = removeProjectManagedFiles(job, true);
    resetImportedJobState(job);
    job.logs.push({
      timestamp: now(),
      level: 'WARNING',
      message: 'Managed source copies and generated working files were removed. Original source files, book details, chapter edits, and finished exports were kept.',
    });
    saveJobs();

    return res.json({ status: 'ok', message: `Working files for ${job.name} were removed${removed ? ` (${removed} folder${removed === 1 ? '' : 's'})` : ''}.`, jobs });
  }

  if (purgeType === 'intermediate') {
    const removed = removeProjectManagedFiles(job, false);
    resetGeneratedJobState(job);
    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: 'Generated audio and transcript files were removed. Imported source copies were kept.',
    });
    saveJobs();
    return res.json({ status: 'ok', message: removed ? 'Generated files for this book were removed.' : 'No generated files were found for this book.', jobs });
  }

  if (purgeType === 'temp') {
    const removed = removeProjectTemporaryFiles(job);
    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: removed ? `Removed ${removed} temporary processing item${removed === 1 ? '' : 's'}.` : 'Temporary file cleanup completed; no disposable files were found.',
    });
    saveJobs();
    return res.json({ status: 'ok', message: removed ? `Removed ${removed} temporary item${removed === 1 ? '' : 's'} for this book.` : 'No temporary files were found for this book.', jobs });
  }

  return res.status(400).json({ error: 'Unknown book cleanup option.' });
  } catch (error: any) {
    return res.status(500).json({ error: `Cleanup could not be completed: ${error.message}` });
  }
});

// Export CSV / FFMETA endpoints
app.get('/api/jobs/:id/export/candidates-csv', (req, res) => {
  const job = projectStore.get(req.params.id);
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
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).send('Job not found');

  let csv = 'start,end,title\n';
  for (const chap of job.chapters) {
    const escapeCsv = (val: string = '') => `"${val.replace(/"/g, '""')}"`;
    csv += `${escapeCsv(chap.start)},${escapeCsv(chap.end || '')},${escapeCsv(chap.title)}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}-chapters.csv"`);
  res.send(csv);
});

app.get('/api/jobs/:id/export/ffmeta', (req, res) => {
  const job = projectStore.get(req.params.id);
  if (!job) return res.status(404).send('Job not found');

  const ffmeta = generateFFMetaContent(job.chapters, job.totalDurationSeconds);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}.ffmeta"`);
  res.send(ffmeta);
});

// Import CSV into chapters
app.post('/api/jobs/:id/import/chapters-csv', (req, res) => {
  const job = projectStore.get(req.params.id);
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
  const headers = parseCsvRow(lines[0]).map(value => value.toLowerCase());
  const startIndex = headers.indexOf('start');
  const endIndex = headers.indexOf('end');
  const titleIndex = headers.indexOf('title');
  if (startIndex < 0 || titleIndex < 0) return res.status(400).json({ error: 'CSV headers must include start and title.' });
  // Parse CSV
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvRow(lines[i]);
    const start = values[startIndex]?.trim() || '';
    const title = values[titleIndex]?.trim() || '';
    const end = endIndex >= 0 ? values[endIndex]?.trim() || '' : undefined;
    newChapters.push({
      id: `imported-${i}`,
      start,
      ...(end !== undefined ? { end, endManuallyEdited: !!end } : {}),
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

  const importedChapters = applyDefaultChapterEnds(newChapters, job.totalDurationSeconds);
  const chapterError = validateChapterEntries(importedChapters, job.totalDurationSeconds);
  if (chapterError) return res.status(400).json({ error: chapterError });
  job.chapters = importedChapters;
  job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds);
  res.json({ status: 'ok', chapters: job.chapters });
});

// ----------------------------------------------------
// Vite Middleware / Static Server
// ----------------------------------------------------
app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  appendMasterEvent('Request failure', error.message || String(error), 'ERROR');
  res.status(500).json({ error: error.message || 'The operation could not be saved. Please retry.' });
});

async function startServer() {
  await recoverBookFilesOperations(APP_ROOT, [path.resolve(currentConfig.inbox_folder || appPath('inbox')), currentOutputFolder], jobs, message => appendMasterEvent('Book Files recovery', message, 'WARNING'), (job, files) => { removeSourceMembership(job, files); persistJobsAtomically(); });

  await refreshRuntimeSelection();
  for (const name of fs.readdirSync(APP_ROOT).filter(name => /^originals-archive-[\w-]+\.json$/.test(name))) {
    try { await restoreArchivedSources(appPath(name)); appendMasterEvent('Originals archive', 'Interrupted original cleanup recovered: ' + name, 'WARNING'); }
    catch (error: any) { appendMasterEvent('Originals archive', 'Original audio recovery needs attention: ' + name + ': ' + error.message, 'ERROR'); }
  }
  for (const name of fs.readdirSync(APP_ROOT).filter(name => /^library-organize-[\w-]+\.json$/.test(name))) {
    try {
      const entry = JSON.parse(fs.readFileSync(appPath(name), 'utf8')) as { id: string; source: string; target: string; stage: string; folder: boolean; finishedOnly?: boolean };
      const root = path.resolve(currentOutputFolder);
      if (![entry.source, entry.target, entry.stage].every(value => typeof value === 'string' && within(root, value)) ||
          !path.basename(entry.stage).startsWith('.swissmouse-')) throw new Error('Organize recovery paths need manual review.');
      const job = projectStore.get(entry.id);
      if (!job) throw new Error('The saved book record is missing. Files were retained.');
      const committedPath = entry.folder ? entry.target : path.join(entry.target, path.basename(entry.source));
      const savedPaths = (entry.finishedOnly ? [job.outputM4b?.fullPath, ...Object.values(job.exportedFiles || {}),
        ...(job.exports || []).filter(output => output.format === 'm4b' && output.status === 'success').map(output => output.fullPath)] : [job.source?.path])
        .filter((file): file is string => typeof file === 'string');
      if (savedPaths.some(file => pathKey(file) === pathKey(committedPath))) {
        if (fs.existsSync(entry.stage)) throw new Error(`The saved move is complete, but ${entry.stage} also exists. Review both copies.`);
        fs.unlinkSync(appPath(name));
        continue;
      }
      if (!savedPaths.some(file => pathKey(file) === pathKey(entry.source))) throw new Error('The saved source differs from this move. Files were retained.');
      const nested = entry.folder && within(entry.source, entry.target);
      if (fs.existsSync(entry.source) && !nested) throw new Error('The original source exists. Any additional move files need manual review.');
      if (fs.existsSync(entry.stage)) {
        if (nested) removeOrganizeScaffold(entry.source, entry.target);
        fs.renameSync(entry.stage, entry.source);
      } else if (fs.existsSync(committedPath)) {
        if (nested) {
          fs.renameSync(committedPath, entry.stage);
          removeOrganizeScaffold(entry.source, entry.target);
          fs.renameSync(entry.stage, entry.source);
        } else fs.renameSync(committedPath, entry.source);
      }
      else throw new Error('Neither the temporary nor destination file is available.');
      fs.unlinkSync(appPath(name));
      appendMasterEvent('Library organize', `Interrupted move restored to ${entry.source}.`, 'WARNING');
    } catch (error: any) { appendMasterEvent('Library organize', `Move recovery needs attention: ${name}: ${error.message}`, 'ERROR'); }
  }
  // Recover interrupted path commits before scanning either root. Keep verified
  // copies for recovery instead of guessing which files can be discarded.
  for (const name of fs.readdirSync(APP_ROOT).filter(name => /^library-move-[\w-]+\.json$/.test(name))) {
    try {
      const entry = JSON.parse(fs.readFileSync(appPath(name), 'utf8'));
      if (entry.version === 2) {
        const recoveryRoot = entry.destinationRoot || currentOutputFolder;
        if (![currentOutputFolder, currentConfig.inbox_folder || appPath('inbox')].some(root => pathKey(root) === pathKey(recoveryRoot)) || !within(recoveryRoot, entry.target) || !Array.isArray(entry.entries)) throw new Error('Transfer recovery paths need manual review.');
        const job = projectStore.get(entry.id);
        if (entry.pending) {
          const { source, quarantine } = entry.pending;
          if (!entry.entries.some((file: MoveEntry) => pathKey(file.source) === pathKey(source)) ||
            path.dirname(source) !== path.dirname(quarantine) || !/^\.swissmouse-[a-f0-9-]+\.moved$/.test(path.basename(quarantine))) throw new Error('Unsafe recovery file.');
          if (fs.existsSync(quarantine)) {
            await assertUnlinked(quarantine);
            // link is exclusive: a newly created original must never be overwritten.
            fs.linkSync(quarantine, source); fs.unlinkSync(quarantine);
            appendMasterEvent('Library move', `Interrupted cleanup restored original: ${source}`, 'WARNING');
          }
        }
        const committed = !!job && (entry.reusedTarget ? job.source?.kind === 'managed' && (pathKey(job.source.path) === pathKey(entry.target) || within(entry.target, job.source.path)) : entry.entries.some((file: MoveEntry) => projectFilePaths(job).some(saved => pathKey(saved) === pathKey(path.join(entry.target, file.name)))));
        if (!committed && fs.existsSync(entry.target)) {
          if (!job || pathKey(job.source?.path || job.sourceFolderPath || '') !== pathKey(entry.source)) throw new Error('Project changed; transfer copies retained for review.');
          if (!Array.isArray(entry.copied)) throw new Error('Interrupted transfer lacks file ownership evidence. Originals and destination files retained for manual review.');
          const recovery = await recoverTransferCopies(entry.target, entry.copied);
          appendMasterEvent('Library move', `Interrupted transfer: originals retained; associated copies saved at ${recovery || entry.target}. Unrelated or changed destination files stay in place.`, 'WARNING');
        } else if (committed) appendMasterEvent('Library move', `Recovered Library transfer for ${job!.name}; remaining originals retained. No automatic source deletion.`, 'WARNING');
        fs.unlinkSync(appPath(name));
        continue;
      }
      if (!within(currentConfig.inbox_folder || appPath('inbox'), entry.source) || !within(currentOutputFolder, entry.target) || path.dirname(entry.source) !== path.dirname(entry.quarantine) || !path.basename(entry.quarantine).startsWith('.swissmouse-')) throw new Error('Move recovery paths need manual review.');
      const job = projectStore.get(entry.id);
      const committed = job?.source && (pathKey(job.source.path) === pathKey(entry.target) || within(entry.target, job.source.path));
      if (!committed) {
        if (!job || pathKey(job.source?.path || job.sourceFolderPath || '') !== pathKey(entry.source)) throw new Error('Saved project no longer matches this move; recovery copies were retained.');
        if (fs.existsSync(entry.quarantine) && fs.existsSync(entry.source)) throw new Error(`Both the Inbox path and recovery copy exist. Review ${entry.quarantine} before cleanup.`);
        if (fs.existsSync(entry.quarantine) && !fs.existsSync(entry.source)) fs.renameSync(entry.quarantine, entry.source);
        if (fs.existsSync(entry.target)) {
          const recovery = path.join(path.dirname(entry.target), `.swissmouse-recovered-${randomUUID()}`);
          fs.renameSync(entry.target, recovery);
          appendMasterEvent('Library move', `Interrupted move restored to Inbox. Verified copy retained for recovery: ${recovery}`, 'WARNING');
        }
        fs.unlinkSync(appPath(name));
      } else appendMasterEvent('Library move', `Completed move recovered. Any residual copy is retained at ${entry.quarantine}`, 'WARNING');
    } catch (error: any) { appendMasterEvent('Library move', `Move recovery needs attention: ${name}: ${error.message}`, 'ERROR'); }
  }
  void reconcileLibrary().catch(error => appendMasterEvent('Library', `Startup scan failed: ${error.message}`, 'ERROR'));
  const initialThemes = scanCustomThemes();
  console.log(`[Themes] Loaded ${initialThemes.themes.length} custom theme(s) from ${CUSTOM_THEMES_DIR}.`);
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
    if (process.env.SWISSMOUSE_OPEN_BROWSER === '1') {
      setTimeout(() => {
        exec(`start "" "http://127.0.0.1:${PORT}"`, { shell: 'cmd.exe', windowsHide: true }, error => {
          if (error) console.error(`[Startup] Could not open the browser: ${error.message}`);
        });
      }, 300);
    }
  });
}

startServer();
