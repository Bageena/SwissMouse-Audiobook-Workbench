/** Experimental declarations/read bridge. Not exported by the installed contract-1 SDK. */
export const informationPrototypeVersion = 1;
export type InformationKind = 'core.item' | 'core.work' | 'core.recording' | 'core.file';
export type ScalarKind = 'text' | 'boolean' | 'integer' | 'decimal' | 'date' | 'timestamp' | 'reference';
export type FilterOperator = 'eq' | 'in' | 'prefix' | 'contains' | 'lt' | 'gt';
interface DefinitionBase { id: string; owner: string; definitionVersion: number; label: string; public: boolean }
export interface InformationType extends DefinitionBase {
  definition: 'type'; baseKind: InformationKind; fieldIds: readonly string[];
  relationshipIds: readonly string[]; taxonomyIds: readonly string[];
}
export interface InformationField extends DefinitionBase {
  definition: 'field'; target: 'resource' | 'relationship'; appliesTo: readonly string[];
  valueType: ScalarKind; cardinality: 'one' | 'many'; filterOperators: readonly FilterOperator[];
  sortable: boolean; referenceTypeIds?: readonly string[]; referenceTaxonomyId?: string;
}
export interface InformationRelationship extends DefinitionBase {
  definition: 'relationship'; fromTypes: readonly string[]; toTypes: readonly string[];
  cardinality: 'one' | 'many'; attributeIds: readonly string[];
}
export interface InformationTaxonomy extends DefinitionBase {
  definition: 'taxonomy'; appliesTo: readonly string[]; hierarchy: 'flat' | 'tree';
  maxDepth: number; cardinality: 'one' | 'many'; userCreatedTerms: boolean;
}
export interface InformationProvider extends DefinitionBase {
  definition: 'provider'; fieldId: string; valueKind: 'text' | 'term' | 'resource';
  taxonomyId?: string; resourceTypeIds?: readonly string[];
  matching: readonly ('prefix' | 'contains')[]; minimumContainsLength: number;
  defaultLimit: number; maxLimit: number;
}
export interface InformationView extends DefinitionBase {
  definition: 'view'; typeIds: readonly string[]; modes: readonly ('list' | 'grid' | 'shelf')[];
  columnIds: readonly string[]; filterIds: readonly string[];
}
export type InformationDefinition = InformationType | InformationField | InformationRelationship | InformationTaxonomy | InformationProvider | InformationView;
export interface InformationBundle { owner: string; prototypeVersion: 1; definitions: readonly InformationDefinition[] }
export interface InformationDescriptor {
  id: string; kind: InformationKind; typeIds: readonly string[]; owner: string;
  title: string; revision: number; revisionScope: 'resource' | 'catalog-snapshot'; archived: boolean;
}
export type ReadValue = string | number | boolean | readonly string[] | null;
export interface InformationReadItem {
  descriptor: InformationDescriptor;
  fields: Readonly<Record<string, ReadValue>>;
  /** Existing IDs only. Does not synthesize entity IDs from author/series labels. */
  relationships: readonly { fromId: string; toId: string; relationshipId: string; position?: number }[];
  memberships: readonly { providerId: string; legacyId: string; label: string; sequence?: string }[];
  /** A bounded preview may omit excess collections/representations; source data is unchanged. */
  omitted: readonly string[];
}
export interface InformationPresentation {
  descriptor: InformationDescriptor;
  available: boolean; readOnly: true; actions: readonly never[];
  typeLabels: readonly string[];
  reason?: 'owner-unavailable' | 'type-unavailable';
}
