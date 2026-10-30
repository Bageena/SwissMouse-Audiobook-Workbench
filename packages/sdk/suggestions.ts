/** Experimental internal shared picker contract; no installed SDK write capability. */
export interface SuggestionRequest {
    providerId: string;
    fieldId: string;
    query: string;
    limit?: number;
    cursor?: string;
    contextResourceIds?: readonly string[];
    selectedKeys?: readonly string[];
}
export interface Suggestion {
    key: string;
    label: string;
    value: string;
    valueKind: 'text' | 'term' | 'resource';
    reason: 'exact' | 'prefix' | 'match' | 'recent' | 'related';
    detail?: string;
}
export interface SelectionCommit {
    receipt: string;
    providerId: string;
    fieldId: string;
    key: string;
    label: string;
    value: string;
    valueKind: Suggestion['valueKind'];
    contextResourceIds: readonly string[];
    committedAt: number;
}
export interface PickerSelection {
    receipt: string;
    key: string;
    value: string;
}
