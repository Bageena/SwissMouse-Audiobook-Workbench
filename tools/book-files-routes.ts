import type { Express } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AudiobookJob, WorkbenchConfig, DiscoveredAudioFile } from '../src/types';
import type { FileDetails, MetadataColumn } from '../src/utils/bookFiles';
import { probableBookGroups } from '../src/utils/bookGroups';
import { DEFAULT_LIBRARY_TEMPLATE, libraryRelativePath } from '../src/utils/libraryPath';
import { checkedPath, copyEntry, mustNotExist, pathStamp, planToken, recycleEntry, remapSourceReferences, rollbackCopies, sameOrInside, validFileName, operationId, renameExclusive, type OwnedCopy } from './book-file-operations';
import { pathKey, stamp, within } from './library-filesystem';
import { transferProjectFiles, recoverTransferCopies } from './project-transfer';
import { contentHash } from './library-filesystem';
import { writeAudioMetadata } from './audio-engine';
import { metadataFromTags } from './audiobook-metadata';
import { rebaseBookMembership } from './book-source-browser';
import { projectFiles } from './project-files';
import { verifyProjectAudio } from './verify-project-audio';
import { checkSourceAudio } from './audio-integrity';
import { DirectoryIndex } from './directory-index';
import { cloneProject } from './project-store';

type Host = {
  getJob?: (id: string) => AudiobookJob | undefined;
  jobs: () => AudiobookJob[]; config: () => WorkbenchConfig; appRoot: string;
  root: (job: AudiobookJob) => string | undefined; excluded: () => string[];
  busy: () => boolean; busyReason?: () => string | undefined; lock: (id: string, locked: boolean) => void;
  persist: () => void; invalidate: (job: AudiobookJob) => void; totals: (job: AudiobookJob) => void;
  remove: (job: AudiobookJob, files: string[]) => void;
  read: (file: string) => Promise<any>; ffmpeg: () => string; ffprobe: () => string;
  probe?: (file: string) => Promise<any>;
  log: (job: AudiobookJob, message: string, failed?: boolean) => void;
  select: (paths: string[], groupId?: string) => Promise<any>;
  recycle?: (file: string) => Promise<void>;
  thumbnail?: (file: string) => Promise<Uint8Array | undefined>;
};
const relative = (root: string, file: string) => path.relative(root, file).replace(/\\/g, '/');
const fields: MetadataColumn[] = ['title', 'author', 'narrator', 'year'];
const tagKeys = { title: 'title', author: 'artist', narrator: 'composer', year: 'date' };
const writableFormats = new Set(['mp3', 'm4a', 'm4b', 'flac', 'ogg', 'opus']);
const audioFormats = new Set(['mp3', 'm4a', 'm4b', 'flac', 'ogg', 'opus', 'wav', 'aiff', 'aif', 'aac', 'wma']);
const ext = (file: string) => path.extname(file).slice(1).toLowerCase();
async function refreshSourceStamps(job: AudiobookJob, root: string, targets?: string[]) {
  job.sourceFileStamps ||= {};
  for (const part of job.parts) {
    const key = (part.sourceRelativePath || part.name).replace(/\\/g, '/');
    if (targets && !targets.some(target => sameOrInside(target, path.resolve(root, key)))) continue;
    try { const stat = await fs.stat(path.resolve(root, key)); job.sourceFileStamps[key] = { sizeBytes: stat.size, modifiedMs: stat.mtimeMs, device: stat.dev, inode: stat.ino }; } catch { /* Missing files stay recoverable in the manifest. */ }
  }
}
function normalizedTags(media: any): Record<string, string> { return Object.fromEntries(Object.entries(media.tags || {}).map(([key, value]) => [key.toLowerCase(), String(value)])); }
function details(media: any, file: string, writable: boolean): FileDetails {
  const tags = normalizedTags(media);
  return { title: tags.title, author: tags.artist || tags.author, narrator: tags.composer || tags.narrator, year: tags.date || tags.year,
    durationSeconds: media.durationSeconds, writable: writable && writableFormats.has(ext(file)) ? fields : [] };
}
function owners(host: Host, files: string[]) {
  const selected = new Set(files.map(pathKey));
  const contains = (file: string) => {
    let key = pathKey(file);
    while (true) { if (selected.has(key)) return true; const parent = path.dirname(key); if (parent === key) return false; key = parent; }
  };
  return host.jobs().flatMap(job => {
    const root = host.root(job); if (!root) return [];
    const sources = job.parts.map(part => path.resolve(root, part.sourceRelativePath || part.name));
    const matching = job.parts.filter((_part, index) => contains(sources[index]));
    const references = projectFiles(job, sources).filter(reference => contains(reference.path)).map(reference => reference.path);
    return references.length ? [{ job, references, files: matching.map(part => (part.sourceRelativePath || part.name).replace(/\\/g, '/')) }] : [];
  });
}
async function treeStamp(file: string): Promise<unknown> {
  const info = await fs.lstat(file);
  if (info.isSymbolicLink()) throw new Error('Linked paths cannot be changed.');
  return [file, await pathStamp(file), info.isDirectory() ? await Promise.all((await fs.readdir(file)).sort().map(name => treeStamp(path.join(file, name)))) : null];
}

