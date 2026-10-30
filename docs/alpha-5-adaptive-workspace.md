# Alpha 5 adaptive workspace

Historical implementation and verification record for the released Alpha 5 foundation. Alpha 6 is the active development cycle. Original plans, limitations, and verification results below retain their recorded scope; use the [current panel guides](PANELS.md) for ongoing development conventions.

## Initial audit and implementation plan

The checkout already contained `DesktopWorkspace` / `DesktopWindow`, a panel
definition catalog, stable instance IDs, portal hosts, three movement controls,
edge/corner resizing, edge docking, magnet clusters, per-page local storage,
and an original/grid/free-canvas layout menu. Metadata sections already shared
their draft and `metadata-fields` form ownership. Responsive content rules and
small-screen document flow were already in `workspace-ui.css`.

The missing pieces were saved handle assignments, atomic workspace changes and
history, generated parents, a resolved responsive grid, and inspection of actual
children. The implementation extends those systems. It adds no grid dependency,
database, plugin installer, or second window engine.

The plan was to retain portal hosts and gestures; extend the existing layout
model and menu; migrate legacy layout preferences into one versioned record;
keep preferred frames separate from responsive frames; and validate drafts,
form ownership, media continuity, recovery, and narrow layouts. The main risks
were remounting functional content, losing saved layouts, and conflicting
pointer/click interactions.

## Architecture and behavior

`DesktopWorkspace` still owns the window registry, placement, docking, selection,
and portal movement. `workspaceState.ts` adds a layout-only workspace record and
30-entry in-memory undo/redo history. Hierarchy changes commit a single record.
Functional state and book data continue to belong to their existing components.

The toolbar exposes Normal Move, Magnet Move, Merge Move, Resize, and the Grid
Inspector. Single-click identifies a tool; dragging uses it immediately after a
small pointer movement threshold. Double-click assigns it to that panel's corner.
Window options provide an explicit assignment select. Right-click or Shift+F10
on a corner opens a four-choice selector. The icon, label, and tooltip describe
the saved assignment. Toolbar use never replaces that assignment.

Two independent children can merge into a generated parent with a stable UUID.
Children keep their roles, instance IDs, mounted content, and handle preferences.
Children can join existing parents or detach again. A dragged parent can collect
an independent child without discarding its current contents. Parent-to-parent
merging and recursive editing are unavailable in Alpha 5. Invalid/locked targets
are excluded; invalid merge drops cancel without changing saved layout.

Generated parents are retained even when empty. They can be renamed, arranged,
locked, and restored after reload. There is no automatic cleanup of customized
parents.

Preferred grid frames remain in the persisted layout. A geometry-only resolver
adapts them to the measured parent width, honors usable minimum widths, and
resolves overlap in spatial order. Passive reflow never saves those resolved
frames. Expanding restores the preferred arrangement. Original authored layouts
and free-canvas layouts remain available. Resizing a child in its authored home
activates its parent's existing grid arrangement rather than replacing its form.

The Grid Inspector displays the actual immediate children, friendly names, and
current footprints. Selection is shared with the workspace; the inspector stays
open while a user selects a real child. Numeric preferred position/size controls
and earlier/later actions use the same arrangement/collision functions as normal
editing. Grid spacing may round edited dimensions. The existing placement-region
designer remains under an advanced disclosure. Inspector drag editing is deferred.

Locks block layout operations while leaving content editable. Window options
offer Undo/Redo; the inspector offers Reset this panel layout, preserving
membership and other panels' preferences. The existing header Reset page layout
clears that page's layout preferences and remains undoable during the session.
Escape and pointer cancellation restore an active gesture without saving it.

The reusable `AdaptiveButton` uses its allocated width for expanded, compact,
and icon-only presentation. Names and tooltips stay available in every state.
It is used for inspector and common window recovery actions. Existing panel
container queries continue to govern ordinary fields, toolbars, and cover actions.
`FluidPanelConstraints` extends panel definitions with usable dimensions,
preferred/maximum sizes, priority, overflow, growth, and aspect-ratio guidance.
This is a trusted component contract, not a third-party runtime or panel designer.

## Compatibility and persistence

Legacy `swissmouse-desktop-v1:<page>:...` frame, group, magnet, connection, and
container keys are imported on first use. Edits save one `:workspace` record with
`schemaVersion: 1` and `workspaceId`. Legacy keys are retained for recovery until
an explicit page reset. Static component definitions and their stable IDs supply
panel types; instance preferences, generated parent descriptors, relationships,
preferred layouts, and frames are stored separately from book data.

Damaged values fall back safely. Storage failures leave the current session
usable in memory, but cannot promise restart persistence. History is per workspace
and lasts for the current session; it is not saved across restarts. Undo/Redo
replays layout snapshots, never metadata edits or audio processing actions.

## Primary changed files

