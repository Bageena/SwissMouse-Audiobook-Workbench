import type { MetadataMembership } from './domain';
export function cleanMemberships(value: unknown): MetadataMembership[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || typeof item.id !== 'string' || !item.id.trim()) return [];
    const id = item.id.slice(0,200), key = item.name.trim().toLocaleLowerCase();
    if (seen.has(key)) return []; seen.add(key);
    return [{ id, name:item.name.trim().slice(0,100), ...(typeof item.sequence === 'string' ? { sequence:item.sequence.slice(0,40) } : {}), ...(typeof item.addedAt === 'string' ? { addedAt:item.addedAt } : {}) }];
  }).slice(0,500);
}