export function registerBookFilesRoutes(app: Express, host: Host) {
  const directoryIndex = new DirectoryIndex(path.join(host.appRoot,'directories.sqlite'));
  const diagnostics = new Map<string, string>();
  const undo = new Map<string, { file: string; stamp: string; before?: { field: MetadataColumn; value: string }; renamedFrom?: string }>();
  const route = (method: 'get' | 'post', suffix: string, mutation: boolean, handler: (job: AudiobookJob, body: any) => Promise<any>) => {
    app[method](`/api/jobs/:id/book-files${suffix}`, async (req, res) => {
      const job = (host.getJob ? host.getJob(req.params.id) : host.jobs().find(item => item.id === req.params.id));
      if (!job) { res.status(404).json({ error: 'Book not found.' }); return; }
      if (mutation && host.busy()) {
        const reason = host.busyReason?.();
        res.status(409).json({ error: reason ? `Wait for ${reason} to finish.` : 'Wait for current processing or file operations to finish.' }); return;
      }
      if (mutation) host.lock(job.id, true);
      try { res.json(await handler(job, method === 'get' ? req.query : req.body || {})); }
      catch (error: any) { host.log(job, error.message, true); res.status(400).json({ error: error.message || 'Could not manage book files.' }); }
      finally { if (mutation) host.lock(job.id, false); }
    });
  };
  route('post', '/verify-audio', true, async job => {
    const root = host.root(job);
    if (!root) throw new Error('Add local audio first.');
    const result = await verifyProjectAudio(job, root, host.probe || host.read, host.excluded(), {
      progress: message => host.log(job, message),
      checkAudio: file => checkSourceAudio(host.ffmpeg(), host.ffprobe(), file, undefined, message => host.log(job, `${path.basename(file)}: ${message}`)),
    });
    if (result.changed) host.invalidate(job);
    host.totals(job);
    for (const issue of result.issues) host.log(job, issue, true);
    host.log(job, `Full audio check: ${result.checked} files; ${result.issues.length ? `${result.issues.length} issues` : 'decoding and packet timelines passed'}; stream compatibility ${result.compatible ? 'passed' : 'not suitable for direct joining'}.`);
    host.persist();
    return { job, ...result };
  });
  const directory = async (job: AudiobookJob, body: any) => {
    const root = host.root(job); if (!root) throw new Error('Add a local source first.');
    const folder = await checkedPath(body.directory || root, host.excluded());
    if (!(await fs.stat(folder)).isDirectory()) throw new Error('Choose an existing folder.');
    return { root, folder };
  };
  const selection = async (job: AudiobookJob, body: any, manage = false) => {
    const { root, folder } = await directory(job, body);
    const excluded = host.excluded();
    if (!Array.isArray(body.files) || !body.files.length || body.files.some((file: unknown) => typeof file !== 'string')) throw new Error('Select files or folders first.');
    if (body.files.length > 10000) throw new Error('Choose up to 10,000 items per disk operation. Directory browsing and selection remain unlimited.');
    const files = await Promise.all((body.files as string[]).map(async file => {
      const full = await checkedPath(file, excluded);
      if (pathKey(path.dirname(full)) !== pathKey(folder)) throw new Error('Selection changed. Select items in the current folder.');
      if (manage && !within(root, full)) throw new Error('File changes are limited to this project’s source folder.');
      return full;
    }));
    if (new Set(files.map(pathKey)).size !== files.length) throw new Error('Select each file once.');
    return { root, folder, files };
  };
  const rejectOtherOwners = (job: AudiobookJob, files: string[]) => {
    if (owners(host, files).some(owner => owner.job.id !== job.id)) throw new Error('These files belong to another project. Use Create New Book from Selected to review reassignment.');
    for (const other of host.jobs()) {
      const protectedPaths = [other.outputM4b?.fullPath, ...Object.values(other.exportedFiles || {}), ...(other.exports || []).map(output => output.fullPath)];
      if (other.id !== job.id && protectedPaths.some(saved => saved && files.some(file => sameOrInside(file, saved)))) throw new Error('This selection contains another project’s exports. Open that project first.');
    }
  };
  app.get('/api/jobs/:id/book-files/thumbnail', async (req, res) => {
    const job = (host.getJob ? host.getJob(req.params.id) : host.jobs().find(item => item.id === req.params.id));
    if (!job) { res.sendStatus(404); return; }
    try {
      const { files } = await selection(job, { directory: req.query.directory, files: [req.query.file] }); const file = files[0];
      if (!audioFormats.has(ext(file)) && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file)) { res.sendStatus(404); return; }
      const bytes = await host.thumbnail?.(file); if (!bytes) { res.sendStatus(404); return; }
      res.set('Cache-Control', 'private, max-age=3600').type('png').send(Buffer.from(bytes));
    } catch { res.sendStatus(404); }
  });

  route('post', '/discover', true, async (_job, body) => host.select(body.paths, body.groupId));
  route('post', '/mkdir', true, async (job, body) => {
    const { root, folder } = await directory(job, body);
    if (!sameOrInside(root, folder)) throw new Error('Create folders inside this project’s source folder.');
    const target = path.join(folder, validFileName(body.name)); await mustNotExist(target); await fs.mkdir(target);
    try { host.log(job, `Created folder: ${target}`); host.persist(); }
    catch (error) { await fs.rmdir(target).catch(() => {}); throw error; }
    return { job };
  });
  route('post', '/attach', true, async (job, body) => {
    const root = host.root(job); if (!root) throw new Error('Import a source before attaching additional files.');
    const selection = await host.select(body.paths, body.groupId);
    if (selection.needsGroup) return selection;
    const files = selection.files as DiscoveredAudioFile[];
    const absolute = files.map(file => path.resolve(selection.root, file.relativePath));
    for (const file of absolute) await checkedPath(file, host.excluded());
    rejectOtherOwners(job, absolute);
    const before = cloneProject(job);
    try {
      const nextRoot = rebaseBookMembership(job, root, absolute);
      const existing = new Set(job.parts.map(part => pathKey(path.resolve(nextRoot, part.sourceRelativePath || part.name))));
      for (let index = 0; index < files.length; index++) {
        if (existing.has(pathKey(absolute[index]))) continue;
        const file = { ...files[index], relativePath: relative(nextRoot, absolute[index]) };
        job.parts.push({ id: `p-${operationId()}`, name: file.relativePath, sourceRelativePath: file.relativePath, sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds, bitrate: file.bitrate || 0, order: job.parts.length + 1 });
        job.discoveredFiles ||= []; job.discoveredFiles.push(file);
        job.explicitlyAddedSourceFiles = [...new Set([...(job.explicitlyAddedSourceFiles || []), file.relativePath])];
        job.excludedSourceFiles = job.excludedSourceFiles?.filter(excluded => excluded !== file.relativePath);
      }
      if (job.source?.mode === 'file' && job.parts.length > 1) job.source = { ...job.source, mode: 'folder', path: nextRoot };
      job.sourceMembership = 'confirmed'; host.invalidate(job); host.totals(job); host.log(job, `Attached ${absolute.length} selected files in place; existing membership and metadata preserved.`); host.persist();
      return { job };
    } catch (error) { for (const key of Object.keys(job)) delete (job as any)[key]; Object.assign(job, before); throw error; }
  });

  route('get', '/folders', false, async (job, body) => {
    // Folder-only pages never probe audio or change project membership.
    const { folder } = await directory(job, body);
    const page = directoryIndex.query(folder, { filter: 'folder', sort: 'name', limit: body.limit === undefined ? 100 : Number(body.limit), cursor: body.cursor, refresh: body.refresh === 'true' }, host.excluded());
    return { directory: folder, ...page, entries: page.entries.map(({ path, name, unavailable }) => ({ path, name, unavailable })) };
  });
  route('get', '', false, async (job, body) => {
    const excluded = host.excluded(), root = host.root(job);
    if (!root) throw new Error('Add a local source first.');
    const requested=body.directory || root;
    if (typeof requested !== 'string' || !path.isAbsolute(requested)) throw new Error('Choose an absolute path.');
    const folder=path.resolve(requested);
    if (folder.split(path.sep).some(segment=>segment.startsWith('.swissmouse')) || excluded.some(blocked=>sameOrInside(blocked,folder))) throw new Error('SwissMouse working files cannot be managed here.');
    // Cached navigation is read-only. Opening, probing and every mutation still
    // validate the real path; background reconciliation checks directory links.
    if (!directoryIndex.has(folder)) await directory(job,body);
    const parts = new Map(job.parts.map(part => [pathKey(path.resolve(root, part.sourceRelativePath || part.name)), part]));
    const indexed = new Map((job.sourceInventory || job.discoveredFiles || []).map(file => [pathKey(path.resolve(root, file.relativePath)), file]));
    const outputs = new Set([job.outputM4b?.fullPath, ...Object.values(job.exportedFiles || {}), ...(job.exports || []).map(output => output.fullPath)].filter(Boolean).map(file => pathKey(file!)));
    const page = directoryIndex.query(folder,{query:body.query,filter:body.filter,sort:body.sort,limit:body.limit === undefined ? 100 : Number(body.limit),cursor:body.cursor,before:body.before==='true',refresh:body.refresh==='true'},excluded);
    const entries = page.entries.map(entry=>({...entry,relativePath:relative(root,entry.path),included:parts.has(pathKey(entry.path)),durationSeconds:parts.get(pathKey(entry.path))?.durationSeconds,
      metadata:entry.metadata || (indexed.get(pathKey(entry.path))?.tags ? details({tags:indexed.get(pathKey(entry.path))!.tags},entry.path,false):undefined)}));
    const issues: string[] = []; let total = 0, complete = true;
    for (const part of job.parts) {
      if (!(part.durationSeconds > 0)) { complete=false; if (issues.length<50) issues.push(`Check duration for ${part.name}: add or refresh the source before processing.`); }
      else total+=part.durationSeconds;
    }
    if (job.libraryScan?.missing) { complete=false; issues.push('Source was unavailable at the last observation. Relink or verify it before processing.'); }
    const diagnostic = `Membership: ${job.sourceMembership || 'automatic'}; scans preserve explicit choices. Book scope: ${job.bookScope?.title || job.name}. Only In Project files are processed.${issues.length ? ' Attention: ' + issues.join('; ') : ''}`;
    if (diagnostics.get(job.id) !== diagnostic) { diagnostics.set(job.id, diagnostic); host.log(job, diagnostic, !!issues.length); }
    return { root, directory: folder, parent: path.dirname(folder) === folder ? undefined : path.dirname(folder), ...page, entries,
      canManage: sameOrInside(root, folder), groups: page.total > entries.length || page.indexing ? [] : probableBookGroups(entries.filter((entry: any) => entry.audio && !(job.excludedSourceFiles || []).includes(entry.relativePath) && !outputs.has(pathKey(entry.path))).map((entry: any) => ({ ...indexed.get(pathKey(entry.path)), relativePath: entry.relativePath })), path.basename(root)),
      readiness: { status: !job.parts.length ? 'Empty' : issues.length ? 'Attention Required' : 'Ready', issues, durationSeconds: total, durationComplete: complete } };
  });
  route('post', '/details', false, async (job, body) => {
    const { files, root, folder } = await selection(job, body);
    if (files.length > 40) throw new Error('Request at most 40 visible audio files at once.');
    const output: Record<string, FileDetails> = {};
    await Promise.all(files.map(async file => {
      if (!audioFormats.has(ext(file))) return;
      try {
        const media = await host.read(file); let writable = within(root, file);
        try { await fs.access(file, fs.constants.W_OK); rejectOtherOwners(job, [file]); } catch { writable = false; }
        output[file] = details(media, file, writable); directoryIndex.remember(folder,file,output[file]);
      }
      catch (error: any) { output[file] = { writable: [], error: error.message }; }
    }));
    return output;
  });
  route('post', '/check', true, async job => {
    const root = host.root(job); if (!root) throw new Error('Add a source first.');
    const before = cloneProject(job), warnings: string[] = [];
    try {
      for (const part of job.parts) {
        const key = (part.sourceRelativePath || part.name).replace(/\\/g, '/'), file = path.resolve(root, key);
        try {
          await checkedPath(file, host.excluded()); const stat = await fs.stat(file), prior = job.sourceFileStamps?.[key];
          if (part.durationSeconds > 0 && stat.size === part.sizeBytes && prior && prior.modifiedMs === stat.mtimeMs && prior.device === stat.dev && prior.inode === stat.ino) continue;
          const media = await host.read(file);
          if (!(media.durationSeconds > 0)) throw new Error('No playable duration');
          if (stat.size !== part.sizeBytes || Math.abs(media.durationSeconds - part.durationSeconds) > .02 || prior && (prior.modifiedMs !== stat.mtimeMs || prior.device !== stat.dev || prior.inode !== stat.ino)) host.invalidate(job);
          part.sizeBytes = stat.size; part.durationSeconds = media.durationSeconds; part.bitrate = media.bitrate || part.bitrate;
          for (const collection of [job.discoveredFiles, job.sourceInventory]) for (const entry of collection || []) if (entry.relativePath.replace(/\\/g, '/') === key) Object.assign(entry, { sizeBytes: stat.size, durationSeconds: media.durationSeconds, tags: normalizedTags(media) });
          job.sourceFileStamps ||= {}; job.sourceFileStamps[key] = { sizeBytes: stat.size, modifiedMs: stat.mtimeMs, device: stat.dev, inode: stat.ino };
        } catch (error: any) { warnings.push(`${part.name}: ${error.message}`); }
      }
      host.totals(job); host.log(job, `Checked assigned processing files. Membership preserved.${warnings.length ? ' ' + warnings.join('; ') : ''}`, !!warnings.length); host.persist();
      return { job, warning: warnings.join('; ') || undefined };
    } catch (error) { for (const key of Object.keys(job)) delete (job as any)[key]; Object.assign(job, before); throw error; }
  });
  const edit = async (job: AudiobookJob, body: any, isUndo = false) => {
    const { root, files } = await selection(job, { ...body, files: [body.file] }, true);
    const file = files[0]; rejectOtherOwners(job, files);
    const affectsSource = job.parts.some(part => sameOrInside(file, path.resolve(root, part.sourceRelativePath || part.name)));
    const before = cloneProject(job);
    const currentStamp = await pathStamp(file);
    if (body.stamp && body.stamp !== currentStamp) throw new Error('The file changed. Refresh before editing it again.');
    if (body.field === 'name') {
      const target = path.join(path.dirname(file), validFileName(body.value));
      if (target === file) return { job };
      await renameExclusive(file, target);
      try { remapSourceReferences(job, root, [{ from: file, to: target }]); if (affectsSource) host.invalidate(job); host.log(job, `${isUndo ? 'Undid' : 'Saved'} filename edit: ${file}`); host.persist(); }
      catch (error) { await renameExclusive(target, file); Object.assign(job, before); throw error; }
      if (!isUndo) undo.set(job.id, { file: target, stamp: await pathStamp(target), renamedFrom: file });
    } else {
      const field = body.field as MetadataColumn;
      if (!fields.includes(field) || !writableFormats.has(ext(file)) || typeof body.value !== 'string' || body.value.length > 4096) throw new Error('This field is not writable for this file.');
      const media = await host.read(file); const prior = details(media, file, true)[field] || '';
      const backup = path.join(path.dirname(file), `.swissmouse-metadata-${operationId()}.${ext(file)}`);
      await fs.copyFile(file, backup, fs.constants.COPYFILE_EXCL);
      let writtenStamp: string | undefined;
      try {
        if (currentStamp !== await pathStamp(file)) throw new Error('Source changed before writing; refresh before retrying.');
        const tags = { ...normalizedTags(media), [tagKeys[field]]: body.value };
        // Clear legacy aliases so removing a field does not reveal stale tags.
        if (field === 'year') tags.year = '';
        if (field === 'author') tags.author = '';
        if (field === 'narrator') tags.narrator = '';
        await writeAudioMetadata({ ffmpeg: host.ffmpeg(), ffprobe: host.ffprobe(), file, format: ext(file) as any, tags });
        writtenStamp = await pathStamp(file);
        const verified = await host.read(file);
        if ((details(verified, file, true)[field] || '') !== body.value) throw new Error('Metadata read-back failed; original restored.');
        for (const collection of [job.sourceInventory, job.discoveredFiles]) for (const entry of collection || []) if (pathKey(path.resolve(root, entry.relativePath)) === pathKey(file)) entry.tags = normalizedTags(verified);
        const stat = await fs.stat(file);
        for (const part of job.parts) if (pathKey(path.resolve(root, part.sourceRelativePath || part.name)) === pathKey(file)) part.sizeBytes = stat.size;
        await refreshSourceStamps(job, root, [file]); if (affectsSource) host.invalidate(job); host.totals(job); host.log(job, `${isUndo ? 'Undid' : 'Saved'} metadata edit: ${file}`); host.persist();
        if (!isUndo) undo.set(job.id, { file, stamp: await pathStamp(file), before: { field, value: prior } });
        await fs.unlink(backup).catch(error => host.log(job, `Metadata saved; recovery copy retained at ${backup}: ${error.message}`, true));
      } catch (error) {
        const current = await pathStamp(file).catch(() => undefined);
        if (writtenStamp && current === writtenStamp) await fs.rename(backup, file);
        else if (current === currentStamp) await fs.unlink(backup).catch(() => {});
        else host.log(job, `Source changed outside SwissMouse; retained current file and recovery copy ${backup}.`, true);
        for (const key of Object.keys(job)) delete (job as any)[key]; Object.assign(job, before); throw error;
      }
    }
    return { job, undoAvailable: !isUndo };
  };
  route('post', '/edit', true, (job, body) => edit(job, body));
  route('post', '/undo', true, async job => {
    const item = undo.get(job.id); if (!item) throw new Error('No supported edit to undo. Only the latest filename or metadata edit in this session can be undone.');
    if (await pathStamp(item.file) !== item.stamp) throw new Error('The edited file changed; undo is unavailable.');
    const result = await edit(job, { directory: path.dirname(item.file), file: item.file, stamp: item.stamp, field: item.before?.field || 'name', value: item.before?.value ?? path.basename(item.renamedFrom!) }, true);
    undo.delete(job.id); return result;
  });
  route('post', '/operation', true, async (job, body) => {
    const { root, folder, files } = await selection(job, body, body.action !== 'copy');
    if (!['copy', 'cut', 'delete', 'rename-folder'].includes(body.action)) throw new Error('Unknown file operation.');
    if (body.action !== 'copy') rejectOtherOwners(job, files);
    const destination = body.action === 'delete' ? undefined : await checkedPath(body.destination || folder, host.excluded());
    if (destination && (!sameOrInside(root, destination) || !(await fs.stat(destination)).isDirectory())) throw new Error('Choose a destination within this project’s source folder.');
    const moves = destination ? files.map(file => ({ from: file, to: path.join(destination, body.action === 'rename-folder' ? validFileName(body.name) : path.basename(file)) })) : [];
    if (body.action === 'rename-folder' && (files.length !== 1 || !(await fs.stat(files[0])).isDirectory())) throw new Error('Select one folder to rename.');
    for (const move of moves) {
      if (sameOrInside(move.from, move.to)) throw new Error('A file or folder cannot be copied into itself.');
      await mustNotExist(move.to);
    }
    if (new Set(moves.map(move => pathKey(move.to))).size !== moves.length) throw new Error('Destination filenames collide.');
    const stamps = await Promise.all(files.map(treeStamp));
    const token = planToken({ action: body.action, moves, stamps, parts: job.parts, allOwners: owners(host, files).map(owner => [owner.job.id, owner.files]) });
    if (!body.commit) return { token, files, moves, action: body.action };
    if (token !== body.token) throw new Error('The files or project changed. Review the operation again.');
    const before = cloneProject(job), owned: OwnedCopy[] = [];
    const journal = path.join(host.appRoot, `book-files-${operationId()}.json`);
    const record = { action: body.action, files, moves, stamps, jobId: job.id, committed: false, owned };
    await fs.writeFile(journal, JSON.stringify(record), { flag: 'wx' });
    try {
      for (const move of moves) { await copyEntry(move.from, move.to, owned); await fs.writeFile(journal, JSON.stringify(record)); }
      if (planToken(await Promise.all(files.map(treeStamp))) !== planToken(stamps)) throw new Error('Source changed during the operation. Originals were kept.');
      if (body.action !== 'copy' && body.action !== 'delete') {
        const affectsSource = owners(host, files).some(owner => owner.job.id === job.id && owner.files.length > 0);
        remapSourceReferences(job, root, moves); await refreshSourceStamps(job, root, moves.map(move => move.to)); if (affectsSource) host.invalidate(job);
      }
      if (body.action !== 'delete') host.persist();
    } catch (error) { Object.assign(job, before); await rollbackCopies(owned); throw error; }
    record.committed = true; await fs.writeFile(journal, JSON.stringify(record));
    const failures: string[] = [];
    if (body.action !== 'copy') for (let i = 0; i < files.length; i++) {
      try {
        if (planToken(await treeStamp(files[i])) !== planToken(stamps[i])) throw new Error('Source changed; retained for review.');
        await (host.recycle || recycleEntry)(files[i]);
        if (body.action === 'delete') {
          const removed = job.parts.filter(part => sameOrInside(files[i], path.resolve(root, part.sourceRelativePath || part.name))).map(part => (part.sourceRelativePath || part.name).replace(/\\/g, '/'));
          host.remove(job, removed); host.persist();
        }
      } catch (error: any) { host.log(job, `${files[i]}: ${error.details || error.message}`, true); failures.push(`${files[i]}: ${error.message}`); }
    }
    undo.delete(job.id);
    host.log(job, `${body.action}: ${files.join(', ')}${failures.length ? `; attention required: ${failures.join('; ')}` : ''}`, !!failures.length); host.persist();
    if (!failures.length) await fs.unlink(journal);
    return { job, warning: failures.length ? `Destination and project changes were saved where possible. Some originals remain; inspect them before retrying. ${failures.join('; ')}` : undefined };
  });

  route('post', '/create', true, async (job, body) => {
    const { root, files } = await selection(job, body);
    if (files.some(file => !audioFormats.has(ext(file)) )) throw new Error('Select supported audio files to create a book.');
    if (typeof body.title !== 'string' || !body.title.trim() || typeof body.author !== 'string' || !body.author.trim()) throw new Error('Book Title and Author are required.');
    if (!['inbox', 'library'].includes(body.destinationType)) throw new Error('Choose Inbox or Library.');
    const config = host.config();
    const managedRoot = path.resolve(host.appRoot, body.destinationType === 'inbox' ? config.inbox_folder || 'inbox' : config.library_folder || 'output');
    const metadata = { ...metadataFromTags({}, body.title.trim()), author: body.author.trim() };
    const suggested = path.join(managedRoot, ...libraryRelativePath(config.library_template || DEFAULT_LIBRARY_TEMPLATE, metadata));
    const target = path.resolve(body.destination || suggested);
    if (!within(managedRoot, target) || host.excluded().some(root => sameOrInside(root, target)) || files.some(file => sameOrInside(file, target))) throw new Error('Destination must be inside the selected configured root, outside processing folders and selected files.');
    await checkedPath(managedRoot, host.excluded());
    let ancestor = path.dirname(target); while (true) { try { await checkedPath(ancestor, host.excluded()); break; } catch (error: any) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); } }
    await mustNotExist(target);
    if (new Set(files.map(file => pathKey(path.join(target, path.basename(file))))).size !== files.length) throw new Error('Selected filenames collide. Rename them before creating the book.');
    const affected = owners(host, files);
    const entries = await Promise.all(files.map(async file => ({ source: file, name: path.basename(file), stamp: await stamp(file) })));
    const token = planToken({ entries, target, metadata, config: [config.inbox_folder, config.library_folder, config.library_template], affected: affected.map(owner => [owner.job.id, owner.job.parts, owner.job.metadata, owner.job.metadataDraft, owner.references]) });
    const plan = { token, files, destination: target, transfers: affected.map(owner => ({ name: owner.job.name, files: owner.files, references: owner.references.length, remaining: owner.job.parts.length - owner.files.length })) };
    if (!body.commit) return plan;
    if (token !== body.token) throw new Error('Files, settings, or ownership changed. Review the move again.');
    const selected: DiscoveredAudioFile[] = [];
    for (const file of files) {
      const media = await host.read(file);
      selected.push({ relativePath: path.basename(file), fileName: path.basename(file), folderName: path.basename(target), sizeBytes: (await fs.stat(file)).size,
        durationSeconds: media.durationSeconds, bitrate: media.bitrate, format: media.format, codec: media.codec, sampleRate: media.sampleRate, channels: media.channels, streamSignature: media.streamSignature, tags: normalizedTags(media), isProbed: true });
    }
    const id = `book-${operationId()}`;
    const created: AudiobookJob = { id, name: metadata.title, author: metadata.author, metadata, metadataDraft: { ...metadata }, status: 'draft', createdAt: new Date().toISOString(),
      inputMethod: 'folder', source: { kind: body.destinationType === 'inbox' ? 'inbox' : 'managed', path: target, mode: 'folder' }, sourceFolderPath: target,
      outputFolderPath: config.library_folder, sourceMembership: 'confirmed', explicitlyAddedSourceFiles: selected.map(file => file.relativePath),
      bookScope: { title: metadata.title }, discoveredFiles: selected, sourceInventory: selected, candidates: [], chapters: [], logs: [], totalDurationSeconds: 0, totalSizeBytes: 0,
      parts: selected.map((file, index) => ({ id: `p-${operationId()}`, name: file.relativePath, sourceRelativePath: file.relativePath, sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds, bitrate: file.bitrate || 0, order: index + 1 })) };
    const snapshots = affected.map(owner => ({ job: owner.job, before: cloneProject(owner.job) }));
    const warning = await transferProjectFiles({ root: managedRoot, journal: path.join(host.appRoot, `book-files-${id}.json`),
      intent: { version: 2, id, source: root, target, mode: 'move', entries }, boundaries: [], protectedFiles: new Set(),
      commit: async () => { for (const owner of affected) {
        const retarget = (saved: string | undefined) => { const index = saved ? files.findIndex(file => pathKey(file) === pathKey(saved)) : -1; return index >= 0 ? path.join(target, path.basename(files[index])) : saved; };
        host.remove(owner.job, owner.files);
        for (const output of owner.job.exports || []) { output.fullPath = retarget(output.fullPath); output.coverPath = retarget(output.coverPath); }
        if (owner.job.outputM4b) owner.job.outputM4b.fullPath = retarget(owner.job.outputM4b.fullPath)!;
        if (owner.job.exportedFiles) owner.job.exportedFiles = Object.fromEntries(Object.entries(owner.job.exportedFiles).map(([key, saved]) => [key, retarget(saved)!]));
        for (const entry of owner.job.associatedFiles || []) entry.path = retarget(entry.path)!;
        if (owner.job.source?.mode === 'file' && files.some(file => pathKey(file) === pathKey(owner.job.source!.path))) owner.job.source = { ...owner.job.source, path: host.root(owner.job)!, mode: 'folder' };
        host.log(owner.job, `Moved ${owner.files.length} source files and updated associated references to new book ${metadata.title} at ${target}.`);
      }
        await refreshSourceStamps(created, target); host.totals(created); host.jobs().push(created); host.persist(); },
      rollback: () => { const index = host.jobs().findIndex(item => item.id === id); if (index >= 0) host.jobs().splice(index, 1); for (const snapshot of snapshots) { for (const key of Object.keys(snapshot.job)) delete (snapshot.job as any)[key]; Object.assign(snapshot.job, snapshot.before); } },
      log: message => host.log(job, message),
    });
    host.persist(); undo.delete(job.id);
    return { job, createdBook: { id, name: metadata.title }, warning };
  });
  return { close: () => directoryIndex.close() };
}

