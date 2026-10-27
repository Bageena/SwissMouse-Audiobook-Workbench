import type { CatalogQuery, CatalogPage, CatalogSelection } from './catalog';

/** Only transport lives here; themes and viewers consume the same typed records. */
export async function catalogRequest<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(route, { method: body === undefined ? 'GET' : 'POST', signal,
    headers: { 'Content-Type':'application/json', 'X-SwissMouse-Catalog':'1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
export const queryCatalog = (query: CatalogQuery, signal?: AbortSignal) => catalogRequest<CatalogPage>('/api/catalog/library/query',query,signal);
export const selectCatalog = (query: CatalogQuery) => catalogRequest<CatalogSelection>('/api/catalog/selections',query);

/** A frozen server selection is consumed in small batches, including across catalog edits. */
export async function* selectedCatalogBatches(selection: CatalogSelection | null, explicit: string[], exclude: string[] = []) {
  if (!selection) { for (let start=0;start<explicit.length;start+=500) yield explicit.slice(start,start+500); return; }
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const result: { ids:string[]; nextOffset?:number } = await catalogRequest('/api/catalog/selections/page',{ token:selection.token,offset,exclude });
    if (result.ids.length) yield result.ids;
    offset = result.nextOffset;
  }
}
