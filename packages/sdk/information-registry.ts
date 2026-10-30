import type { InformationBundle, InformationDefinition, InformationDescriptor, InformationField, InformationPresentation, InformationType } from './information';
import { informationPrototypeVersion } from './information';

const ownerPattern = /^[a-z][a-z0-9-]{0,63}$/;
const idPattern = /^[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9.-]*$/;
const kinds = new Set(['core.item', 'core.work', 'core.recording', 'core.file']);
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function identifier(value: unknown): asserts value is string { ensure(typeof value === 'string' && value.length <= 160 && idPattern.test(value), 'Invalid definition ID.'); }
function list(value: unknown, empty = true): asserts value is string[] {
  ensure(Array.isArray(value) && value.length <= 128 && (empty || value.length > 0) && value.every(item => typeof item === 'string') && new Set(value).size === value.length, 'Expected a bounded unique string list.');
}
/** Data declarations only: reject accessors, functions, exotic objects and cycles before copying. */
export function informationDataSnapshot<T>(input: T): T {
  const seen = new Set<object>(); let nodes = 0;
  function copy(value: unknown, depth: number): any {
    ensure(++nodes <= 50000 && depth <= 16, 'Declaration is too large or deeply nested.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { ensure(value.length <= 10000, 'Declaration text is too long.'); return value; }
    if (typeof value === 'number') { ensure(Number.isFinite(value), 'Invalid numeric declaration.'); return value; }
    ensure(value && typeof value === 'object' && !seen.has(value), 'Declarations must be acyclic plain data.');
    const proto = Object.getPrototypeOf(value);
    ensure(Array.isArray(value) || proto === Object.prototype || proto === null, 'Declarations must be plain data.');
    seen.add(value);
    const result: any = Array.isArray(value) ? [] : {};
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      ensure(typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key), 'Unsafe declaration property.');
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      ensure('value' in property, 'Declaration accessors are not allowed.');
      result[key] = copy(property.value, depth + 1);
    }
    seen.delete(value); return Object.freeze(result);
  }
  return copy(input, 0);
}

