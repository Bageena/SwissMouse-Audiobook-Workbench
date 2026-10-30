import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { probableBookGroups } from './book-groups';
import type { AudiobookFilePorts, DiskBook, FileCommandInput } from './file-ports';
import { fileReply as reply, type SourceFileFacts } from './file-ports';
import type { AudiobookJob } from './legacy-domain';
import { isUntouchedDiscovery } from './library-regrouping';
import { mergeDetectedMetadata } from './metadata-state';

export function createLibraryDiscovery(host: AudiobookFilePorts, source: Pick<SourceFileFacts, "sourceFilePaths" | "knownIntermediatesRoots" | "exportedAudioPaths" | "bookRootType" | "remapBookPaths" | "sourceRelative" | "completionSignature" | "archiveCurrent" | "sourceMissing" | "survivingLibraryM4b">) {
  const { sourceFilePaths, knownIntermediatesRoots, exportedAudioPaths, bookRootType, remapBookPaths, sourceRelative, completionSignature, archiveCurrent, sourceMissing, survivingLibraryM4b } = source;
  function reconcileLibrary(afterMove = false, fullRescan = false, rebuildSources?: ('inbox' | 'library')[]): Promise<void> {
    if (host.activity.scan)
      return host.activity.scan;
    if (host.work.mutations > (afterMove ? 1 : 0) || host.activity.moving || host.work.configSaving || host.work.validating || host.activity.imports.size || host.work.processing || host.work.metadataWriters.size || host.store.projects.some(job => job.exports?.some(item => ['running', 'queued'].includes(item.status))))
      return Promise.reject(new Error('Wait for current audio or file operations to finish before refreshing folders.'));
    host.activity.scan = (async () => {
      host.activity.warnings = [];
      host.activity.progress = { operation: rebuildSources ? 'rebuild' : 'refresh', source: '', folders: 0, discovered: 0, processed: 0, phase: 'Scanning folders' };
      // Commit discovery in small recoverable batches. Durable user state is
      // never copied or discarded by a catalog rebuild.
      try {
        // Keep only identity/path indexes for reconciliation. Hydrate each project
        // lazily, and yield between small batches so browsing remains responsive.
        const scanProjects = async function*() {
          let count = 0;
          for (const job of host.store.projects) {
            yield job;
            if (++count % 64 === 0)
              await new Promise<void>(resolve => setImmediate(resolve));
          }
        };
        const activeSources = new Set<string>();
        const retained = new Map<string, NonNullable<AudiobookJob['retainedSourceFiles']>[number]>();
        const untouched = new Set<string>();
        const savedOwners = new Map<string, Set<string>>(), indexedOwners = new Map<string, Set<string>>(), automaticOwners = new Map<string, Set<string>>();
        const savedById = new Map<string, AudiobookJob>();
        for await (const job of scanProjects()) {
          savedById.set(job.id, job);
          let sources: string[] = [];
          try {
            sources = sourceFilePaths(job);
          }
          catch { /* Invalid legacy paths remain recoverable. */ }
          for (const file of sources)
            activeSources.add(host.files.pathKey(file));
          for (const file of job.retainedSourceFiles || [])
            retained.set(host.files.pathKey(file.path), file);
          if (isUntouchedDiscovery(job) && !host.views.listening.has(job.id))
            untouched.add(job.id);
          if (job.libraryScan?.superseded)
            continue;
          for (const file of host.files.projectFiles(job, sources)) {
            const key = host.files.pathKey(file.path);
            for (const owners of [savedOwners, untouched.has(job.id) ? automaticOwners : indexedOwners]) {
              const ids = owners.get(key) || new Set<string>();
              ids.add(job.id);
              owners.set(key, ids);
            }
          }
        }
        for (const key of retained.keys())
          if (activeSources.has(key))
            retained.delete(key);
        activeSources.clear();
        const roots = [{ type: 'inbox' as const, root: path.resolve(host.locations.config.inbox_folder || host.locations.appPath('inbox')) }, { type: 'library' as const, root: path.resolve(host.locations.output) }].filter(item => !rebuildSources || rebuildSources.includes(item.type));
        const incompleteRoots = new Set<string>();
        const unavailableRoots = new Set<string>();
        const found: {
          type: 'inbox' | 'library';
          root: string;
          books: DiskBook[];
        }[] = [];
        const joinedFragments = new Set<string>();
        for (const { type, root } of roots) {
          host.activity.progress.source = type === 'inbox' ? 'Inbox' : 'Library';
          host.logs.event('Library', `${host.activity.progress.source} ${rebuildSources ? 'rebuild' : 'scan'} started: ${root}`);
          try {
            const unreadable: string[] = [];
            const scannedBooks = await host.files.scanRoot(root, host.media.extensions, [...knownIntermediatesRoots(), host.locations.upload], {
              onFolder: () => { host.activity.progress.folders++; },
              onError: (file, error) => {
                incompleteRoots.add(root);
                unreadable.push(file);
                const warning = `Could not read ${file}: ${error.message}. Existing records retained for unreadable paths.`;
                host.activity.warnings.push(warning);
                host.logs.event('Library', warning, 'WARNING');
              },
            });
            // A source plus its known exports can share a book sidecar even though
            // the generic M4B scanner treats each file as an independent book. Only
            // restore saved companions when every audio file here has that owner.
            const folderBooks = new Map<string, DiskBook[]>();
            for (const disk of scannedBooks) {
              const key = host.files.pathKey(disk.folder), siblings = folderBooks.get(key) || [];
              siblings.push(disk);
              folderBooks.set(key, siblings);
            }
            for (const siblings of folderBooks.values()) {
              if (siblings.some(disk => disk.metadataFile))
                continue;
              const ownerIds = siblings.flatMap(disk => disk.files.map(file => savedOwners.get(host.files.pathKey(path.join(disk.folder, file.name)))));
              const owner = ownerIds[0]?.size === 1 ? [...ownerIds[0]][0] : undefined;
              if (!owner || !ownerIds.every(ids => ids?.size === 1 && ids.has(owner)))
                continue;
              const companions = savedById.get(owner)?.associatedFiles?.filter(file => host.files.pathKey(path.dirname(file.path)) === host.files.pathKey(siblings[0].folder) && /^((?:exmetadata|metadata)\.json|cover\.(png|jpe?g|webp))$/i.test(path.basename(file.path))) || [];
              const present = [];
              for (const file of companions) {
                try {
                  present.push({ file, stamp: await host.files.stamp(file.path) });
                }
                catch { /* Missing companions are optional. */ }
              }
              for (const disk of siblings)
                if (present.length) {
                  disk.metadataFile = present.find(item => item.file.kind === 'metadata')?.file.path;
                  disk.associatedFiles = present.map(item => ({ path: item.file.path, kind: item.file.kind as 'metadata' | 'cover' }));
                  disk.signature = host.files.fileSignature([...disk.files, ...present.map(item => item.stamp)]);
                }
            }
            for (const book of scannedBooks)
              book.files = book.files.filter(file => {
                const original = retained.get(host.files.pathKey(path.join(book.folder, file.name)));
                return !original || original.identity !== file.identity || original.size !== file.size || original.mtime !== file.mtime;
              });
            const explicitById = savedById;
            const partitioned = scannedBooks.flatMap(disk => {
              const diskMembers = new Set(disk.files.map(file => host.files.pathKey(path.join(disk.folder, file.name))));
              const owners = [...new Set([...diskMembers].flatMap(file => [...(indexedOwners.get(file) || [])]))].map(id => explicitById.get(id)!).filter(job => job.sourceMembership === 'confirmed' || job.sourceMembership === 'explicit' || !!job.outputM4b ||
                !!job.libraryScan?.path && host.files.within(disk.path, job.libraryScan.path));
              if (!owners.length || (owners.length === 1 && disk.files.every(file => indexedOwners.get(host.files.pathKey(path.join(disk.folder, file.name)))?.has(owners[0].id))))
                return [disk];
              const assigned = new Set<string>();
              const groups: DiskBook[] = owners.map(job => {
                const memberPaths = new Set([...sourceFilePaths(job), ...exportedAudioPaths(job)].map(host.files.pathKey));
                const files = disk.files.filter(file => memberPaths.has(host.files.pathKey(path.join(disk.folder, file.name))));
                files.forEach(file => assigned.add(file.name));
                const sidecars = disk.associatedFiles?.filter(file => job.associatedFiles?.some(own => host.files.pathKey(own.path) === host.files.pathKey(file.path)));
                const folder = job.sourceFolderPath && files.every(file => host.files.within(job.sourceFolderPath!, path.join(disk.folder, file.name))) ? job.sourceFolderPath : disk.folder;
                const relativeFiles = files.map(file => ({ ...file, name: path.relative(folder, path.join(disk.folder, file.name)) }));
                return {
                  ...disk, folder, files: relativeFiles, path: job.libraryScan?.path && host.files.within(disk.path, job.libraryScan.path) ? job.libraryScan.path : path.join(disk.folder, files[0].name), grouped: true,
                  signature: host.files.fileSignature(relativeFiles), identity: createHash('sha256').update(JSON.stringify(files.map(file => file.identity))).digest('hex'),
                  metadataFile: sidecars?.find(file => file.kind === 'metadata')?.path, associatedFiles: sidecars, title: job.name
                };
              });
              const remaining = disk.files.filter(file => !assigned.has(file.name));
              if (remaining.length)
                groups.push({ ...disk, files: remaining, path: path.join(disk.folder, remaining[0].name), metadataFile: undefined, associatedFiles: [], grouped: true });
              return groups;
            });
            const books = partitioned.filter(book => book.files.length > 0).filter(book => !unreadable.some(file => host.files.pathKey(file) === host.files.pathKey(book.path) || host.files.within(book.path, file) || host.files.within(file, book.path)));
            host.activity.progress.discovered += books.length;
            // Prefer the book's own sidecar/source over a nested export directory.
            books.sort((a, b) => a.path.split(path.sep).length - b.path.split(path.sep).length || a.path.localeCompare(b.path));
            found.push({ type, root, books });
          }
          catch (error: any) {
            unavailableRoots.add(root);
            const warning = `${type === 'inbox' ? 'Inbox' : 'Library'} scan unavailable: ${error.message}. Saved records retained.`;
            host.activity.warnings.push(warning);
            host.logs.event('Library', warning, 'WARNING');
          }
        }
        const diskPaths = new Set(found.flatMap(group => group.books.map(book => host.files.pathKey(book.path))));
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
        for (const group of found)
          if (!incompleteRoots.has(group.root))
            for (const disk of group.books) {
              const members = new Set(disk.files.map(file => host.files.pathKey(path.join(disk.folder, file.name))));
              const fragments = [...new Set([...members].flatMap(file => [...(automaticOwners.get(file) || [])]))].map(id => automaticById.get(id)!);
              for (const fragment of fragments)
                if (fragment.libraryScan?.root === group.root && host.files.within(disk.folder, fragment.libraryScan.path) &&
                  !diskPaths.has(host.files.pathKey(fragment.libraryScan.path)) && sourceFilePaths(fragment).every(file => members.has(host.files.pathKey(file)))) {
                  superseded.add(fragment.id);
                  joinedFragments.add(fragment.id);
                }
            }
        for await (const job of scanProjects()) {
          const previousPath = job.libraryScan?.path || job.source?.path || job.sourceFolderPath;
          if (!previousPath || job.importPending || job.personalRating !== undefined || host.views.listening.has(job.id) || (job.sourceMembership && job.sourceMembership !== 'automatic') || diskPaths.has(host.files.pathKey(previousPath)))
            continue;
          const exports = new Set(exportedAudioPaths(job).map(host.files.pathKey));
          if (found.some(group => !incompleteRoots.has(group.root) && (!rebuildSources || rebuildSources.includes(job.libraryScan?.type || bookRootType(job)!)) &&
            group.books.filter(book => host.files.within(previousPath, book.path) && !book.files.every(file => exports.has(host.files.pathKey(path.join(book.folder, file.name))))).length > 1))
            superseded.add(job.id);
        }
        for await (const job of scanProjects()) {
          if (superseded.has(job.id) || job.libraryScan?.superseded)
            continue;
          // A shared browse folder is not the identity of a loose multipart book.
          for (const value of job.libraryScan ? [job.libraryScan.path] : [job.source?.path, job.sourceFolderPath])
            if (value)
              byPath.set(host.files.pathKey(value), job);
          try {
            for (const file of [...sourceFilePaths(job), ...exportedAudioPaths(job)])
              byFile.set(host.files.pathKey(file), job);
          }
          catch { /* Invalid legacy paths remain recoverable. */ }
          if (job.libraryScan)
            byIdentity.set(job.libraryScan.identity, [...(byIdentity.get(job.libraryScan.identity) || []), job]);
          if (job.libraryScan)
            bySignature.set(job.libraryScan.signature, [...(bySignature.get(job.libraryScan.signature) || []), job]);
        }
        let changed = false;
        for (const { type, root, books } of found) {
          host.activity.progress.source = type === 'inbox' ? 'Inbox' : 'Library';
          host.activity.progress.phase = 'Identifying books and grouping files';
          let added = 0, updated = 0, removed = 0, uncertain = 0;
          // Inspect a small window concurrently, then reconcile in stable order.
          // Only changed observations are read; project mutations stay serial.
          for (let offset = 0;offset < books.length;offset += 4) {
            const batch = books.slice(offset, offset + 4);
            const detectedBatch = await host.files.mapScanWork(batch, 4, async (disk) => {
              const candidate = byPath.get(host.files.pathKey(disk.path)) || disk.files.map(file => byFile.get(host.files.pathKey(path.join(disk.folder, file.name)))).find(Boolean);
              if (candidate && (used.has(candidate.id) || candidate.importPending || (candidate.libraryScan && unavailableRoots.has(candidate.libraryScan.root)) ||
                (rebuildSources && !rebuildSources.includes(candidate.libraryScan?.type || bookRootType(candidate)!))))
                return undefined;
              const old = candidate?.libraryScan;
              if (candidate && !fullRescan && old?.coverScanVersion === 1 && old?.identificationVersion === 1 && old.signature === disk.signature && !old.missing && old.path === disk.path && old.root === root)
                return undefined;
              const detected = await host.files.identifyBook(disk, file => host.media.libraryReader.tags(host.media.ffprobe(), file), old || rebuildSources ? undefined : candidate?.metadata, file => host.media.libraryReader.cover(host.media.ffmpeg(), host.media.ffprobe(), file));
              const durationSeconds = disk.files.length === 1 ? await host.media.libraryReader.duration(host.media.ffprobe(), path.join(disk.folder, disk.files[0].name)).catch(() => undefined) : undefined;
              return { ...detected, durationSeconds };
            });
            for (const [index, disk] of batch.entries()) {
              host.activity.progress.processed++;
              const diskFiles = new Set(disk.files.map(file => host.files.pathKey(path.join(disk.folder, file.name))));
              let job = byPath.get(host.files.pathKey(disk.path)) || [...diskFiles].map(file => byFile.get(file)).find(Boolean);
              if (job?.libraryScan && unavailableRoots.has(job.libraryScan.root)) {
                used.add(job.id);
                continue;
              }
              // Shared projects retain their owning source's state during a targeted rebuild.
              if (job && rebuildSources && !rebuildSources.includes(job.libraryScan?.type || bookRootType(job)!)) {
                used.add(job.id);
                continue;
              }
              if (job && used.has(job.id))
                continue;
              if (!job) {
                const identityMatches = byIdentity.get(disk.identity) || [];
                const candidates = identityMatches.filter(item => (!rebuildSources || rebuildSources.includes(item.libraryScan!.type)) && !used.has(item.id) && !diskPaths.has(host.files.pathKey(item.libraryScan!.path)) && !fs.existsSync(item.libraryScan!.path));
                if (candidates.length === 1) {
                  job = candidates[0];
                  remapBookPaths(job, job.source?.mode === 'folder' ? job.source.path : job.libraryScan!.path, disk.mode === 'folder' ? disk.folder : disk.path);
                  host.logs.event('Library', `Relinked moved book: ${job.name} -> ${disk.path}`);
                }
              }
              if (job?.importPending) {
                used.add(job.id);
                continue;
              }
              // An export and its Inbox original remain one project, never duplicate entries.
              if (job && type === 'library') {
                try {
                  const relocated = await host.files.recoverRelocatedOutput(job, disk, file => host.media.read(host.media.ffprobe(), file), file => {
                    const owner = byFile.get(host.files.pathKey(file));
                    return !!owner && owner.id !== job!.id;
                  });
                  if (relocated) {
                    changed = true;
                    byFile.set(host.files.pathKey(relocated), job);
                    host.logs.event('Library', 'Recovered relocated export: ' + relocated);
                  }
                }
                catch (error: any) {
                  host.logs.event('Library', 'Could not verify a relocated export for ' + job.name + ': ' + error.message, 'WARNING');
                }
              }
              const old = job?.libraryScan;
              const newRecord = !job;
              if (detectedBatch[index]) {
                const detected = detectedBatch[index]!;
                if (!job) {
                  job = { id: `book-${randomUUID()}`, name: detected.metadata.title, createdAt: new Date().toISOString(), status: 'draft', parts: [], totalSizeBytes: 0, totalDurationSeconds: 0, candidates: [], chapters: [], logs: [], importedAt: new Date().toISOString(), metadata: detected.metadata, outputFolderPath: type === 'inbox' ? path.join(root, '.swissmouse-work') : host.locations.output };
                  host.store.projects.push(job);
                  job = host.store.adopt(job.id)!;
                  added++;
                }
                else {
                  updated++;
                  const next = mergeDetectedMetadata(job, detected.metadata);
                  if (JSON.stringify(next) !== JSON.stringify(job.metadata))
                    job.metadataRevision = (job.metadataRevision || 0) + 1;
                  job.metadata = next;
                }
                // The index is derived data; retain project IDs, explicit edits, drafts,
                // transcripts and confirmed membership while rebuilding disk-derived data.
                job.sourceInventory = undefined;
                job.name = job.metadata?.title || job.name;
                // Do not replace a processed project's original parts with its exports.
                const sourceMatches = newRecord || (old?.path === disk.path && job.source?.mode === 'folder' && host.files.pathKey(job.source.path) === host.files.pathKey(disk.folder)) || (job.source
                  ? host.files.pathKey(job.source.path) === host.files.pathKey(disk.path)
                  : sourceFilePaths(job).some(file => diskFiles.has(host.files.pathKey(file))));
                if (sourceMatches) {
                  job.source = { kind: type === 'inbox' ? 'inbox' : 'managed', path: disk.mode === 'folder' ? disk.folder : disk.path, mode: disk.mode };
                  job.sourceFolderPath = disk.folder;
                  // Refresh displayed file sizes without silently changing project membership.
                  const sizes = new Map(disk.files.map(file => [file.name.replace(/\\/g, '/'), file.size]));
                  for (const part of job.parts) {
                    const size = sizes.get(sourceRelative(job, part));
                    if (size !== undefined)
                      part.sizeBytes = size;
                  }
                  job.totalSizeBytes = job.parts.reduce((sum, part) => sum + part.sizeBytes, 0);
                  const groups = probableBookGroups(disk.files.map(file => ({ relativePath: file.name })), path.basename(disk.folder));
                  if (!job.sourceMembership || job.sourceMembership === 'automatic') {
                    job.bookScope = { ...job.bookScope, title: groups.length === 1 ? groups[0].title : 'Choose a probable book group' };
                    if (groups.length > 1)
                      detected.warning ||= 'Several probable books found. Review Files to select a book before processing.';
                  }
                  if (newRecord && !job.outputM4b) {
                    const owned = disk.grouped || groups.length === 1 ? disk.files : [];
                    if (!owned.length)
                      detected.warning = 'Several probable books found. Review Files to select a book before processing.';
                    job.bookScope = { title: groups.length === 1 ? groups[0].title : 'Choose a probable book group' };
                    job.parts = owned.map((file, index) => ({ ...job!.parts.find(part => part.name === file.name), id: job!.parts.find(part => part.name === file.name)?.id || `p-${index + 1}`, name: file.name, sizeBytes: file.size, durationSeconds: job!.parts.find(part => part.name === file.name)?.durationSeconds || 0, bitrate: job!.parts.find(part => part.name === file.name)?.bitrate || 0, order: index + 1 }));
                    job.totalSizeBytes = owned.reduce((sum, file) => sum + file.size, 0);
                  }
                }
                if (old && old.signature !== disk.signature && job.processingStatus === 'complete') {
                  let sameCompletedFiles = false;
                  if (job.sourceReorganizationPending) {
                    try {
                      sameCompletedFiles = job.completionSignature === await completionSignature(job);
                    }
                    catch { /* Missing audio is incomplete. */ }
                  }
                  if (!sameCompletedFiles) {
                    job.processingStatus = 'incomplete';
                    host.logs.event('Library', `Processing status changed to needs work after filesystem changes: ${job.name}`);
                  }
                }
                job.sourceReorganizationPending = false;
                job.libraryScan = {
                  root, type, path: disk.path, signature: disk.signature, identity: disk.identity, warning: detected.warning, coverScanVersion: 1, identificationVersion: 1, durationSeconds: detected.durationSeconds,
                  detectedMetadata: { ...detected.metadata, cover: undefined }, coverSignature: createHash('sha256').update(JSON.stringify(detected.metadata.cover || null)).digest('hex')
                };
                job.metadataUpdatedAt = new Date().toISOString();
                changed = true;
                if (detected.warning) {
                  uncertain++;
                  host.logs.event('Library', `${disk.path}: ${detected.warning}`, 'WARNING');
                }
              }
              const memberPaths = new Set(sourceFilePaths(job!).map(host.files.pathKey));
              if (disk.associatedFiles?.length && disk.files.every(file => memberPaths.has(host.files.pathKey(path.join(disk.folder, file.name))))) {
                const associated = new Map((job!.associatedFiles || []).map(file => [host.files.pathKey(file.path), file]));
                for (const file of disk.associatedFiles)
                  if (!associated.has(host.files.pathKey(file.path))) {
                    associated.set(host.files.pathKey(file.path), file);
                    changed = true;
                  }
                job!.associatedFiles = [...associated.values()];
              }
              used.add(job!.id);
              if (job!.sourceReorganizationPending) {
                job!.sourceReorganizationPending = false;
                changed = true;
              }
              if (job!.processingStatus === 'complete') {
                let valid = false;
                try {
                  valid = job!.completionSignature === await completionSignature(job!);
                }
                catch { /* Missing audio invalidates completion. */ }
                if (!valid) {
                  job!.processingStatus = 'incomplete';
                  changed = true;
                  host.logs.event('Library', `Processing status changed to needs work: ${job!.name}`);
                }
              }
            }
            if (offset % 100 === 96 && changed) {
              host.store.commit();
              changed = false;
            }
          }
          for await (const job of scanProjects()) {
            // Archiving intentionally removes source audio; the verified ZIP and
            // export in the work folder keep this project available for finalization.
            if (archiveCurrent(job) && exportedAudioPaths(job).some(file => fs.existsSync(file))) {
              if (job.libraryScan?.missing) {
                job.libraryScan.missing = false;
                changed = true;
              }
              continue;
            }
            if (incompleteRoots.has(root))
              continue;
            if (rebuildSources && !rebuildSources.includes(job.libraryScan?.type || bookRootType(job)!))
              continue;
            const source = job.source?.path || job.sourceFolderPath;
            if (!job.libraryScan && !job.importPending && !used.has(job.id) && source && host.files.within(root, source)) {
              job.libraryScan = { root, type, path: source, signature: '', identity: '', missing: true };
              job.processingStatus = 'incomplete';
              changed = true;
              removed++;
            }
            if (job.libraryScan?.root === root && !used.has(job.id) && !diskPaths.has(host.files.pathKey(job.libraryScan.path)) && !job.libraryScan.missing) {
              job.libraryScan.missing = true;
              job.processingStatus = 'incomplete';
              changed = true;
              removed++;
            }
            if (superseded.has(job.id) && job.libraryScan?.root === root) {
              const warning = joinedFragments.has(job.id)
                ? 'This automatic disc entry was replaced by a complete book entry. Its saved project data is retained for recovery.'
                : 'This automatic collection entry was replaced by separate book entries. Its saved project data is retained for recovery.';
              if (!job.libraryScan.superseded || job.libraryScan.warning !== warning) {
                job.libraryScan.superseded = true;
                job.libraryScan.warning = warning;
                changed = true;
              }
            }
          }
          host.logs.event('Library', `${type === 'inbox' ? 'Inbox' : 'Library'} reconciliation: ${books.length} books, ${added} discovered, ${updated} changed, ${removed} removed from view, ${uncertain} need metadata verification.`);
        }
        if (changed) {
          try {
            host.store.commit();
          }
          catch (error) {
            host.store.projects = host.store.rollback();
            throw error;
          }
        }
      }
      catch (error) {
        host.store.projects = host.store.rollback();
        throw error;
      }
    })().finally(async () => {
      host.catalog?.invalidate(true); try {
        await host.catalog?.ready();
      }
        finally {
        host.activity.progress.phase = 'Finished';
        host.activity.scan = undefined;
      }
    });
    return host.activity.scan;
  }

  async function postLibraryRefresh(input: FileCommandInput) {
    if (host.activity.moving)
      return reply(409, { error: 'Wait for the Library move to finish.' });
    try {
      await reconcileLibrary();
      return reply(200, { books: input.getHeader('X-SwissMouse-Catalog') === '1' ? [] : host.views.visibleBooks(), warnings: host.activity.warnings });
    }
    catch (error: any) {
      return reply(500, { error: error.message });
    }
  }

  async function postLibraryRescan(input: FileCommandInput) {
    try {
      await reconcileLibrary(false, true);
      const recovered = host.store.projects.filter(job => sourceMissing(job) && !!survivingLibraryM4b(job)).length;
      return reply(200, { books: host.views.visibleBooks(), warnings: host.activity.warnings, recovered });
    }
    catch (error: any) {
      return reply(500, { error: error.message });
    }
  }

  async function postLibraryRebuild(input: FileCommandInput) {
    const sources = input.body?.sources;
    if (input.body?.confirmed !== true || !Array.isArray(sources) || !sources.length || sources.some(source => !['inbox', 'library'].includes(source)))
      return reply(400, { error: 'Select Inbox and/or Library and confirm the rebuild.' });
    if (host.activity.scan || host.activity.moving)
      return reply(409, { error: 'Wait for the current library operation to finish.' });
    try {
      await reconcileLibrary(false, true, [...new Set(sources)] as ('inbox' | 'library')[]);
      return reply(200, { books: input.getHeader('X-SwissMouse-Catalog') === '1' ? [] : host.views.visibleBooks(), warnings: host.activity.warnings });
    }
    catch (error: any) {
      host.logs.event('Library', `Rebuild failed; previous stored information retained: ${error.message}`, 'ERROR');
      return reply(500, { error: error.message });
    }
  }
  return { reconcileLibrary, postLibraryRefresh, postLibraryRescan, postLibraryRebuild };
}
export type LibraryDiscovery = ReturnType<typeof createLibraryDiscovery>;
