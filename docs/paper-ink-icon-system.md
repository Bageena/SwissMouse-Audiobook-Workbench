# Paper, Ink & Cheese icon system

The Cheese theme uses the approved original illustrations plus adaptations of
the installed Lucide geometry for utility controls. Legacy themes still render
the original Lucide components. Controls keep their accessible labels, keyboard
behavior, processing actions, and sizes.

## Source and regeneration

- `src/assets/paper-ink/manifest.json` catalogs all current and future icons.
- `semantic` maps stable product concepts such as `media.comic`, `action.play`,
  and `status.verified` to catalog names. Future components can resolve these
  through the catalog without inventing filenames.
- `icons` records the asset, provenance, current usage, and future categories.
- `tools/generate-cheese-icons.mjs` discovers current imports, validates exports,
  generates utility artwork, mappings, manifest, attribution, and preview.
- Run `node tools/generate-cheese-icons.mjs` from the repository root after adding
  icons or changing the catalog. Approved original SVGs are preserved.
- `src/cheese-icons.css` is generated; edit the generator instead of that file.
- `docs/cheese-icons-preview.html` shows every entry at large, 20px, and 16px sizes.

Future coverage includes books, audiobooks, comics, magazines, research papers,
notes, video games, television, movies, music, art, and photos; structural media
labels; organization; reading and annotation; playback; editing; recovery;
appearance; accessibility; and status indicators. These are assets for future
features, not newly implemented media workflows.

## Visual and interaction rules

Use warm cream edges, charcoal ink, restrained pencil hatching, and muted pigment.
Play remains a cheese wedge; layered material uses the sandwich illustration.
Utility and safety symbols retain their familiar silhouettes. Carrots are for
expandable disclosures; ordinary navigation arrows retain direction semantics.
Platform marks such as YouTube retain their recognizable branding.

Button surfaces use the existing shared Cheese paper texture, slight irregular
corners, hover elevation, visible focus, and concave pressed shadows. Plain text
links and artwork remain unframed. Disabled controls retain their disabled state.
Filled/half-star rating overlays use distinct filled artwork. Loading icons retain
their animation classes. Forced-colors mode restores native SVG geometry.

The catalog is versioned and extensible, not a promise that all future features
will require no new assets. Lucide-derived assets retain the complete upstream
ISC and Feather MIT notices in `src/assets/paper-ink/LUCIDE-LICENSE.txt`.
