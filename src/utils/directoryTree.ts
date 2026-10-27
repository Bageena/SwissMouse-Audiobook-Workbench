/** Path comparisons for the local Windows server and portable POSIX fixtures. */
export const directoryKey = (path: string) => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLocaleLowerCase('en-US') : normalized;
};
export const containsDirectory = (root: string, path: string) => {
  const parent = directoryKey(root), child = directoryKey(path);
  return parent === child || child.startsWith(parent === '/' ? '/' : `${parent}/`);
};
export function filesystemRoot(path: string) {
  const windows = path.replace(/\\/g, '/');
  const unc = windows.match(/^\/\/[^/]+\/[^/]+/);
  if (unc) return unc[0].replace(/\//g, '\\');
  if (/^[a-z]:\//i.test(windows)) return `${windows.slice(0, 2)}\\`;
  return '/';
}
export function directoryTrail(root: string, directory: string): string[] {
  if (!containsDirectory(root, directory)) return [];
  const separator = root.includes('\\') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  const parts = directory.replace(/\\/g, '/').slice(base.replace(/\\/g, '/').length).split('/').filter(Boolean);
  return [root, ...parts.map((_, index) => base + separator + parts.slice(0, index + 1).join(separator))];
}
