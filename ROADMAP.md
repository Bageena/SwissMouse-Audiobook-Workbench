# SwissMouse Direction

**Current status:** Alpha 5 has launched. Alpha 6 is the active development cycle. See the [documentation index](docs/README.md) for current guides and historical release records.

I’m keeping the roadmap open because SwissMouse is still evolving. I believe this direction is the right future for the project, while leaving room for ideas and priorities to develop. What began as a new workflow for audiobooks has led me to rethink how people work across many tasks, how those tasks can connect, and what SwissMouse could offer beyond media.

**Alpha 6 shifts the main focus to the core of SwissMouse.** Audiobook improvements may continue alongside that work, but completing the audiobook feature set is no longer the organizing priority for this release.

## Alpha 6 goals

1. **Detach the Audiobook module completely.** Move it into its own repository and make it installable within SwissMouse. This includes establishing the host/module boundaries needed for a separately maintained module, beyond the current compiled-in registration.
2. **Overhaul settings.** Create a dedicated **Preferences** screen as the central home for all settings, with a way for modules and plugins to contribute their settings. Retain the existing settings surface as **Quick Settings** and rework it for useful, frequent adjustments.
3. **Establish the core of the Notes app.** Put the initial Notes foundation in place. The detailed first-release feature set still needs definition; the broader notebook vision is not all implied by this goal.
4. **Expand the shared file manager and audio player.** Create a dedicated File Manager screen with the full file manager and bulk actions. Create a dedicated Audio Player screen with a fuller player, EQ presets, and a basic equalizer.

These are release goals, not claims of implemented functionality. See the [Alpha 6 scope](docs/ALPHA6.md) for boundaries and planning questions.

## Longer-term direction

SwissMouse is growing into a customizable desktop for your work, running on top of Windows or Linux. Its shared foundation will organize files, notes, tags, and workspaces. Modules will add tools for specific tasks—such as audiobooks, research, writing, or business—and plugins will add optional capabilities. Users can choose the tools they need and use AI locally, through a provider, or not at all.

Information should stay connected across those tools. A note taken while listening to an audiobook could appear in a research project, and an image created in one module could be used elsewhere. Each item keeps a stable identity, so modules can share references without making unnecessary copies. Shared tools and dependencies should also be managed centrally.

There will be two main applications: **Swiss Mouse**, with the full desktop and administration tools, and **Swiss Mouse Server**, which will provide controlled remote access. Administrators will decide what users can access, which actions they can perform, and how much they can customize their workspaces.

**SwissMouse Alpha 5 established the initial foundation for this direction while remaining an audiobook application. Alpha 6 builds on that released foundation.** Reliable storage, consistent containers, shared resource identities, and clear rules for modules remain priorities. Beyond the Notes core planned for Alpha 6, the full notebook vision, workflow editor, server, and additional modules remain longer-term direction.
