import type { AudioPart } from './legacy-domain';

/** Groups are manifest metadata; source files stay untouched and keep their order. */
export function manualChapterGroups(parts: Pick<AudioPart, 'name' | 'sourceRelativePath' | 'chapterGroup'>[]) {
  const groups: { title: string; indices: number[] }[] = [];
  const seen = new Set<string>();
  let previous: string | undefined;
  parts.forEach((part, index) => {
    const group = part.chapterGroup;
    if (group && (!group.id || !group.title.trim())) throw new Error('Chapter groups need a name.');
    if (group && group.id === previous) groups[groups.length - 1].indices.push(index);
    else {
      if (group && seen.has(group.id)) throw new Error('Keep files in each chapter group together in Processing Order, or ungroup them.');
      if (group) seen.add(group.id);
      groups.push({ title: group?.title || (part.sourceRelativePath || part.name).replace(/\\/g, '/').split('/').pop()!.replace(/\.[^.]+$/, ''), indices: [index] });
    }
    previous = group?.id;
  });
  return { mode: 'manual_groups' as const, groups };
}

export function setChapterGroup(parts: AudioPart[], files: string[], title: string | undefined, id: string) {
  if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string') || new Set(files).size !== files.length) throw new Error('Select processing files to group or ungroup.');
  const selected = new Set(files);
  const indices = parts.flatMap((part, index) => selected.has((part.sourceRelativePath || part.name).replace(/\\/g, '/')) ? [index] : []);
  if (indices.length !== files.length) throw new Error('The processing files changed. Refresh and retry.');
  if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.trim().length > 200)) throw new Error('Enter a chapter group name of up to 200 characters.');
  if (title !== undefined && (indices.length < 2 || indices[indices.length - 1] - indices[0] + 1 !== indices.length)) throw new Error('Select two or more consecutive files in Processing Order.');
  const affected = new Set(indices.map(index => parts[index].chapterGroup?.id).filter(Boolean));
  if (title !== undefined && parts.some((part, index) => part.chapterGroup && affected.has(part.chapterGroup.id) && !indices.includes(index))) throw new Error('Select the whole existing group before regrouping, or ungroup it first.');
  for (const part of parts) if (part.chapterGroup && affected.has(part.chapterGroup.id)) delete part.chapterGroup;
  if (title !== undefined) for (const index of indices) parts[index].chapterGroup = { id, title: title.trim() };
}

// Relative paths are structural metadata, independent of app-owned uploaded filenames.
export function naturalPathCompare(a: string, b: string) {
  return a.replace(/\\/g, '/').localeCompare(b.replace(/\\/g, '/'), 'en', {numeric:true, sensitivity:'base'});
}
export function sourceOrderCompare(a: { sourceRelativePath?: string; relativePath?: string; name?: string; discNumber?: number; trackNumber?: number }, b: { sourceRelativePath?: string; relativePath?: string; name?: string; discNumber?: number; trackNumber?: number }) {
  const ap = a.sourceRelativePath || a.relativePath || a.name || '';
  const bp = b.sourceRelativePath || b.relativePath || b.name || '';
  const folderNumber = (value: string) => /^(?:(?:disc|disk|cd|part|chapters?)\s*[._-]*)?0*(\d+)(?=$|[\s._-])/i.exec(value.replace(/\\/g, '/').split('/')[0])?.[1];
  const fileNumber = (value: string) => /(?:track|chapter|part|disc)?[\s._-]*0*(\d+)(?=[\s._-]|$)/i.exec(value.replace(/\\/g, '/').split('/').pop() || '')?.[1];
  const ad = a.discNumber ?? Number(folderNumber(ap) || 0), bd = b.discNumber ?? Number(folderNumber(bp) || 0);
  if (ad !== bd) return ad - bd;
  const at = a.trackNumber ?? Number(fileNumber(ap) || 0), bt = b.trackNumber ?? Number(fileNumber(bp) || 0);
  if (at !== bt) return at - bt;
  return naturalPathCompare(ap, bp);
}
export function hasExplicitSourceOrder(file: { relativePath: string; discNumber?: number; trackNumber?: number }) {
  if (file.discNumber || file.trackNumber) return true;
  const segments = file.relativePath.replace(/\\/g, '/').split('/');
  return segments.slice(0, -1).some(folder => /^(?:(?:disc|disk|cd|part|chapters?)\s*[._-]*)?\d+(?=$|[\s._-])/i.test(folder)) ||
    /^(?:(?:track|chapter|part)\s*[._-]*)?\d+(?=$|[\s._-])/i.test(segments[segments.length - 1]);
}
export function sourceChapterGroups(paths: string[]) {
  const relative = paths.map(p => p.replace(/\\/g, '/'));
  const folders = [...new Set(relative.filter(p => p.includes('/')).map(p => p.split('/')[0]))];
  const numbers = folders.map(f => /^(?:(?:chapter|part|disc|disk|cd)\s*)?(\d+)(?=$|[\s._-])/i.exec(f)?.[1]);
  // Numeric labels explicitly indicate ordering; gaps are allowed (e.g. 2 before 10).
  const useFolders = folders.length > 0 && numbers.every(Boolean) && new Set(numbers.map(Number)).size === folders.length;
  const groups: {title:string; indices:number[]}[] = [];
  let previousKey: string | undefined;
  relative.forEach((p,i) => {
    const folder = p.includes('/') ? p.split('/')[0] : undefined;
    const key = useFolders && folder ? 'folder:' + folder : 'file:' + p;
    const previous = groups[groups.length-1];
    if (useFolders && folder && previousKey === key) previous.indices.push(i);
    else groups.push({title: useFolders && folder ? folder : p.split('/').pop()!.replace(/\.[^.]+$/, ''), indices:[i]});
    previousKey = key;
  });
  return { mode: useFolders ? 'sequential_folders' : 'files', groups } as const;
}
