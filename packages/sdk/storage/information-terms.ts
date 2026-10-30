import type { InformationStore } from './information-store';
import { createHash } from 'node:crypto';
export interface RetainedTerm {
    id: string;
    taxonomy: string;
    owner: string;
    label: string;
    parent: string | null;
    revision: number;
    retired: boolean;
}
/** Internal canonical term storage. No public write route or legacy genre conversion. */
export class InformationTerms {
    constructor(readonly store: InformationStore) { }
    save(term: RetainedTerm, expectedRevision: number) {
        const db = this.store.db, taxonomy = this.store.definitions().find(d => d.id === term.taxonomy);
        if (taxonomy?.definition !== 'taxonomy' || taxonomy.owner !== term.owner || !term.id.startsWith(term.owner + ':') || term.id.length > 200 || !term.label.trim() || term.label.length > 1000 || typeof term.retired !== 'boolean' || !Number.isSafeInteger(expectedRevision))
            throw new Error('Invalid canonical term.');
        db.exec('BEGIN IMMEDIATE');
        try {
            const old = db.prepare('SELECT * FROM information_terms WHERE id=?').get(term.id);
            if (Number(old?.revision || 0) !== expectedRevision || old && (old.taxonomy !== term.taxonomy || old.owner !== term.owner))
                throw new Error('Term revision or ownership conflict.');
            const seen = new Set([term.id]);
            let parent = term.parent, depth = 0;
            while (parent) {
                if (seen.has(parent) || ++depth > taxonomy.maxDepth || taxonomy.hierarchy !== 'tree')
                    throw new Error('Invalid term hierarchy.');
                seen.add(parent);
                const row = db.prepare('SELECT * FROM information_terms WHERE id=?').get(parent);
                if (!row || row.taxonomy !== term.taxonomy || row.retired)
                    throw new Error('Invalid term parent.');
                parent = row.parent as string | null;
            }
            // Moving existing subtrees requires a reviewed operation with descendant-depth checks.
            if (old && old.parent !== term.parent && db.prepare('SELECT 1 FROM information_terms WHERE parent=? LIMIT 1').get(term.id))
                throw new Error('Subtree moves require a reviewed hierarchy operation.');
            if (term.retired && db.prepare('SELECT 1 FROM information_terms WHERE parent=? AND retired=0 LIMIT 1').get(term.id))
                throw new Error('Retiring a parent requires reviewing its active descendants.');
            const saved = { ...term, revision: expectedRevision + 1 };
            db.prepare('INSERT INTO information_terms VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,parent=excluded.parent,revision=excluded.revision,retired=excluded.retired').run(saved.id, saved.taxonomy, saved.owner, saved.label, saved.parent, saved.revision, Number(saved.retired));
            const payload = JSON.stringify(saved), previous = db.prepare('SELECT chain FROM information_term_changes ORDER BY seq DESC LIMIT 1').get()?.chain || '';
            const chain = createHash('sha256').update(JSON.stringify([previous, payload])).digest('hex');
            db.prepare('INSERT INTO information_term_changes(payload,chain) VALUES(?,?)').run(payload, chain);
            db.exec('COMMIT');
            return saved;
        }
        catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
}
