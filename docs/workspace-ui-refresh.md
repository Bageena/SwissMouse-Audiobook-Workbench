# Workspace UI refresh

Five coordinated changes preserve existing processing and source-file behavior:

1. Import is the prominent library action and becomes secondary inside a book.
   Chapter review emphasizes save-and-continue, with save-only secondary.
   Metadata keeps "Save prominent" and moves sidecar/folder tools under "More actions".
   Import completion emphasizes Finish, with processing an outlined alternative.
   File Manager exposes common operations and keeps less frequent operations in More.
2. Library cover cards use consistent 96 × 128 artwork areas with uncropped images,
   title-first credits, compact metadata/status indicators, a selection footer,
   and the existing bottom-right action menu. Full titles still wrap. List/Edit
   views, complete-catalog filtering, page sizes, and All-mode virtualization remain.
3. Cheese uses quieter watercolor and selection colors with the existing light
   page, darker inner paper, charcoal depth, and stronger primary-action pigment.
   Active workflow navigation has an explicit current-step state and solid contrast.
4. The top player uses a container-responsive identity/playback arrangement.
   Rating and technical playback details are available upon request. Play/Stop, time,
   progress, and remaining time stay visible. Playback order is read from the
   real streaming manifest, never inferred from potentially different source files.
   It is a read-only list; it does not support reordering or seeking.
5. File Manager, metadata, and chapter review use the same resizable two-panel
   structure. Splits remember independent widths; File Manager also remembers
   Details column widths. At narrower widths, panels stack and resize handles hide.
   Toolbars share spacing and semantic theme surfaces.

Panel dividers support pointer/touch dragging, arrow keys, Shift for larger steps,
and Home/double-click reset. Storage errors and invalid saved sizes fall back
safely. Layout refinements apply across themes; legacy palettes and the restricted
custom-theme format remain unchanged. No future-media workflow is added here.
