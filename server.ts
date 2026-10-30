import { createAudiobookProjectService } from './packages/audiobooks/src/backend';
import { createAudiobookCompletionBackend,type AudiobookCompletionBackend } from './packages/audiobooks/src/completion-backend';
import { createAudiobookCompletionState } from './packages/audiobooks/src/completion-ports';
import { createAudiobookFileBackend,type AudiobookFileBackend } from './packages/audiobooks/src/file-backend';
import { createAudiobookFileState } from './packages/audiobooks/src/file-ports';
import { createAudiobookProcessingBackend } from './packages/audiobooks/src/processing-backend';
import { createAudiobookProcessingState } from './packages/audiobooks/src/processing-state';
import { audiobookCompletionRoute } from './tools/audiobook-completion-route';
import { audiobookFileRoute } from './tools/audiobook-file-route';
import { registerAudiobookProjectRoutes } from './tools/audiobook-project-routes';
import { finalCheckSignature,runFinalCheck } from './tools/final-check';
import { registerInformationPreviewRoutes } from './tools/information-preview-routes';
import { prepareSeriesSelection, registerInformationDirectoryRoutes } from './tools/information-directory-routes';
import type { SelectionCommit } from './packages/sdk/suggestions';
// Copyright (C) 2026 SwissMouse contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import AdmZip from 'adm-zip';
import { exec,execFile,execFileSync,spawn } from 'child_process';
import cors from 'cors';
import { createHash,randomUUID } from 'crypto';
import express from 'express';
import fs from 'fs';
import https from 'https';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { outputFormats,stitchCompatibility } from './src/audioFormats';
import { type BackendCapabilities,type TranscriptionBackend } from './src/transcription';
import type { AudiobookJob,BaseRequirementItem,HardwareEnvironmentInfo,HardwareInfo,InstallRepairProgress,LibraryBook,RequirementsReport,SpeechModelInfo,WorkbenchConfig,YtDlpStatusInfo,YtDlpStatusState } from './src/types';
import { DEFAULT_LIBRARY_TEMPLATE,validateLibraryTemplate } from './src/utils/libraryPath';
import { cleanQuickTags,QUICK_ADD_CATEGORIES } from './src/utils/metadataQuickAdd';
import { asyncRoute } from './tools/api-route';
import { readAppearance,saveAppearance,validThemeId } from './tools/appearance-preferences';
import { ensureAnalysis,rebuildAnalysis,retainWaveform,waveformSlice } from './tools/audio-analysis';
import { exportAudio,fingerprint,inspect,inspectAsync,makePreview,validateChapters,writeAudioMetadata } from './tools/audio-engine';
import { envelopeConfidence,sampledEnvelope } from './tools/audio-match';
import { recoverBookFilesOperations,registerBookFilesRoutes } from './tools/book-files-routes';
import { buildBookPlaybackManifest } from './tools/book-playback';
import { createBookFolder,listBookDirectory,listBookTree,moveBookFiles,rebaseBookMembership,resolveBookAudio } from './tools/book-source-browser';
import { catalogArchiveCurrent,findAvailableM4b } from './tools/catalog-availability';
import { projectCatalogRecord } from './tools/catalog-projection';
import { isReadOnlyCatalogRequest,registerCatalogRoutes } from './tools/catalog-routes';
import { CatalogService } from './tools/catalog-service';
import { parseChapterFile } from './tools/chapter-file';
import { recheckChapterWindows,recoveryWindows } from './tools/chapter-recovery';
import { discoverCustomThemes,isSafeThemeAssetName } from './tools/custom-themes';
import { DurableProjectStore } from './tools/durable-project-store';
import { existingChapterList } from './tools/existing-chapters';
import type { FeatureId } from './tools/feature-dependencies';
import { missingDependencies,missingRequirementsTooltip } from './tools/feature-dependencies';
import { installFfmpegDistribution } from './tools/ffmpeg-distribution';
import { IMPROVED_DETECTOR_VERSION,mergeDetectionSuggestions,reconcileSources,sourceBoundaries,structuralSuggestions } from './tools/improved-chapter-detection';
import { assertUnlinked,contentHash,fileSignature,identifyBook,inventory,pathKey,scanRoot,stamp,within } from './tools/library-filesystem';
import { findBookMatches,pairKey,type MatchBook } from './tools/library-matches';
import { LibraryMediaReader } from './tools/library-media';
import { recoverRelocatedOutput } from './tools/library-output-recovery';
import { mountLibriVox } from './tools/librivox-import';
import { ListeningStore } from './tools/listening-store';
import { MediaCache } from './tools/media-cache';
import { detectMusicTransitions,MUSIC_DETECTOR_VERSION } from './tools/music-transitions';
import { pickAudioFile,pickAudioFiles,pickAudioFolder } from './tools/native-file-picker';
import { openFolderInForeground } from './tools/native-folder-opener';
import { archiveOriginals,restoreArchivedSources } from './tools/originals-archive';
import { PACKAGE_STATUS_SCRIPT } from './tools/package-status';
import { registerPlaybackRoutes } from './tools/playback-routes';
import { assertSidecarOwnership,projectFiles } from './tools/project-files';
import { cloneProject } from './tools/project-store';
import { recoverTransferCopies,transferProjectFiles } from './tools/project-transfer';
import { evaluateRequirementReadiness,parseNvidiaCudaVersion,pytorchBuildOptions,pytorchInstallPlan,selectedMissingRequirements } from './tools/requirements';
import { assertManagedTarget,cleanPythonEnv,discoverRuntime,optionalPackages,optionalRemoval,PRIVATE_UNINSTALL_CHECK,removalImpact,type RuntimeSelection } from './tools/runtime-selection';
import { mapScanWork } from './tools/scan-work';
import { prepareMaster,sourceReviewPreview } from './tools/source-audio';
import { StatusCache } from './tools/status-cache';
import { detectTitleBoundaries,TITLE_DETECTOR_VERSION } from './tools/title-boundaries';
import { probeBackendCapabilities } from './tools/transcription-capabilities';
import { PYTHON_DLL_SETUP,transcribeWithFallback,transcriptionEngines,type TranscriptionEngineId } from './tools/transcription-engine';
import { downloadYoutubeAudio,youtubeBaseArgs,youtubeUrl } from './tools/youtube-audio';
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

