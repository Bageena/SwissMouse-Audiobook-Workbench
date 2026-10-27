# Moving and connecting containers

Each desktop container has two move tabs:

- **Free** keeps the existing movement behavior. Drag the tab or a non-interactive
  header area to position a standalone window without snapping. Arrow keys on the
  Free tab move it; Shift moves farther.
- **Connect** previews a magnetic attachment near another container's sides and
  corners. Left/right creates a row inside that container; above/below creates a
  column. Release to attach. Drag the connected container's Connect tab again to
  change sides, attach elsewhere, or detach by releasing in open space. Escape
  cancels the gesture. The page scrolls while dragging near its top or bottom.

Click Connect (or press Enter/Space on it) for precise placement controls. Choose
the side, then the destination container. Window options still provide Pop out
and Return to the original container for built-in sections.

Connections and their order are saved per page alongside free window positions.
Reset page layout restores the original arrangement without clearing editor
contents. Moving a parent with Free also moves its connected children.

Rows stack on narrow containers so controls remain readable. Desktop drag tabs
hide below the existing 680-pixel workspace breakpoint; placement menus remain
available. The existing one-level grouping rule still applies: detach a
container's children before placing that container inside another container.

## Code and theme integration

- `DesktopWorkspace.tsx` owns container registration, parent relationships, four
  docking regions, and saved layout application. Each editor/player keeps the
  same React portal host when its position changes. Atomic DOM moves preserve
  focus and media; older browsers retain the existing media/focus fallback.
- `ContainerConnector.tsx` handles pointer capture, drag threshold, scroll,
  cancellation, the preview, and committing a drop. It does not change a saved
  layout during the gesture. Free movement uses its original separate handlers.
- `windowConnections.ts` validates placement data, orders attachments, and finds
  nearby edges. A slightly wider release distance keeps the preview from
  flickering around an acquired edge. Stale placements for another parent are
  ignored. Existing saved groups without side data still dock below their parent.
- `workspace-ui.css` lays out rows/columns and styles both move tabs and previews
  using existing `--sm-surface`, `--sm-surface-elevated`, `--sm-border`, `--sm-ink`,
  `--sm-muted`, and `--sm-ring` theme tokens.

Future built-in or plugin panels can use the existing `DesktopWindow` wrapper with
a stable `id` and a readable `title`. No plugin-specific drag implementation is
needed. This change does not add a plugin loader or alter media/file data.

## Verification

Focused unit tests cover all four sides and corners, release hysteresis, open
space, placement ordering/validation, per-page persistence/reset, and existing
workspace/metadata/chapter layouts. Browser checks use the real components in an
isolated fixture: Free does not connect; Connect attaches into a row/column,
reparents, detaches, restores after reload, and resets home sections while keeping
unsaved edits. Narrow workspace behavior, keyboard placement, sibling order after
reload, and continued audio playback through attachment/collapse are checked too.

### Sidebar docking sizing regression (2026-10-19)

Connecting Project navigation to Audio processing hid the first item of the
two-column workflow grid. Automatic grid placement then put the entire workflow
in the old 210px sidebar track; the compact Project Overview shrank to 70px.
Library/workflow grids now reclaim a hidden container's track. Connected rows
use their panels' minimum widths and wrap when space runs out instead of dividing
the available width into arbitrarily small shares.

Verified on the affected saved layout in the running app, without resetting its
connections: the workflow recovered to 1424px and Project Overview to 475px.
At 760px viewport width the connected panels remained readable side by side;
at 420px they stacked within the 381px workspace. Restored the normal viewport
after verification. Build, TypeScript, and 18 focused tests passed.
