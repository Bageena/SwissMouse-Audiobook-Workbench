# Panel catalog and identity

SwissMouse uses a shared panel shell. Every built-in workspace panel now has a
catalog entry in `src/workspace/panels.ts`, available before its screen mounts.
The public API is exported from `src/workspace/index.ts`.

- **Panel ID** identifies a reusable panel, independently of its screen.
- **Friendly name** is its unique, readable catalog name. File Manager is named
  **File Manager**, rather than its legacy storage ID `panel-File Manager`.
- **Instance ID** identifies a placement in a page. Existing IDs and layout
  storage keys remain unchanged. Repeated instances can share one panel ID.
- **Role** is permanently `parent` or `child`; moving never changes it.
- **Default parent** identifies the authored starting home for a child.
- **Current parent** comes from page layout state and can differ from the default.

Friendly names must be nonempty and unique across registered definitions,
ignoring case. Multiple screens reuse the same definition and name. A panel's
content heading may be contextual (for example Library books can show Inbox),
while its catalog name remains stable. References and saved layouts use IDs,
never friendly names.

See [Parent panels](PARENT-PANELS.md) and [Child panels](CHILD-PANELS.md) for role
and appearance rules. Container kinds (Panel, Bar, Group) and content kinds
(Widget, Gallery, Menu) remain separate presentation concepts.

## Built-in catalog

| Stable panel ID | Friendly name | Role |
| --- | --- | --- |
| `library-navigation` | Library navigation | Parent |
| `library-books` | Library books | Parent |
| `project-navigation` | Project navigation | Parent |
| `project-overview` | Project Overview | Parent |
| `add-files` | Add Files | Parent |
| `panel-File Manager` | File Manager | Parent |
| `panel-Processing Order` | Processing Order | Parent |
| `processing-progress` | Audio processing | Parent |
| `processing-output` | Processing workspace and output | Parent |
| `processing-options` | Chapter and audio options | Parent |
| `transcription-settings` | Transcription and model settings | Parent |
| `processing-readiness` | Processing readiness | Parent |
| `chapter-player` | Chapter audio player | Parent |
| `transcript` | Transcript | Parent |
| `chapter-editor` | Chapter editor | Parent |
| `metadata` | Metadata | Parent |
| `export` | Create your audiobook | Parent |
| `final-check` | Final check | Parent |
| `metadata-cover` | Cover art | Child |
| `metadata-identity` | Book title and contributors | Child |
| `metadata-taxonomy` | Series & Taxonomy | Child |
| `metadata-description` | Description | Child |
| `metadata-publication` | Publication | Child |
| `metadata-identifiers` | Identifiers | Child |
| `metadata-rights` | Rights | Child |

The seven Metadata children share Metadata as their default parent. Book Files
and Review Metadata render these same definitions and components.

## Using the catalog

`listPanelDefinitions()` returns all registered descriptors for future menus or
theme tooling; `getPanelDefinition(id)` resolves one. `registerPanel()` adds a
trusted module descriptor and returns an unregister function. Registration
rejects duplicate IDs and friendly names. Descriptors are immutable.

```tsx
registerPanel({ id: 'research.notes', name: 'Research notebook', role: 'child' });

<WorkspaceContainer id="research-notes-on-page-one" panelId="research.notes"
  title="Research notebook" homeWindow="my-research-parent">
  <NotesEditor />
</WorkspaceContainer>
```

Register module descriptors before rendering their panels. `panelId` defaults
to the existing instance ID for built-ins. Registered names and roles take
precedence over legacy title/role props. Legacy unregistered trusted components
remain compatible: a `homeWindow` implies Child; otherwise they default to
Parent. New modules should register explicitly.

Mounted shells expose `data-panel-id`, `data-panel-name`, `data-panel-role`, and
`data-desktop-window` (instance ID). Use the role and semantic CSS tokens for
shared styling; use the stable panel ID for a targeted theme override.

## Implemented boundaries

Expansion uses a shared 180 ms downward clip reveal beneath a stationary header.
It runs only on collapsed-to-expanded transitions, not initial mount, and never
animates height or scales text. One geometry measurement starts the browser's
animation; collapse/unmount cancels it without retaining a clip. Reduced-motion
preferences and unavailable animation APIs use immediate expansion.
`--sm-panel-reveal-duration` is a millisecond number (0 disables; nonzero values
are bounded to 100–240 ms). Parent and child header lips are independently styled
with `--sm-panel-header-bottom-shadow` and `--sm-child-header-bottom-shadow`.

The catalog, fixed roles, docking guards, friendly-name validation and theme
hooks are implemented. Old saved links that promote children or nest parents
are ignored when layouts load; unrelated frames and drafts are preserved.

User-created parents, add/remove panel menus, a theme-builder interface,
cross-page dragging, and portable user-defined workflows remain future work.
This catalog does not load or sandbox third-party executable code. Global app
chrome and dialogs are outside this workspace panel catalog.

Validation: `npm.cmd run lint` and
`node --import tsx --test tools/panels.test.tsx tools/container-components.test.tsx tools/metadata-layout.test.tsx tools/desktop-layout.test.ts tools/window-connections.test.ts tools/container-layout.test.ts`.
The catalog coverage test checks all literal built-in panel placements so a new
panel cannot silently ship without a registered ID and friendly name.