| File | Purpose |
| --- | --- |
| `src/components/DesktopWorkspace.tsx` | Shared transactions/history, generated parents, selection, locks, tools and inspector integration |
| `src/workspace/workspaceState.ts` | Versioned layout state, migration, validation and bounded history |
| `src/utils/containerLayout.ts` | Spatial collision ordering and responsive resolved frames |
| `src/components/ContainerConnector.tsx` | Reused merge gestures, per-panel assignment and invalid-drop feedback |
| `src/components/ContainerMagnet.tsx` | Reused magnet gestures and configurable corner presentation |
| `src/components/ContainerLayoutMenu.tsx` | Existing menu extended with inspection and advanced disclosure |
| `src/components/PanelGridInspector.tsx` | Real-child visualization, shared selection and basic editing |
| `src/components/AdaptiveButton.tsx` | Shared fluid button presentation and accessible identity |
| `src/workspace/panels.ts`, `src/workspace/index.ts` | Fluid constraints and public contracts |
| `src/workspace-ui.css` | Themed interaction feedback, inspector, corner tools and adaptive controls |
| `tools/adaptive-workspace.test.ts`, `tools/adaptive-controls.test.tsx` | Migration, recovery, reflow, constraints, inspector and accessibility regressions |
| `tools/fixtures/container-workspace.tsx` | Isolated browser fixture with live drafts, counters and silent audio continuity checks |
| `package.json` | Repeatable `test:workspace` command; no dependency changes |

## Performance

Pointer previews remain requestAnimationFrame based and avoid saving every
pointer movement. Magnet/merge target geometry is captured at pickup. Responsive
calculation depends on registered panels, not library records. CSS continues to
handle ordinary internal presentation. The inspector's map exists only while
opened; it renders actual children rather than a permanently mounted empty grid.

The automated 150-panel responsive-resolution test completed in approximately
61 ms in the final combined test run, including its pairwise overlap assertions. This
is a synthetic check, not a production latency benchmark. Interactive testing
also verified that the draft component's render count stayed unchanged through
layout changes. Long-duration memory profiling has not been performed.

## Verification and limitations

The repeatable verification commands are:

```powershell
npm.cmd run lint
npm.cmd run test:workspace
npm.cmd run build
```

Browser verification uses `tools/fixtures/container-workspace.html` through Vite.
The fixture contains no user book data. Final validation results:

- TypeScript/lint passed.
- All 52 workspace and regression tests passed, with zero skipped or failed tests.
- Production frontend, server, and catalog-worker builds passed. Vite still
  reports a bundle larger than 500 kB; this change does not introduce code splitting.
- Browser checks passed for click versus double-click assignment, independent
  corner tools, keyboard and pointer resize, pointer merge creating a parent,
  authored-child resize with a single-action undo, parent collection preserving
  existing children, repeated detach/merge/undo/redo, inspector selection in both
  directions, preferred size editing, ordering, locks, and reload restoration.
- A parent narrowed from 827 px to 443 px reflowed its children; widening it
  restored the exact prior child styles. Expanding a top child also kept it
  anchored while moving its lower neighbor out of the occupied space.
- A live silent WAV retained its source and playing state, with advancing
  playback time, through detach, generated-parent merge, undo and redo. Draft text
  and a local component counter remained intact.
- At a 600 px viewport, the document-flow fallback displayed both grouped children
  within the available width. Light, Dark, and Cheese appearances were inspected.
- The rebuilt app displayed the real Metadata inspector with all seven sections;
  all 22 child form fields retained `form="metadata-fields"`. Chapter player,
  Transcript, and Chapter editor panels mounted without console errors.

Live Library navigation was not fully validated: one automation tab stopped
responding while leaving Chapter Review, and a fresh tab's Library navigation
did not complete during the check. No console error or confirmed cause was
obtained. Library structure/filter regressions pass in the automated suite, but
this is not evidence that the complete real-data Library workflow passed. That
navigation path remains a manual release check; it is not attributed to an
unrelated subsystem without evidence.

The browser's state-preserving `moveBefore` operation crashed when moving live
subtrees into a newly created generated parent. That boundary now uses the
existing insertion fallback with explicit focus/media restoration. React portal
targets remain stable. Repeated merge/undo/redo checks preserved the draft,
component counter, audio source, playback position, and playing state afterward.
This does not establish sample-perfect audio continuity on every browser.

Deferred: recursive parent editing, parent-to-parent merging, inspector drag
editing, custom internal child designers, full control conversion, third-party
plugin runtime/installer, synchronization, remote execution, and new modules.
Small screens use the existing readable document-flow fallback. Inspection and
selection remain available there; geometry editing requires a wider workspace.

## Manual release QA

1. Open Metadata, type a draft, and start playback. Pop out two sections and merge
   them. Confirm the same fields, form ownership, values, and playback remain.
2. Single-click, drag, and double-click each toolbar tool. Confirm that only
   double-click/explicit assignment changes that panel's saved corner tool.
3. Try a corner's right-click menu and keyboard alternatives. Reload and check
   independent assignments and locks.
4. Resize a parent narrow and wide. Verify accessible overflow, no overlaps,
   readable controls, and restoration of the preferred arrangement.
5. Select from the inspector and from the workspace. Edit a child's footprint,
   reorder it, undo/redo, and reset only that parent's layout.
6. Drag toward locked/invalid targets, cancel with Escape or pointer cancellation,
   and verify that rejected operations do not save geometry or hierarchy changes.
7. Detach every child from a renamed generated parent. Confirm it remains and can
   accept children again. Reset the page, then undo the reset.
8. Exercise Library Manager and Chapter Editor in Light, Dark, and Cheese/Parchment
   appearances, narrow screens, keyboard navigation, touch, and reduced motion.
9. Before release, repeat on supported browsers/operating systems with long media,
   screen readers, and prolonged merge/detach cycles. Full cross-platform,
   assistive-technology, and memory-leak certification has not been performed.
