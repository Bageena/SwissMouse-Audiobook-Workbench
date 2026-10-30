# Batch 7: shared information contract review

Prepared October 29, 2026 on `codex/audiobook-batch1`. This batch produces the next design deliverable after the four backend slices; **it does not implement a new database or finish Audiobook independence**.

The maintainer subsequently approved these recommendations. The first executable slice is now implemented in [Batch 8: registry and read bridge](BATCH8-REGISTRY-READ-BRIDGE.md). The remaining proposal still has explicit storage/migration and public-SDK gates; approval of the direction is not evidence that all of those systems are shipped.

The concrete proposal is [Shared information contracts](SHARED-RESOURCE-CONTRACTS.md). It follows the accepted [shared resource direction](SHARED-RESOURCE-CORE.md) and checks that direction against the current code.

## Main recommendations

- Retain the existing stable resource IDs, SQLite stores and worker-backed catalog. Give Core durable basic descriptions it can display and reindex when a module is absent.
- Register resource types, typed fields, relationships, taxonomies, suggestion providers and view contributions together. Modules use the shared browser and services, while owning their specialized editing and processing.
- Start taxonomy with flat vocabularies or single-parent trees. People, series memberships, physical file locations and ordinary metadata fields remain distinct concepts.
- Do not merge people or series because their names match. Keep imported contributor text intact until identity is resolved explicitly.
- Use one autocomplete service with provider-specific rules. Index observed values/associations. Store actual recent committed selections separately from inferred author associations, preserving local-profile ownership and clear-history behavior.
- Migrate incrementally with one authoritative writer per fact. Keep legacy audiobook content/metadata in its current store until a separately reviewed authority migration is ready. Preserve IDs, saved output, memberships and recovery material.
- Define measurable query budgets and benchmark hierarchy/index options before approving a physical schema. The 40,000-file baseline and larger synthetic scale profile are test requirements, not current generalized-system performance claims.

## Source review and validation

Reviewed the existing resource contract, catalog schema/projection/query service, durable project store/schema safeguards, suggestions and membership suggestions, module SDK and Preferences registry. The review confirms that identity aliases and collection membership already have durable storage, while generic retained descriptors, registered taxonomies and actual picker history remain gaps. Existing suggestion limits do not bound all database work.

The proposal separates new contract shapes from existing contract-1 APIs and the read-only installed SDK. It does not add executable extension access or declare the private engine ports to be the public SDK. It also distinguishes current membership-derived recency from actual recorded choices.

This is a documentation-only batch. No application code, database, user configuration, dependency or media file changed. No runtime/performance validation is claimed. Verified 141 local link references across the touched guides, parsed the proposal's TypeScript examples for syntax, and passed tracked/new-document whitespace checks. The Batch 6 code validation remains its own historical evidence.

## Next step

Review the proposed contract shape and recommendations. The next executable slice is **Batch 8: the declaration registry and audiobook read bridge**, with compatibility checks and no new authoritative user-data schema. Durable descriptors/migration, shared indexed autocomplete and remaining Core extraction follow their explicit gates. The later Core-extraction work must be split into smaller implementation batches once inventoried; its row in the proposal is not a promise to finish all remaining separation in one turn.
