# Navigation Panel and Toolbar Panel

Use `NavigationPanel` and `ToolbarPanel` from `src/workspace` for new navigation and command strips. Both use the same DesktopWindow lifecycle, theme tokens, move/resize controls, eye toggle, layout history, and saved workspace preferences as ordinary panels. Navigation panels can collapse; toolbars have no title or collapse chrome.

- `swissmouse.navigation` has the friendly type name **Navigation Panel**. Supply a screen-specific title and destination items (label, optional description, icon, selected/completed/stale state, callback). Processing screens show **Processing Navigation**; Book Files shows **File Manager Navigation**; the library uses **Library Navigation**. The existing `project-navigation` and `library-navigation` instance IDs remain stable.
- `swissmouse.toolbar` has the friendly type name **Toolbar Panel**. Supply command children and optionally a `homeWindow` for an initial inline location. The component owns the accessible toolbar wrapper; command state remains with the caller.

Toolbars are command strips. The leading grip opens the shared window controls without taking space over command buttons. Docked strips reserve a separate outer resize edge; floating strips reserve space for the corner handle and expose the hamburger/hotdog orientation toggle. Vertical strips keep independent floating buttons. The grip retains keyboard access and uses the same viewport-clamped controls overlay as other panels.

Detached strips use the shared hamburger/hotdog orientation toggle. Navigation keeps the measured five-line icon fallback and compact horizontal layout. Toolbar orientation is saved while free; attachments force vertical orientation on either side and horizontal orientation at the top, under the header, or footer.

Use the toolbar's Window options, choose Placement, then Move into a target panel. The five slots are `top`, `header`, `left`, `right`, and `bottom`. Merge Move drag retains the existing four edge targets; the precise under-header slot is available through Window options. Pop out detaches the same mounted component; Return restores its authored home location. Existing editors, command callbacks, and selections stay with their owning screens.

The File Manager command toolbar is the first migrated Toolbar Panel. Other older inline command groups can migrate incrementally; new toolbars should use this contract.

Parent panels may accept either parent or child panels, including parents that already own nested content. Roles and instance identities remain unchanged by nesting. Reparenting and Pop out keep the subtree mounted. Self-links and ancestor cycles are rejected both by merge targeting and by saved-layout validation.

## Header docking

Application Header is a fixed parent surface in the active workspace. Header Toolbar starts at the right of the Media Player and uses horizontal icon-only commands. The player is a child panel with the same undock, resize, and return controls. Use Move into Application Header with Left side or Right side; Merge Move also has dedicated side zones around the player. Header membership, placements, and player sizes use the existing per-page workspace state. Detaching the player moves its existing mounted subtree. Header actions retain accessible labels and tooltips. File audio check and page layout reset use distinct composite refresh glyphs.

## Responsive content and attachment feedback

Processing components use named container queries, not browser breakpoints, for card grids and form fields. `AdaptiveButton` simplifies from description to a short label to an icon while keeping its complete accessible name and tooltip. Chapter editing rows become labeled cards at narrow widths without replacing inputs or their draft state. Keep essential fields and values visible; hide only supplementary copy and redundant action labels.

Merging into an existing parent preserves its width and lets the child reflow into that space. Grid children report their natural height so following rows move below wrapped content; these resolved heights do not replace saved preferred geometry. Canvas remains an explicit arrangement. Resize observations are frame-batched.

Completed merges settle with a short translation/opacity animation and a receiving outline, with no text scaling or animated layout dimensions. Reduced motion skips the animation. Magnetic links show a persistent magnet badge on both attached panels, naming their peers in the accessible label and tooltip. Pulling apart clears the badge. Drag previews update only on input or active edge scrolling and use compositor transforms.