const app = express();
if(process.env.SWISSMOUSE_MODULE_CHILD_TOKEN){
  if(process.env.SWISSMOUSE_HOST_API!=='2')throw new Error('This full Audiobook package requires host protocol 2.');
  app.use((req,res,next)=>{if(req.get('x-swissmouse-module-token')!==process.env.SWISSMOUSE_MODULE_CHILD_TOKEN)return res.status(403).json({error:'Use the owning SwissMouse host.'});next();});
}
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

const audiobookFileState = createAudiobookFileState();
const audiobookCompletionState = createAudiobookCompletionState();
const audiobookCompletion = createAudiobookCompletionBackend({
  state: audiobookCompletionState,
  store: { get projects() { return jobs; }, get: id => projectStore.get(id), save: saveJobs, progress: saveJobProgress, flushStopped: () => projectStore.save(jobs), snapshot: cloneProject },
  work: { get processing() { return audiobookProcessingState.running; }, imports: audiobookFileState.imports,
    get moving() { return audiobookFileState.moving; }, set moving(value) { audiobookFileState.moving = value; },
    get installing() { return activeInstallProgress.isActive; }, get runtimeMutation() { return runtimeMutationRunning; },
    get youtubeInstalling() { return isYtDlpInstalling; }, get modelDownloads() { return activeModelDownloads.size; },
    get fasterInstalls() { return activeFasterWhisperInstalls.size; }, get mutations() { return activeLibraryMutations; } },
  locations: { appRoot: APP_ROOT, appPath, get output() { return currentOutputFolder; }, get upload() { return uploadDir; } },
  get config() { return currentConfig; },
  source: { isManagedChild, sourceMissing, sourceFilePaths, resolvedOutputRoot, knownIntermediatesRoots, projectIntermediatesDir, exportedAudioPaths,
    sourceLocation, bookSourceRoot, sourceRelative, sourceFingerprint, bookFileStamp, archiveCurrent, associateProjectFile, backfillProjectCompanions,
    projectFilePaths, availableOriginalPaths, ownedProjectDestination, pathEntryExists, completionSignature, transferAssociatedProject, canMoveInboxBook },
  files: { pathKey, within, stamp, projectFiles, assertSidecarOwnership, get extensions() { return SUPPORTED_AUDIO_EXTENSIONS; } },
  media: { ffmpeg: getFfmpeg, ffprobe: getFfprobe, inspect, inspectAsync, read: (...args) => mediaCache.read(...args as [string,string]), retainWaveform,
    prepare: prepareMaster, writeMetadata: writeAudioMetadata, playback: buildBookPlaybackManifest, exportAudio, validateChapters },
  checks: { signature: finalCheckSignature, run: runFinalCheck },
  archive: { create: archiveOriginals, restore: restoreArchivedSources },
  get catalog() { return catalog; },
  logs: { event: appendMasterEvent, failure: appendOperationFailure }, system: { openFolder: launchFolder },
});

const audiobookProcessingState = createAudiobookProcessingState();
const audiobookProcessing = createAudiobookProcessingBackend({
  store: { get: id => projectStore.get(id), save: saveJobs, snapshot: cloneProject },
  work: { get installing() { return activeInstallProgress.isActive; }, imports: audiobookFileState.imports },
  get config() { return currentConfig; },
  locations: { appRoot: APP_ROOT, get output() { return currentOutputFolder; }, get torch() { return TORCH_CACHE_DIR; }, get matplotlib() { return MATPLOTLIB_CACHE_DIR; }, get whisper() { return WHISPERX_MODEL_CACHE_DIR; }, get openai() { return OPENAI_WHISPER_MODEL_CACHE_DIR; } },
  source: { sourceFingerprint, projectIntermediatesDir, resolvedOutputRoot, importedSourcePaths, chaptersForJob, associateProjectFile },
  runtime: { engine: requestEngine, get models() { return speechModels; }, modelStatus: getModelInstallationStatus, capabilities: getBackendCapabilities, python: getBackendPython,
    isSystem: engine => !!runtimeSelection?.backends[engine], env: transcriptionRuntimeEnv, get repositories() { return FASTER_WHISPER_REPOSITORIES; }, engines: transcriptionEngines, transcribe: transcribeWithFallback },
  media: { inspect, ffmpeg: getFfmpeg, ffprobe: getFfprobe, prepare: prepareMaster, reviewPreview: sourceReviewPreview, preview: makePreview, ensureAnalysis, rebuildAnalysis },
  detection: { versions: { improved: IMPROVED_DETECTOR_VERSION, music: MUSIC_DETECTOR_VERSION, title: TITLE_DETECTOR_VERSION },
    sourceBoundaries, structuralSuggestions, titles: detectTitleBoundaries, music: detectMusicTransitions, merge: mergeDetectionSuggestions,
    recoveryWindows, recheck: recheckChapterWindows, reconcile: reconcileSources },
  logs: { event: appendMasterEvent },
}, audiobookProcessingState);


