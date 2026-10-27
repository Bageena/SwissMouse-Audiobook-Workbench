# Extended metadata (Alpha 5)

`exmetadata.json` is SwissMouse's portable sidecar. Its versioned JSON envelope contains:

- `format`: `swissmouse.extended-metadata`.
- `schemaVersion`: `1`.
- `resourceId`: the originating project ID.
- `metadata`: the complete Audiobookshelf-compatible projection, including exported chapters.
- `fileTags`: the semantic metadata fields offered to the media tag writer. Actual tag names and support depend on the audio format. Cover embedding is handled separately.
- `internal`: collection memberships, additional series with independent sequence numbers, primary-series recency, and optional cover state. These fields are never written as audio ID tags.

Each membership has a stable `id`, a `name`, optional `addedAt`, and (for additional series) optional `sequence`.

Reading priority is per field: the book folder's `exmetadata.json`, then its `metadata.json`, then embedded media tags. Explicit empty strings, empty lists, and false values survive. Invalid/unsupported extended sidecars produce a warning and fall back. Archived original sidecars do not override the current book. Saved edits and drafts retain their existing rescan protection.

SwissMouse exports/rebuilds `exmetadata.json` by default. Settings offers **Write Audiobookshelf metadata.json**, off by default. When off, an existing `metadata.json` is not rewritten, deleted, or renamed by sidecar rebuilding. Enabling it writes an additional compatibility projection. Disabling it again leaves the existing compatibility file untouched. Manual Download creates an extended sidecar copy.

Sidecar writes retain shared-folder ownership checks and atomic replacement. Merely referencing external media does not create files beside the originals; explicit rebuilds and managed/exported book destinations use the sidecar writer. Explicit file transfers preserve existing sidecars as associated originals when replacement would otherwise collide.

Collections and Additional Series have independent autocomplete and Quick Add sections in Series & Taxonomy. Typed lookup searches all indexed names, not just the Quick Add subset. Quick Add combines five recent names with the author's existing memberships; series suggestions include primary and additional series. Existing Library collection operations synchronize saved project memberships without discarding drafts.

Markdown descriptions are deferred to Alpha 6.

Organize Library folder moves selected book audio and confidently associated sidecars into the configured Library pattern, creating the destination folders. It verifies the destination before removing originals; files shared with another project and ambiguous companions remain in place. Extended metadata is written inside the destination book folder, with optional Audiobookshelf compatibility metadata.

Filesystem naming uses a single narrator's name, **Cast** for two or three distinct narrators, and **Full Cast** for four or more. This applies to the `%Narrator%` folder token, output filenames derived from it, and the destination preview. Metadata and embedded Composer credits retain the full narrator list. Existing source filenames are preserved when organizing.
