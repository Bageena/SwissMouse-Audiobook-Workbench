import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { audiobookTags, metadataFromTags } from './audio-metadata';
import { probableBookGroups } from './book-groups';
import { applyDefaultChapterEnds } from './chapters';
import type { AudiobookMetadata, ChapterEntry, CoverArtInfo } from './domain';
import type { AudiobookFilePorts, ChapterAudioSource, FileCommandInput, MoveEntry } from './file-ports';
import { fileReply as reply } from './file-ports';
import { createImportProviders, type ImportProviders } from './import-providers';
import type { AudiobookJob, DiscoveredAudioFile, FolderScanResult, LibraryBook, OutputAudioFormat, UnsupportedFileItem } from './legacy-domain';
import { createLibraryDiscovery, type LibraryDiscovery } from './library-discovery';
import { createLibraryTransfers, type LibraryTransfers } from './library-transfers';
import { retainMetadataOverrides } from './metadata-state';
import { applySavedMetadata } from './project-metadata';
import { checkRelinkIdentity } from './relink-identity';
import { hasExplicitSourceOrder, manualChapterGroups, setChapterGroup, sourceOrderCompare } from './source-structure';

/** Audiobook file coordination over existing storage, media and verified-transfer engines. */
export function createAudiobookFileBackend(host: AudiobookFilePorts) {
  const discovery = createLibraryDiscovery(host, { sourceFilePaths, knownIntermediatesRoots, exportedAudioPaths, bookRootType, remapBookPaths, sourceRelative, completionSignature, archiveCurrent, sourceMissing, survivingLibraryM4b });
  const transfers = createLibraryTransfers(host, { availableOriginalPaths, bookSourceRoot, sourceFilePaths, exportedAudioPaths, pathEntryExists, completionSignature, sourceRelative, sourceLocation, canMoveInboxBook, completionCurrent, isManagedChild, sourceMissing, survivingLibraryM4b, knownIntermediatesRoots, resolvedOutputRoot });
  const providers = createImportProviders(host, { probeAudioFile });

  // ----------------------------------------------------
  // Source selection, inspection and membership
  // ----------------------------------------------------
  function naturalSort<T>(items: T[], keyFn: (item: T) => string): T[] {
    return [...items].sort((a, b) => {
      return keyFn(a).localeCompare(keyFn(b), undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  // FFprobe / FFmpeg media inspector
  function probeAudioFile(filePath: string) {
    return host.media.inspect(host.media.ffprobe(), filePath);
  }

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
    const excludedWorkspaces = new Set(knownIntermediatesRoots().map(host.files.pathKey));
    async function walk(currentDir: string, relativeParent = '') {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      // Sort naturally: Chapter 2 before Chapter 10
      const sortedEntries = naturalSort(entries, e => e.name);
      await host.files.mapScanWork(sortedEntries.filter(entry => !entry.isDirectory()), 4, async (entry) => {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = relativeParent ? path.join(relativeParent, entry.name) : entry.name;
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase().replace('.', '');
          const fileStat = await fs.promises.stat(fullPath);
          if (host.media.extensions.has(ext)) {
            // Probe with FFprobe
            let probe: ReturnType<typeof probeAudioFile>;
            try {
              probe = await host.media.read(host.media.ffprobe(), fullPath);
            }
            catch (error: any) {
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
          }
          else {
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
        if (['.swissmouse-work', '.swissmouse'].includes(entry.name.toLowerCase()) || excludedWorkspaces.has(host.files.pathKey(fullPath)))
          continue;
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
    const compatibility = host.media.stitchCompatibility(sortedFiles);
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

  function bookSourceRoot(job: AudiobookJob): string | undefined {
    if (job.sourceFolderPath)
      return job.sourceFolderPath;
    if (job.source?.mode === 'folder')
      return job.source.path;
    return job.sourceFolderPath || (job.source?.mode === 'file' ? path.dirname(job.source.path) : undefined);
  }

  function sourceRelative(job: AudiobookJob, part: AudiobookJob['parts'][number]): string {
    return (part.sourceRelativePath || part.name).replace(/\\/g, '/');
  }

  function bookFileStamp(root: string, relative: string) {
    const file = path.resolve(root, relative);
    if (!host.files.within(root, file) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      return undefined;
    const stat = fs.statSync(file);
    return { sizeBytes: stat.size, modifiedMs: stat.mtimeMs, device: stat.dev, inode: stat.ino };
  }

  function sourceFingerprint(job: AudiobookJob, files: string[]) {
    const logical = job.parts.map((part, index) => job.sourcePathIdentity?.[sourceRelative(job, part)] || files[index]);
    return host.media.fingerprint(files, {}, logical);
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
    job.pipelineSteps = Object.fromEntries(Object.entries(job.pipelineSteps || {}).map(([key, state]) => [key, key !== 'metadata_processing' && state?.hasOutput ? { ...state, status: 'stale' } : state])) as AudiobookJob['pipelineSteps'];
  }

  function updateSourceTotals(job: AudiobookJob) {
    job.parts.forEach((part, index) => { part.order = index + 1; });
    job.totalSizeBytes = job.parts.length ? job.parts.reduce((sum, part) => sum + part.sizeBytes, 0) : job.outputM4b?.sizeBytes || 0;
    job.totalDurationSeconds = job.parts.length ? job.parts.reduce((sum, part) => sum + part.durationSeconds, 0) : job.outputM4b?.duration || 0;
    job.hasNestedChapterFolders = !!job.discoveredFiles?.some(file => !!file.chapterGroup);
    job.sourceOrderWarning = !job.sourceOrderManual && job.parts.length > 1 && job.parts.some(part => !hasExplicitSourceOrder({ relativePath: sourceRelative(job, part), discNumber: part.discNumber, trackNumber: part.trackNumber }))
      ? 'Some files have no clear disc or track number. Check the processing order before running.' : undefined;
  }

  function bookSourceTree(job: AudiobookJob, root: string, directory?: string) {
    const durationByPath = new Map((job.discoveredFiles || []).map(file => [file.relativePath.replace(/\\/g, '/'), file.durationSeconds]));
    const included = new Set(job.parts.map(part => sourceRelative(job, part)));
    const listing = directory ? host.files.listBookDirectory(directory, host.media.extensions, knownIntermediatesRoots()) : undefined;
    const entries = (listing ? listing.entries.map(entry => ({ ...entry, relativePath: path.relative(root, path.join(listing.directory, entry.name)).replace(/\\/g, '/') }))
      : host.files.listBookTree(root, host.media.extensions, knownIntermediatesRoots())).map(entry => ({
        ...entry, path: path.resolve(root, entry.relativePath),
        included: entry.type === 'file' ? included.has(entry.relativePath) : undefined, durationSeconds: durationByPath.get(entry.relativePath)
      }));
    const observed = new Map((job.sourceInventory || job.discoveredFiles || []).map(file => [file.relativePath.replace(/\\/g, '/'), file]));
    const excluded = new Set(job.excludedSourceFiles || []);
    const outputs = new Set([job.outputM4b?.fullPath, ...Object.values(job.exportedFiles || {}), ...(job.exports || []).map(item => item.fullPath)].filter(Boolean).map(file => host.files.pathKey(file!)));
    const groups = probableBookGroups(entries.filter(entry => entry.audio && !excluded.has(entry.relativePath) && !outputs.has(host.files.pathKey(path.join(root, entry.relativePath))))
      .map(entry => ({ ...observed.get(entry.relativePath), relativePath: entry.relativePath })), path.basename(root));
    return {
      directory: listing?.directory || root, parent: listing?.parent, canManage: !listing || host.files.pathKey(root) === host.files.pathKey(listing.directory) || host.files.within(root, listing.directory),
      missingFiles: job.parts.filter(part => !fs.existsSync(path.resolve(root, sourceRelative(job, part)))).map(part => sourceRelative(job, part)),
      membership: job.sourceMembership || 'automatic', review: job.sourceMembershipReview, root, scope: job.bookScope || { title: job.name }, groups, name: path.basename(root), entries, order: job.parts.map(part => sourceRelative(job, part)), summary: {
        audioFiles: job.parts.length,
        diskAudioFiles: entries.filter(entry => entry.audio).length,
        folders: entries.filter(entry => entry.type === 'folder').length,
        durationSeconds: job.parts.reduce((sum, part) => sum + part.durationSeconds, 0),
      }
    };
  }

  // Resolve ownership by physical path, independently of a project's browse root.
  function sourceOwners(files: string[], except?: string) {
    const canonical = (file: string) => host.files.pathKey(fs.existsSync(file) ? fs.realpathSync(file) : file);
    const selected = new Set(files.map(canonical));
    return host.store.projects.filter(job => job.id !== except && !job.libraryScan?.superseded).flatMap(job => {
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
    for (const file of files) {
      delete job.sourceFileStamps?.[file];
      delete job.sourcePathIdentity?.[file];
    }
    job.sourceMembership = 'confirmed';
    if (!job.parts.length)
      job.sourceMembershipReview = 'All source files were reassigned. Select files before processing this project.';
    sourceFilesInvalidated(job);
    updateSourceTotals(job);
  }

  function resolvedOutputRoot(job?: AudiobookJob): string {
    const configured = job?.outputFolderPath?.trim() || host.locations.output;
    if (job && bookRootType(job) === 'inbox' && host.files.pathKey(path.resolve(host.locations.appRoot, configured)) === host.files.pathKey(host.locations.output))
      return path.join(host.locations.config.inbox_folder || host.locations.appPath('inbox'), '.swissmouse-work');
    return path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(host.locations.appRoot, configured);
  }

  function projectIntermediatesDir(job: AudiobookJob): string {
    return path.join(resolvedOutputRoot(job), 'intermediates', job.id);
  }

  function knownIntermediatesRoots(): string[] {
    return [...new Set([
      path.join(path.resolve(host.locations.output), 'intermediates'),
      ...host.store.outputRoots().map(root => path.join(path.resolve(host.locations.appRoot, root), 'intermediates')),
    ])];
  }

  function isManagedChild(root: string, target: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  function pathEntryExists(candidate: string): boolean {
    try {
      fs.lstatSync(candidate);
      return true;
    }
    catch (error: any) {
      if (error?.code === 'ENOENT')
        return false;
      throw error;
    }
  }

  function ensureUnlinkedLibraryParent(root: string, parent: string): void {
    if (fs.lstatSync(root).isSymbolicLink())
      throw new Error('The configured Library folder is a linked path.');
    let current = root;
    for (const segment of path.relative(root, parent).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (!pathEntryExists(current))
        fs.mkdirSync(current);
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error(`Linked Library folder is not a safe copy destination: ${current}`);
    }
  }

  function isInboxPath(candidate: string): boolean {
    const root = host.locations.config.inbox_folder || host.locations.appPath('inbox');
    return !!candidate && (host.files.pathKey(root) === host.files.pathKey(path.resolve(host.locations.appRoot, candidate)) || host.files.within(root, path.resolve(host.locations.appRoot, candidate)));
  }

  function bookRootType(job: AudiobookJob): 'inbox' | 'library' | undefined {
    const candidate = job.source?.path || job.sourceFolderPath;
    if (candidate && isInboxPath(candidate))
      return 'inbox';
    if (candidate && host.files.within(host.locations.output, path.resolve(host.locations.appRoot, candidate)))
      return 'library';
    if (job.outputM4b?.fullPath && host.files.within(host.locations.output, job.outputM4b.fullPath))
      return 'library';
    return undefined;
  }

  function completionCurrent(job: AudiobookJob) {
    return (!job.finalCheck || (job.finalCheck.state === 'complete' && job.finalCheck.inputSignature === host.validation.signature(job))) && job.processingStatus === 'complete' && job.validation?.status === 'PASS' && !job.libraryScan?.missing && !(job.staleSteps || []).some(step => ['export', 'validation', 'chapter_review'].includes(step));
  }

  function canMoveInboxBook(job: AudiobookJob) {
    return sourceLocation(job) !== 'managed' && completionCurrent(job) && job.validation?.status === 'PASS' && !!job.outputM4b?.fullPath;
  }

  async function completionSignature(job: AudiobookJob) {
    const files = [...new Set([...availableOriginalPaths(job), ...(archiveCurrent(job) ? [job.originalsArchive!.path] : []), ...exportedAudioPaths(job)])].sort();
    return host.files.fileSignature(await Promise.all(files.map(async (file, index) => host.files.stamp(file, String(index)))));
  }

  function remapBookPaths(job: AudiobookJob, from: string, to: string) {
    const remap = (value: string | undefined) => value && (host.files.pathKey(value) === host.files.pathKey(from) || host.files.within(from, value)) ? path.resolve(to, path.relative(from, value)) : value;
    if (job.source)
      job.source.path = remap(job.source.path)!;
    job.sourceFolderPath = remap(job.sourceFolderPath);
    job.outputFolderPath = remap(job.outputFolderPath);
    job.previewPath = remap(job.previewPath);
    job.downloadedAudioFile = remap(job.downloadedAudioFile);
    if (job.sourceSummary)
      job.sourceSummary = { ...job.sourceSummary, sourcePath: remap(job.sourceSummary.sourcePath)! };
    if (job.mergedMp3)
      job.mergedMp3.fullPath = remap(job.mergedMp3.fullPath);
    if (job.outputM4b)
      job.outputM4b.fullPath = remap(job.outputM4b.fullPath);
    for (const item of job.exports || []) {
      item.fullPath = remap(item.fullPath);
      item.coverPath = remap(item.coverPath);
    }
    for (const [format, file] of Object.entries(job.exportedFiles || {}))
      job.exportedFiles![format as OutputAudioFormat] = remap(file)!;
    for (const part of job.parts)
      if (path.isAbsolute(part.name))
        part.name = remap(part.name)!;
    job.associatedFiles = job.associatedFiles?.map(file => ({ ...file, path: remap(file.path)! }));
    if (job.originalsArchive)
      job.originalsArchive = { ...job.originalsArchive, path: remap(job.originalsArchive.path)!, files: job.originalsArchive.files.map(file => ({ ...file, source: remap(file.source)! })) };
  }

  function reconcileLibrary(...args: Parameters<LibraryDiscovery['reconcileLibrary']>): ReturnType<LibraryDiscovery['reconcileLibrary']> { return discovery.reconcileLibrary(...args); }

  function sourceLocation(job: AudiobookJob): LibraryBook['sourceLocation'] {
    if (job.source)
      return isInboxPath(job.source.path) ? 'inbox' : host.files.within(host.locations.output, job.source.path) ? 'managed' : 'external';
    if (!job.parts.length)
      return 'unknown';
    if (!job.sourceFolderPath)
      return job.parts.every(part => path.isAbsolute(part.name)) ? 'external' : 'unknown';
    // Old jobs load without migration; their stable IDs and original paths stay intact.
    return isInboxPath(job.sourceFolderPath) ? 'inbox' : 'external';
  }

  function sourceFilePaths(job: AudiobookJob): string[] {
    if (!job.parts.length)
      return [];
    if (!job.sourceFolderPath)
      return job.parts.every(part => path.isAbsolute(part.name)) ? job.parts.map(part => path.resolve(part.name)) : [];
    const root = path.resolve(host.locations.appRoot, job.sourceFolderPath);
    return job.parts.map(part => {
      if (!job.source && path.isAbsolute(part.name))
        return path.resolve(part.name); // Older path-based jobs.
      const candidate = path.resolve(root, part.name);
      if (!isManagedChild(root, candidate))
        throw new Error(`Unsafe source part path: ${part.name}`);
      return candidate;
    });
  }

  function archiveCurrent(job: AudiobookJob): boolean {
    try {
      return host.availability.catalogArchiveCurrent(job.originalsArchive, job.sourceKey, sourceFilePaths(job));
    }
    catch {
      return false;
    }
  }

  function availableOriginalPaths(job: AudiobookJob): string[] {
    const files = sourceFilePaths(job);
    return archiveCurrent(job) ? files.filter(file => fs.existsSync(file)) : files;
  }

  function sourceMissing(job: AudiobookJob): boolean {
    if (archiveCurrent(job))
      return false;
    try {
      const paths = sourceFilePaths(job);
      return paths.length > 0 && paths.some(file => !fs.existsSync(file) || !fs.statSync(file).isFile());
    }
    catch {
      return true;
    }
  }

  function survivingLibraryM4b(job: AudiobookJob): string | undefined {
    return host.availability.findAvailableM4b(host.locations.output, [job.outputM4b?.fullPath, job.exportedFiles?.m4b,
    ...(job.exports || []).filter(item => item.format === 'm4b' && item.status === 'success').map(item => item.fullPath)]);
  }

  function importedSourcePaths(job: AudiobookJob): string[] {
    const files = sourceFilePaths(job);
    if (!files.length)
      throw new Error('Choose an audio source first.');
    for (const file of files)
      if (!fs.existsSync(file) || !fs.statSync(file).isFile())
        throw new Error(`Source audio is missing: ${file}`);
    return files;
  }

  function validatedAudioFile(value: unknown) {
    if (typeof value !== 'string' || !path.isAbsolute(value))
      throw new Error('Select an absolute local audiobook path.');
    const file = path.resolve(value);
    const extension = path.extname(file).slice(1).toLowerCase();
    if (!host.media.extensions.has(extension))
      throw new Error('This audio file type is not supported.');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      throw new Error('Source audio is missing. Select an existing file.');
    const media = host.media.inspect(host.media.ffprobe(), file);
    return { file, media, sizeBytes: fs.statSync(file).size };
  }

  async function localAudioSelection(value: unknown, groupId?: string) {
    const paths = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(paths) || !paths.length || paths.some(item => typeof item !== 'string' || !path.isAbsolute(item)))
      throw new Error('Enter an existing absolute local file or folder path.');
    const selected = [...new Set((paths as string[]).map(item => path.resolve(item)))];
    if (selected.some(item => !fs.existsSync(item)))
      throw new Error(`Path does not exist: ${selected.find(item => !fs.existsSync(item))}`);
    if (selected.length === 1 && fs.statSync(selected[0]).isDirectory()) {
      const scanned = await scanLocalFolder(selected[0]);
      if (!scanned.files.length)
        throw new Error('No supported audio was found in that folder.');
      const groups = probableBookGroups(scanned.files, path.basename(selected[0]));
      const group = groupId ? groups.find(item => item.id === groupId) : groups.length === 1 ? groups[0] : undefined;
      if (groupId && !group)
        throw new Error('The candidate book changed. Scan the folder again.');
      return {
        root: selected[0], mode: 'folder' as const, files: group ? scanned.files.filter(file => group.files.includes(file.relativePath.replace(/\\/g, '/'))) : scanned.files,
        groups, group, needsGroup: !group, orderWarning: scanned.orderWarning
      };
    }
    if (selected.some(item => !fs.statSync(item).isFile()))
      throw new Error('Select one folder or supported audio files from one folder.');
    const root = path.dirname(selected[0]);
    if (selected.some(item => path.dirname(item) !== root))
      throw new Error('Selected audio files must be in the same folder.');
    const files = (await Promise.all(naturalSort(selected, item => path.basename(item)).map(async (file) => {
      const extension = path.extname(file).slice(1).toLowerCase();
      if (!host.media.extensions.has(extension))
        throw new Error(`Unsupported audio file: ${path.basename(file)}`);
      const media = await host.media.read(host.media.ffprobe(), file);
      const tagNumber = (keys: string[]) => {
        const value = Object.entries(media.tags).find(([key]) => keys.includes(key.toLowerCase()))?.[1];
        const number = Number(/^\s*(\d+)/.exec(String(value || ''))?.[1]);
        return number > 0 ? number : undefined;
      };
      return {
        relativePath: path.basename(file), fileName: path.basename(file), folderName: 'Root',
        tags: Object.fromEntries(Object.entries(media.tags).map(([key, value]) => [key, String(value)])),
        discNumber: tagNumber(['disc', 'discnumber', 'disk', 'disknumber', 'tpos']), trackNumber: tagNumber(['track', 'tracknumber', 'trck']),
        format: media.format, codec: media.codec, sampleRate: media.sampleRate, channels: media.channels,
        bitrate: media.bitrate, sizeBytes: fs.statSync(file).size, durationSeconds: media.durationSeconds,
        isProbed: true, streamSignature: media.streamSignature
      };
    }))).sort(sourceOrderCompare);
    return {
      root, mode: selected.length === 1 ? 'file' as const : 'folder' as const, files, groups: probableBookGroups(files), group: undefined, needsGroup: false,
      orderWarning: files.length > 1 && files.some(file => !hasExplicitSourceOrder(file))
        ? 'Some files have no clear disc or track number. Check the processing order before running.' : undefined
    };
  }

  function localLibraryTarget(selection: Awaited<ReturnType<typeof localAudioSelection>>) {
    const root = path.resolve(host.locations.output);
    const name = selection.mode === 'file'
      ? path.basename(selection.files[0].fileName, path.extname(selection.files[0].fileName))
      : path.basename(selection.root);
    const base = path.resolve(root, name);
    if (!isManagedChild(root, base))
      throw new Error('The Library destination is outside the selected location.');
    let target = base;
    for (let number = 2;pathEntryExists(target);number++)
      target = `${base} (${number})`;
    if (!isManagedChild(root, target) || isManagedChild(selection.root, target))
      throw new Error('Choose audio outside its destination Library folder.');
    ensureUnlinkedLibraryParent(root, path.dirname(target));
    return { root, base, target };
  }

  function exportedAudioPaths(job: AudiobookJob): string[] {
    return [...new Set([
      ...Object.values(job.exportedFiles || {}),
      ...(job.exports || []).filter(item => item.status === 'success').map(item => item.fullPath),
      job.outputM4b?.fullPath,
    ].filter((file): file is string => typeof file === 'string' && fs.existsSync(file) && fs.statSync(file).isFile()))];
  }

  function planSingleExportFolderMove(...args: Parameters<LibraryTransfers['planSingleExportFolderMove']>): ReturnType<LibraryTransfers['planSingleExportFolderMove']> { return transfers.planSingleExportFolderMove(...args); }

  function planExportFolderMove(...args: Parameters<LibraryTransfers['planExportFolderMove']>): ReturnType<LibraryTransfers['planExportFolderMove']> { return transfers.planExportFolderMove(...args); }

  function associateProjectFile(...args: Parameters<LibraryTransfers['associateProjectFile']>): ReturnType<LibraryTransfers['associateProjectFile']> { return transfers.associateProjectFile(...args); }

  function projectFilePaths(...args: Parameters<LibraryTransfers['projectFilePaths']>): ReturnType<LibraryTransfers['projectFilePaths']> { return transfers.projectFilePaths(...args); }

  function backfillProjectCompanions(...args: Parameters<LibraryTransfers['backfillProjectCompanions']>): ReturnType<LibraryTransfers['backfillProjectCompanions']> { return transfers.backfillProjectCompanions(...args); }

  function restoreProject(...args: Parameters<LibraryTransfers['restoreProject']>): ReturnType<LibraryTransfers['restoreProject']> { return transfers.restoreProject(...args); }

  /** An existing final export may be adopted, but never an unrelated folder. */
  function ownedProjectDestination(...args: Parameters<LibraryTransfers['ownedProjectDestination']>): ReturnType<LibraryTransfers['ownedProjectDestination']> { return transfers.ownedProjectDestination(...args); }

  function transferAssociatedProject(...args: Parameters<LibraryTransfers['transferAssociatedProject']>): ReturnType<LibraryTransfers['transferAssociatedProject']> { return transfers.transferAssociatedProject(...args); }


  function organizeLibraryPlan(...args: Parameters<LibraryTransfers['organizeLibraryPlan']>): ReturnType<LibraryTransfers['organizeLibraryPlan']> { return transfers.organizeLibraryPlan(...args); }

  function removeOrganizeScaffold(...args: Parameters<LibraryTransfers['removeOrganizeScaffold']>): ReturnType<LibraryTransfers['removeOrganizeScaffold']> { return transfers.removeOrganizeScaffold(...args); }

  async function chaptersForJob(job: AudiobookJob, sources: ChapterAudioSource[], sourceKey?: string): Promise<{
    chapters: ChapterEntry[];
    source?: string;
    sidecar?: string;
  }> {
    if (!job.importedChapterFile)
      return host.chapters.existing(sources, host.media.extensions);
    const imported = job.importedChapterFile;
    const current = sourceKey || await sourceFingerprint(job, sources.map(source => source.file));
    if (current !== imported.sourceKey)
      return { chapters: [], source: 'Imported chapter file no longer matches the project audio. Import it again or clear it.' };
    const parsed = host.chapters.parse(imported.name, imported.content, sources, bookSourceRoot(job) || path.dirname(sources[0].file));
    return { chapters: parsed.chapters, source: `Imported ${parsed.kind === 'tracks' ? 'playlist track boundaries' : 'chapters'}: ${imported.name}` };
  }

  function postUploadAudio(...args: Parameters<ImportProviders['postUploadAudio']>): ReturnType<ImportProviders['postUploadAudio']> { return providers.postUploadAudio(...args); }

  async function getJobsSourceTree(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    const root = bookSourceRoot(job);
    if (!root)
      return reply(400, { error: 'Select a local book source first.' });
    try {
      return reply(200, bookSourceTree(job, root, input.query.view === 'directory' ? (typeof input.query.directory === 'string' ? input.query.directory : root) : undefined));
    }
    catch (error: any) {
      return reply(400, { error: error.message || 'Could not read book files.' });
    }
  }

  async function postJobsSourceFolderOpen(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    const root = bookSourceRoot(job);
    if (!root)
      return reply(400, { error: 'Select a local book source first.' });
    let directory: string;
    try {
      directory = host.files.listBookDirectory(typeof input.body?.directory === 'string' ? input.body.directory : root, host.media.extensions, knownIntermediatesRoots()).directory;
      if (!fs.statSync(directory).isDirectory())
        throw new Error('Source is not a folder.');
    }
    catch {
      return reply(404, { error: 'The source folder is no longer available. Choose or relink the source folder first.' });
    }
    try {
      await host.system.openFolder(directory);
      return reply(200, { status: 'ok', directory });
    }
    catch (error: any) {
      return reply(500, { error: `Could not open the source folder: ${error.message}` });
    }
  }

  async function postJobsSourceSelection(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (host.work.cleanupReason())
      return reply(409, { error: host.work.cleanupReason() });
    if (host.activity.imports.size || host.work.processing || host.activity.scan || host.work.mutations > 1 || host.work.metadataWriters.size ||
      host.store.projects.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status))))
      return reply(409, { error: 'Wait for current processing or file operations to finish.' });
    host.activity.moving = true;
    let before: {
      job: AudiobookJob;
      snapshot: AudiobookJob;
    }[] = [];
    let createdId: string | undefined;
    try {
      const root = bookSourceRoot(job);
      const action = input.body?.action;
      if (!root || !['create', 'replace'].includes(action))
        throw new Error('Choose a local source and a manual grouping action.');
      if (!Array.isArray(input.body.files) || !input.body.files.length || input.body.files.some((file: unknown) => typeof file !== 'string'))
        throw new Error('Select audio files first.');
      const relativePaths = (input.body.files as string[]).map(file => file.replace(/\\/g, '/'));
      if (new Set(relativePaths).size !== relativePaths.length)
        throw new Error('Select each file only once.');
      const available = new Set(host.files.listBookTree(root, host.media.extensions, knownIntermediatesRoots()).filter(entry => entry.audio).map(entry => entry.relativePath));
      if (relativePaths.some(file => !available.has(file)))
        throw new Error('Selected audio is unavailable. Refresh the file browser.');
      const selected: DiscoveredAudioFile[] = (await Promise.all(relativePaths.map(async (relativePath) => {
        const file = host.files.resolveBookAudio(root, relativePath, host.media.extensions);
        const media = await host.media.read(host.media.ffprobe(), file);
        const tags = Object.fromEntries(Object.entries(media.tags).map(([key, value]) => [key.toLowerCase(), String(value)]));
        const number = (value?: string) => Number(/^\s*(\d+)/.exec(value || '')?.[1]) || undefined;
        return {
          relativePath, fileName: path.basename(file), folderName: path.dirname(relativePath), tags,
          trackNumber: number(tags.track || tags.tracknumber), discNumber: number(tags.disc || tags.discnumber),
          format: media.format, codec: media.codec, sampleRate: media.sampleRate, channels: media.channels,
          streamSignature: media.streamSignature, isProbed: true, sizeBytes: fs.statSync(file).size,
          durationSeconds: media.durationSeconds, bitrate: media.bitrate
        };
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
      if (coherent && !metadata.author)
        metadata.author = groups[0].author;
      const review = !coherent || !selected[0].tags?.album ? 'Review the inferred title and metadata for these manually selected files.' : undefined;
      const selectedPaths = selected.map(file => file.relativePath);
      const removed = action === 'replace' ? job.parts.map(part => sourceRelative(job, part)).filter(file => !selectedPaths.includes(file)) : [];
      const transfers = owners.map(owner => ({ id: owner.job.id, name: owner.job.name, files: owner.files, remaining: owner.job.parts.length - owner.files.length }));
      const token = createHash('sha256').update(JSON.stringify({
        action, root, selectedPaths,
        stamps: selectedPaths.map(file => bookFileStamp(root, file)),
        affected: [job, ...owners.map(owner => owner.job)].map(item => ({ id: item.id, name: item.name, source: item.source, sourceFolderPath: item.sourceFolderPath, parts: item.parts, excluded: item.excludedSourceFiles, membership: item.sourceMembership, metadata: item.metadata, metadataDraft: item.metadataDraft }))
      })).digest('hex');
      const plan = { action, files: selectedPaths, removed, transfers, title: action === 'replace' ? job.name : metadata.title, review, token };
      if (!input.body.commit)
        return reply(200, plan);
      if (input.body.token !== token)
        return reply(409, { error: 'Files or project ownership changed. Review the selection again before confirming.' });
      before = [...new Set([job, ...owners.map(owner => owner.job)])].map(item => ({ job: item, snapshot: host.store.snapshot(item) }));
      let target = job;
      if (action === 'create') {
        target = {
          id: `book-${randomUUID()}`, name: metadata.title, author: metadata.author, narrator: metadata.narrator,
          metadata, metadataDraft: host.store.snapshot(metadata), importedMetadata: host.store.snapshot(metadata), importInspected: true,
          importedAt: new Date().toISOString(), createdAt: new Date().toISOString(), status: 'draft', inputMethod: 'folder',
          source: { kind: 'external', path: root, mode: 'folder' }, sourceFolderPath: root, outputFolderPath: host.locations.output,
          parts: [], candidates: [], chapters: [{ id: `c-${randomUUID()}`, start: '00:00:00.000', title: 'Chapter 1' }], logs: [], totalDurationSeconds: 0, totalSizeBytes: 0,
          sourceMembershipReview: review
        };
        createdId = target.id;
        host.store.projects.push(target);
      }
      for (const owner of owners) {
        removeSourceMembership(owner.job, owner.files);
        owner.job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Reassigned ${owner.files.length} source files to ${target.name}; files remain on disk.` });
      }
      if (action === 'replace')
        removeSourceMembership(target, removed);
      const oldParts = new Map(target.parts.map(part => [sourceRelative(target, part), part]));
      target.parts = selected.map((file, index) => ({
        ...oldParts.get(file.relativePath), id: oldParts.get(file.relativePath)?.id || `p-${randomUUID()}`,
        name: file.relativePath, sourceRelativePath: file.relativePath, sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds,
        bitrate: file.bitrate || 0, discNumber: file.discNumber, trackNumber: file.trackNumber, order: index + 1
      }));
      target.discoveredFiles = selected;
      target.excludedSourceFiles = (target.excludedSourceFiles || []).filter(file => !selectedPaths.includes(file));
      target.explicitlyAddedSourceFiles = selectedPaths;
      target.sourceMembership = 'confirmed';
      target.sourceOrderManual = !!job.sourceOrderManual;
      target.bookScope = { title: coherent ? groups[0].title : target.name };
      if (target.source?.mode === 'file' && (selected.length !== 1 || host.files.pathKey(target.source.path) !== host.files.pathKey(path.join(root, selectedPaths[0]))))
        target.source = { ...target.source, path: root, mode: 'folder' };
      target.sourceFileStamps = Object.fromEntries(selectedPaths.map(file => [file, bookFileStamp(root, file)!]));
      if (target.parts.length && target.sourceMembershipReview?.startsWith('All source files'))
        target.sourceMembershipReview = undefined;
      sourceFilesInvalidated(target);
      updateSourceTotals(target);
      target.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Manually confirmed ${selected.length} project files. No physical files moved or deleted.` });
      const tree = bookSourceTree(job, root, input.body.view === 'directory' ? (typeof input.body.directory === 'string' ? input.body.directory : root) : undefined);
      host.store.commit();
      return reply(200, { job, ...tree, createdBook: action === 'create' ? { id: target.id, name: target.name, review: target.sourceMembershipReview } : undefined });
    }
    catch (error: any) {
      if (createdId)
        host.store.projects = host.store.projects.filter(item => item.id !== createdId);
      for (const { job: item, snapshot } of before) {
        for (const key of Object.keys(item) as (keyof AudiobookJob)[])
          if (!(key in snapshot))
            delete (item as any)[key];
        Object.assign(item, snapshot);
      }
      return reply(400, { error: error.message || 'Could not save manual grouping.' });
    }
    finally {
      host.activity.moving = false;
    }
  }

  async function postJobsSourceFiles(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (host.work.cleanupReason() || host.activity.imports.has(job.id) || host.work.processing || job.exports?.some(item => item.status === 'running' || item.status === 'queued') || host.activity.scan || host.work.mutations > 1)
      return reply(409, { error: 'Wait for current file operations to finish.' });
    let root = bookSourceRoot(job);
    if (!root)
      return reply(400, { error: 'Select a local book source first.' });
    const before = host.store.snapshot(job);
    const checkedBeforeSourceEdit = completionCurrent(job);
    let moved: ReturnType<typeof host.files.moveBookFiles> = [];
    let createdFolder: string | undefined;
    let copiedFile: string | undefined;
    host.activity.imports.add(job.id);
    try {
      if (input.body?.action === 'create-folder') {
        if (typeof input.body.parent !== 'string' || typeof input.body.name !== 'string')
          throw new Error('Choose a parent folder and enter a folder name.');
        const parent = path.resolve(root, input.body.parent || '');
        if (knownIntermediatesRoots().some(workspace => host.files.pathKey(parent) === host.files.pathKey(workspace) || host.files.within(workspace, parent)))
          throw new Error('SwissMouse processing folders cannot be changed here.');
        const created = host.files.createBookFolder(root, input.body.parent || '', input.body.name);
        createdFolder = path.join(root, created);
        job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Created source folder: ${created}` });
      }
      else if (input.body?.action === 'refresh') {
        const scan = await scanLocalFolder(root);
        job.sourceInventory = scan.files;
        const scanned = new Map(scan.files.map(file => [file.relativePath.replace(/\\/g, '/'), file]));
        let changed = false;
        for (const part of job.parts) {
          const relative = sourceRelative(job, part);
          const file = scanned.get(relative);
          if (!file)
            continue; // A missing source remains visible in the manifest for recovery.
          const current = bookFileStamp(root, relative);
          const prior = job.sourceFileStamps?.[relative];
          if (current && (prior ? current.sizeBytes !== prior.sizeBytes || current.modifiedMs !== prior.modifiedMs ||
            current.device !== prior.device || current.inode !== prior.inode : file.sizeBytes !== part.sizeBytes || Math.abs(file.durationSeconds - part.durationSeconds) > 0.02))
            changed = true;
          part.sizeBytes = file.sizeBytes;
          part.durationSeconds = file.durationSeconds;
          part.bitrate = file.bitrate || part.bitrate;
        }
        if (changed) {
          if (!job.sourceOrderManual)
            job.parts.sort(sourceOrderCompare);
          sourceFilesInvalidated(job);
        }
        job.sourceFileStamps ||= {};
        for (const part of job.parts) {
          const relative = sourceRelative(job, part);
          const stamp = bookFileStamp(root, relative);
          if (stamp)
            job.sourceFileStamps[relative] = stamp;
        }
        job.discoveredFiles = job.parts.map(part => scanned.get(sourceRelative(job, part)) ||
          job.discoveredFiles?.find(file => file.relativePath.replace(/\\/g, '/') === sourceRelative(job, part))).filter((file): file is DiscoveredAudioFile => !!file);
        job.unsupportedFiles = scan.unsupportedFiles;
        updateSourceTotals(job);
        job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Rescanned source root; found ${scan.files.length} audio files on disk; project membership preserved${changed ? '; existing source details changed' : ''}.` });
      }
      else if (input.body?.action === 'add') {
        if (typeof input.body.file !== 'string' || !path.isAbsolute(input.body.file) || typeof input.body.destination !== 'string')
          throw new Error('Choose one local audio file and a destination.');
        const selected = path.resolve(input.body.file);
        const media = validatedAudioFile(selected);
        const destination = input.body.destination ? path.resolve(root, input.body.destination) : root;
        if (!fs.existsSync(destination) || !fs.statSync(destination).isDirectory() || (destination !== root && !host.files.within(root, destination)))
          throw new Error('Choose a folder inside this book.');
        if (fs.realpathSync(destination).toLowerCase() !== destination.toLowerCase())
          throw new Error('Linked destination folders cannot be used.');
        const target = path.join(destination, path.basename(selected));
        const relative = path.relative(root, target).replace(/\\/g, '/');
        if (knownIntermediatesRoots().some(workspace => host.files.pathKey(target) === host.files.pathKey(workspace) || host.files.within(workspace, target)))
          throw new Error('SwissMouse processing folders cannot be source destinations.');
        if (job.parts.some(part => sourceRelative(job, part) === relative))
          throw new Error('This file is already in the project.');
        if (host.files.pathKey(target) === host.files.pathKey(selected) && sourceOwners([selected], job.id).length)
          throw new Error('This file belongs to another project. Use the manual selection actions to review reassignment.');
        if (host.files.pathKey(target) !== host.files.pathKey(selected)) {
          if (pathEntryExists(target))
            throw new Error('A file with that name already exists in the destination folder.');
          const stage = path.join(destination, `.swissmouse-${randomUUID()}.partial`);
          fs.copyFileSync(selected, stage, fs.constants.COPYFILE_EXCL);
          copiedFile = stage;
          if (fs.statSync(stage).size !== media.sizeBytes || await host.files.contentHash(stage) !== await host.files.contentHash(selected))
            throw new Error('The source file copy did not verify.');
          if (pathEntryExists(target))
            throw new Error('A file with that name appeared in the destination folder.');
          fs.renameSync(stage, target);
          copiedFile = target;
        }
        job.parts.push({
          id: `p-${randomUUID()}`, name: relative, sourceRelativePath: relative, sizeBytes: media.sizeBytes,
          durationSeconds: media.media.durationSeconds, bitrate: media.media.bitrate || 0, order: job.parts.length + 1
        });
        job.discoveredFiles = [...(job.discoveredFiles || []), {
          relativePath: relative, fileName: path.basename(relative),
          folderName: path.dirname(relative) === '.' ? 'Root' : path.basename(path.dirname(relative)), format: media.media.format,
          codec: media.media.codec, sampleRate: media.media.sampleRate, channels: media.media.channels,
          bitrate: media.media.bitrate, durationSeconds: media.media.durationSeconds, sizeBytes: media.sizeBytes,
          chapterGroup: path.dirname(relative) === '.' ? undefined : path.dirname(relative), isProbed: true, streamSignature: media.media.streamSignature
        }];
        job.sourceMembership = job.sourceMembership === 'confirmed' ? 'confirmed' : 'explicit';
        job.explicitlyAddedSourceFiles = [...new Set([...(job.explicitlyAddedSourceFiles || []), relative])];
        job.excludedSourceFiles = (job.excludedSourceFiles || []).filter(file => file !== relative);
        job.sourceFileStamps ||= {};
        job.sourceFileStamps[relative] = bookFileStamp(root, relative)!;
        if (job.source?.mode === 'file' && job.parts.length > 1)
          job.source = { ...job.source, mode: 'folder', path: path.dirname(job.source.path) };
        if (!job.sourceOrderManual)
          job.parts.sort(sourceOrderCompare);
        sourceFilesInvalidated(job);
        updateSourceTotals(job);
        job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Added source file to project: ${relative}` });
      }
      else if (input.body?.action === 'include' || input.body?.action === 'remove') {
        if (!Array.isArray(input.body.files) || !input.body.files.length || input.body.files.some((file: unknown) => typeof file !== 'string'))
          throw new Error('Select files in this book.');
        let chosen = new Set(input.body.files as string[]);
        if (input.body.action === 'remove') {
          if ([...chosen].some(file => !job.parts.some(part => sourceRelative(job, part) === file)))
            throw new Error('Selected files are not in the project.');
          const remaining = job.parts.filter(part => !chosen.has(sourceRelative(job, part)));
          if (remaining.length === job.parts.length)
            throw new Error('Selected files are not in the project.');
          const retainingFinishedBook = !remaining.length && job.validation?.status === 'PASS' &&
            !!job.outputM4b?.fullPath && fs.existsSync(job.outputM4b.fullPath);
          if (!remaining.length && !retainingFinishedBook)
            throw new Error('Keep at least one source file until a finished M4B has passed validation.');
          job.parts = remaining;
          job.discoveredFiles = job.discoveredFiles?.filter(file => !chosen.has(file.relativePath.replace(/\\/g, '/')));
          job.excludedSourceFiles = [...new Set([...(job.excludedSourceFiles || []), ...chosen])];
          for (const file of chosen) {
            delete job.sourcePathIdentity?.[file];
            delete job.sourceFileStamps?.[file];
          }
        }
        else {
          const directory = typeof input.body.directory === 'string' ? host.files.listBookDirectory(input.body.directory, host.media.extensions, knownIntermediatesRoots()) : undefined;
          const selectedPaths = [...chosen].map(file => {
            if (!directory)
              return host.files.resolveBookAudio(root!, file, host.media.extensions);
            const absolute = path.resolve(root!, file);
            if (!directory.entries.some(entry => entry.audio && host.files.pathKey(path.join(directory.directory, entry.name)) === host.files.pathKey(absolute)))
              throw new Error('Select available audio files in the current folder.');
            return host.files.resolveBookAudio(directory.directory, path.basename(absolute), host.media.extensions);
          });
          if (selectedPaths.some(file => knownIntermediatesRoots().some(workspace => host.files.within(workspace, file))))
            throw new Error('Processing files are not browse sources.');
          if (sourceOwners(selectedPaths, job.id).length)
            throw new Error('These files belong to another project. Use Create new book or Use as this book to review reassignment.');
          root = host.files.rebaseBookMembership(job, root, selectedPaths);
          chosen = new Set(selectedPaths.map(file => path.relative(root!, file).replace(/\\/g, '/')));
          const known = new Set(job.parts.map(part => sourceRelative(job, part)));
          const files: DiscoveredAudioFile[] = [...chosen].filter(file => !known.has(file)).map(relativePath => {
            const absolute = host.files.resolveBookAudio(root!, relativePath, host.media.extensions);
            const media = probeAudioFile(absolute);
            const tags = Object.fromEntries(Object.entries(media.tags).map(([key, value]) => [key.toLowerCase(), String(value)]));
            const number = (value?: string) => Number(/^\s*(\d+)/.exec(value || '')?.[1]) || undefined;
            return {
              relativePath, fileName: path.basename(absolute), folderName: path.basename(path.dirname(absolute)), sizeBytes: fs.statSync(absolute).size,
              durationSeconds: media.durationSeconds, bitrate: media.bitrate, format: media.format, codec: media.codec, sampleRate: media.sampleRate, channels: media.channels,
              streamSignature: media.streamSignature, tags, isProbed: true, discNumber: number(tags.disc || tags.discnumber), trackNumber: number(tags.track || tags.tracknumber)
            };
          });
          if (!files.length)
            throw new Error('No new audio files were selected.');
          for (const file of files)
            job.parts.push({
              id: `p-${randomUUID()}`, name: file.relativePath, sourceRelativePath: file.relativePath,
              sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds, bitrate: file.bitrate || 0, order: job.parts.length + 1,
              discNumber: file.discNumber, trackNumber: file.trackNumber
            });
          job.discoveredFiles = [...(job.discoveredFiles || []), ...files];
          job.excludedSourceFiles = (job.excludedSourceFiles || []).filter(file => !chosen.has(file));
          job.sourceFileStamps ||= {};
          for (const file of files)
            job.sourceFileStamps[file.relativePath.replace(/\\/g, '/')] = bookFileStamp(root, file.relativePath)!;
          if (!job.sourceOrderManual)
            job.parts.sort(sourceOrderCompare);
        }
        job.sourceMembership = job.sourceMembership === 'confirmed' ? 'confirmed' : 'explicit';
        job.explicitlyAddedSourceFiles = input.body.action === 'include' ? [...new Set([...(job.explicitlyAddedSourceFiles || []), ...chosen])] : (job.explicitlyAddedSourceFiles || []).filter(file => !chosen.has(file));
        if (job.source?.mode === 'file' && job.parts.length > 1)
          job.source = { ...job.source, mode: 'folder', path: path.dirname(job.source.path) };
        if (input.body.action === 'remove' && !job.parts.length) {
          job.sourceKey = undefined;
          job.preparedAudioKey = undefined;
          job.libraryScan = undefined;
          job.sourceFilesChanged = false;
          if (job.processingStatus === 'complete')
            job.completionSignature = await completionSignature(job);
        }
        else
          sourceFilesInvalidated(job);
        updateSourceTotals(job);
        job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `${input.body.action === 'remove' ? 'Removed from' : 'Added to'} project manifest: ${[...chosen].join(', ')}` });
      }
      else if (input.body?.action === 'group' || input.body?.action === 'ungroup') {
        setChapterGroup(job.parts, input.body.files, input.body.action === 'group' ? (input.body.title ?? '') : undefined, randomUUID());
        job.sourceOrderManual = true;
        if (job.chapterSource === 'grouped_files') {
          job.processingStatus = 'incomplete';
          job.staleSteps = [...new Set([...(job.staleSteps || []), 'chapter_review', 'export', 'validation'] as const)];
          job.pipelineSteps = { ...job.pipelineSteps, extracting_chapters: { ...job.pipelineSteps?.extracting_chapters, status: 'stale', hasOutput: !!job.chapters.length } };
        }
        job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: input.body.action === 'group' ? `Saved chapter group: ${input.body.title}` : 'Ungrouped selected chapter groups.' });
      }
      else if (input.body?.action === 'reorder') {
        if (!Array.isArray(input.body.files) || input.body.files.length !== job.parts.length ||
          new Set(input.body.files).size !== job.parts.length)
          throw new Error('Provide every source file once in the desired order.');
        const byPath = new Map(job.parts.map(part => [sourceRelative(job, part), part]));
        if (input.body.files.some((file: unknown) => typeof file !== 'string' || !byPath.has(file)))
          throw new Error('The source order changed. Refresh and retry.');
        const previous = job.parts.map(part => sourceRelative(job, part)).join('\0');
        const reordered = input.body.files.map((file: string) => byPath.get(file)!);
        manualChapterGroups(reordered);
        job.parts = reordered;
        const discovered = new Map((job.discoveredFiles || []).map(file => [file.relativePath.replace(/\\/g, '/'), file]));
        job.discoveredFiles = input.body.files.map((file: string) => discovered.get(file)).filter((file: DiscoveredAudioFile | undefined): file is DiscoveredAudioFile => !!file);
        job.sourceOrderManual = true;
        if (previous !== input.body.files.join('\0'))
          sourceFilesInvalidated(job);
        updateSourceTotals(job);
        job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Saved manual source-file order.' });
      }
      else if (input.body?.action === 'move') {
        if (!Array.isArray(input.body.files) || input.body.files.some((file: unknown) => typeof file !== 'string') || typeof input.body.destination !== 'string')
          throw new Error('Select files and a destination folder inside this book.');
        const selectedPaths = [...input.body.files, input.body.destination].map((value: string) => path.resolve(root, value));
        if (selectedPaths.some(file => knownIntermediatesRoots().some(workspace => host.files.pathKey(file) === host.files.pathKey(workspace) || host.files.within(workspace, file))))
          throw new Error('SwissMouse processing folders cannot be organized as source files.');
        if (sourceOwners((input.body.files as string[]).map(file => path.resolve(root, file)), job.id).length)
          throw new Error('Selected files belong to another project. Open that project to move its files.');
        const identity = new Map((input.body.files as string[]).map(file => { const stat = fs.statSync(path.resolve(root, file)); return [file.replace(/\\/g, '/'), { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }]; }));
        moved = host.files.moveBookFiles(root, input.body.files, input.body.destination);
        const sameFiles = moved.every(item => {
          const original = identity.get(item.oldRelativePath);
          const stat = fs.statSync(item.to);
          return !!original && stat.dev === original.dev && stat.ino === original.ino && stat.size === original.size && stat.mtimeMs === original.mtimeMs;
        });
        const changes = new Map(moved.map(item => [item.oldRelativePath.replace(/\\/g, '/'), item.relativePath]));
        for (const part of job.parts) {
          const old = (part.sourceRelativePath || part.name).replace(/\\/g, '/');
          const next = changes.get(old);
          if (next) {
            part.name = next;
            part.sourceRelativePath = next;
          }
        }
        for (const file of job.discoveredFiles || []) {
          const next = changes.get(file.relativePath.replace(/\\/g, '/'));
          if (next) {
            file.relativePath = next;
            file.storedName = next;
            file.fileName = path.basename(next);
            file.folderName = path.dirname(next) === '.' ? 'Root' : path.basename(path.dirname(next));
            file.chapterGroup = path.dirname(next) === '.' ? undefined : path.dirname(next);
          }
        }
        for (const file of job.unsupportedFiles || []) {
          const next = changes.get(file.relativePath.replace(/\\/g, '/'));
          if (next) {
            file.relativePath = next;
            file.fileName = path.basename(next);
          }
        }
        if (job.source?.mode === 'file') {
          const next = changes.get(path.relative(root, job.source.path).replace(/\\/g, '/'));
          if (next)
            job.source.path = path.join(root, next);
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
        if (!sameFiles)
          sourceFilesInvalidated(job);
        updateSourceTotals(job);
        if (sameFiles && job.processingStatus === 'complete' && job.completionSignature)
          job.completionSignature = await completionSignature(job);
        if (sameFiles && job.processingStatus === 'complete')
          job.sourceReorganizationPending = true;
        if (sameFiles && checkedBeforeSourceEdit && job.finalCheck)
          job.finalCheck.inputSignature = host.validation.signature(job);
        job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Moved ${moved.length} source file${moved.length === 1 ? '' : 's'} within ${root}.` });
      }
      else
        throw new Error('Unknown source-file action.');
      const tree = bookSourceTree(job, root, input.body.view === 'directory' ? (typeof input.body.directory === 'string' ? input.body.directory : root) : undefined);
      host.store.commit();
      return reply(200, { job, ...tree });
    }
    catch (error: any) {
      for (const item of moved.reverse()) {
        try {
          fs.renameSync(item.to, item.from);
        }
        catch (rollback: any) {
          host.logs.event('Source files', `Rollback failed for ${item.from}: ${rollback.message}`, 'ERROR');
        }
      }
      if (createdFolder) {
        try {
          fs.rmdirSync(createdFolder);
        }
        catch { /* Keep any newly added contents. */ }
      }
      if (copiedFile) {
        try {
          fs.unlinkSync(copiedFile);
        }
        catch { /* Keep the copied file if rollback cannot remove it. */ }
      }
      for (const key of Object.keys(job) as (keyof AudiobookJob)[])
        if (!(key in before))
          delete (job as any)[key];
      Object.assign(job, before);
      host.logs.failure(job.id, 'Source files', error.message);
      return reply(400, { error: error.message || 'Could not organize source files.' });
    }
    finally {
      host.activity.imports.delete(job.id);
    }
  }

  function postYoutubeFetchInfo(...args: Parameters<ImportProviders['postYoutubeFetchInfo']>): ReturnType<ImportProviders['postYoutubeFetchInfo']> { return providers.postYoutubeFetchInfo(...args); }

  function postYoutubeDownload(...args: Parameters<ImportProviders['postYoutubeDownload']>): ReturnType<ImportProviders['postYoutubeDownload']> { return providers.postYoutubeDownload(...args); }

  function postLibraryRefresh(...args: Parameters<LibraryDiscovery['postLibraryRefresh']>): ReturnType<LibraryDiscovery['postLibraryRefresh']> { return discovery.postLibraryRefresh(...args); }

  function postLibraryRescan(...args: Parameters<LibraryDiscovery['postLibraryRescan']>): ReturnType<LibraryDiscovery['postLibraryRescan']> { return discovery.postLibraryRescan(...args); }

  function postLibraryRebuild(...args: Parameters<LibraryDiscovery['postLibraryRebuild']>): ReturnType<LibraryDiscovery['postLibraryRebuild']> { return discovery.postLibraryRebuild(...args); }

  async function postJobsStep1Settings(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job) {
      return reply(404, { error: 'Job not found' });
    }
    const { sourceFolderPath, outputFolderPath, chapterSource, mergeMethod, selectedModelId, parts, } = input.body;
    if (job.sourceMembership === 'confirmed' && !(sourceFolderPath === '' && Array.isArray(parts) && parts.length === 0) &&
      ((sourceFolderPath !== undefined && sourceFolderPath !== job.sourceFolderPath) || (Array.isArray(parts) && JSON.stringify(parts.map((part: any) => part.name).sort()) !== JSON.stringify(job.parts.map(part => part.name).sort()))))
      return reply(409, { error: 'Manual file membership must be changed in Review Files.' });
    if (sourceFolderPath !== undefined && sourceFolderPath !== job.sourceFolderPath) {
      job.libraryScan = undefined;
      job.processingStatus = 'incomplete';
    }
    if (input.body.transcriptionSettings !== undefined) {
      try {
        job.transcriptionSettings = host.metadata.transcriptionSettings(input.body.transcriptionSettings);
      }
      catch (error: any) {
        return reply(400, { error: error.message });
      }
    }
    if (job.status === 'draft' && Array.isArray(parts) && parts.length > 0 &&
      (sourceFolderPath !== job.sourceFolderPath || JSON.stringify(parts.map((part: any) => [part.name, part.sizeBytes])) !== JSON.stringify(job.parts.map(part => [part.name, part.sizeBytes])))) {
      job.importInspected = false;
      job.importedMetadata = undefined;
      if (job.importPending)
        job.metadataDraft = undefined;
    }
    if (sourceFolderPath !== undefined)
      job.sourceFolderPath = sourceFolderPath;
    if (sourceFolderPath === '' && Array.isArray(parts) && parts.length === 0) {
      job.source = undefined;
      job.sourceMembership = undefined;
      job.explicitlyAddedSourceFiles = [];
      job.sourceMembershipReview = undefined;
      job.bookScope = undefined;
      job.sourceInventory = undefined;
      job.excludedSourceFiles = [];
    }
    if (input.body.inputMethod !== undefined)
      job.inputMethod = input.body.inputMethod;
    if (input.body.hasNestedChapterFolders !== undefined)
      job.hasNestedChapterFolders = input.body.hasNestedChapterFolders;
    if (outputFolderPath !== undefined)
      job.outputFolderPath = outputFolderPath;
    if (chapterSource !== undefined)
      job.chapterSource = chapterSource;
    if (input.body.generateTranscript !== undefined)
      job.generateTranscript = input.body.generateTranscript === true;
    if (input.body.generateWaveform !== undefined) {
      job.generateWaveform = input.body.generateWaveform === true;
      if (!job.generateWaveform)
        job.waveformReady = false;
    }
    if (mergeMethod !== undefined)
      job.mergeMethod = mergeMethod;
    if (selectedModelId !== undefined)
      job.selectedModelId = selectedModelId;
    if (Array.isArray(input.body.discoveredFiles))
      job.discoveredFiles = input.body.discoveredFiles;
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
      if (sourceFolderPath && (!job.source || path.resolve(job.sourceFolderPath || '') !== path.resolve(host.locations.appRoot, sourceFolderPath))) {
        const resolved = path.resolve(host.locations.appRoot, sourceFolderPath);
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
      job.chapterReviewBaseline = undefined;
      job.chapters = [{ id: `c-${Date.now()}`, start: '00:00:00.000', title: 'Chapter 1' }];
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
    host.store.commit();
    return reply(200, { status: 'ok', job });
  }

  async function postJobsSourceFile(input: FileCommandInput) {
    const index = host.store.projects.findIndex(item => item.id === input.params.id);
    const job = host.store.projects[index];
    if (!job)
      return reply(404, { error: 'Book not found.' });
    const relink = input.body?.relink === true;
    if (relink) {
      if (job.importPending || !sourceMissing(job) || !job.parts.length)
        return reply(409, { error: 'Only a missing source can be relinked here.' });
    }
    else if (!job.importPending || job.status !== 'draft')
      return reply(409, { error: 'Start an Import Book before selecting a source.' });
    if (host.activity.imports.has(job.id) || host.work.processing || job.exports?.some(item => ['queued', 'running'].includes(item.status)))
      return reply(409, { error: 'Wait for the current file operation to finish.' });
    if (relink && job.parts.length > 1) {
      const previous = host.store.snapshot(job);
      host.activity.imports.add(job.id);
      try {
        const root = host.files.listBookDirectory(input.body?.path, host.media.extensions, knownIntermediatesRoots()).directory;
        const sourceTags: Record<string, unknown>[] = [];
        const parts = await Promise.all(job.parts.map(async (part) => {
          const relative = sourceRelative(job, part), file = path.resolve(root, relative);
          if (!host.files.within(root, file))
            throw new Error('Source member lies outside the selected folder.');
          await host.files.assertUnlinked(file);
          const media = await host.media.read(host.media.ffprobe(), file);
          sourceTags.push(media.tags);
          return { ...part, name: relative, sourceRelativePath: relative, sizeBytes: (await fs.promises.stat(file)).size, durationSeconds: media.durationSeconds, bitrate: media.bitrate };
        }));
        const identity = checkRelinkIdentity(job.metadataDraft || job.metadata || {}, sourceTags, false);
        if (identity && (identity.code !== 'RELINK_CONFIRM_IDENTITY' || input.body?.confirmSameRecording !== true))
          return reply(409, identity);
        sourceFilesInvalidated(job);
        job.source = { kind: 'external', mode: 'folder', path: root };
        job.sourceFolderPath = root;
        job.parts = parts;
        job.sourceInventory = undefined;
        job.discoveredFiles = undefined;
        job.sourceFileStamps = undefined;
        job.sourcePathIdentity = undefined;
        updateSourceTotals(job);
        host.store.commit();
        return reply(200, { job: { ...job, sourceMissing: false }, book: host.views.book(job) });
      }
      catch (error: any) {
        restoreProject(job, previous);
        return reply(400, { error: 'Could not relink all selected parts: ' + error.message });
      }
      finally {
        host.activity.imports.delete(job.id);
      }
    }
    let selected: ReturnType<typeof validatedAudioFile>;
    try {
      selected = validatedAudioFile(input.body?.path);
    }
    catch (error: any) {
      return reply(400, { error: error.message || 'Could not use selected audio file.' });
    }
    const previous = host.store.snapshot(job);
    try {
      const { file, media, sizeBytes } = selected;
      if (relink) {
        const identity = checkRelinkIdentity(job.metadataDraft || job.metadata || {}, [media.tags], true);
        if (identity && (identity.code !== 'RELINK_CONFIRM_IDENTITY' || input.body?.confirmSameRecording !== true))
          return reply(409, identity);
      }
      if (relink) {
        sourceFilesInvalidated(job);
        job.sourceFileStamps = undefined;
        job.sourcePathIdentity = undefined;
      }
      const name = path.basename(file);
      job.libraryScan = undefined;
      job.processingStatus = 'incomplete';
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
      if (!relink) {
        job.excludedSourceFiles = [];
        job.sourceFileStamps = undefined;
        job.sourcePathIdentity = undefined;
        job.sourceOrderManual = false;
        job.importInspected = false;
        job.importedMetadata = undefined;
        job.metadataDraft = undefined;
        job.chapterReviewBaseline = undefined;
        job.chapters = [{ id: `c-${Date.now()}`, start: '00:00:00.000', title: 'Chapter 1' }];
      }
      job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `${relink ? 'Relinked' : 'Referenced'} external source: ${file}` });
      host.store.commit();
      return reply(200, { job: { ...job, sourceMissing: false }, book: host.views.book(job) });
    }
    catch (error: any) {
      host.store.projects[index] = previous;
      return reply(500, { error: `Could not save source reference: ${error.message}` });
    }
  }

  async function postJobsLocalSource(input: FileCommandInput) {
    const index = host.store.projects.findIndex(item => item.id === input.params.id);
    const job = host.store.projects[index];
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (!job.importPending || job.status !== 'draft')
      return reply(409, { error: 'Start an Import Book before selecting audio.' });
    if (host.activity.imports.has(job.id) || host.work.processing || job.exports?.some(item => ['queued', 'running'].includes(item.status)))
      return reply(409, { error: 'Wait for the current file operation to finish.' });
    host.activity.imports.add(job.id);
    try {
      const move = input.body?.move === true;
      const commit = input.body?.commit === true;
      let selection: Awaited<ReturnType<typeof localAudioSelection>>;
      let destination: ReturnType<typeof localLibraryTarget> | undefined;
      try {
        selection = await localAudioSelection(input.body?.paths ?? input.body?.path, input.body?.groupId);
        if (selection.needsGroup) {
          if (commit)
            return reply(409, { error: 'This folder contains several probable books. Choose a candidate book first.', groups: selection.groups });
          return reply(200, { files: selection.files, groups: selection.groups, needsGroup: true, sourcePath: selection.root });
        }
        if (move) {
          if (fs.lstatSync(selection.root).isSymbolicLink())
            throw new Error('A linked source folder cannot be moved safely.');
          destination = localLibraryTarget(selection);
          for (const file of selection.files) {
            const source = path.join(selection.root, file.relativePath);
            if (fs.lstatSync(source).isSymbolicLink())
              throw new Error(`Linked audio cannot be moved safely: ${source}`);
            if (host.store.projects.some(other => other.id !== job.id && sourceFilePaths(other).some(otherPath => path.resolve(otherPath) === path.resolve(source))))
              throw new Error(`This audio is already used by another book: ${source}`);
          }
        }
        if (!commit)
          return reply(200, {
            files: selection.files, groups: selection.groups, orderWarning: selection.orderWarning, sourcePath: selection.mode === 'file' ? path.join(selection.root, selection.files[0].fileName) : selection.root,
            destination: destination?.target, collision: destination ? destination.base !== destination.target : false
          });
        if (move && input.body?.destination !== destination?.target)
          return reply(409, { error: 'The Library destination changed. Check the move again before confirming.' });
      }
      catch (error: any) {
        return reply(400, { error: error.message || 'Could not validate local audio.' });
      }
      const previous = host.store.snapshot(job);
      host.activity.imports.add(job.id);
      host.activity.moving = true;
      try {
        const commitSelection = () => {
          const sourceRoot = destination?.target || selection.root;
          job.libraryScan = undefined;
          job.processingStatus = 'incomplete';
          job.source = {
            kind: move ? 'managed' : 'external',
            path: selection.mode === 'file' ? path.join(sourceRoot, selection.files[0].fileName) : sourceRoot, mode: selection.mode
          };
          job.sourceFolderPath = sourceRoot;
          job.parts = selection.files.map((file, i) => ({
            id: `p-${i + 1}`, name: file.relativePath,
            sourceRelativePath: file.relativePath, discNumber: file.discNumber, trackNumber: file.trackNumber,
            sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds,
            bitrate: file.bitrate || 0, order: i + 1
          }));
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
          job.chapterReviewBaseline = undefined;
          job.chapters = [{ id: `c-${Date.now()}`, start: '00:00:00.000', title: 'Chapter 1' }];
          job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `${move ? 'Moved' : 'Referenced'} local audio: ${job.source.path}` });
          host.store.commit();
        };
        let warning: string | undefined;
        if (destination) {
          const entries: MoveEntry[] = await Promise.all(selection.files.map(async (file) => ({ source: path.join(selection.root, file.relativePath), name: file.relativePath, stamp: await host.files.stamp(path.join(selection.root, file.relativePath)) })));
          warning = await host.files.transferProjectFiles({
            root: destination.root, journal: host.locations.appPath('library-move-' + randomUUID() + '.json'),
            intent: { version: 2, id: job.id, operation: 'import', source: previous.source?.path || selection.root, target: destination.target, mode: 'move', entries },
            boundaries: [destination.root], protectedFiles: new Set(), log: message => host.logs.event('Import', message),
            commit: commitSelection, rollback: () => restoreProject(job, previous)
          });
        }
        else
          commitSelection();
        return reply(200, { job: { ...job, sourceMissing: false }, warning });
      }
      catch (error: any) {
        return reply(500, { error: error.message || 'Could not select local audio.' });
      }
      finally {
        host.activity.moving = false;
      }
    }
    finally {
      host.activity.imports.delete(job.id);
    }
  }

  async function postJobsInspectImport(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    host.activity.imports.add(job.id);
    try {
      const files = importedSourcePaths(job);
      const media = await host.media.read(host.media.ffprobe(), files[0]);
      const fallback = job.bookScope?.title || (files.length === 1 ? path.basename(files[0], path.extname(files[0])) : path.basename(job.sourceFolderPath!));
      await backfillProjectCompanions(job);
      const folder = bookSourceRoot(job)!;
      const fileStamps = await Promise.all(files.map(file => host.files.stamp(file, path.relative(folder, file))));
      const companions = (job.associatedFiles || []).filter((file): file is {
        path: string;
        kind: 'metadata' | 'cover';
      } => file.kind === 'metadata' || file.kind === 'cover');
      const imported = (await host.files.identifyBook({
        path: job.source?.path || folder, folder, mode: job.source?.mode || 'folder', title: fallback,
        files: fileStamps, signature: host.files.fileSignature(fileStamps), identity: '', metadataFile: companions.find(file => file.kind === 'metadata')?.path, associatedFiles: companions
      }, async (file) => (await host.media.read(host.media.ffprobe(), file)).tags)).metadata;
      if (media.artwork && !imported.cover) {
        const coverPath = path.join(projectIntermediatesDir(job), media.artwork.codec_name === 'png' ? 'import-cover.png' : 'import-cover.jpg');
        fs.mkdirSync(path.dirname(coverPath), { recursive: true });
        execFileSync(host.media.ffmpeg(), ['-v', 'error', '-y', '-i', files[0], '-map', `0:${media.artwork.index}`, '-c', 'copy', coverPath], { windowsHide: true });
        imported.cover = { source: 'local', filename: path.basename(coverPath), url: `data:image/${coverPath.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(coverPath).toString('base64')}` };
      }
      const previous = job.importedMetadata;
      const current = job.metadataDraft || job.metadata;
      const merged = { ...imported };
      for (const key of new Set([...Object.keys(imported), ...Object.keys(current || {})]) as Set<keyof AudiobookMetadata>) {
        if (previous && current && JSON.stringify(current[key]) !== JSON.stringify(previous[key]))
          (merged as any)[key] = current[key];
        else if (!job.importPending && current && current[key] !== undefined)
          (merged as any)[key] = current[key];
        else if (job.inputMethod === 'librivox' && current && current[key] && !(key === 'title' && current.title === 'New book'))
          (merged as any)[key] = current[key];
      }
      job.importedMetadata = imported;
      job.sourceTags = Object.fromEntries(Object.entries(media.tags).map(([key, value]) => [key, String(value)]));
      job.sourceFormat = media.format;
      job.sourceCodec = media.codec;
      const existing = await chaptersForJob(job, files.map(file => ({ file, ...host.media.inspect(host.media.ffprobe(), file) })));
      job.existingChapters = existing.chapters;
      job.existingChapterSource = existing.source;
      if (existing.sidecar)
        associateProjectFile(job, existing.sidecar, 'chapters');
      if (job.importPending && !job.importInspected && job.existingChapters.length)
        job.chapters = applyDefaultChapterEnds(job.existingChapters, job.totalDurationSeconds);
      job.metadataDraft = merged;
      job.metadata = merged;
      job.importInspected = true;
      job.name = merged.title;
      job.author = merged.author;
      job.narrator = merged.narrator;
      host.store.commit();
      return reply(200, job);
    }
    catch (error: any) {
      return reply(400, { error: error.message || 'Could not inspect source audio.' });
    }
    finally {
      host.activity.imports.delete(job.id);
    }
  }

  async function postJobsScanCover(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job) {
      return reply(404, { error: 'Job not found' });
    }
    // A path import points to the original folder. A browser folder import stores
    // its selected cover beside the copied audio because browsers hide local paths.
    const sourceDir = job.sourceFolderPath && path.resolve(host.locations.appRoot, job.sourceFolderPath);
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
        if (stats.size > 10 * 1024 * 1024)
          return reply(400, { error: 'Source cover exceeds the 10 MiB limit.' });
        const ext = path.extname(selected.name).slice(1).toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        foundCover = {
          source: 'local', filename: selected.name,
          url: `data:${mime};base64,${fs.readFileSync(selected.fullPath).toString('base64')}`,
          mimeType: mime, sizeBytes: stats.size, width: 1400, height: 1400,
        };
        associateProjectFile(job, selected.fullPath, 'cover');
        host.store.commit();
      }
    }
    if (foundCover) {
      return reply(200, {
        found: true,
        cover: foundCover,
        message: `Found '${foundCover.filename}' in the imported audio folder. Added to your metadata draft.`,
      });
    }
    return reply(200, {
      found: false,
      message: 'No cover.jpg/png/webp was found in the imported audio folder. You can upload an image or provide an image URL.',
    });
  }

  function getJobsExportFolderMove(...args: Parameters<LibraryTransfers['getJobsExportFolderMove']>): ReturnType<LibraryTransfers['getJobsExportFolderMove']> { return transfers.getJobsExportFolderMove(...args); }

  function postJobsExportFolderMove(...args: Parameters<LibraryTransfers['postJobsExportFolderMove']>): ReturnType<LibraryTransfers['postJobsExportFolderMove']> { return transfers.postJobsExportFolderMove(...args); }

  async function postJobsFinishImport(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (!job.importPending && (job.status !== 'draft' || job.sourceKey || job.mergedMp3))
      return reply(409, { error: 'This book is already being processed.' });
    const metadata = input.body?.metadata as AudiobookMetadata;
    if (!metadata?.title?.trim())
      return reply(400, { error: 'Book title is required.' });
    let files: string[];
    try {
      files = importedSourcePaths(job);
    }
    catch (error: any) {
      return reply(400, { error: error.message });
    }
    if (host.activity.imports.has(job.id))
      return reply(409, { error: 'Wait for the source import to finish.' });
    const writeSource = input.body?.writeSource === true;
    const process = input.body?.process === true;
    if (writeSource && files.some(file => !host.media.outputFormats.includes(path.extname(file).slice(1).toLowerCase() as OutputAudioFormat)))
      return reply(400, { error: 'One or more source formats do not support safe metadata writing. Keep the option off to save SwissMouse metadata only.' });
    host.activity.imports.add(job.id);
    try {
      if (writeSource)
        for (const file of files) {
          const format = path.extname(file).slice(1).toLowerCase() as OutputAudioFormat;
          const original = host.media.inspect(host.media.ffprobe(), file);
          const tags = audiobookTags(metadata, undefined, Object.fromEntries(Object.entries(original.tags).map(([key, value]) => [key, String(value)])), format);
          const trackTitle = Object.entries(original.tags).find(([key]) => key.toLowerCase() === 'title')?.[1];
          if (files.length > 1 && trackTitle)
            tags[['flac', 'ogg', 'opus'].includes(format) ? 'TITLE' : 'title'] = String(trackTitle);
          let cover: string | null | undefined;
          const changedCover = JSON.stringify(metadata.cover || null) !== JSON.stringify(job.importedMetadata?.cover || null);
          if (changedCover && ['m4b', 'm4a', 'mp3', 'flac'].includes(format)) {
            if (!metadata.cover)
              cover = null;
            else {
              cover = await host.media.writeCoverImage(projectIntermediatesDir(job), metadata.cover.url, 'metadata-cover-' + randomUUID());
            }
          }
          try {
            await host.media.writeAudioMetadata({ ffmpeg: host.media.ffmpeg(), ffprobe: host.media.ffprobe(), file, format, tags, cover });
          }
          finally {
            if (typeof cover === 'string' && fs.existsSync(cover))
              fs.rmSync(cover, { force: true });
          }
        }
      applySavedMetadata(job, metadata);
      job.importPending = false;
      job.importFinished = !process;
      try {
        if (sourceLocation(job) === 'managed')
          host.metadata.writeSidecars(job, files);
      }
      catch (error: any) {
        job.logs.push({ timestamp: new Date().toISOString(), level: 'WARNING', message: `Book saved; exmetadata.json could not be written: ${error.message}` });
      }
      job.importedAt = new Date().toISOString();
      job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'INFO', message: process ? 'Import saved; ready for processing.' : 'Import finished without audio processing.' });
      host.store.commit();
      await host.catalog!.publish([job.id]);
      return reply(200, { job, book: host.views.book(job) });
    }
    catch (error: any) {
      return reply(500, { error: error.message || 'Could not finish import.' });
    }
    finally {
      host.activity.imports.delete(job.id);
    }
  }

  function getJobsMoveToLibrary(...args: Parameters<LibraryTransfers['getJobsMoveToLibrary']>): ReturnType<LibraryTransfers['getJobsMoveToLibrary']> { return transfers.getJobsMoveToLibrary(...args); }

  function postJobsMoveToLibrary(...args: Parameters<LibraryTransfers['postJobsMoveToLibrary']>): ReturnType<LibraryTransfers['postJobsMoveToLibrary']> { return transfers.postJobsMoveToLibrary(...args); }

  function getJobsOrganizeLibrary(...args: Parameters<LibraryTransfers['getJobsOrganizeLibrary']>): ReturnType<LibraryTransfers['getJobsOrganizeLibrary']> { return transfers.getJobsOrganizeLibrary(...args); }

  async function postJobsChapterFile(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (host.work.processing || host.activity.imports.has(job.id) || job.exports?.some(item => ['running', 'queued'].includes(item.status)))
      return reply(409, { error: 'Wait for file processing to finish before changing chapter sources.' });
    try {
      if (typeof input.body?.name !== 'string' || typeof input.body?.content !== 'string')
        throw new Error('Choose a chapter or playlist file.');
      const name = path.basename(input.body.name);
      if (name.length > 255)
        throw new Error('The filename is too long.');
      const files = importedSourcePaths(job);
      const sourceKey = await sourceFingerprint(job, files);
      const sources = await Promise.all(files.map(async (file) => ({ file, ...await host.media.read(host.media.ffprobe(), file) })));
      const parsed = host.chapters.parse(name, input.body.content, sources, bookSourceRoot(job) || path.dirname(files[0]));
      if (sourceKey !== await sourceFingerprint(job, files))
        throw new Error('Audio changed while importing. Check the project files and try again.');
      const previous = { file: job.importedChapterFile, source: job.chapterSource };
      job.importedChapterFile = { name, content: input.body.content, sourceKey };
      job.chapterSource = 'existing_chapters';
      try {
        host.store.commit();
      }
      catch (error) {
        job.importedChapterFile = previous.file;
        job.chapterSource = previous.source;
        throw error;
      }
      return reply(200, { count: parsed.chapters.length, source: `Imported ${parsed.kind === 'tracks' ? 'playlist track boundaries' : 'chapters'}: ${name}`, importedName: name, kind: parsed.kind });
    }
    catch (error: any) {
      return reply(400, { error: error.message || 'Could not import chapter file.' });
    }
  }

  async function deleteJobsChapterFile(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (host.work.processing || host.activity.imports.has(job.id) || job.exports?.some(item => ['running', 'queued'].includes(item.status)))
      return reply(409, { error: 'Wait for file processing to finish.' });
    const previous = job.importedChapterFile;
    job.importedChapterFile = undefined;
    try {
      host.store.commit();
    }
    catch (error) {
      job.importedChapterFile = previous;
      throw error;
    }
    return reply(200, { cleared: true });
  }

  async function getJobsExistingChapters(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    try {
      const files = importedSourcePaths(job);
      const sources = await Promise.all(files.map(async (file) => ({ file, ...await host.media.read(host.media.ffprobe(), file) })));
      const existing = await chaptersForJob(job, sources);
      return reply(200, { count: existing.chapters.length, source: existing.source, importedName: job.importedChapterFile?.name });
    }
    catch (error: any) {
      return reply(409, { error: error.message || 'Could not read existing chapters.' });
    }
  }

  function postJobsOrganizeLibrary(...args: Parameters<LibraryTransfers['postJobsOrganizeLibrary']>): ReturnType<LibraryTransfers['postJobsOrganizeLibrary']> { return transfers.postJobsOrganizeLibrary(...args); }

  function postLibrarySendToLibrary(...args: Parameters<LibraryTransfers['postLibrarySendToLibrary']>): ReturnType<LibraryTransfers['postLibrarySendToLibrary']> { return transfers.postLibrarySendToLibrary(...args); }
  return { recover: transfers.recoverFileTransfers, helpers: { bookSourceRoot, sourceRelative, bookFileStamp, sourceFingerprint, sourceFilesInvalidated, updateSourceTotals, bookSourceTree, sourceOwners, removeSourceMembership, importedSourcePaths, validatedAudioFile, localAudioSelection, localLibraryTarget, sourceLocation, sourceFilePaths, archiveCurrent, availableOriginalPaths, sourceMissing, survivingLibraryM4b, reconcileLibrary, transferAssociatedProject, organizeLibraryPlan, removeOrganizeScaffold, associateProjectFile, projectFilePaths, backfillProjectCompanions, restoreProject, ownedProjectDestination, remapBookPaths, naturalSort, scanLocalFolder, probeAudioFile, knownIntermediatesRoots, resolvedOutputRoot, projectIntermediatesDir, isManagedChild, pathEntryExists, ensureUnlinkedLibraryParent, isInboxPath, bookRootType, completionCurrent, canMoveInboxBook, completionSignature, planSingleExportFolderMove, planExportFolderMove, chaptersForJob, exportedAudioPaths }, commands: { postUploadAudio, getJobsSourceTree, postJobsSourceFolderOpen, postJobsSourceSelection, postJobsSourceFiles, postYoutubeFetchInfo, postYoutubeDownload, postLibraryRefresh, postLibraryRescan, postLibraryRebuild, postJobsStep1Settings, postJobsSourceFile, postJobsLocalSource, postJobsInspectImport, postJobsScanCover, getJobsExportFolderMove, postJobsExportFolderMove, postJobsFinishImport, getJobsMoveToLibrary, postJobsMoveToLibrary, getJobsOrganizeLibrary, postJobsChapterFile, deleteJobsChapterFile, getJobsExistingChapters, postJobsOrganizeLibrary, postLibrarySendToLibrary } };
}
export type AudiobookFileBackend = ReturnType<typeof createAudiobookFileBackend>;
