import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { PlaybackBookmark } from '../src/playback/types';
import { replaceFileAtomically } from './atomic-file';

interface ListeningRecord {
  version: 1;
  profileId: string;
  bookId: string;
  bookmark: PlaybackBookmark;
  sessions?: Record<string, number>;
}
export interface ListeningSequence { clientSessionId: string; clientSequence: number }
const key = (bookId: string) => createHash('sha256').update(bookId).digest('hex');
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function decode(text: string, profileId: string, bookId: string): ListeningRecord {
  const record = JSON.parse(text) as ListeningRecord;
  const b = record?.bookmark;
  if (record?.version !== 1 || record.profileId !== profileId || record.bookId !== bookId || b?.bookId !== bookId ||
      !finite(b.positionSeconds) || !finite(b.segmentOffsetSeconds) || !finite(b.totalDurationSeconds) ||
      !b.mediaSignature || !b.segmentId || !['source', 'finalized'].includes(b.mediaKind) || typeof b.completed !== 'boolean' ||
      typeof b.updatedAt !== 'string' || typeof b.lastPlayedAt !== 'string' ||
      !Array.isArray(b.segments) || !b.segments.length || b.segments.some(s => !s.id || !s.signature || !finite(s.durationSeconds)) ||
      (record.sessions && Object.entries(record.sessions).some(([id, sequence]) => !id || !Number.isSafeInteger(sequence) || sequence < 0))) {
    throw new Error('Invalid listening record.');
  }
  return record;
}

/** Each profile/book owns a small atomic record. Checkpoints never rewrite jobs.json. */
export class ListeningStore {
  private readonly folder: string;
  private readonly known: Set<string>;
  constructor(root: string, readonly profileId = 'local', private warning: (message: string) => void = () => {}) {
    if (!/^[a-zA-Z0-9_-]+$/.test(profileId)) throw new Error('Invalid listening profile.');
    this.folder = path.join(root, profileId);
    this.known = new Set(fs.existsSync(this.folder) ? fs.readdirSync(this.folder)
      .filter(name => /^[a-f0-9]{64}\.json(?:\.bak)?$/.test(name)).map(name => name.slice(0, 64)) : []);
  }
  has(bookId: string): boolean { return this.known.has(key(bookId)); }
  private read(bookId: string): ListeningRecord | undefined {
    if (!this.has(bookId)) return undefined;
    const file = path.join(this.folder, key(bookId) + '.json');
    try { return decode(fs.readFileSync(file, 'utf8'), this.profileId, bookId); }
    catch {
      let text: string;
      try { text = fs.readFileSync(file + '.bak', 'utf8'); decode(text, this.profileId, bookId); }
      catch { throw new Error('The listening bookmark is damaged. Its files were preserved; restore a valid backup before saving.'); }
      const recovery = `${file}.corrupt-${Date.now()}-${randomUUID()}`;
      if (fs.existsSync(file)) fs.copyFileSync(file, recovery, fs.constants.COPYFILE_EXCL);
      replaceFileAtomically(file, text);
      this.warning('Recovered a listening bookmark from its backup. The damaged record was preserved.');
      return decode(text, this.profileId, bookId);
    }
  }
  get(bookId: string): PlaybackBookmark | undefined { return this.read(bookId)?.bookmark; }
  save(bookmark: PlaybackBookmark, sequence?: ListeningSequence): PlaybackBookmark {
    const previous = this.read(bookmark.bookId);
    if (sequence && previous?.sessions?.[sequence.clientSessionId] >= sequence.clientSequence) return previous.bookmark;
    const sessions = { ...previous?.sessions };
    if (sequence) { delete sessions[sequence.clientSessionId]; sessions[sequence.clientSessionId] = sequence.clientSequence; }
    const record: ListeningRecord = { version: 1, profileId: this.profileId, bookId: bookmark.bookId, bookmark,
      sessions: Object.fromEntries(Object.entries(sessions).slice(-32)) };
    const text = JSON.stringify(record);
    decode(text, this.profileId, bookmark.bookId);
    fs.mkdirSync(this.folder, { recursive: true });
    const file = path.join(this.folder, key(bookmark.bookId) + '.json');
    if (previous) replaceFileAtomically(file + '.bak', JSON.stringify(previous));
    replaceFileAtomically(file, text);
    this.known.add(key(bookmark.bookId));
    return bookmark;
  }
}
