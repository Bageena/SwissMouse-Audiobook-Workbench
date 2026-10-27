# Parent panels

A parent panel provides a home and layout area for child panels. Its role is
fixed even while it has no children. It can also retain its current authored
content; converting every existing screen into smaller children is separate work.

- Parents live at the page/workspace level and cannot be docked into another panel.
- They accept child panels from any parent on the same mounted page.
- Free move positions the parent; Magnet move aligns and links peer movement.
- Parents have no Connect move control or Move into destination menu.
- Moving a parent carries its contained children naturally. Magnet links never
  change containment or roles.

Metadata, File Manager, and Processing Order are examples. Container kind
`group` is not the role: existing Panel and Bar containers can also be parents.

## Theme contract

Parent header defaults retain the shared `--sm-panel-header-bg`,
`--sm-panel-header-texture`, and `--sm-panel-header-shadow` tokens. Title stickers
retain the `--sm-panel-title-*` tokens. Structure lives in `src/workspace-ui.css`;
the Cheese palette has its own theme values.

Child headers use separate `--sm-child-header-*` and `--sm-child-title-*` tokens.
Theme authors can change either role without changing the other's explicit values.

For stable names, identity and future menu integration, see [Panel catalog](PANELS.md).