const audiobookFiles = createAudiobookFileBackend({
  store: {
    get projects() { return jobs; }, set projects(value) { jobs = value; },
    get: id => projectStore.get(id), adopt: id => projectStore.adopt(id), commit: persistJobsAtomically,
    rollback: () => projectStore.rollback(), outputRoots: () => projectStore.outputRoots(), snapshot: cloneProject,
  },
  activity: audiobookFileState,
  work: {
    get processing() { return audiobookProcessingState.running; }, get configSaving() { return libraryConfigSaving; },
    get validating() { return audiobookCompletionState.validating; }, get mutations() { return activeLibraryMutations; },
    get metadataWriters() { return audiobookCompletionState.metadataWriters; }, cleanupReason: cleanupBusyReason,
  },
  locations: {
    appRoot: APP_ROOT, appPath, get output() { return currentOutputFolder; },
    get upload() { return uploadDir; }, get config() { return currentConfig; },
  },
  files: { stamp, fileSignature, pathKey, within, assertUnlinked, contentHash, inventory, scanRoot, identifyBook,
    listBookTree, listBookDirectory, resolveBookAudio, moveBookFiles, createBookFolder, rebaseBookMembership, projectFiles,
    recoverRelocatedOutput, recoverTransferCopies, transferProjectFiles, mapScanWork },
  media: {
    get extensions() { return SUPPORTED_AUDIO_EXTENSIONS; }, outputFormats,
    ffmpeg: getFfmpeg, ffprobe: getFfprobe, inspect,
    read: (...args) => mediaCache.read(...args as [string, string]), writeAudioMetadata, writeCoverImage,
    fingerprint, stitchCompatibility,
    libraryReader: { tags: (...args) => libraryMedia.tags(...args as [string,string]), cover: (...args) => libraryMedia.cover(...args as [string,string,string]), duration: (...args) => libraryMedia.duration(...args as [string,string]) },
  },
  availability: { catalogArchiveCurrent, findAvailableM4b },
  views: { book: libraryBook, visibleBooks: visibleLibraryBooks, listening: { has: id => listeningStore.has(id) } },
  metadata: { writeSidecars: writeAudiobookshelfJson, transcriptionSettings: validatedTranscriptionSettingsMap },
  chapters: { parse: parseChapterFile, existing: existingChapterList },
  validation: { signature: currentFinalCheckSignature },
  providers: { status: getYtDlpStatus, youtubeUrl, youtubeArgs: youtubeBaseArgs, downloadYoutubeAudio },
  logs: { event: appendMasterEvent, import: importLog, failure: appendOperationFailure },
  system: { openFolder: (...args) => launchFolder(...args as [string]) },
  get catalog() { return catalog; },
});

let libraryConfigSaving = false;

let activeLibraryMutations = 0;
const libraryMutationRequests = new Map<express.Response, string>();


const libraryRecoveryWarnings: string[] = [];