/** Trusted built-in prototype. No loaders, database access, React or executable callbacks. */
export function createInformationRegistry() {
  const active = new Map<string, InformationDefinition>();
  const retained = new Map<string, InformationDefinition>();
  const owners = new Map<string, object>();
  function applicable(field: InformationField, type: InformationType) { return field.appliesTo.includes(type.id) || field.appliesTo.includes(type.baseKind); }
  return {
    activate(raw: InformationBundle) {
      const bundle = informationDataSnapshot(raw);
      ensure(typeof bundle.owner === 'string' && ownerPattern.test(bundle.owner), 'Invalid definition owner.');
      ensure(bundle.prototypeVersion === informationPrototypeVersion, 'Unsupported information prototype.');
      ensure(!owners.has(bundle.owner), 'Owner is already active.');
      ensure(Array.isArray(bundle.definitions) && bundle.definitions.length > 0 && bundle.definitions.length <= 512, 'Expected 1–512 definitions.');
      const proposed = new Map(active);
      for (const item of bundle.definitions) {
        ensure(item && typeof item === 'object' && !Array.isArray(item), 'Invalid definition object.');
        const common = ['id', 'owner', 'definitionVersion', 'label', 'public', 'definition'];
        const extras: Record<string, string[]> = {
          type: ['baseKind', 'fieldIds', 'relationshipIds', 'taxonomyIds'],
          field: ['target', 'appliesTo', 'valueType', 'cardinality', 'filterOperators', 'sortable', 'referenceTypeIds', 'referenceTaxonomyId'],
          relationship: ['fromTypes', 'toTypes', 'cardinality', 'attributeIds'],
          taxonomy: ['appliesTo', 'hierarchy', 'maxDepth', 'cardinality', 'userCreatedTerms'],
          provider: ['fieldId', 'valueKind', 'taxonomyId', 'resourceTypeIds', 'matching', 'minimumContainsLength', 'defaultLimit', 'maxLimit'],
          view: ['typeIds', 'modes', 'columnIds', 'filterIds'],
        };
        ensure(Object.prototype.hasOwnProperty.call(extras, item.definition) && Object.keys(item).every(key => [...common, ...extras[item.definition]].includes(key)), 'Unknown definition kind or property.');
        identifier(item.id);
        ensure(item.owner === bundle.owner && item.id.startsWith(bundle.owner + '.'), 'Definition ownership mismatch.');
        ensure(Number.isSafeInteger(item.definitionVersion) && item.definitionVersion > 0, 'Invalid definition version.');
        ensure(typeof item.label === 'string' && item.label.trim().length > 0 && item.label.length <= 200 && typeof item.public === 'boolean', 'Invalid definition label or visibility.');
        ensure(!proposed.has(item.id), 'Duplicate definition ID.');
        const old = retained.get(item.id);
        ensure(!old || old.definition === item.definition, 'Definition kind cannot change.');
        ensure(!old || item.definitionVersion >= old.definitionVersion, 'Definition downgrade is not supported.');
        ensure(!old || item.definitionVersion !== old.definitionVersion || canonical(item) === canonical(old), 'Changed definition needs a new version.');
        proposed.set(item.id, item);
      }
      const reference = <K extends InformationDefinition['definition']>(id: string, expected: K): Extract<InformationDefinition, { definition: K }> => {
        identifier(id); const found = proposed.get(id);
        ensure(found?.definition === expected, `Missing ${expected} definition: ${id}`);
        ensure(found.owner === bundle.owner || found.public, `Definition is private: ${id}`);
        return found as Extract<InformationDefinition, { definition: K }>;
      };
      const refs = (values: readonly string[], expected: InformationDefinition['definition'], empty = true) => { list(values, empty); for (const id of values) reference(id, expected); };
      for (const item of bundle.definitions) {
        switch (item.definition) {
          case 'type':
            ensure(kinds.has(item.baseKind), 'Unsupported base kind.');
            refs(item.fieldIds, 'field'); refs(item.relationshipIds, 'relationship'); refs(item.taxonomyIds, 'taxonomy');
            for (const id of item.fieldIds) { const f = reference(id, 'field'); ensure(f.target === 'resource' && applicable(f, item), 'Field does not apply to resource type.'); }
            for (const id of item.relationshipIds) { const r = reference(id, 'relationship'); ensure([...r.fromTypes, ...r.toTypes].some(type => type === item.id || type === item.baseKind), 'Relationship does not apply to resource type.'); }
            for (const id of item.taxonomyIds) { const t = reference(id, 'taxonomy'); ensure(t.appliesTo.includes(item.id) || t.appliesTo.includes(item.baseKind), 'Taxonomy does not apply to resource type.'); }
            break;
          case 'field': {
            ensure(['resource', 'relationship'].includes(item.target), 'Invalid field target.');
            refs(item.appliesTo, item.target === 'resource' ? 'type' : 'relationship', false);
            ensure(['text', 'boolean', 'integer', 'decimal', 'date', 'timestamp', 'reference'].includes(item.valueType), 'Invalid field value type.');
            ensure(['one', 'many'].includes(item.cardinality) && typeof item.sortable === 'boolean', 'Invalid field cardinality/sort.');
            ensure(!item.sortable || item.cardinality === 'one', 'Multi-value sort needs an explicit future policy.');
            list(item.filterOperators);
            const allowed = item.valueType === 'text' ? ['eq', 'in', 'prefix', 'contains'] : ['boolean', 'reference'].includes(item.valueType) ? ['eq', 'in'] : ['eq', 'in', 'lt', 'gt'];
            ensure(item.filterOperators.every(op => allowed.includes(op)), 'Unsupported field operator.');
            if (item.valueType === 'reference') {
              ensure((item.referenceTypeIds !== undefined) !== (item.referenceTaxonomyId !== undefined), 'Reference fields need exactly one target kind.');
              if (item.referenceTypeIds !== undefined) refs(item.referenceTypeIds, 'type', false);
              else {
                const taxonomy = reference(item.referenceTaxonomyId, 'taxonomy');
                ensure(item.target === 'resource' && item.appliesTo.every(id => { const type = reference(id, 'type'); return taxonomy.appliesTo.includes(type.id) || taxonomy.appliesTo.includes(type.baseKind); }), 'Taxonomy reference does not apply to this field.');
              }
            } else ensure(item.referenceTypeIds === undefined && item.referenceTaxonomyId === undefined, 'Only reference fields declare targets.');
            break;
          }
          case 'relationship':
            refs(item.fromTypes, 'type', false); refs(item.toTypes, 'type', false); refs(item.attributeIds, 'field');
            ensure(['one', 'many'].includes(item.cardinality), 'Invalid relationship cardinality.');
            for (const id of item.attributeIds) { const f = reference(id, 'field'); ensure(f.target === 'relationship' && f.appliesTo.includes(item.id), 'Attribute does not apply to relationship.'); }
            break;
          case 'taxonomy':
            refs(item.appliesTo, 'type', false);
            ensure(['flat', 'tree'].includes(item.hierarchy) && ['one', 'many'].includes(item.cardinality) && typeof item.userCreatedTerms === 'boolean', 'Invalid taxonomy rules.');
            ensure(Number.isSafeInteger(item.maxDepth) && (item.hierarchy === 'flat' ? item.maxDepth === 0 : item.maxDepth >= 1 && item.maxDepth <= 32), 'Invalid taxonomy depth.');
            break;
          case 'provider': {
            const field = reference(item.fieldId, 'field');
            ensure(['text', 'term', 'resource'].includes(item.valueKind), 'Invalid provider result kind.');
            list(item.matching, false); ensure(item.matching.every(mode => ['prefix', 'contains'].includes(mode)), 'Invalid match mode.');
            ensure(Number.isSafeInteger(item.minimumContainsLength) && item.minimumContainsLength >= 3 && item.minimumContainsLength <= 256, 'Contains matching requires at least three characters.');
            ensure(Number.isSafeInteger(item.defaultLimit) && Number.isSafeInteger(item.maxLimit) && item.defaultLimit > 0 && item.defaultLimit <= item.maxLimit && item.maxLimit <= 100, 'Invalid provider limits.');
            if (item.valueKind === 'term') { reference(item.taxonomyId, 'taxonomy'); ensure(field.valueType === 'reference' && field.referenceTaxonomyId === item.taxonomyId, 'Term provider target must match its field.'); }
            else ensure(item.taxonomyId === undefined, 'Only term providers declare a taxonomy.');
            if (item.valueKind === 'resource') { refs(item.resourceTypeIds, 'type', false); ensure(field.valueType === 'reference' && item.resourceTypeIds.every(id => field.referenceTypeIds?.includes(id)), 'Resource provider target must match its field.'); }
            else ensure(item.resourceTypeIds === undefined, 'Only resource providers declare target types.');
            if (item.valueKind === 'text') ensure(field.valueType === 'text', 'Text provider requires a text field.');
            break;
          }
          case 'view':
            refs(item.typeIds, 'type', false); refs(item.columnIds, 'field'); refs(item.filterIds, 'field'); list(item.modes, false);
            ensure(item.modes.every(mode => ['list', 'grid', 'shelf'].includes(mode)), 'Unsupported view mode.');
            for (const id of [...item.columnIds, ...item.filterIds]) { const f = reference(id, 'field'); ensure(f.target === 'resource' && item.typeIds.some(type => applicable(f, reference(type, 'type'))), 'View field is not applicable.'); }
            for (const id of item.filterIds) ensure(reference(id, 'field').filterOperators.length > 0, 'View filter needs declared operators.');
            break;
          default: throw new Error('Unknown information definition kind.');
        }
      }
      const token = {}; owners.set(bundle.owner, token);
      for (const item of bundle.definitions) { active.set(item.id, item); retained.set(item.id, item); }
      return Object.freeze({ unregister: () => { if (owners.get(bundle.owner) !== token) return; owners.delete(bundle.owner); for (const item of bundle.definitions) active.delete(item.id); } });
    },
    list: () => Object.freeze([...active.values()]),
    retained: () => Object.freeze([...retained.values()]),
    present(input: InformationDescriptor): InformationPresentation {
      const descriptor = informationDataSnapshot(input);
      ensure(typeof descriptor.id === 'string' && descriptor.id.length > 0 && descriptor.id.length <= 200 && kinds.has(descriptor.kind) && typeof descriptor.owner === 'string' && ownerPattern.test(descriptor.owner), 'Invalid resource descriptor.');
      list(descriptor.typeIds, false); ensure(typeof descriptor.title === 'string' && descriptor.title.length <= 10000 && Number.isSafeInteger(descriptor.revision) && descriptor.revision >= 0 && ['resource', 'catalog-snapshot'].includes(descriptor.revisionScope) && typeof descriptor.archived === 'boolean', 'Invalid descriptor fields.');
      const available = owners.has(descriptor.owner) && descriptor.typeIds.every(id => { const d = active.get(id); return d?.definition === 'type' && d.baseKind === descriptor.kind; });
      return Object.freeze({ descriptor, available, readOnly: true, actions: Object.freeze([]) as readonly never[], typeLabels: Object.freeze(descriptor.typeIds.map(id => retained.get(id)?.label || id)),
        ...(!available ? { reason: owners.has(descriptor.owner) ? 'type-unavailable' as const : 'owner-unavailable' as const } : {}) });
    },
  };
}
export type InformationRegistry = ReturnType<typeof createInformationRegistry>;
