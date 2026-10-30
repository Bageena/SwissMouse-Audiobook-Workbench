import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { InformationBundle, InformationDefinition, InformationField, InformationReadItem } from '../information';
import type { InformationPublication } from '../information-publication';
import { createInformationRegistry, informationDataSnapshot } from '../information-registry';
import { openInformationUserDatabase } from './information-schema';
export function informationCanonical(value: any): string {
    if (Array.isArray(value))
        return `[${value.map(informationCanonical).join(',')}]`;
    if (value && typeof value === 'object')
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${informationCanonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(informationCanonical(value)).digest('hex');
const id = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
/** Authoritative generic facts and replay receipts. Does not import or execute module code. */
export class InformationStore {
    readonly db: DatabaseSync;
    constructor(file: string, warning?: (message: string) => void, companions?: readonly string[]) { this.db = openInformationUserDatabase(file, warning, companions); }
    close() { this.db.close(); }
    private transaction<T>(run: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = run();
            this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    definitions(): InformationDefinition[] { return this.db.prepare('SELECT payload FROM information_definitions ORDER BY id').all().map(row => JSON.parse(String(row.payload))); }
    registerDefinitions(bundles: readonly InformationBundle[]) {
        const incoming = informationDataSnapshot(bundles), all = new Map(this.definitions().map(d => [d.id, d]));
        for (const bundle of incoming) {
            if (bundle.prototypeVersion !== 1 || typeof bundle.owner !== 'string' || !Array.isArray(bundle.definitions) || bundle.definitions.some(definition => definition.owner !== bundle.owner))
                throw new Error('Invalid retained definition owner or prototype.');
            for (const definition of bundle.definitions) {
                const old = all.get(definition.id);
                if (old && (old.owner !== definition.owner || old.definition !== definition.definition || old.definitionVersion > definition.definitionVersion || (old.definitionVersion === definition.definitionVersion && informationCanonical(old) !== informationCanonical(definition))))
                    throw new Error('Incompatible retained definition; a reviewed migration is required.');
                if (old && old.definitionVersion < definition.definitionVersion) {
                    const { label: _oldLabel, definitionVersion: _oldVersion, ...before } = old;
                    const { label: _newLabel, definitionVersion: _newVersion, ...after } = definition;
                    if (informationCanonical(before) !== informationCanonical(after) && this.db.prepare('SELECT 1 FROM information_resources LIMIT 1').get())
                        throw new Error('Definition semantics changed; review a data migration before applying them.');
                }
                all.set(definition.id, definition);
            }
        }
        const registry = createInformationRegistry();
        const pending = [...new Set([...all.values()].map(d => d.owner))];
        while (pending.length) {
            let progress = false;
            for (const owner of [...pending]) {
                try {
                    registry.activate({ owner, prototypeVersion: 1, definitions: [...all.values()].filter(d => d.owner === owner) });
                }
                catch (error) {
                    if (pending.length === 1)
                        throw error;
                    continue;
                }
                pending.splice(pending.indexOf(owner), 1);
                progress = true;
            }
            if (!progress)
                throw new Error('Retained definitions have unresolved references or invalid declarations.');
        }
        this.transaction(() => { for (const definition of all.values())
            this.db.prepare('INSERT INTO information_definitions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,payload=excluded.payload').run(definition.id, definition.owner, definition.definitionVersion, JSON.stringify(definition)); });
    }
    source(sourceId: string) { return this.db.prepare('SELECT * FROM information_sources WHERE id=?').get(sourceId); }
    /** Explicit compare-and-set epoch transition. Retains old facts, receipts and tombstones. */
    startEpoch(sourceId: string, owner: string, epoch: string, expectedPrevious?: string) {
        if (!id(sourceId) || !/^[a-z][a-z0-9-]*$/.test(owner) || !sourceId.startsWith(owner + '.') || !id(epoch))
            throw new Error('Invalid publication source.');
        return this.transaction(() => {
            const current = this.source(sourceId);
            if (current?.epoch === epoch && current.owner === owner)
                return;
            if ((current?.epoch ?? undefined) !== expectedPrevious || (current && current.owner !== owner))
                throw new Error('Source epoch conflict.');
            if (this.db.prepare('SELECT 1 FROM information_epochs WHERE source_id=? AND epoch=?').get(sourceId, epoch))
                throw new Error('A retired epoch cannot be reactivated.');
            this.db.prepare('INSERT INTO information_epochs VALUES(?,?)').run(sourceId, epoch);
            this.db.prepare('INSERT INTO information_sources VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,checkpoint=0').run(sourceId, owner, epoch);
        });
    }
    get(resourceId: string) {
        const row = this.db.prepare('SELECT * FROM information_resources WHERE id=?').get(resourceId);
        return row ? { item: JSON.parse(String(row.payload)) as InformationReadItem, sourceId: String(row.source_id), epoch: String(row.epoch), sourceVersion: Number(row.source_version), retired: !!row.retired } : undefined;
    }
    private validate(event: InformationPublication, definitions: Map<string, InformationDefinition>) {
        const source = this.source(event.sourceId), d = event.item.descriptor;
        if (!source || source.epoch !== event.epoch || source.owner !== d.owner)
            throw new Error('Publication source/epoch/owner mismatch.');
        if (!Number.isSafeInteger(event.version) || event.version < 1 || !id(d.id) || typeof d.title !== 'string' || d.title.length > 10000 || !Array.isArray(d.typeIds) || !d.typeIds.length || d.typeIds.length > 32 || typeof event.retired !== 'boolean' || event.item.omitted.length)
            throw new Error('Incomplete or invalid publication.');
        for (const typeId of d.typeIds) {
            const type = definitions.get(typeId);
            if (type?.definition !== 'type' || type.baseKind !== d.kind || (type.owner !== d.owner && !type.public))
                throw new Error('Invalid publication resource type.');
        }
        if (Object.keys(event.item.fields).length > 128 || event.item.relationships.length > 10000 || event.item.memberships.length > 10000 || event.aliases.length > 10000)
            throw new Error('Publication exceeds its bounds.');
        const scalar = (field: InformationField, value: unknown) => {
            if (value === null)
                return true;
            if (field.valueType === 'boolean')
                return typeof value === 'boolean';
            if (field.valueType === 'integer')
                return Number.isSafeInteger(value);
            if (field.valueType === 'decimal')
                return typeof value === 'number' && Number.isFinite(value);
            if (typeof value !== 'string')
                return false;
            if (field.valueType === 'reference')
                return id(value);
            if (field.valueType === 'date')
                return /^\d{4}-\d\d-\d\d$/.test(value) && new Date(value).toISOString().slice(0, 10) === value;
            if (field.valueType === 'timestamp')
                return /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
            return true;
        };
        for (const [key, value] of Object.entries(event.item.fields)) {
            const field = definitions.get(key);
            if (field?.definition !== 'field' || field.target !== 'resource' || (field.owner !== d.owner && !field.public) || !field.appliesTo.some(type => d.typeIds.includes(type) || type === d.kind))
                throw new Error('Unregistered or inapplicable publication field.');
            if (field.cardinality === 'many' ? !Array.isArray(value) || value.some(item => !scalar(field, item)) : Array.isArray(value) || !scalar(field, value))
                throw new Error('Invalid publication field value.');
        }
        for (const r of event.item.relationships) {
            const rel = definitions.get(r.relationshipId);
            if (!id(r.fromId) || !id(r.toId) || (r.fromId !== d.id && r.toId !== d.id) || rel?.definition !== 'relationship' || (rel.owner !== d.owner && !rel.public) || (r.position !== undefined && (!Number.isSafeInteger(r.position) || r.position < 0)))
                throw new Error('Invalid publication relationship.');
            if ((r.fromId === d.id && !rel.fromTypes.some(type => type === d.kind || d.typeIds.includes(type))) || (r.toId === d.id && !rel.toTypes.some(type => type === d.kind || d.typeIds.includes(type))))
                throw new Error('Publication relationship endpoint has the wrong type.');
        }
        for (const m of event.item.memberships) {
            const provider = definitions.get(m.providerId);
            if (!id(m.legacyId, 4096) || !id(m.label, 10000) || provider?.definition !== 'provider' || (provider.owner !== d.owner && !provider.public) || (m.sequence !== undefined && typeof m.sequence !== 'string'))
                throw new Error('Invalid retained membership.');
        }
        for (const a of event.aliases)
            if (!id(a.namespace) || !a.namespace.startsWith(d.owner + ':') || !id(a.key, 4096))
                throw new Error('Invalid retained alias.');
        const row = this.db.prepare('SELECT source_id FROM information_resources WHERE id=?').get(d.id);
        if (row && row.source_id !== event.sourceId)
            throw new Error('Resource is owned by another publication source.');
        return source;
    }
    /** Receipt, authoritative fact, aliases and change feed commit in one user-DB transaction. */
    publish(raw: readonly InformationPublication[]) {
        if (!Array.isArray(raw) || !raw.length || raw.length > 100)
            throw new Error('Expected 1–100 publications.');
        const events = informationDataSnapshot(raw), definitions = new Map(this.definitions().map(d => [d.id, d]));
        if (Buffer.byteLength(JSON.stringify(events)) > 8 * 1024 * 1024)
            throw new Error('Publication batch exceeds 8 MiB.');
        return this.transaction(() => {
            let applied = 0, replayed = 0;
            for (const event of events) {
                const source = this.validate(event, definitions), receiptHash = hash(event);
                if (event.version <= Number(source.checkpoint)) {
                    if (this.db.prepare('SELECT hash FROM information_receipts WHERE source_id=? AND epoch=? AND version=?').get(event.sourceId, event.epoch, event.version)?.hash !== receiptHash)
                        throw new Error('Conflicting publication replay.');
                    replayed++;
                    continue;
                }
                if (event.version !== Number(source.checkpoint) + 1)
                    throw new Error('Publication gap; replay missing events first.');
                const old = this.db.prepare('SELECT revision,hash,payload FROM information_resources WHERE id=?').get(event.item.descriptor.id);
                const content = { ...event.item, descriptor: { ...event.item.descriptor, revision: 0, revisionScope: 'resource', archived: event.retired } };
                const contentHash = hash(content), changed = !old || old.hash !== contentHash;
                const item = { ...content, descriptor: { ...content.descriptor, revision: Number(old?.revision || 0) + (changed ? 1 : 0) } };
                this.db.prepare('INSERT INTO information_resources VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,source_version=excluded.source_version,revision=excluded.revision,retired=excluded.retired,hash=excluded.hash,payload=excluded.payload')
                    .run(item.descriptor.id, event.sourceId, event.epoch, event.version, item.descriptor.revision, Number(event.retired), contentHash, JSON.stringify(item));
                for (const a of event.aliases) {
                    const alias = this.db.prepare('SELECT resource_id FROM aliases WHERE namespace=? AND source_key=?').get(a.namespace, a.key);
                    if (alias && alias.resource_id !== item.descriptor.id)
                        throw new Error('Alias identity conflict; existing identity was retained.');
                    this.db.prepare('INSERT OR IGNORE INTO aliases VALUES(?,?,?)').run(a.namespace, a.key, item.descriptor.id);
                }
                this.db.prepare('INSERT INTO information_receipts VALUES(?,?,?,?)').run(event.sourceId, event.epoch, event.version, receiptHash);
                this.db.prepare('UPDATE information_sources SET checkpoint=? WHERE id=?').run(event.version, event.sourceId);
                if (changed) {
                    const previous = String(this.db.prepare('SELECT chain FROM information_changes ORDER BY seq DESC LIMIT 1').get()?.chain || '');
                    this.db.prepare('INSERT INTO information_changes(resource_id,chain,payload) VALUES(?,?,?)').run(item.descriptor.id, hash([previous, receiptHash]), JSON.stringify(item));
                }
                applied++;
            }
            return { applied, replayed };
        });
    }
    changes(after: number, limit = 100) {
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw new Error('Invalid information change page.');
        return this.db.prepare('SELECT seq,chain,payload FROM information_changes WHERE seq>? ORDER BY seq LIMIT ?').all(after, limit).map(row => ({ seq: Number(row.seq), chain: String(row.chain), item: JSON.parse(String(row.payload)) as InformationReadItem }));
    }
    changeHash(seq: number) { return seq === 0 ? '' : this.db.prepare('SELECT chain FROM information_changes WHERE seq=?').get(seq)?.chain; }
}
