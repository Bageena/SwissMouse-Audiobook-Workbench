import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { audiobookshelfMetadata } from './audiobookshelf-metadata';
import { planChapterExport } from './chapter-export';
import type { ChapterEntry } from './domain';
import { extendedMetadata } from './extended-metadata';
import type { AudiobookFilePorts, CopiedFile, FileCommandInput, MoveEntry, TransferJournal } from './file-ports';
import { fileReply as reply, type SourceFileFacts } from './file-ports';
import type { AudiobookJob, OutputAudioFormat } from './legacy-domain';
import { DEFAULT_LIBRARY_TEMPLATE, finalOutputRoot, libraryRelativePath } from './library-path';
const isWin = process.platform === 'win32';

export function createLibraryTransfers(host: AudiobookFilePorts, source: Pick<SourceFileFacts, "availableOriginalPaths" | "bookSourceRoot" | "sourceFilePaths" | "exportedAudioPaths" | "pathEntryExists" | "completionSignature" | "sourceRelative" | "sourceLocation" | "canMoveInboxBook" | "completionCurrent" | "isManagedChild" | "sourceMissing" | "survivingLibraryM4b" | "knownIntermediatesRoots" | "resolvedOutputRoot">) {
  const { availableOriginalPaths, bookSourceRoot, sourceFilePaths, exportedAudioPaths, pathEntryExists, completionSignature, sourceRelative, sourceLocation, canMoveInboxBook, completionCurrent, isManagedChild, sourceMissing, survivingLibraryM4b, knownIntermediatesRoots, resolvedOutputRoot } = source;
  function associateProjectFile(job: AudiobookJob, file: string, kind: NonNullable<AudiobookJob['associatedFiles']>[number]['kind']) {
    job.associatedFiles = [...(job.associatedFiles || []).filter(item => host.files.pathKey(item.path) !== host.files.pathKey(file)), { path: file, kind }];
  }

  function projectFilePaths(job: AudiobookJob): string[] {
    return host.files.projectFiles(job, availableOriginalPaths(job)).map(file => file.path);
  }

  async function backfillProjectCompanions(job: AudiobookJob) {
    const sourceRoot = bookSourceRoot(job);
    if (!sourceRoot || !fs.existsSync(sourceRoot))
      return;
    const owned = new Set(projectFilePaths(job).map(host.files.pathKey));
    const extensions = new Set([...host.media.extensions, ...sourceFilePaths(job).map(file => path.extname(file).slice(1).toLowerCase())]);
    // Older exports predate associatedFiles. Only accept scanner-owned companions
    // when every audio member is already explicitly attached to this project.
    for (const folder of new Set([sourceRoot, ...exportedAudioPaths(job).map(file => path.dirname(file))])) {
      // Only this directory's companions need legacy backfill; do not rescan a collection.
      const subfolders = (await fs.promises.readdir(folder, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(folder, entry.name));
      const diskBooks = await host.files.scanRoot(folder, extensions, subfolders);
      for (const disk of diskBooks)
        if (disk.files.length && disk.files.every(file => owned.has(host.files.pathKey(path.join(disk.folder, file.name))))) {
          for (const file of disk.associatedFiles || [])
            associateProjectFile(job, file.path, file.kind);
        }
    }
    for (const output of exportedAudioPaths(job))
      if (fs.existsSync(output + '.cue'))
        associateProjectFile(job, output + '.cue', 'chapters');
  }

  function restoreProject(job: AudiobookJob, previous: AudiobookJob) {
    Object.keys(job).forEach(key => delete (job as any)[key]);
    Object.assign(job, previous);
  }

  async function ownedProjectDestination(job: AudiobookJob, target: string): Promise<CopiedFile[] | undefined> {
    if (!pathEntryExists(target))
      return undefined;
    const outputs = [job.outputM4b, ...(job.exports || []).filter(output => output.status === 'success')]
      .filter(output => output?.fullPath && host.files.pathKey(path.dirname(output.fullPath)) === host.files.pathKey(target));
    if (!outputs.length)
      return undefined;
    for (const output of outputs) {
      const expected = output!.fileIdentity;
      if (!expected || (await host.files.stamp(output!.fullPath!)).identity !== expected)
        return undefined;
    }
    const owned = new Set(projectFilePaths(job).map(host.files.pathKey));
    const shared = new Set(host.store.projects.filter(other => other.id !== job.id).flatMap(projectFilePaths).map(host.files.pathKey));
    const files = await host.files.inventory(target);
    if (!files.length || files.some(file => !owned.has(host.files.pathKey(path.join(target, file.name))) || shared.has(host.files.pathKey(path.join(target, file.name)))))
      return undefined;
    return Promise.all(files.map(async (file) => ({ name: file.name, stamp: file, hash: await host.files.contentHash(path.join(target, file.name)) })));
  }

  async function transferAssociatedProject(job: AudiobookJob, target: string, mode: 'copy' | 'move', options: {
    finishedOnly?: boolean;
    finalCheck?: boolean;
    onlyFolder?: string;
    allowMissingSources?: boolean;
    destinationRoot?: string;
    destinationKind?: 'inbox' | 'managed';
  } = {}) {
    const previous = host.store.snapshot(job);
    const source = job.source?.path || job.sourceFolderPath || '';
    const sourceRoot = bookSourceRoot(job) || path.dirname(job.outputM4b?.fullPath || target);
    const sources = sourceFilePaths(job);
    const generated = await fs.promises.mkdtemp(host.locations.appPath('.swissmouse-transfer-'));
    const log = (message: string) => host.logs.event('Library transfer', message);
    try {
      if (!options.finishedOnly && !options.onlyFolder)
        await backfillProjectCompanions(job);
      const existingTarget = await ownedProjectDestination(job, target);
      const members = new Set(sources.map(host.files.pathKey));
      const files = host.files.projectFiles(job, options.finishedOnly ? [] : availableOriginalPaths(job)).filter(file => !options.onlyFolder || host.files.within(options.onlyFolder, file.path));
      const exportFolders = new Set(exportedAudioPaths(job).filter(file => !members.has(host.files.pathKey(file))).map(file => host.files.pathKey(path.dirname(file))));
      const separateOutput = (file: string) => !host.files.within(sourceRoot, file) || (!members.has(host.files.pathKey(file)) && exportFolders.has(host.files.pathKey(path.dirname(file))) && host.files.pathKey(path.dirname(file)) !== host.files.pathKey(sourceRoot));
      const entries: MoveEntry[] = [];
      // Finished audio and companions belong at the book root. Preserve colliding
      // original names in a separate subfolder instead of overwriting either file.
      for (const file of [...files].sort((a, b) => Number(b.roles.includes('output')) - Number(a.roles.includes('output')) || Number(host.files.within(target, b.path)) - Number(host.files.within(target, a.path)))) {
        if ((options.finishedOnly || (options.allowMissingSources && members.has(host.files.pathKey(file.path)))) && !fs.existsSync(file.path))
          continue;
        let name = file.roles.includes('output') || file.path === job.originalsArchive?.path || separateOutput(file.path) ? path.basename(file.path)
          : options.onlyFolder ? path.relative(options.onlyFolder, file.path) : path.relative(sourceRoot, file.path);
        if (entries.some(entry => host.files.pathKey(entry.name) === host.files.pathKey(name))) {
          if (file.roles.includes('output'))
            throw new Error('Several finished files have the same name. Rename them before transferring.');
          const prefix = file.roles.includes('source') ? 'Original audio' : 'Original sidecars';
          name = path.join(prefix, path.basename(file.path));
          for (let index = 2;entries.some(entry => host.files.pathKey(entry.name) === host.files.pathKey(name));index++)
            name = path.join(prefix, String(index), path.basename(file.path));
        }
        entries.push({ source: file.path, name, stamp: await host.files.stamp(file.path) });
      }
      if (!entries.length)
        throw new Error('No associated book files are available.');
      // Keep superseded physical sidecars as associated originals. The root sidecar
      // and root cover always describe the saved book that the user sees.
      const generatedFiles: {
        file: string;
        name: string;
        kind: 'metadata' | 'cover';
      }[] = [];
      let chapters: ChapterEntry[] = [];
      try {
        chapters = planChapterExport(job.chapters, job.totalDurationSeconds).chapters as ChapterEntry[];
      }
      catch { /* Imported books need no processing. */ }
      if (job.metadata) {
        const sidecars = [['exmetadata.json', extendedMetadata(job.metadata, chapters, job.id)], ...(host.locations.config.audiobookshelf_metadata ? [['metadata.json', audiobookshelfMetadata(job.metadata, chapters)]] : [])] as const;
        for (const [name, data] of sidecars) {
          const file = path.join(generated, name as string);
          await fs.promises.writeFile(file, JSON.stringify(data, null, 2) + '\n');
          generatedFiles.push({ file, name: name as string, kind: 'metadata' });
        }
      }
      const cover = job.metadata?.cover;
      if (cover && host.locations.config.save_cover_beside_audio !== false) {
        const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(cover.url);
        if (!match)
          throw new Error('Save a local PNG, JPEG or WebP cover before transferring this book.');
        const name = 'cover.' + (match[1] === 'jpeg' ? 'jpg' : match[1]);
        const file = path.join(generated, name);
        await fs.promises.writeFile(file, Buffer.from(match[2], 'base64'));
        generatedFiles.push({ file, name, kind: 'cover' });
      }
      // Already-published companions were saved with the verified export. Keep
      // those files in place; transfer must not rewrite or archive them again.
      if (existingTarget)
        for (let index = generatedFiles.length - 1;index >= 0;index--) {
          if (entries.some(entry => host.files.pathKey(entry.source) === host.files.pathKey(path.join(target, generatedFiles[index].name)) && host.files.pathKey(entry.source) === host.files.pathKey(path.join(target, entry.name))))
            generatedFiles.splice(index, 1);
        }
      for (const entry of entries)
        if (/^((?:exmetadata|metadata)\.json|cover\.(png|jpe?g|webp))$/i.test(entry.name)) {
          const replacement = generatedFiles.find(file => file.name.toLowerCase() === entry.name.toLowerCase());
          if (replacement && await host.files.contentHash(replacement.file) === await host.files.contentHash(entry.source)) {
            generatedFiles.splice(generatedFiles.indexOf(replacement), 1);
          }
          else if (replacement) {
            let name = path.join('Original sidecars', entry.name), suffix = 2;
            while (entries.some(other => other !== entry && host.files.pathKey(other.name) === host.files.pathKey(name)))
              name = path.join('Original sidecars', String(suffix++), entry.name);
            entry.name = name;
          }
        }
      for (const file of generatedFiles)
        entries.push({ source: file.file, name: file.name, stamp: await host.files.stamp(file.file) });
      const originals = entries.filter(entry => !host.files.within(generated, entry.source) && !host.files.within(target, entry.source));
      const protectedFiles = new Set(host.store.projects.filter(other => other.id !== job.id).flatMap(other => [...projectFilePaths(other), ...(other.retainedSourceFiles || []).map(file => file.path)]).map(host.files.pathKey));
      const root = path.resolve(options.destinationRoot || host.locations.output);
      const intent: TransferJournal = { version: 2, id: job.id, source, target, mode, entries, destinationRoot: root, operation: options.onlyFolder || options.finishedOnly ? 'exports' : 'project' };
      const warning = await host.files.transferProjectFiles({
        root, journal: host.locations.appPath('library-move-' + randomUUID() + '.json'), intent, existingTarget,
        cleanupEntries: originals, boundaries: [path.resolve(host.locations.config.inbox_folder || host.locations.appPath('inbox')), root], protectedFiles, log,
        rollback: () => restoreProject(job, previous), commit: async () => {
          if (options.finalCheck && job.completionSignature !== await completionSignature(job))
            throw new Error('Audio changed after the final check. Original files were retained.');
          const mapping = new Map(entries.map(entry => [host.files.pathKey(entry.source), path.join(target, entry.name)]));
          if (options.allowMissingSources || previous.originalsArchive)
            for (const file of sources)
              if (!mapping.has(host.files.pathKey(file)) && host.files.within(sourceRoot, file)) {
                let name = path.relative(sourceRoot, file);
                const occupied = (relative: string) => [...mapping.values()].some(value => host.files.pathKey(value) === host.files.pathKey(path.join(target, relative)));
                if (occupied(name)) {
                  name = path.join('Original audio', path.basename(file));
                  for (let index = 2;occupied(name);index++)
                    name = path.join('Original audio', String(index), path.basename(file));
                }
                mapping.set(host.files.pathKey(file), path.join(target, name));
              }
          const remap = (file: string | undefined) => file ? mapping.get(host.files.pathKey(file)) || file : file;
          if (!options.finishedOnly && !options.onlyFolder) {
            job.parts = job.parts.map((part, index) => { const relative = path.relative(target, remap(sources[index])!); return { ...part, name: relative, sourceRelativePath: relative.replace(/\\/g, '/') }; });
            job.source = { kind: options.destinationKind || 'managed', mode: previous.source?.mode === 'file' && sources.length === 1 ? 'file' : 'folder', path: previous.source?.mode === 'file' && sources.length === 1 ? remap(sources[0])! : target };
            job.sourceFolderPath = target;
            if (job.sourceSummary)
              job.sourceSummary.sourcePath = job.source.path;
            job.sourceInventory = undefined;
            job.discoveredFiles = undefined;
            job.sourceFileStamps = undefined;
            job.explicitlyAddedSourceFiles = undefined;
            if (job.sourceKey) {
              job.sourcePathIdentity = Object.fromEntries(job.parts.map((part, index) => [sourceRelative(job, part), previous.sourcePathIdentity?.[sourceRelative(previous, previous.parts[index])] || sources[index]]));
            }
          }
          if (job.outputM4b) {
            job.outputM4b.fullPath = remap(job.outputM4b.fullPath);
            if (job.outputM4b.fullPath)
              job.outputM4b.fileIdentity = (await host.files.stamp(job.outputM4b.fullPath)).identity;
          }
          if (job.originalsArchive) {
            job.originalsArchive.path = remap(job.originalsArchive.path)!;
            job.originalsArchive.stamp = await host.files.stamp(job.originalsArchive.path);
            job.originalsArchive.files = job.originalsArchive.files.map(file => ({ ...file, source: remap(file.source)! }));
          }
          if (job.mergedMp3)
            job.mergedMp3.fullPath = remap(job.mergedMp3.fullPath);
          if (job.finalCheck)
            job.finalCheck.files = job.finalCheck.files.map(file => ({ ...file, file: remap(file.file)! }));
          for (const report of job.validations || [])
            report.file = remap(report.file)!;
          job.previewPath = remap(job.previewPath);
          job.downloadedAudioFile = remap(job.downloadedAudioFile);
          for (const output of job.exports || []) {
            output.fullPath = remap(output.fullPath);
            output.coverPath = remap(output.coverPath);
          }
          for (const [format, file] of Object.entries(job.exportedFiles || {}))
            job.exportedFiles![format as OutputAudioFormat] = remap(file)!;
          job.associatedFiles = (job.associatedFiles || []).map(file => ({ ...file, path: remap(file.path)! }));
          for (const file of files) {
            const kind = file.roles.find(role => role !== 'source' && role !== 'output');
            if (kind)
              associateProjectFile(job, remap(file.path)!, kind);
          }
          for (const file of generatedFiles)
            associateProjectFile(job, path.join(target, file.name), file.kind);
          job.retainedSourceFiles = [...(job.retainedSourceFiles || []), ...originals.map(entry => ({ path: entry.source, ...entry.stamp }))];
          job.libraryScan = undefined;
          if (options.finalCheck && job.sourceKey && !job.originalsArchive) {
            job.sourcePathIdentity = undefined;
            job.sourceKey = await host.media.fingerprint(sourceFilePaths(job), {});
            if (job.retainedWaveform)
              job.retainedWaveform.sourceKey = job.sourceKey;
          }
          if (job.processingStatus === 'complete') {
            job.completionSignature = await completionSignature(job);
            job.sourceReorganizationPending = true;
          }
          job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Verified ' + mode + ' of ' + entries.length + ' associated files to ' + target });
          host.store.commit();
        }
      });
      // Cleanup can change hard-link ctimes after the transaction commits. Stamp
      // the verified destination only after cleanup, while the transfer lock holds.
      if (options.finalCheck && job.finalCheck && job.processingStatus === 'complete'
        && job.completionSignature === await completionSignature(job)) {
        const previousSignature = job.finalCheck.inputSignature;
        job.finalCheck.inputSignature = host.validation.signature(job);
        try {
          host.store.commit();
        }
        catch (error: any) {
          job.finalCheck.inputSignature = previousSignature;
          log(`Transferred files retained; Final Check state could not be saved: ${error.message}`);
          return [warning, 'Files transferred. Run Final Check again; its updated state could not be saved.'].filter(Boolean).join(' ');
        }
      }
      return warning;
    }
    finally {
      await fs.promises.rm(generated, { recursive: true, force: true });
    }
  }

  async function moveCompletedProject(input: FileCommandInput, allowUnchecked = false) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    const mode = input.body?.mode;
    if (mode !== 'copy' && mode !== 'move')
      return reply(400, { error: 'Choose Copy & Keep or Move & Clean Up.' });
    if (job.importPending || !job.metadata?.title?.trim())
      return reply(409, { error: 'Finish importing and save book details first.' });
    if (sourceLocation(job) === 'managed')
      return reply(409, { error: 'This book is already in the managed Library.' });
    if (!allowUnchecked && !canMoveInboxBook(job))
      return reply(409, { error: 'Run a successful final check before moving this book.' });
    if (host.work.mutations > 1 || host.activity.imports.size || host.work.processing || host.work.metadataWriters.size || host.store.projects.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status))))
      return reply(409, { error: 'Wait for current file operations to finish.' });
    host.activity.moving = true;
    try {
      const checkedCurrent = completionCurrent(job) && job.completionSignature === await completionSignature(job).catch(() => undefined);
      if (!allowUnchecked && !checkedCurrent)
        throw new Error('Audio changed since the final check. Check the audiobook again before moving.');
      const target = path.resolve(host.locations.output, ...libraryRelativePath(host.locations.config.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata!));
      if (allowUnchecked && !checkedCurrent) {
        job.processingStatus = 'incomplete';
        job.completionSignature = undefined;
      }
      const warning = await transferAssociatedProject(job, target, mode, { finalCheck: checkedCurrent });
      host.logs.event('Library move', 'Move success: verified project saved at ' + target);
      return reply(200, { job: { ...job, canMoveToLibrary: false, sourceMissing: false }, book: host.views.book(job), books: input.getHeader('X-SwissMouse-Catalog') === '1' ? [] : host.views.visibleBooks(), path: target, mode, warning });
    }
    catch (error: any) {
      host.logs.event('Library move', 'Move failed; original files retained: ' + error.message, 'ERROR');
      return reply(409, { error: error.message || 'Could not transfer the book. Original files were retained.' });
    }
    finally {
      host.activity.moving = false;
    }
  }

  function organizeLibraryPlan(job: AudiobookJob) {
    if (job.importPending || !job.metadata?.title?.trim())
      throw new Error('Save book details before organizing the Library folder.');
    const managedBookFolder = !!job.source?.path && isManagedChild(host.locations.output, job.source.path) &&
      fs.existsSync(job.source.path) && fs.statSync(job.source.path).isDirectory();
    const finishedOnly = !managedBookFolder && (sourceMissing(job) || !job.parts.length) ? survivingLibraryM4b(job) : undefined;
    const savedSource = finishedOnly || job.source?.path || job.sourceFolderPath;
    if (!savedSource)
      throw new Error('Choose a book source before organizing the Library folder.');
    const source = path.resolve(savedSource);
    if (!fs.existsSync(source))
      throw new Error('The current book source is unavailable. Relink or add it before organizing.');
    const folder = fs.statSync(source).isDirectory();
    if (!folder && !fs.statSync(source).isFile())
      throw new Error('The current book source is not a regular file or folder.');
    if (!finishedOnly && sourceFilePaths(job).some(file => host.files.pathKey(file) !== host.files.pathKey(source) && !(folder && host.files.within(source, file))))
      throw new Error('This project uses files outside its source folder. Place its selected files together before organizing the book.');
    const root = path.resolve(host.locations.output);
    if (host.files.pathKey(source) === host.files.pathKey(root) || knownIntermediatesRoots().some(workspace => host.files.pathKey(source) === host.files.pathKey(workspace) || host.files.within(workspace, source)))
      throw new Error('Choose a book source folder outside SwissMouse workspaces and the Library root.');
    const base = path.resolve(root, ...libraryRelativePath(host.locations.config.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata));
    if (!isManagedChild(root, base))
      throw new Error('The Library folder pattern resolves outside the configured Library.');
    const alreadyOrganized = folder ? host.files.pathKey(source) === host.files.pathKey(base) : host.files.pathKey(path.dirname(source)) === host.files.pathKey(base);
    let target = base;
    if (!alreadyOrganized)
      for (let copy = 2;pathEntryExists(target);copy++)
        target = `${base} (${copy})`;
    if (!isManagedChild(root, target))
      throw new Error('The Library destination is outside the configured folder.');
    const mode = 'move' as const;
    if (folder && !host.files.within(root, source) && host.files.within(source, target))
      throw new Error('The Library destination is inside the current book folder. Move the book folder outside the Library root first.');
    return { source, root, base, target, folder, mode, alreadyOrganized, collision: target !== base, finishedOnly: !!finishedOnly };
  }

  function removeOrganizeScaffold(source: string, target: string) {
    if (!host.files.within(source, target))
      return;
    let folder = path.dirname(target);
    while (host.files.pathKey(folder) === host.files.pathKey(source) || host.files.within(source, folder)) {
      fs.rmdirSync(folder); // Refuse to remove a folder that gained user files.
      if (host.files.pathKey(folder) === host.files.pathKey(source))
        break;
      folder = path.dirname(folder);
    }
  }

  function planSingleExportFolderMove(job: AudiobookJob) {
    const root = path.resolve(host.locations.appRoot, finalOutputRoot(job.outputFolderPath, host.locations.output));
    const files = exportedAudioPaths(job);
    if (!files.length)
      throw new Error('Export an audiobook before updating its folder location.');
    const parts = libraryRelativePath(host.locations.config.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata);
    const desired = path.resolve(root, ...parts);
    if (!isManagedChild(root, desired))
      throw new Error('The folder pattern resolves outside the library.');
    const sources = [...new Set(files.map(file => path.dirname(path.resolve(file))))].sort();
    const rejectLinkedPath = (target: string) => {
      let current = path.resolve(root);
      const relative = path.relative(current, target);
      for (const segment of relative.split(path.sep)) {
        if (!segment || segment === '..')
          continue;
        current = path.join(current, segment);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
          throw new Error(`Linked library path cannot be moved safely: ${current}`);
      }
    };
    for (const source of sources) {
      if (!isManagedChild(root, source) || !fs.statSync(source).isDirectory())
        throw new Error(`Export folder is outside the library: ${source}`);
      rejectLinkedPath(source);
      for (const other of host.store.projects) {
        if (other.id === job.id)
          continue;
        const referenced = [...exportedAudioPaths(other), other.mergedMp3?.fullPath,
        ...other.parts.map(part => path.resolve(host.locations.appRoot, other.sourceFolderPath || '', part.name))].filter((file): file is string => !!file);
        if (referenced.some(file => path.resolve(file) === source || isManagedChild(source, file)))
          throw new Error(`Another project uses this folder: ${source}`);
      }
      if (job.mergedMp3?.fullPath && (path.resolve(job.mergedMp3.fullPath) === source || isManagedChild(source, job.mergedMp3.fullPath)))
        throw new Error(`The source audio is inside this folder and cannot be moved as an export: ${source}`);
      if (fs.lstatSync(source).isSymbolicLink())
        throw new Error(`Cannot move a linked export folder: ${source}`);
    }
    const ordered = sources.includes(desired) ? [desired, ...sources.filter(source => source !== desired)] : sources;
    const moves = ordered.map((from, index) => ({ from, to: index ? `${desired} (${index + 1})` : desired })).filter(move => move.from !== move.to);
    for (const move of moves) {
      if (!isManagedChild(root, move.to))
        throw new Error('Destination is outside the library.');
      if (isManagedChild(move.from, move.to))
        throw new Error(`Destination cannot be inside the current export folder: ${move.to}`);
      rejectLinkedPath(path.dirname(move.to));
      const caseOnlyRename = isWin && move.from.toLowerCase() === move.to.toLowerCase();
      if (fs.existsSync(move.to) && !caseOnlyRename)
        throw new Error(`Destination already exists. No files were moved: ${move.to}`);
    }
    return { root, moves };
  }

  function planExportFolderMove(job: AudiobookJob) {
    const first = planSingleExportFolderMove(job);
    const series = job.metadata?.series?.trim();
    if (!series)
      return { root: first.root, moves: first.moves.map(move => ({ jobId: job.id, ...move })) };
    const desiredParent = path.dirname(path.resolve(first.root, ...libraryRelativePath(host.locations.config.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata)));
    const related = host.store.projects.filter(other => other.id !== job.id && other.metadata?.series?.trim() === series &&
      resolvedOutputRoot(other) === first.root && exportedAudioPaths(other).length &&
      path.dirname(path.resolve(first.root, ...libraryRelativePath(host.locations.config.library_template || DEFAULT_LIBRARY_TEMPLATE, other.metadata))) === desiredParent);
    const planned = [job, ...related].sort((a, b) => a.id.localeCompare(b.id))
      .map(book => ({ jobId: book.id, ...planSingleExportFolderMove(book) }));
    const moves = planned.flatMap(item => item.moves.map(move => ({ jobId: item.jobId, ...move })));
    const targets = new Set<string>();
    for (const move of moves) {
      const key = isWin ? move.to.toLowerCase() : move.to;
      if (targets.has(key))
        throw new Error(`More than one book would move to the same folder: ${move.to}`);
      targets.add(key);
    }
    return { root: first.root, moves };
  }

  async function getJobsExportFolderMove(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (!job.metadata)
      return reply(400, { error: 'Save book metadata first.' });
    try {
      return reply(200, planExportFolderMove(job));
    }
    catch (error: any) {
      return reply(409, { error: error.message });
    }
  }

  async function postJobsExportFolderMove(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (host.work.mutations > 1 || host.activity.imports.size || host.work.processing || host.work.metadataWriters.size || host.store.projects.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status))))
      return reply(409, { error: 'Wait for current file operations to finish.' });
    host.activity.moving = true;
    const moved: {
      jobId: string;
      from: string;
      to: string;
    }[] = [];
    const warnings: string[] = [];
    try {
      const plan = planExportFolderMove(job);
      if (JSON.stringify(input.body?.confirmedMoves) !== JSON.stringify(plan.moves))
        return reply(409, { error: 'Folder locations changed. Review the move again.' });
      for (const move of plan.moves) {
        const book = host.store.get(move.jobId)!;
        const warning = await transferAssociatedProject(book, move.to, 'move', { onlyFolder: move.from });
        moved.push(move);
        if (warning)
          warnings.push(warning);
      }
      return reply(200, { moved, warnings });
    }
    catch (error: any) {
      return reply(409, { moved, warnings, error: 'Could not finish moving export folders: ' + error.message + (moved.length ? '. Earlier verified moves were saved; refresh to see their locations.' : '') });
    }
    finally {
      host.activity.moving = false;
    }
  }

  async function getJobsMoveToLibrary(input: FileCommandInput) {
    const saved = host.store.get(input.params.id);
    if (!saved)
      return reply(404, { error: 'Book not found.' });
    try {
      const job = host.store.snapshot(saved);
      await backfillProjectCompanions(job);
      const destination = path.resolve(host.locations.output, ...libraryRelativePath(host.locations.config.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata!));
      const files = projectFilePaths(job), owned = new Set(files.map(host.files.pathKey));
      const protectedFiles = new Set(host.store.projects.filter(other => other.id !== job.id).flatMap(projectFilePaths).map(host.files.pathKey));
      const root = bookSourceRoot(job);
      // A preview must not recursively walk a collection or processing workspace.
      const kept = root && fs.existsSync(root) ? (await fs.promises.readdir(root, { withFileTypes: true })).map(entry => path.join(root, entry.name))
        .filter(file => (!owned.has(host.files.pathKey(file)) && !files.some(member => host.files.within(file, member))) || protectedFiles.has(host.files.pathKey(file))) : [];
      return reply(200, { destination, files, kept, keptOverview: true, conflict: pathEntryExists(destination) && !(await ownedProjectDestination(job, destination)) });
    }
    catch (error: any) {
      return reply(409, { error: error.message });
    }
  }

  async function postJobsMoveToLibrary(input: FileCommandInput) {
    return moveCompletedProject(input);
  }

  async function getJobsOrganizeLibrary(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    try {
      return reply(200, organizeLibraryPlan(job));
    }
    catch (error: any) {
      return reply(409, { error: error.message });
    }
  }

  async function postJobsOrganizeLibrary(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (host.work.mutations > 1 || host.activity.imports.size || host.work.processing || host.work.metadataWriters.size || host.store.projects.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status))))
      return reply(409, { error: 'Wait for current file operations to finish.' });
    host.activity.moving = true;
    try {
      const plan = organizeLibraryPlan(job);
      if (plan.alreadyOrganized)
        return reply(200, { job, target: plan.target, alreadyOrganized: true });
      if (input.body?.source !== plan.source || input.body?.target !== plan.target)
        return reply(409, { error: 'The book location changed. Review the destination again.' });
      const warning = await transferAssociatedProject(job, plan.target, plan.mode, { finishedOnly: plan.finishedOnly, allowMissingSources: true });
      return reply(200, { job, target: plan.target, copied: false, warning });
    }
    catch (error: any) {
      return reply(409, { error: error.message || 'Could not organize the book.' });
    }
    finally {
      host.activity.moving = false;
    }
  }

  async function postLibrarySendToLibrary(input: FileCommandInput) {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (input.body?.mode)
      return moveCompletedProject(input, true);
    if (job.importPending || !job.metadata?.title?.trim())
      return reply(409, { error: 'Finish importing and save book details first.' });
    if (sourceLocation(job) === 'managed')
      return reply(409, { error: 'This book is already in the managed Library.' });
    if (host.work.mutations > 1 || host.activity.imports.size || host.work.processing || host.work.metadataWriters.size || host.store.projects.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status))))
      return reply(409, { error: 'Wait for current file operations to finish.' });
    host.activity.moving = true;
    try {
      const plan = organizeLibraryPlan(job);
      const warning = await transferAssociatedProject(job, plan.target, 'copy');
      return reply(200, { job: { ...job, sourceMissing: false }, book: host.views.book(job), path: plan.target, warning });
    }
    catch (error: any) {
      return reply(409, { error: error.message || 'Could not copy book to Library.' });
    }
    finally {
      host.activity.moving = false;
    }
  }
  async function recoverFileTransfers() {
    for (const name of fs.readdirSync(host.locations.appRoot).filter(name => /^library-organize-[\w-]+\.json$/.test(name))) {
      try {
        const entry = JSON.parse(fs.readFileSync(host.locations.appPath(name), 'utf8')) as {
          id: string;
          source: string;
          target: string;
          stage: string;
          folder: boolean;
          finishedOnly?: boolean;
        };
        const root = path.resolve(host.locations.output);
        if (![entry.source, entry.target, entry.stage].every(value => typeof value === 'string' && host.files.within(root, value)) ||
          !path.basename(entry.stage).startsWith('.swissmouse-'))
          throw new Error('Organize recovery paths need manual review.');
        const job = host.store.get(entry.id);
        if (!job)
          throw new Error('The saved book record is missing. Files were retained.');
        const committedPath = entry.folder ? entry.target : path.join(entry.target, path.basename(entry.source));
        const savedPaths = (entry.finishedOnly ? [job.outputM4b?.fullPath, ...Object.values(job.exportedFiles || {}),
        ...(job.exports || []).filter(output => output.format === 'm4b' && output.status === 'success').map(output => output.fullPath)] : [job.source?.path])
          .filter((file): file is string => typeof file === 'string');
        if (savedPaths.some(file => host.files.pathKey(file) === host.files.pathKey(committedPath))) {
          if (fs.existsSync(entry.stage))
            throw new Error(`The saved move is complete, but ${entry.stage} also exists. Review both copies.`);
          fs.unlinkSync(host.locations.appPath(name));
          continue;
        }
        if (!savedPaths.some(file => host.files.pathKey(file) === host.files.pathKey(entry.source)))
          throw new Error('The saved source differs from this move. Files were retained.');
        const nested = entry.folder && host.files.within(entry.source, entry.target);
        if (fs.existsSync(entry.source) && !nested)
          throw new Error('The original source exists. Any additional move files need manual review.');
        if (fs.existsSync(entry.stage)) {
          if (nested)
            removeOrganizeScaffold(entry.source, entry.target);
          fs.renameSync(entry.stage, entry.source);
        }
        else if (fs.existsSync(committedPath)) {
          if (nested) {
            fs.renameSync(committedPath, entry.stage);
            removeOrganizeScaffold(entry.source, entry.target);
            fs.renameSync(entry.stage, entry.source);
          }
          else
            fs.renameSync(committedPath, entry.source);
        }
        else
          throw new Error('Neither the temporary nor destination file is available.');
        fs.unlinkSync(host.locations.appPath(name));
        host.logs.event('Library organize', `Interrupted move restored to ${entry.source}.`, 'WARNING');
      }
      catch (error: any) {
        host.logs.event('Library organize', `Move recovery needs attention: ${name}: ${error.message}`, 'ERROR');
      }
    }
    // Recover interrupted path commits before scanning either root. Keep verified
    // copies for recovery instead of guessing which files can be discarded.
    for (const name of fs.readdirSync(host.locations.appRoot).filter(name => /^library-move-[\w-]+\.json$/.test(name))) {
      try {
        const entry = JSON.parse(fs.readFileSync(host.locations.appPath(name), 'utf8'));
        if (entry.version === 2) {
          const recoveryRoot = entry.destinationRoot || host.locations.output;
          if (![host.locations.output, host.locations.config.inbox_folder || host.locations.appPath('inbox')].some(root => host.files.pathKey(root) === host.files.pathKey(recoveryRoot)) || !host.files.within(recoveryRoot, entry.target) || !Array.isArray(entry.entries))
            throw new Error('Transfer recovery paths need manual review.');
          const job = host.store.get(entry.id);
          if (entry.pending) {
            const { source, quarantine } = entry.pending;
            if (!entry.entries.some((file: MoveEntry) => host.files.pathKey(file.source) === host.files.pathKey(source)) ||
              path.dirname(source) !== path.dirname(quarantine) || !/^\.swissmouse-[a-f0-9-]+\.moved$/.test(path.basename(quarantine)))
              throw new Error('Unsafe recovery file.');
            if (fs.existsSync(quarantine)) {
              await host.files.assertUnlinked(quarantine);
              // link is exclusive: a newly created original must never be overwritten.
              fs.linkSync(quarantine, source);
              fs.unlinkSync(quarantine);
              host.logs.event('Library move', `Interrupted cleanup restored original: ${source}`, 'WARNING');
            }
          }
          const committed = !!job && (entry.reusedTarget ? job.source?.kind === 'managed' && (host.files.pathKey(job.source.path) === host.files.pathKey(entry.target) || host.files.within(entry.target, job.source.path)) : entry.entries.some((file: MoveEntry) => projectFilePaths(job).some(saved => host.files.pathKey(saved) === host.files.pathKey(path.join(entry.target, file.name)))));
          if (!committed && fs.existsSync(entry.target)) {
            if (!job || host.files.pathKey(job.source?.path || job.sourceFolderPath || '') !== host.files.pathKey(entry.source))
              throw new Error('Project changed; transfer copies retained for review.');
            if (!Array.isArray(entry.copied))
              throw new Error('Interrupted transfer lacks file ownership evidence. Originals and destination files retained for manual review.');
            const recovery = await host.files.recoverTransferCopies(entry.target, entry.copied);
            host.logs.event('Library move', `Interrupted transfer: originals retained; associated copies saved at ${recovery || entry.target}. Unrelated or changed destination files stay in place.`, 'WARNING');
          }
          else if (committed)
            host.logs.event('Library move', `Recovered Library transfer for ${job!.name}; remaining originals retained. No automatic source deletion.`, 'WARNING');
          fs.unlinkSync(host.locations.appPath(name));
          continue;
        }
        if (!host.files.within(host.locations.config.inbox_folder || host.locations.appPath('inbox'), entry.source) || !host.files.within(host.locations.output, entry.target) || path.dirname(entry.source) !== path.dirname(entry.quarantine) || !path.basename(entry.quarantine).startsWith('.swissmouse-'))
          throw new Error('Move recovery paths need manual review.');
        const job = host.store.get(entry.id);
        const committed = job?.source && (host.files.pathKey(job.source.path) === host.files.pathKey(entry.target) || host.files.within(entry.target, job.source.path));
        if (!committed) {
          if (!job || host.files.pathKey(job.source?.path || job.sourceFolderPath || '') !== host.files.pathKey(entry.source))
            throw new Error('Saved project no longer matches this move; recovery copies were retained.');
          if (fs.existsSync(entry.quarantine) && fs.existsSync(entry.source))
            throw new Error(`Both the Inbox path and recovery copy exist. Review ${entry.quarantine} before cleanup.`);
          if (fs.existsSync(entry.quarantine) && !fs.existsSync(entry.source))
            fs.renameSync(entry.quarantine, entry.source);
          if (fs.existsSync(entry.target)) {
            const recovery = path.join(path.dirname(entry.target), `.swissmouse-recovered-${randomUUID()}`);
            fs.renameSync(entry.target, recovery);
            host.logs.event('Library move', `Interrupted move restored to Inbox. Verified copy retained for recovery: ${recovery}`, 'WARNING');
          }
          fs.unlinkSync(host.locations.appPath(name));
        }
        else
          host.logs.event('Library move', `Completed move recovered. Any residual copy is retained at ${entry.quarantine}`, 'WARNING');
      }
      catch (error: any) {
        host.logs.event('Library move', `Move recovery needs attention: ${name}: ${error.message}`, 'ERROR');
      }
    }
  }
  return { recoverFileTransfers, associateProjectFile, projectFilePaths, backfillProjectCompanions, restoreProject, ownedProjectDestination, transferAssociatedProject, moveCompletedProject, organizeLibraryPlan, removeOrganizeScaffold, planSingleExportFolderMove, planExportFolderMove, getJobsExportFolderMove, postJobsExportFolderMove, getJobsMoveToLibrary, postJobsMoveToLibrary, getJobsOrganizeLibrary, postJobsOrganizeLibrary, postLibrarySendToLibrary };
}
export type LibraryTransfers = ReturnType<typeof createLibraryTransfers>;