/** Startup never retries deletion. Uncommitted owned copies are quarantined
 * before library discovery; changed or unknown entries remain for human review. */
export async function recoverBookFilesOperations(appRoot: string, managedRoots: string[], jobs: AudiobookJob[], log: (message: string) => void, repairDeleted?: (job: AudiobookJob, files: string[]) => void) {
  for (const name of (await fs.readdir(appRoot)).filter(name => /^book-files-[\w-]+\.json$/.test(name))) {
    const journal = path.join(appRoot, name);
    try {
      const record = JSON.parse(await fs.readFile(journal, 'utf8'));
      if (record.version === 2) {
        if (!managedRoots.some(root => within(root, record.target)) || !Array.isArray(record.copied)) throw new Error('Transfer evidence requires manual review.');
        if (record.pending) {
          const { source, quarantine } = record.pending;
          if (!record.entries.some((entry: any) => pathKey(entry.source) === pathKey(source)) || path.dirname(source) !== path.dirname(quarantine) || !/^\.swissmouse-[a-f0-9-]+\.moved$/.test(path.basename(quarantine))) throw new Error('Invalid cleanup recovery path.');
          try { await fs.lstat(quarantine); await fs.link(quarantine, source); await fs.unlink(quarantine); }
          catch (error: any) { if (error.code !== 'ENOENT') throw error; }
        }
        const committed = jobs.some(job => job.id === record.id && job.sourceFolderPath && pathKey(job.sourceFolderPath) === pathKey(record.target));
        if (!committed) { const recovery = await recoverTransferCopies(record.target, record.copied); log(`Interrupted Book Files transfer: originals retained; owned copies recovered at ${recovery || record.target}.`); }
        else log(`Recovered committed Book Files transfer for ${record.id}; any remaining originals were retained.`);
        await fs.unlink(journal);
      } else {
        const job = jobs.find(job => job.id === record.jobId), root = job?.sourceFolderPath;
        if (!root || !Array.isArray(record.owned) || !Array.isArray(record.moves)) throw new Error('Operation evidence requires manual review.');
        if (record.action === 'delete' && record.committed && Array.isArray(record.files) && repairDeleted) {
          const missing: string[] = [];
          for (const file of record.files) {
            if (!within(root, file)) throw new Error('Invalid deletion recovery path.');
            try { await fs.lstat(file); } catch (error: any) { if (error.code !== 'ENOENT') throw error; missing.push(file); }
          }
          const removed = job.parts.filter(part => missing.some(file => sameOrInside(file, path.resolve(root, part.sourceRelativePath || part.name)))).map(part => (part.sourceRelativePath || part.name).replace(/\\/g, '/'));
          if (removed.length) { repairDeleted(job, removed); log(`Recovered membership for ${removed.length} successfully recycled source files.`); }
          // Keep evidence when any originals remain; do not retry recycling.
          if (missing.length === record.files.length) await fs.unlink(journal);
          else log(`Book Files recycling is incomplete (${name}); remaining originals were kept.`);
          continue;
        }
        const referenced = record.moves.some((move: any) => job.parts.some(part => sameOrInside(move.to, path.resolve(root, part.sourceRelativePath || part.name))));
        if (!record.committed && !referenced) {
          const recovery = path.join(appRoot, `.swissmouse-recovered-${operationId()}`);
          for (const item of record.owned as OwnedCopy[]) {
            if (!within(root, item.path) || !record.moves.some((move: any) => sameOrInside(move.to, item.path))) throw new Error('Invalid owned copy path.');
            if (!item.hash) continue;
            try {
              await checkedPath(item.path, []);
              if (item.stamp !== await pathStamp(item.path) || item.hash !== await contentHash(item.path)) continue;
              const target = path.join(recovery, relative(root, item.path)); await fs.mkdir(path.dirname(target), { recursive: true }); await renameExclusive(item.path, target);
            } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
          }
          log(`Interrupted Book Files operation: originals retained; owned copies moved to ${recovery}. Unknown or changed files were kept.`);
          await fs.unlink(journal);
        } else log(`Book Files operation ${name} committed; retained originals or failed recycling require review. No cleanup was retried.`);
      }
    } catch (error: any) { log(`Book Files recovery needs attention (${name}): ${error.message}. Files and recovery evidence retained.`); }
  }
}
