// Relative paths are structural metadata, independent of app-owned uploaded filenames.
export function naturalPathCompare(a: string, b: string) {
  return a.replace(/\\/g, '/').localeCompare(b.replace(/\\/g, '/'), 'en', {numeric:true, sensitivity:'base'});
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
