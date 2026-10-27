# Child panels

A child panel is a functional section that can live inside a parent or float
independently on the page. Floating is a placement state, not a promotion to
Parent. A child cannot contain another child or parent.

- **Free move** changes position without magnetic attachment or reparenting.
  Placement inside a grid parent still follows that parent's grid rules.
- **Magnet move** aligns edges and links movement without merging panels.
- **Connect move / Dock** changes containment: it accepts only parent targets.
  Release in open space detaches the child; Escape cancels.
- **Pop out** makes the child float. **Move into…** selects any available parent
  on the current page. **Return to Metadata** (or another named default parent)
  returns it to its authored home.
- Returning to its default parent in Original layout reuses its existing slot.
- Moving preserves the mounted editor, shared form ownership, and unsaved draft.

The current Metadata children are Cover art, Book title and contributors,
Series & Taxonomy, Description, Publication, Identifiers, and Rights. They are
reused on Book Files and Review Metadata, not separately implemented copies.

## Theme contract

The shared shell keeps child styling in nested, floating and collapsed states.
Titles are centered by default. Headers follow the parent header treatment with
a slightly darker surface; layered shadows raise children above the page.

| Token family | Purpose |
| --- | --- |
| `--sm-child-panel-texture`, `--sm-child-panel-texture-size` | Body paper texture |
| `--sm-child-panel-radius`, `--sm-child-panel-shadow` | Shape and elevation |
| `--sm-child-header-bg`, `--sm-child-header-texture`, `--sm-child-header-texture-size` | Header stock |
| `--sm-child-header-border`, `--sm-child-header-shadow` | Header edge and depth |
| `--sm-child-title-align` | Title placement; default `center` |
| `--sm-child-title-bg`, `--sm-child-title-texture`, `--sm-child-title-shadow` | Title sticker |

Shared selectors are in `src/workspace-ui.css`; Cheese overrides are in
`src/cheese.css`. Other palettes use semantic color fallbacks. Authored headings
retain their controls; otherwise the shell supplies a header.

See [Panel catalog](PANELS.md) for IDs, names, registration and implementation limits.
