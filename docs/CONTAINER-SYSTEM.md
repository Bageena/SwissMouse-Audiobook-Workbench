# SwissMouse container standard

The implemented role and naming contract is documented in [Panel catalog](PANELS.md),
[Parent panels](PARENT-PANELS.md), and [Child panels](CHILD-PANELS.md). Parent/Child
are fixed roles, separate from the visual Panel/Bar/Group kinds below. Only a
Child can dock, and only a Parent can receive it. A floating Child stays a Child.

The desktop uses one container shell for all existing workspace windows. The
public module entry point is `src/workspace/index.ts`; the existing
`DesktopWorkspace` and `DesktopWindow` names remain compatible aliases.

## Names and responsibilities

| Friendly name | Stable type | Responsibility |
| --- | --- | --- |
| Panel | `swissmouse.panel` | A focused editor or working surface |
| Bar | `swissmouse.bar` | A compact navigation or control surface |
| Group | `swissmouse.group` | Related containers arranged together |

Widget, Gallery, and Menu describe content, independently of its container.
Names shown to people may change. Definition IDs and instance IDs must remain
stable. Existing instance IDs are retained so saved layouts continue to work.

The control order is Move, Magnet move, Connect move (children only), Layout,
Collapse, Options. Tooltips and accessible names describe each control.
Move/resize controls appear where desktop placement is available. All headings
use the shared sticker tokens, including collapsed headings and legacy palettes.
An authored heading retains its actions; otherwise the shell supplies a title.

## Layout menu

The grid icon edits the **contents** of a container. Its outer frame continues
to determine where the container sits on the desktop.

- **Original layout** retains the module's authored responsive arrangement. This
  is the default for existing workspaces and provides a reversible return path.
- **Free canvas** gives registered child containers and the main content widget
  their own movable/resizable rectangles. Positions are saved in CSS pixels.
- **Grid** snaps those rectangles to a 24 px lattice by default. Available sizes
  are 8, 12, 16, 24, 32, and 48 px. Switching from canvas snaps existing geometry,
  respects readable minimum widths, and resolves collisions downwards.
- **Draw regions** allows pointer drag or keyboard selection of opposite corners
  on a small preview. Objects prefer the nearest unoccupied region wide enough
  for their content. Overlapping drawn regions are rejected; objects without a
  suitable region fall back to the regular grid. Undo last region and Clear
  regions are available. Arrow keys navigate preview cells; Enter selects corners.
- **Arrange content** reveals the main content's move/resize handles and optional
  grid guides. Done hides those guides and handles while keeping the arrangement.

The main module content is one widget, internally identified as `$content`.
Fields, transcript words, and library records do not become layout objects.
Modules can expose finer independently movable units using child containers, as
Metadata already does. A parent with child windows is measured once after format
conversion so the original child slots do not leave large empty areas behind.

Container menus use an anchored overlay outside scrolling panels, so controls
remain reachable when editing a nested container. Below a 680 px workspace width,
the shell restores document flow while retaining the saved desktop arrangement.

## Moving and magnets

- **Move** changes position without attaching to another container. Inside a grid
  parent, release snaps the child to its nearest valid placement.
- **Magnet move** attracts matching edges of peer containers. Capture is 18 px;
  release is 34 px. The wider release threshold produces resistance to small
  movements after capture. The preview highlights a held edge. This is visual
  attraction and hysteresis, not physical pointer force feedback.
- Magnets keep an 8 px gutter, with extra vertical clearance for the top control
  tab. They align edges without changing container ownership. Each remains
  independently movable. Use a child's Connect move to place it inside a parent.
- **Connect move** is available only to children. It previews placement inside a parent or detaches into
  open space. A grid/canvas destination uses the same placement rules as its
  existing children. The existing one-level grouping guard prevents cycles.
- Escape, pointer cancellation, or focus loss cancels a pending drag. Arrow keys
  offer keyboard movement/resizing; Shift increases the step.

## Persistence and performance

Versioned content layouts use
`swissmouse-desktop-v1:<page>:container:<instance>`. Existing desktop frames,
connections, and group membership retain their storage keys. Reset page layout
clears only the current page's layout settings. It does not remount editors or
clear drafts. Invalid saved layouts fall back to the original arrangement, and
in-memory settings remain usable if browser storage is unavailable.

Stable portal hosts move existing DOM nodes. Supporting browsers use atomic DOM
moves, retaining focus, media, selection, and React state. The compatibility
fallback restores media position/playback and focus. Metadata fields retain their
existing form ownership and shared Save action.

Drag motion uses animation-frame previews; it does not serialize settings or
update the global workspace on each pointer event. Magnet and connection targets
are measured at pickup. Only geometry and the preview update during dragging;
state and storage commit on release. Observers are scoped to their own window.
Catalog virtualization, paging, and lazy data access remain the responsibility of
the Gallery widget. Layout cost depends on mounted workspace objects, not the
number of library records.

## Module contribution example

```tsx
import { registerContainer, WorkspaceContainer } from './workspace';

const unregister = registerContainer({
  id: 'reading.notes', name: 'Reading notes', version: 1,
  type: 'panel', content: 'widget', minimumWidth: 280,
});

// Render within an existing Workspace. Keep this instance ID stable on rename.
<WorkspaceContainer definitionId="reading.notes" id="book-reading-notes"
  title="My notes">
  <NotesEditor />
</WorkspaceContainer>;
```

Registration is a trusted frontend module contract, not an installer or a sandbox
for arbitrary third-party code. Plugin loading, permissions, resource-context
bindings, cross-module messages, an Add Widget catalog, and a complete workspace
builder remain separate future work. Gallery arrangements such as carousels are
content-widget concerns; the container shell does not eagerly render a collection.

## Existing container coverage

| Workspace | Containers using the shared shell |
| --- | --- |
| Library | Library navigation (Bar/Menu), Library books (Panel/Gallery) |
| All processing pages | Project navigation (Bar/Menu), Project Overview |
| Book Files | Add Files, File Manager, Processing Order, Metadata |
| Audio processing | Audio processing progress, Processing workspace and output, Chapter and audio options, Transcription and model settings, Processing readiness |
| Chapter review | Chapter audio player, Transcript, Chapter editor |
| Metadata | Metadata (Group), Cover art, Book title and contributors, Series & Taxonomy, Description, Publication, Identifiers, Rights |
| Export and validation | Create your audiobook, Final check |

All other rows use Panel/Widget. The global app header and modal dialogs are app
chrome, outside the per-page desktop; they are not made freely movable by this
change. Grouping deeper than one level retains the existing guard until a future
layout-tree migration defines those semantics.

## Verification

Run TypeScript checks and the focused tests:

```powershell
npm.cmd run lint
node --import tsx --test tools/container-layout.test.ts tools/container-components.test.tsx tools/desktop-layout.test.ts tools/window-connections.test.ts tools/workspace-panels.test.tsx tools/metadata-layout.test.tsx
```

`tools/fixtures/container-workspace.html` is an isolated interactive fixture for
a local Vite server. It contains a group, a nested draft editor with a render
counter, and a peer toolbar. Check mode switches, pointer/keyboard movement,
region drawing, magnetic capture/release, nesting, reload, page isolation,
narrow-screen fallback, and reset. Fixture state has its own page identities.
