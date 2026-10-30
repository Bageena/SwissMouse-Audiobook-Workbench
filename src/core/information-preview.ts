import type { InformationReadItem } from '../../packages/sdk/information';
import type { InformationRegistry } from './information-registry';

/** Composes inert projections without knowing any module payload or store. */
export function informationPreviewPage(registry: InformationRegistry, page: { items: readonly InformationReadItem[]; revision: number; total: number; nextCursor?: string }) {
  if (!Array.isArray(page.items) || page.items.length > 500 || !Number.isSafeInteger(page.revision) || page.revision < 0) throw new Error('Invalid bounded catalog page.');
  return { prototypeVersion: 1 as const, readOnly: true as const, revision: page.revision, total: page.total, nextCursor: page.nextCursor,
    items: page.items.map(data => ({ ...data, presentation: registry.present(data.descriptor) })) };
}
