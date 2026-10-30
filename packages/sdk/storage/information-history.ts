import { createHash } from 'node:crypto';
import type { SelectionCommit } from '../suggestions';
import type { InformationStore } from './information-store';
import { informationCanonical } from './information-store';
export const localInformationProfile = 'local-default'; // Host-owned single-user profile, never a request parameter.
export const equalityKey = (text: string) => text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
export const searchKey = (text: string) => equalityKey(text).normalize('NFKD').replace(/\p{M}/gu, '');
/** Exclusive UTF-8/BINARY prefix bound, including supplementary-plane characters. */
export function prefixEnd(text: string): string | undefined {
    const points = Array.from(text);
    for (let i = points.length - 1; i >= 0; i--) {
        const code = points[i].codePointAt(0)!;
        if (code < 0x10ffff)
            return points.slice(0, i).join('') + String.fromCodePoint(code === 0xd7ff ? 0xe000 : code + 1);
    }
    return undefined;
}
export const valueKey = (provider: string, field: string, value: string, kind = 'text') => `${provider}:v1:${createHash('sha256').update(JSON.stringify([field, kind, kind === 'text' ? equalityKey(value) : value])).digest('hex')}`;
/** Selection history is authoritative and independent of observations and media metadata. */
export class InformationHistory {
    constructor(readonly store: InformationStore) { }
    record(raw: SelectionCommit) {
        if (!raw || typeof raw.receipt !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(raw.receipt) || typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 10000 || typeof raw.value !== 'string' || raw.value.length > 10000 || !['text', 'term', 'resource'].includes(raw.valueKind) || !Number.isSafeInteger(raw.committedAt) || raw.committedAt < 0 || !Array.isArray(raw.contextResourceIds) || raw.contextResourceIds.length > 8 || raw.contextResourceIds.some(id => typeof id !== 'string' || id.length > 200))
            throw new Error('Invalid selection commit.');
        const provider = this.store.definitions().find(d => d.id === raw.providerId);
        if (provider?.definition !== 'provider' || provider.fieldId !== raw.fieldId || provider.valueKind !== raw.valueKind || raw.key !== valueKey(raw.providerId, raw.fieldId, raw.value, raw.valueKind))
            throw new Error('Selection does not match its registered provider.');
        const { committedAt: _time, ...identity } = raw;
        const hash = createHash('sha256').update(informationCanonical(identity)).digest('hex'), db = this.store.db;
        db.exec('BEGIN IMMEDIATE');
        try {
            const old = db.prepare('SELECT hash FROM information_history_receipts WHERE receipt=?').get(raw.receipt);
            if (old) {
                if (old.hash !== hash)
                    throw new Error('Conflicting selection receipt.');
                db.exec('COMMIT');
                return { replayed: true };
            }
            db.prepare('INSERT INTO information_history_receipts VALUES(?,?)').run(raw.receipt, hash);
            db.prepare(`INSERT INTO information_history VALUES(?,?,?,?,?,?,?,?,1,?) ON CONFLICT(profile,provider,field,key) DO UPDATE SET label=excluded.label,value=excluded.value,used_at=max(used_at,excluded.used_at),uses=uses+1,contexts=excluded.contexts`)
                .run(localInformationProfile, raw.providerId, raw.fieldId, raw.key, raw.label, raw.value, raw.valueKind, raw.committedAt, JSON.stringify(raw.contextResourceIds));
            db.prepare(`DELETE FROM information_history WHERE profile=? AND provider=? AND field=? AND key NOT IN(SELECT key FROM information_history WHERE profile=? AND provider=? AND field=? ORDER BY used_at DESC,key LIMIT 50)`)
                .run(localInformationProfile, raw.providerId, raw.fieldId, localInformationProfile, raw.providerId, raw.fieldId);
            db.prepare(`DELETE FROM information_history WHERE profile=? AND rowid NOT IN(SELECT rowid FROM information_history WHERE profile=? ORDER BY used_at DESC,key LIMIT 5000)`).run(localInformationProfile, localInformationProfile);
            db.exec('COMMIT');
            return { replayed: false };
        }
        catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
    recent(provider: string, field: string) {
        return this.store.db.prepare('SELECT * FROM information_history WHERE profile=? AND provider=? AND field=? ORDER BY used_at DESC,key LIMIT 50').all(localInformationProfile, provider, field);
    }
    clear() { this.store.db.prepare('DELETE FROM information_history WHERE profile=?').run(localInformationProfile); }
}
