# Preferences

The header gear opens one menu: Free Up Space, Preferences, Quick Settings, System Check, and Technical Logs, in alphabetical order. Preferences opens the full page; Quick Settings retains the old settings interface, and System Check opens Requirements inside Preferences. Existing configuration endpoints and saved values are reused.

## Initial categories

- Appearance: built-in/custom themes, theme discovery, and player ambient glow.
- Files & storage: PCM retention and Library maintenance.
- Audiobooks: Inbox/Library paths and folder templates, metadata/cover options, Quick Tags, speech defaults, chapter lead-in, and M4B quality defaults.
- Requirements: the existing dependency manager, embedded with installation, repair, build selection, optional removal, diagnostics, and system ownership protections intact.
- Modules: the [Batch 1 read-only module proof](BATCH1-MODULE-PROOF.md), with local approved-package installation, restart status, enable/disable/removal, and a packaged panel for the open resource.

Search matches section titles, descriptions, owners, and keywords across categories. Draft configuration remains mounted when categories change. Save preferences commits the draft; errors retain it, and closing with unsaved changes asks before discarding. Theme selection retains its existing immediate-save behavior. Project-specific processing/model controls remain available in their existing workflows; this initial page does not move the full model-download interface out of Audio Processing.

## Trusted settings contributions

`src/preferences/registry.ts` exposes `preferencesRegistry.register()` and the section/field contracts. Register contributions at app composition time before opening Preferences. IDs must be namespaced by their owner, and duplicate IDs are rejected.

```tsx
preferencesRegistry.register({
  id: 'audiobooks.chapter-defaults',
  owner: 'audiobooks',
  category: 'audiobooks',
  title: 'Chapter defaults',
  description: 'Default timing for detected chapters',
  keywords: ['lead-in', 'timing'],
  fields: ({ config, updateConfig }) => [{
    id: 'audiobooks.lead-in',
    label: 'Chapter lead-in (seconds)',
    description: 'Start detected chapters slightly before the spoken heading.',
    control: 'number', value: config.lead_in_seconds,
    min: 0, max: 5, step: 0.1,
    onChange: value => updateConfig({ ...config, lead_in_seconds: Number(value) }),
  }],
});
```

This illustrates registration; the existing chapter control already appears in the built-in processing section, so do not register a duplicate in production. Standard fields support text, numbers, and toggles. A section can alternatively/additionally supply `render(context)` for specialized controls. New category IDs appear automatically; explicit friendly category metadata and additional control types can extend this initial contract.

These are trusted compiled-in contributions. This registry does not load third-party code or implement an extension sandbox. The supplied context edits the existing validated application configuration. A future module's private settings need an explicit validated storage/API adapter; adding arbitrary keys to WorkbenchConfig is not a persistence mechanism. Specialized panels must avoid nested forms and use explicit action buttons for immediate operations.

## Dependency descriptions and links

`src/preferences/requirements.ts` contains descriptions, official website/source links, license labels/links, and consumer descriptions for the processing dependencies currently reported by the backend. Add metadata there when adding a corresponding dependency to runtime discovery. Local folder-access checks are not software and use their existing purpose text without invented external/license links.

Keep license qualifications specific to artifacts: FFmpeg builds vary, yt-dlp's Windows executable differs from its source, and Python/GPU wheels may contain separately licensed components. These links are informational; they do not certify every installed artifact or replace license acceptance where required. Acquired runtimes remain outside SwissMouse release packages.

The current Requirements API still reports audiobook-oriented dependency groups. General module-contributed dependency discovery, consumer counting, and dependency solving remain future work; the Preferences section is their shared UI destination.
