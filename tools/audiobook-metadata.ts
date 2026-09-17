import type { AudiobookMetadata } from '../src/types';
import type { ExportFormat } from '../src/audioFormats';

// FFmpeg translates common semantic keys to native ID3/MP4/Vorbis representations.
// Custom MP4 keys are written as iTunes freeform atoms by mp4-metadata.ts.
export function audiobookTags(meta: AudiobookMetadata | undefined, original: AudiobookMetadata | undefined, source: Record<string,string> = {}, format: ExportFormat) {
  const tags = Object.fromEntries(Object.entries(source).map(([k,v])=>[k.toLowerCase(),v]));
  if (!meta) return tags;
  const set = (field: keyof AudiobookMetadata, keys: string[], value: string) => {
    if (!original || JSON.stringify(meta[field]) !== JSON.stringify(original[field])) for (const key of keys) tags[key] = value;
  };
  set('title', ['title','album'], meta.title || '');
  set('author', ['artist','album_artist'], meta.author || '');
  set('narrator', ['composer'], meta.narrator || '');
  set('subtitle', ['subtitle'], meta.subtitle || '');
  set('series', ['series'], meta.series || '');
  set('seriesSequence', ['series-part'], meta.seriesSequence || '');
  set('genres', ['genre'], meta.genres?.join('; ') || '');
  set('publishedYear', ['date'], meta.publishedYear || '');
  set('releaseDate', ['releasetime'], meta.releaseDate || '');
  // FFmpeg translates Vorbis/WAV DESCRIPTION to COMMENT when probing. DESC is
  // Audiobookshelf's supported description alias, so emit it as well.
  set('description', ['description','comment',...(['flac','ogg','opus','wav'].includes(format)?['desc']:[])], meta.description || '');
  for (const field of ['publisher','language','isbn','asin','copyright'] as const) set(field,[field],meta[field] || '');
  for (const field of ['explicit','abridged'] as const) set(field,[field],meta[field] ? '1' : '0');
  // Vorbis comment field names are case-insensitive; standard uppercase spelling is conventional.
  if (['flac','ogg','opus'].includes(format)) return Object.fromEntries(Object.entries(tags).map(([k,v])=>[k.toUpperCase(),v]));
  return tags;
}

export const metadataRepresentations = {
  m4b: 'MP4 atoms: title/album, artist, composer (Narrator); series and identifiers in iTunes freeform tags.',
  m4a: 'MP4 atoms: title/album, artist, composer (Narrator); series and identifiers in iTunes freeform tags.',
  mp3: 'ID3: TIT2/TALB, TPE1, TCOM (Narrator); custom TXXX fields for series and identifiers.',
  flac: 'Vorbis comments: TITLE/ALBUM, ARTIST, COMPOSER (Narrator), SERIES, SERIES-PART and identifiers.',
  ogg: 'Vorbis comments: TITLE/ALBUM, ARTIST, COMPOSER (Narrator), SERIES, SERIES-PART and identifiers.',
  opus: 'Vorbis comments: TITLE/ALBUM, ARTIST, COMPOSER (Narrator), SERIES, SERIES-PART and identifiers.',
  wav: 'RIFF INFO plus ID3 metadata chunk. Rich metadata requires a reader that supports WAV ID3.',
};
