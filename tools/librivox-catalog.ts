import type { LibriVoxBook, LibriVoxSearchField, LibriVoxSearchResult, LibriVoxSection } from '../src/librivox';
export const PAGE_SIZE = 20;
const API = 'https://librivox.org/api/feed/';
export class LibriVoxError extends Error {
  constructor(message: string, public status = 502, public retryAfter?: number) { super(message); }
}
export function trustedUrl(value: unknown, media = false): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return;
    const host = url.hostname.toLowerCase();
    if (!(host === 'librivox.org' || host === 'www.librivox.org' || host === 'archive.org' || host.endsWith('.archive.org'))) return;
    if (media && (host === 'librivox.org' || host === 'www.librivox.org')) return;
    url.protocol = 'https:';
    return url.href;
  } catch { return; }
}
export function plainText(value: unknown, limit = 1000): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, limit * 4).replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
    const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[n]!))
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
const list = (value: unknown): any[] => Array.isArray(value) ? value.filter(v => v && typeof v === 'object').slice(0, 5000) : [];
const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
export function normalizeSections(value: unknown): LibriVoxSection[] {
  return list(value).map((s, i) => ({
    id: plainText(String(s.id ?? i), 40), order: positive(s.section_number) || i + 1,
    title: plainText(s.title, 500) || 'Section ' + (i + 1), url: trustedUrl(s.listen_url, true),
    originalUrl: trustedUrl(s.listen_url, true) ? s.listen_url : undefined,
    durationSeconds: positive(s.playtime),
    readers: [...new Set(list(s.readers).map(r => plainText(r.display_name, 200)).filter(Boolean))],
  })).sort((a, b) => a.order - b.order);
}
export function normalizeBook(raw: any): LibriVoxBook | null {
  if (!raw || !/^\d{1,12}$/.test(String(raw.id)) || !plainText(raw.title)) return null;
  const sections = normalizeSections(raw.sections);
  return {
    id: String(raw.id), title: plainText(raw.title, 500), description: plainText(raw.description, 16000),
    authors: [...new Set(list(raw.authors).map(a => plainText([a.first_name, a.last_name].filter(v => typeof v === 'string').join(' '), 300)).filter(Boolean))],
    language: plainText(raw.language, 100), runtime: plainText(raw.totaltime, 40), durationSeconds: positive(raw.totaltimesecs),
    sectionCount: positive(raw.num_sections) || sections.length, genres: list(raw.genres).map(g => plainText(g.name, 200)).filter(Boolean),
    projectUrl: trustedUrl(raw.url_librivox), archiveUrl: trustedUrl(raw.url_iarchive),
    coverUrl: trustedUrl(raw.coverart_jpg || raw.coverart_thumbnail, true), sections,
    coverThumbnailUrl: trustedUrl(raw.coverart_thumbnail, true),
  };
}
export function searchParams(field: unknown, query: unknown, page: unknown) {
  if (!['title', 'author', 'genre'].includes(String(field))) throw new LibriVoxError('Search by Title, Author or Genre.', 400);
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new LibriVoxError('Enter a search term (up to 200 characters).', 400);
  const p = Number(page ?? 1);
  if (!Number.isSafeInteger(p) || p < 1 || p > 1000) throw new LibriVoxError('Invalid search page.', 400);
  return { field: field as LibriVoxSearchField, query: query.trim(), page: p };
}
export const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export async function safeFetch(url: string, init: RequestInit = {}, request: typeof fetch = fetch): Promise<Response> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const clean = trustedUrl(url);
    if (!clean) throw new LibriVoxError('The service returned an untrusted download URL.');
    const response = await request(clean, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) break;
    url = new URL(location, clean).href;
  }
  throw new LibriVoxError('Too many redirects from the download service.');
}
export async function boundedBody(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) throw new LibriVoxError('The service returned an empty response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > max) throw new LibriVoxError('The service response exceeds the supported size.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
// One queue across searches/details: no parallel catalog pages or retry storms.
export class LibriVoxCatalog {
  private tail: Promise<unknown> = Promise.resolve();
  private nextRequest = 0;
  private cooldownUntil = 0;
  private pending = new Map<string, Promise<any>>();
  private cacheBytes = 0;
  private cache = new Map<string, { expires: number; value: any; bytes: number }>();
  constructor(private request: typeof fetch = fetch, private wait = pause, private now = Date.now, private spacing = 3000) {}
  private json(endpoint: string, params: Record<string, string>): Promise<any> {
    const url = new URL(API + endpoint + '/'); url.search = new URLSearchParams({ ...params, format: 'json' }).toString();
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return Promise.resolve(cached.value);
    if (this.pending.has(key)) return this.pending.get(key)!;
    if (this.pending.size >= 30) return Promise.reject(new LibriVoxError('LibriVox requests are busy. Try again shortly.', 429, 5));
    const run = this.tail.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (this.cooldownUntil > this.now()) throw new LibriVoxError('LibriVox is rate limiting requests. Please try again later.', 429, Math.ceil((this.cooldownUntil - this.now()) / 1000));
        await this.wait(Math.max(0, this.nextRequest - this.now()));
        this.nextRequest = this.now() + this.spacing;
        try {
          const response = await safeFetch(key, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'SwissMouse/0.1 (LibriVox audiobook importer)', Accept: 'application/json' } }, this.request);
          if (response.status === 429) {
            const header = response.headers.get('retry-after');
            const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - this.now()) / 1000) : 60;
            const retry = Number.isFinite(seconds) ? Math.max(3, seconds) : 60;
            this.nextRequest = this.now() + retry * 1000;
            this.cooldownUntil = this.nextRequest;
            await response.body?.cancel();
            throw new LibriVoxError('LibriVox is rate limiting requests. Please try again later.', 429, retry);
          }
          if (response.status >= 500) { await response.body?.cancel(); throw new Error('Temporary service failure'); }
          const data = JSON.parse(Buffer.from(await boundedBody(response, 8 * 1024 * 1024)).toString('utf8'));
          if (data?.error && /could not be found/i.test(String(data.error))) return endpoint === 'audiobooks' ? { books: [] } : { sections: [] };
          if (!response.ok || data?.error) throw new LibriVoxError('LibriVox could not complete this request.');
          if (!data || typeof data !== 'object') throw new LibriVoxError('LibriVox returned an invalid response.');
          return data;
        } catch (error) {
          if (error instanceof LibriVoxError) throw error;
          if (attempt) throw new LibriVoxError('LibriVox could not be reached. Check your connection or try again later.');
        }
      }
    }).then(value => {
      const bytes = Buffer.byteLength(JSON.stringify(value));
      const previous = this.cache.get(key);
      if (previous) { this.cacheBytes -= previous.bytes; this.cache.delete(key); }
      while (this.cache.size && (this.cache.size >= 100 || this.cacheBytes + bytes > 32 * 1024 * 1024)) {
        const oldest = this.cache.keys().next().value!;
        this.cacheBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
      }
      this.cache.set(key, { expires: this.now() + 10 * 60_000, value, bytes }); this.cacheBytes += bytes;
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, run); this.tail = run.catch(() => {}); return run;
  }
  async search(field: unknown, query: unknown, page: unknown = 1): Promise<LibriVoxSearchResult> {
    const p = searchParams(field, query, page);
    console.log('[LibriVox] Search:', p.field, JSON.stringify(p.query), 'page', p.page);
    // The live API treats bare partial titles as exact matches. Its documented
    // caret syntax performs prefix search without fetching unrelated pages.
    const data = await this.json('audiobooks', { [p.field]: p.query.startsWith('^') ? p.query : '^' + p.query, limit: String(PAGE_SIZE), offset: String((p.page - 1) * PAGE_SIZE), coverart: '1', extended: '1',
      fields: '{id,title,authors,language,totaltime,totaltimesecs,num_sections,genres,url_librivox,coverart_thumbnail,coverart_jpg}' });
    if (!Array.isArray(data.books)) throw new LibriVoxError('LibriVox returned an invalid book list.');
    const books = data.books.slice(0, PAGE_SIZE).map(normalizeBook).filter(Boolean) as LibriVoxBook[];
    console.log('[LibriVox] Results:', books.length);
    return { books, page: p.page, hasNext: data.books.length >= PAGE_SIZE, skipped: Math.min(data.books.length, PAGE_SIZE) - books.length };
  }
  async detail(id: string): Promise<LibriVoxBook> {
    if (!/^\d{1,12}$/.test(id)) throw new LibriVoxError('Invalid LibriVox project ID.', 400);
    const data = await this.json('audiobooks', { id, extended: '1', coverart: '1', limit: '1' });
    const book = normalizeBook(data.books?.[0]);
    if (!book || book.id !== id) throw new LibriVoxError('LibriVox project could not be found.', 404);
    // Extended data includes readers. The tracks endpoint may omit readers and
    // ignores limit/offset on the live service; request only this one project.
    if (!book.sections.length || book.sections.length !== book.sectionCount || book.sections.some(s => !s.url)) {
      const tracks = await this.json('audiotracks', { project_id: id });
      const fallback = normalizeSections(tracks.sections);
      const old = new Map(book.sections.map(s => [s.id, s]));
      book.sections = fallback.map(s => ({ ...s, readers: old.get(s.id)?.readers || s.readers }));
    }
    console.log('[LibriVox] Selected project:', id, 'sections:', book.sections.length);
    return book;
  }
}
