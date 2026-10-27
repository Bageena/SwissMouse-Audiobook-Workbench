# Slide-out panels

`SlideOutPanel` is exported from `src/workspace` and registered as
`swissmouse.slide-out`. It is an attached child surface for navigation, menus,
or supporting information. It stays inside its owning panel and moves with it.

```tsx
<SlideOutPanel
  id="example-navigation"
  title="Navigation"
  homeWindow="example-parent"
  side="left"
  main={<MainContent />}
>
  {open => <NavigationContent active={open} />}
</SlideOutPanel>
```

Use a stable instance ID; register built-in instances in `workspace/panels.ts`.
The component accepts either side and arbitrary React content. The child render
function receives the open state so background work can pause while closed.
Both the main content and auxiliary content remain mounted when toggled.

The toggle remembers its state per workspace page and instance. The close
button and Escape return focus to the toggle. Closed contents are inert and
hidden from assistive technology. Reduced-motion preferences disable sliding.
Below 600px of available panel width, the sheet overlays only its parent's
content, leaving the main content at full width.

File Manager uses `file-manager-folders`, attached to `panel-File Manager`.
Its tree has Project folder, Inbox, Library, and current drive/share roots.
Branches load shallow folder-only pages from `GET /api/jobs/:id/book-files/folders`
and disclose additional pages explicitly. Search, file filters, and file paging
do not filter the tree. Navigation uses the existing browser history and never
changes processing membership or source files.