app.use('/api', asyncRoute(async (req, res, next) => {
  if (isReadOnlyCatalogRequest(req.method, req.path)) return next();
  // Personal checkpoints are independent of library and audio mutations.
  if (req.method === 'POST' && (/^\/jobs\/[^/]+\/final-check\/cancel$/.test(req.path) || /^\/jobs\/[^/]+\/listening$/.test(req.path) || req.path.endsWith('/book-files/details'))) return next();
  const scanRequest = req.path === '/library/refresh' || req.path === '/library/rescan' || req.path === '/library/rebuild';
  if (req.method !== 'GET' && !scanRequest && audiobookFileState.scan) {
    try { await audiobookFileState.scan; }
    catch { /* A failed scan rolls back before a waiting action runs. */ }
  }
  if (req.method !== 'GET' && (audiobookFileState.moving || libraryConfigSaving || audiobookCompletionState.validating) && !scanRequest)
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
}, audiobookFileRoute(input => audiobookFiles.commands.postUploadAudio(input)));


// Initial workbench configuration matching config.json from original Python app
const CONFIG_PATH = appPath('config.json');
const defaultConfig: WorkbenchConfig = {
  audiobookshelf_metadata: false,
  save_cover_beside_audio: true,
  quick_tags: [...QUICK_ADD_CATEGORIES],
  pcm_retention: 'after_verified_export',
  player_ambient_glow: true,
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








function validatedTranscriptionSettingsMap(input: unknown) { return audiobookProcessing.helpers.validatedTranscriptionSettingsMap(input); }













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
app.get('/api/step1/progress', audiobookFileRoute(input => audiobookProcessing.commands.progress(input)));



// Cancel active Step 1 process
app.post('/api/step1/cancel', audiobookFileRoute(input => audiobookProcessing.commands.cancel(input)));

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
function probeAudioFile(...args: Parameters<AudiobookFileBackend['helpers']['probeAudioFile']>): ReturnType<AudiobookFileBackend['helpers']['probeAudioFile']> { return audiobookFiles.helpers.probeAudioFile(...args); }

// Local Recursive Directory Scanner (Supports Layout A, Layout B, and Layout C with natural sorting)
const mediaCache = new MediaCache(inspectAsync);
const libraryMedia = new LibraryMediaReader();
function scanLocalFolder(...args: Parameters<AudiobookFileBackend['helpers']['scanLocalFolder']>): ReturnType<AudiobookFileBackend['helpers']['scanLocalFolder']> { return audiobookFiles.helpers.scanLocalFolder(...args); }

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

function bookSourceRoot(...args: Parameters<AudiobookFileBackend['helpers']['bookSourceRoot']>): ReturnType<AudiobookFileBackend['helpers']['bookSourceRoot']> { return audiobookFiles.helpers.bookSourceRoot(...args); }
function sourceRelative(...args: Parameters<AudiobookFileBackend['helpers']['sourceRelative']>): ReturnType<AudiobookFileBackend['helpers']['sourceRelative']> { return audiobookFiles.helpers.sourceRelative(...args); }
function bookFileStamp(...args: Parameters<AudiobookFileBackend['helpers']['bookFileStamp']>): ReturnType<AudiobookFileBackend['helpers']['bookFileStamp']> { return audiobookFiles.helpers.bookFileStamp(...args); }
function sourceFingerprint(...args: Parameters<AudiobookFileBackend['helpers']['sourceFingerprint']>): ReturnType<AudiobookFileBackend['helpers']['sourceFingerprint']> { return audiobookFiles.helpers.sourceFingerprint(...args); }
function sourceFilesInvalidated(...args: Parameters<AudiobookFileBackend['helpers']['sourceFilesInvalidated']>): ReturnType<AudiobookFileBackend['helpers']['sourceFilesInvalidated']> { return audiobookFiles.helpers.sourceFilesInvalidated(...args); }
function updateSourceTotals(...args: Parameters<AudiobookFileBackend['helpers']['updateSourceTotals']>): ReturnType<AudiobookFileBackend['helpers']['updateSourceTotals']> { return audiobookFiles.helpers.updateSourceTotals(...args); }


app.get('/api/jobs/:id/source-tree', audiobookFileRoute(input => audiobookFiles.commands.getJobsSourceTree(input)));

app.post('/api/jobs/:id/source-folder/open', audiobookFileRoute(input => audiobookFiles.commands.postJobsSourceFolderOpen(input)));


// Resolve ownership by physical path, independently of a project's browse root.

function removeSourceMembership(...args: Parameters<AudiobookFileBackend['helpers']['removeSourceMembership']>): ReturnType<AudiobookFileBackend['helpers']['removeSourceMembership']> { return audiobookFiles.helpers.removeSourceMembership(...args); }

function bookFilesBusyReason(ownRequest = true): string | undefined {
  if (audiobookProcessingState.running) return 'audio processing';
  if (audiobookFileState.imports.size) return `source import or file verification (${[...audiobookFileState.imports].join(', ')})`;
  const exporting = jobs.find(job => job.exports?.some(item => item.status === 'running' || item.status === 'queued'));
  if (exporting) return `export for ${exporting.name}`;
  if (audiobookFileState.scan) return 'the library scan';
  if (audiobookFileState.moving) return 'the verified file move';
  if (activeLibraryMutations > (ownRequest ? 1 : 0)) return `file operations (${[...libraryMutationRequests.values()].join(', ')})`;
  if (audiobookCompletionState.metadataWriters.size) return 'metadata writing';
  if (activeInstallProgress.isActive) return 'component installation';
  if (runtimeMutationRunning) return 'runtime changes';
  if (isYtDlpInstalling) return 'the downloader installation';
  if (activeModelDownloads.size || activeFasterWhisperInstalls.size) return 'speech model downloads';
}
app.get('/api/operations/status', (_req, res) => res.json({ busy: bookFilesBusyReason(false) || null }));

registerBookFilesRoutes(app, {
  jobs: () => jobs, getJob: id => projectStore.get(id), config: () => currentConfig, appRoot: APP_ROOT,
  root: bookSourceRoot, excluded: () => [...knownIntermediatesRoots(), appPath('.installed-modules')],
  busy: () => !!bookFilesBusyReason(), busyReason: bookFilesBusyReason,
  lock: (id, locked) => { audiobookFileState.moving = locked; if (locked) audiobookFileState.imports.add(id); else audiobookFileState.imports.delete(id); },
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
app.post('/api/jobs/:id/source-selection', audiobookFileRoute(input => audiobookFiles.commands.postJobsSourceSelection(input)));

app.post('/api/jobs/:id/source-files', audiobookFileRoute(input => audiobookFiles.commands.postJobsSourceFiles(input)));

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
app.post('/api/youtube/fetch-info', requireFeatures(['youtube_inspection'], 'YouTube inspection', () => undefined), audiobookFileRoute(input => audiobookFiles.commands.postYoutubeFetchInfo(input)));

// Download YouTube audio via yt-dlp & FFmpeg

mountLibriVox(app, {
  get jobs() { return jobs; }, save: persistJobsAtomically, root: appPath('output', 'imports', 'librivox'), probe: probeAudioFile,
  locks: audiobookFileState.imports, busy: () => audiobookProcessingState.running || activeInstallProgress.isActive,
  requireImport: requireFeatures(['file_import'], 'LibriVox import', req => req.params.jobId),
});
// Source replacement commits as one transaction. Do not mutate or remove the
// same project while either remote importer is working.
app.use('/api/jobs/:id', (req, res, next) => {
  const job = projectStore.get(req.params.id);
  if (req.method === 'POST' && /\/(metadata|metadata-draft|metadata-json|finish-import)$/.test(req.path) && req.body?.expectedRevision !== undefined && req.body.expectedRevision !== (job?.metadataRevision || 0)) return res.status(409).json({ error: 'Book details changed in another view. Reopen the book before saving; your current edits have not been applied.' });
  if (req.method !== 'GET' && audiobookFileState.imports.has(req.params.id)) return res.status(409).json({ error: 'Wait for the source import to finish, or cancel it first.' });
  next();
});
app.post('/api/youtube/download', (req, res, next) => requireFeatures(
  [req.body?.format && req.body.format !== 'best' ? 'youtube_conversion' : 'youtube_import'],
  'YouTube import', request => request.body?.jobId,
)(req, res, next), audiobookFileRoute(input => audiobookFiles.commands.postYoutubeDownload(input)));

// Get configuration
app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

// Update configuration
app.post('/api/config', asyncRoute(async (req, res) => {
  const updates = req.body;
  if (updates.player_ambient_glow !== undefined && typeof updates.player_ambient_glow !== 'boolean') return res.status(400).json({ error: 'Player ambient glow must be on or off.' });
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
      if ([appPath('.cache'), appPath('logs'), appPath('runtime'), appPath('models'), appPath('.installed-modules'), ...knownIntermediatesRoots()].some(reserved => pathKey(reserved) === pathKey(folder) || within(reserved, folder))) throw new Error('Choose a book folder outside SwissMouse runtime, installed modules, cache, logs, models, and intermediates.');
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
if (process.env.SWISSMOUSE_INFORMATION_PREVIEW === '1') registerInformationPreviewRoutes(app, catalog);
const flushInformationSelections = registerInformationDirectoryRoutes(app,catalog,projectStore);
app.post('/api/module-lifecycle/prepare-removal',async(_req,res)=>{
  const busy=bookFilesBusyReason(true);if(busy){res.status(409).json({error:busy});return;}
  try{await catalog!.ready();const historyPending=await flushInformationSelections();const publication=await catalog!.call('informationStatus');res.json({historyPending,publicationPending:!publication.enabled||!!publication.error||!!publication.dirty||!!publication.outbox||!!publication.pendingProjection});}
  catch(error){res.status(409).json({error:String(error)});}
});
// Compatibility endpoint for older clients. The current UI uses bounded catalog queries.
app.get('/api/library', asyncRoute(async (req, res) => {
  res.json((await catalog!.call('query', { limit: req.query.limit === undefined ? 100 : Number(req.query.limit) })).items);
}));
app.get('/api/library/scan-status', (_req, res) => res.json({ scanning: !!audiobookFileState.scan, warnings: [...libraryRecoveryWarnings, ...audiobookFileState.warnings], progress: audiobookFileState.progress }));
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
app.post('/api/library/refresh', audiobookFileRoute(input => audiobookFiles.commands.postLibraryRefresh(input)));
// Retained for older clients; normal UI exposes only Refresh.
app.post('/api/library/rescan', audiobookFileRoute(input => audiobookFiles.commands.postLibraryRescan(input)));
app.post('/api/library/rebuild', audiobookFileRoute(input => audiobookFiles.commands.postLibraryRebuild(input)));
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

// Temporary built-in backend entry: shared store and filesystem safety remain host services.
const audiobookProjects = createAudiobookProjectService<AudiobookJob, LibraryBook>({
  selections: process.env.SWISSMOUSE_INFORMATION_DIRECTORY === '1' ? {
    prepare: prepareSeriesSelection,
    save: input => { const commit = input as SelectionCommit; projectStore.withSelectionCommit(commit.receipt,JSON.stringify(commit),saveJobs); },
  } : undefined,
  store: {
    get: id => projectStore.get(id),
    insert: project => { jobs.unshift(project); return projectStore.get(project.id)!; },
    remove: id => { const index = jobs.findIndex(project => project.id === id); if (index >= 0) jobs.splice(index, 1); },
    save: saveJobs,
  },
  views: {
    query: async options => (await catalog!.call('query', options)).items,
    prepareRead: job => {
      if (!job.sourceBitrate && job.mergedMp3?.fullPath) {
        try {
          const media = job.parts.map(part=>inspect(getFfprobe(),path.resolve(APP_ROOT,job.sourceFolderPath || '',part.name)));
          job.sourceBitrate = Math.max(...media.map(m=>m.bitrate));
        } catch { /* Keep unknown explicit until the source can be inspected. */ }
      }
    },
    describe: job => ({ sourceMissing: sourceMissing(job), canMoveToLibrary: canMoveInboxBook(job), libraryBook: libraryBook(job) }),
    book: libraryBook,
    publish: async ids => { await catalog!.publish(ids); },
  },
  sidecars: {
    savedAudio: savedAudiobookshelfPaths,
    availableAudio: job => { const exported = exportedAudioPaths(job); return exported.length ? exported : sourceFilePaths(job).filter(file => fs.existsSync(file)); },
    write: writeAudiobookshelfJson,
  },
  guards: {
    sourceImportActive: id => audiobookFileState.imports.has(id),
    metadataWriteBusy: job => audiobookProcessingState.running || audiobookFileState.imports.size > 0 || audiobookCompletionState.validating || !!job.exports?.some(item => item.status === 'queued' || item.status === 'running'),
    deletionBusy: cleanupBusyReason,
  },
  removeManagedFiles: job => removeProjectManagedFiles(job, true),
  outputFolder: () => currentOutputFolder,
});
registerAudiobookProjectRoutes(app, audiobookProjects,flushInformationSelections);

function resolvedOutputRoot(...args: Parameters<AudiobookFileBackend['helpers']['resolvedOutputRoot']>): ReturnType<AudiobookFileBackend['helpers']['resolvedOutputRoot']> { return audiobookFiles.helpers.resolvedOutputRoot(...args); }

function projectIntermediatesDir(...args: Parameters<AudiobookFileBackend['helpers']['projectIntermediatesDir']>): ReturnType<AudiobookFileBackend['helpers']['projectIntermediatesDir']> { return audiobookFiles.helpers.projectIntermediatesDir(...args); }

function knownIntermediatesRoots(...args: Parameters<AudiobookFileBackend['helpers']['knownIntermediatesRoots']>): ReturnType<AudiobookFileBackend['helpers']['knownIntermediatesRoots']> { return audiobookFiles.helpers.knownIntermediatesRoots(...args); }

function isManagedChild(...args: Parameters<AudiobookFileBackend['helpers']['isManagedChild']>): ReturnType<AudiobookFileBackend['helpers']['isManagedChild']> { return audiobookFiles.helpers.isManagedChild(...args); }

function pathEntryExists(...args: Parameters<AudiobookFileBackend['helpers']['pathEntryExists']>): ReturnType<AudiobookFileBackend['helpers']['pathEntryExists']> { return audiobookFiles.helpers.pathEntryExists(...args); }





function bookRootType(...args: Parameters<AudiobookFileBackend['helpers']['bookRootType']>): ReturnType<AudiobookFileBackend['helpers']['bookRootType']> { return audiobookFiles.helpers.bookRootType(...args); }

function completionCurrent(...args: Parameters<AudiobookFileBackend['helpers']['completionCurrent']>): ReturnType<AudiobookFileBackend['helpers']['completionCurrent']> { return audiobookFiles.helpers.completionCurrent(...args); }

function canMoveInboxBook(...args: Parameters<AudiobookFileBackend['helpers']['canMoveInboxBook']>): ReturnType<AudiobookFileBackend['helpers']['canMoveInboxBook']> { return audiobookFiles.helpers.canMoveInboxBook(...args); }

function completionSignature(...args: Parameters<AudiobookFileBackend['helpers']['completionSignature']>): ReturnType<AudiobookFileBackend['helpers']['completionSignature']> { return audiobookFiles.helpers.completionSignature(...args); }



function reconcileLibrary(...args: Parameters<AudiobookFileBackend['helpers']['reconcileLibrary']>): ReturnType<AudiobookFileBackend['helpers']['reconcileLibrary']> { return audiobookFiles.helpers.reconcileLibrary(...args); }

function sourceLocation(...args: Parameters<AudiobookFileBackend['helpers']['sourceLocation']>): ReturnType<AudiobookFileBackend['helpers']['sourceLocation']> { return audiobookFiles.helpers.sourceLocation(...args); }

function sourceFilePaths(...args: Parameters<AudiobookFileBackend['helpers']['sourceFilePaths']>): ReturnType<AudiobookFileBackend['helpers']['sourceFilePaths']> { return audiobookFiles.helpers.sourceFilePaths(...args); }

function archiveCurrent(...args: Parameters<AudiobookFileBackend['helpers']['archiveCurrent']>): ReturnType<AudiobookFileBackend['helpers']['archiveCurrent']> { return audiobookFiles.helpers.archiveCurrent(...args); }
function availableOriginalPaths(...args: Parameters<AudiobookFileBackend['helpers']['availableOriginalPaths']>): ReturnType<AudiobookFileBackend['helpers']['availableOriginalPaths']> { return audiobookFiles.helpers.availableOriginalPaths(...args); }
function sourceMissing(...args: Parameters<AudiobookFileBackend['helpers']['sourceMissing']>): ReturnType<AudiobookFileBackend['helpers']['sourceMissing']> { return audiobookFiles.helpers.sourceMissing(...args); }

function survivingLibraryM4b(...args: Parameters<AudiobookFileBackend['helpers']['survivingLibraryM4b']>): ReturnType<AudiobookFileBackend['helpers']['survivingLibraryM4b']> { return audiobookFiles.helpers.survivingLibraryM4b(...args); }





function cleanupInProgress(...args: Parameters<AudiobookCompletionBackend['helpers']['cleanupInProgress']>): ReturnType<AudiobookCompletionBackend['helpers']['cleanupInProgress']> { return audiobookCompletion.helpers.cleanupInProgress(...args); }

function cleanupBusyReason(...args: Parameters<AudiobookCompletionBackend['helpers']['cleanupBusyReason']>): ReturnType<AudiobookCompletionBackend['helpers']['cleanupBusyReason']> { return audiobookCompletion.helpers.cleanupBusyReason(...args); }






function removeProjectManagedFiles(...args: Parameters<AudiobookCompletionBackend['helpers']['removeProjectManagedFiles']>): ReturnType<AudiobookCompletionBackend['helpers']['removeProjectManagedFiles']> { return audiobookCompletion.helpers.removeProjectManagedFiles(...args); }











app.get('/api/storage/processing', audiobookCompletionRoute(input => audiobookCompletion.commands.getStorageProcessing(input)));

// Step 1: Save Step 1 Options & Settings
app.post('/api/jobs/:id/step1-settings', audiobookFileRoute(input => audiobookFiles.commands.postJobsStep1Settings(input)));

function importedSourcePaths(...args: Parameters<AudiobookFileBackend['helpers']['importedSourcePaths']>): ReturnType<AudiobookFileBackend['helpers']['importedSourcePaths']> { return audiobookFiles.helpers.importedSourcePaths(...args); }



app.post('/api/jobs/:id/source-file', audiobookFileRoute(input => audiobookFiles.commands.postJobsSourceFile(input)));

function localAudioSelection(...args: Parameters<AudiobookFileBackend['helpers']['localAudioSelection']>): ReturnType<AudiobookFileBackend['helpers']['localAudioSelection']> { return audiobookFiles.helpers.localAudioSelection(...args); }



app.post('/api/jobs/:id/local-source', audiobookFileRoute(input => audiobookFiles.commands.postJobsLocalSource(input)));

app.post('/api/jobs/:id/inspect-import', audiobookFileRoute(input => audiobookFiles.commands.postJobsInspectImport(input)));



// Step 1: Process Step 1 (Supports both 'whisperx' and 'existing_files' workflows)


const requireStep1Dependencies = (req: any, res: any, next: any) => {
  const chapterSource = req.body?.chapterSource || (projectStore.get(req.params.id)?.chapterSource || 'whisperx');
  const features: FeatureId[] = ['audio_processing'];
  if (chapterSource === 'whisperx' || (req.body?.generateTranscript ?? projectStore.get(req.params.id)?.generateTranscript)) features.push(currentConfig.faster_transcription ? 'faster_transcription' : 'openai_transcription');
  return requireFeatures(features, 'Step 1 processing')(req, res, next);
};
app.post('/api/jobs/:id/merge-and-detect', requireStep1Dependencies, audiobookFileRoute(input => audiobookProcessing.commands.processSource(input)));
app.post('/api/jobs/:id/process-step1', requireStep1Dependencies, audiobookFileRoute(input => audiobookProcessing.commands.processSource(input)));


app.post('/api/jobs/:id/rerun/:step', audiobookFileRoute(input => audiobookProcessing.commands.rerun(input)));

// Scan local folder for cover image (looks for cover.jpg, cover.png, etc.)
app.post('/api/jobs/:id/scan-cover', audiobookFileRoute(input => audiobookFiles.commands.postJobsScanCover(input)));

function exportedAudioPaths(...args: Parameters<AudiobookFileBackend['helpers']['exportedAudioPaths']>): ReturnType<AudiobookFileBackend['helpers']['exportedAudioPaths']> { return audiobookFiles.helpers.exportedAudioPaths(...args); }

function savedAudiobookshelfPaths(...args: Parameters<AudiobookCompletionBackend['helpers']['savedAudiobookshelfPaths']>): ReturnType<AudiobookCompletionBackend['helpers']['savedAudiobookshelfPaths']> { return audiobookCompletion.helpers.savedAudiobookshelfPaths(...args); }

function writeAudiobookshelfJson(...args: Parameters<AudiobookCompletionBackend['helpers']['writeAudiobookshelfJson']>): ReturnType<AudiobookCompletionBackend['helpers']['writeAudiobookshelfJson']> { return audiobookCompletion.helpers.writeAudiobookshelfJson(...args); }





app.get('/api/jobs/:id/export-folder-move', audiobookFileRoute(input => audiobookFiles.commands.getJobsExportFolderMove(input)));

app.post('/api/jobs/:id/export-folder-move', audiobookFileRoute(input => audiobookFiles.commands.postJobsExportFolderMove(input)));

// Finish import without running the audio pipeline. The persisted job JSON is
// SwissMouse's book record; embedded tags are an explicit, separate operation.
app.post('/api/jobs/:id/finish-import', audiobookFileRoute(input => audiobookFiles.commands.postJobsFinishImport(input)));

function writeCoverImage(...args: Parameters<AudiobookCompletionBackend['helpers']['writeCoverImage']>): ReturnType<AudiobookCompletionBackend['helpers']['writeCoverImage']> { return audiobookCompletion.helpers.writeCoverImage(...args); }

function associateProjectFile(...args: Parameters<AudiobookFileBackend['helpers']['associateProjectFile']>): ReturnType<AudiobookFileBackend['helpers']['associateProjectFile']> { return audiobookFiles.helpers.associateProjectFile(...args); }

function projectFilePaths(...args: Parameters<AudiobookFileBackend['helpers']['projectFilePaths']>): ReturnType<AudiobookFileBackend['helpers']['projectFilePaths']> { return audiobookFiles.helpers.projectFilePaths(...args); }

function backfillProjectCompanions(...args: Parameters<AudiobookFileBackend['helpers']['backfillProjectCompanions']>): ReturnType<AudiobookFileBackend['helpers']['backfillProjectCompanions']> { return audiobookFiles.helpers.backfillProjectCompanions(...args); }



/** An existing final export may be adopted, but never an unrelated folder. */
function ownedProjectDestination(...args: Parameters<AudiobookFileBackend['helpers']['ownedProjectDestination']>): ReturnType<AudiobookFileBackend['helpers']['ownedProjectDestination']> { return audiobookFiles.helpers.ownedProjectDestination(...args); }

function transferAssociatedProject(...args: Parameters<AudiobookFileBackend['helpers']['transferAssociatedProject']>): ReturnType<AudiobookFileBackend['helpers']['transferAssociatedProject']> { return audiobookFiles.helpers.transferAssociatedProject(...args); }


app.get('/api/jobs/:id/move-to-library', audiobookFileRoute(input => audiobookFiles.commands.getJobsMoveToLibrary(input)));
app.post('/api/jobs/:id/move-to-library', audiobookFileRoute(input => audiobookFiles.commands.postJobsMoveToLibrary(input)));





app.get('/api/jobs/:id/organize-library', audiobookFileRoute(input => audiobookFiles.commands.getJobsOrganizeLibrary(input)));

function chaptersForJob(...args: Parameters<AudiobookFileBackend['helpers']['chaptersForJob']>): ReturnType<AudiobookFileBackend['helpers']['chaptersForJob']> { return audiobookFiles.helpers.chaptersForJob(...args); }

app.post('/api/jobs/:id/chapter-file', audiobookFileRoute(input => audiobookFiles.commands.postJobsChapterFile(input)));

app.delete('/api/jobs/:id/chapter-file', audiobookFileRoute(input => audiobookFiles.commands.deleteJobsChapterFile(input)));

app.get('/api/jobs/:id/existing-chapters', audiobookFileRoute(input => audiobookFiles.commands.getJobsExistingChapters(input)));

app.post('/api/jobs/:id/organize-library', audiobookFileRoute(input => audiobookFiles.commands.postJobsOrganizeLibrary(input)));

// Explicitly copy a referenced book into the configured Library. The source
// remains untouched; only after every copied file is present does the stable
// book record switch to the managed path.
app.post('/api/library/:id/send-to-library', audiobookFileRoute(input => audiobookFiles.commands.postLibrarySendToLibrary(input)));


app.post('/api/library/:id/write-audio-metadata', requireFeatures(['audio_export'], 'Audio metadata write'), audiobookCompletionRoute(input => audiobookCompletion.commands.postLibraryWriteAudioMetadata(input)));

// Progress polling must not serialize covers and entire word timelines every second.


app.get('/api/jobs/:id/export-progress', audiobookCompletionRoute(input => audiobookCompletion.commands.getJobsExportProgress(input)));

// Step 4: Build Chaptered M4B (replicates app/m4b.py)
app.post('/api/jobs/:id/build-m4b', requireFeatures(['audio_export'], 'Audio export'), audiobookCompletionRoute(input => audiobookCompletion.commands.postJobsBuildM4b(input)));

app.post('/api/jobs/:id/build-audio', requireFeatures(['audio_export'], 'Audio export'), audiobookCompletionRoute(input => audiobookCompletion.commands.postJobsBuildM4b(input)));

// Final Check uses the same source-preserving audio inspection as processing.


function currentFinalCheckSignature(...args: Parameters<AudiobookCompletionBackend['helpers']['currentFinalCheckSignature']>): ReturnType<AudiobookCompletionBackend['helpers']['currentFinalCheckSignature']> { return audiobookCompletion.helpers.currentFinalCheckSignature(...args); }
app.get('/api/jobs/:id/final-check', audiobookCompletionRoute(input => audiobookCompletion.commands.getJobsFinalCheck(input)));
app.post('/api/jobs/:id/final-check/cancel', audiobookCompletionRoute(input => audiobookCompletion.commands.postJobsFinalCheckCancel(input)));
app.post('/api/jobs/:id/final-check/repair', audiobookCompletionRoute(input => audiobookCompletion.commands.postJobsFinalCheckRepair(input)));



app.get('/api/jobs/:id/finish', audiobookCompletionRoute(input => audiobookCompletion.commands.getJobsFinish(input)));
app.post('/api/jobs/:id/finish', audiobookCompletionRoute(input => audiobookCompletion.commands.postJobsFinish(input)));
app.post('/api/jobs/:id/validate', requireFeatures(['audio_processing'], 'Final check'), audiobookCompletionRoute(input => audiobookCompletion.commands.postJobsValidate(input)));

app.post('/api/jobs/:id/export/open-folder', audiobookCompletionRoute(input => audiobookCompletion.commands.postJobsExportOpenFolder(input)));

// Global storage cleanup. These actions only touch SwissMouse-managed folders.
app.post('/api/cleanup', audiobookCompletionRoute(input => audiobookCompletion.commands.postCleanup(input)));

// Cleanup files for one saved book.
app.post('/api/jobs/:id/purge', audiobookCompletionRoute(input => audiobookCompletion.commands.postJobsPurge(input)));

// Export CSV / FFMETA endpoints
app.get('/api/jobs/:id/export/candidates-csv', audiobookCompletionRoute(input => audiobookCompletion.commands.getJobsExportCandidatesCsv(input)));

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
  await audiobookCompletion.recover();
  // Recover interrupted path commits before scanning either root. Keep verified
  // copies for recovery instead of guessing which files can be discarded.
  await audiobookFiles.recover();
  void reconcileLibrary().catch(error => appendMasterEvent('Library', `Startup scan failed: ${error.message}`, 'ERROR'));
  const initialThemes = scanCustomThemes();
  console.log(`[Themes] Loaded ${initialThemes.themes.length} custom theme(s) from ${CUSTOM_THEMES_DIR}.`);
  if(process.env.SWISSMOUSE_APPLICATION_BUILD!=='1'){
    const {ModuleHost}=await import('./tools/module-host');
    const {registerModuleRoutes}=await import('./tools/module-routes');
    const {audiobookReadAdapter}=await import('./tools/audiobook-module-adapter');
    const moduleHost = new ModuleHost({ appRoot: APP_ROOT, readRecord: audiobookReadAdapter(id => projectStore.get(id)) });
    await moduleHost.start(process.env.SWISSMOUSE_MODULE_SAFE_MODE === '1');
    registerModuleRoutes(app, moduleHost, () => bookFilesBusyReason(true));
  }
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = process.env.SWISSMOUSE_MODULE_WEB_ROOT||appPath('dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, process.env.SWISSMOUSE_MODULE_CHILD_TOKEN?'127.0.0.1':"0.0.0.0", () => {
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
