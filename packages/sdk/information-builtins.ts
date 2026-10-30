import type { InformationBundle, InformationDefinition } from './information';

const base = { owner: 'core', definitionVersion: 1, public: true } as const;
export const coreInformationBundle: InformationBundle = {
  owner: 'core', prototypeVersion: 1,
  definitions: [
    ...(['item', 'work', 'recording', 'file'] as const).map(kind => ({ ...base, definition: 'type', id: `core.${kind}`, label: kind,
      baseKind: `core.${kind}`, fieldIds: ['core.title', ...(kind === 'file' ? ['core.file-path', 'core.size-bytes', 'core.modified-ms'] : [])], relationshipIds: kind === 'work' ? ['core.edition-of'] : kind === 'recording' ? ['core.edition-of', 'core.contains'] : kind === 'file' ? ['core.contains'] : [], taxonomyIds: [] } as InformationDefinition)),
    { ...base, definition: 'field', id: 'core.title', label: 'Title', target: 'resource', appliesTo: ['core.item', 'core.work', 'core.recording', 'core.file'],
      valueType: 'text', cardinality: 'one', filterOperators: ['eq', 'in', 'prefix', 'contains'], sortable: true },
    { ...base, definition: 'relationship', id: 'core.edition-of', label: 'Edition of', fromTypes: ['core.recording'], toTypes: ['core.work'], cardinality: 'one', attributeIds: [] },
    { ...base, definition: 'relationship', id: 'core.contains', label: 'Contains file', fromTypes: ['core.recording'], toTypes: ['core.file'], cardinality: 'many', attributeIds: [] },
    ...(['file-path', 'size-bytes', 'modified-ms'] as const).map(name => ({ ...base, definition: 'field', id: `core.${name}`, label: name, target: 'resource', appliesTo: ['core.file'],
      valueType: name === 'file-path' ? 'text' : name === 'size-bytes' ? 'integer' : 'decimal', cardinality: 'one', filterOperators: ['eq', 'in'], sortable: true } as InformationDefinition)),
  ],
};
