# Alpha 6 scope

Status: active development after the Alpha 5 launch. The maintainer set these four main goals on October 28, 2026. This document records intended scope; it does not establish implementation or verification status.

Alpha 6 focuses on the core of SwissMouse after the audiobook-focused work leading up to Alpha 5. Audiobook updates may be included alongside these goals.

## 1. Independently installable Audiobook module

Completely detach the Audiobook module from the core application, move it into its own repository, and make it installable within SwissMouse. A compiled-in module manifest alone does not complete this goal.

The extraction needs explicit ownership of shared services and audiobook-specific behavior, a host/module compatibility contract, and an installation/loading lifecycle. Preserve existing project identities, saved work, source media, and processing behavior through the transition. Core services should remain available independently of the Audiobook module.

Repository location, package format, delivery mechanism, and update/removal behavior still need design. The existing [extension contracts](EXTENSION-CONTRACTS.md) describe the starting implementation and provisional boundaries; they are not yet a completed installer.

## 2. Preferences and Quick Settings

Create a dedicated **Preferences** screen as the central home for all settings. Provide a contribution mechanism for module and plugin settings so users can find configuration in one place.

Keep the current settings surface as **Quick Settings**, reworked around useful, frequently adjusted controls. Quick Settings should use the same underlying preferences rather than create competing saved values. Preserve existing explicit user selections when reorganizing settings.

The accepted design uses shared categories with extension-owned sections: standard setting descriptions provide consistent controls, search, validation, and saving, while specialized panels support richer tools. The top-right main-header settings icon opens Preferences. Modules and plugins contribute their sections through a host-owned registration contract. Exact categories, contract details, and Quick Settings controls still need design.

Preferences includes a central **Requirements** section for SwissMouse, modules, and plugins. Show each dependency once, with the features/extensions using it, whether it is required, recommended, or optional for those features, compatibility/status, installed version and location, and system versus app ownership. Provide supported install, repair, update, and uninstall actions. Explain impacts before removal, protect system-owned installations, and retain shared dependencies needed elsewhere. Include upstream source, license/notices, and any applicable license-acceptance requirements. A dependency may be required for one feature and optional for another; classification must retain that context.

## 3. Notes core

Establish the core of the Notes app. Define the initial editing, storage, identity, and integration boundaries before committing to a detailed feature list. Reuse shared resource identities and references where appropriate.

The first Notes scope remains to be specified. Markdown, audio notes, sketches, sticky notes, templates, and the broader notebook/reference model in the [product vision](SWISSMOUSE-VISION.md) are longer-term context, not an automatic commitment to deliver every capability in Alpha 6.

## 4. Full File Manager and Audio Player screens

Create a dedicated browsing screen with bulk actions. The maintainer has clarified that the managed-information experience is closer to Steam Big Picture: SwissMouse resources presented as shelves, covers, lists, and other views. Its working name is **shared resource browser**, with a final name to be chosen; a **File Browser** separately handles physical directories/files. Preserve existing safe file operations when exposing filesystem actions. See the [shared resource core direction](SHARED-RESOURCE-CORE.md) for resource types, typed fields, relationships, taxonomy, views, autocomplete, and scale requirements. Additional-file-type testing is deferred; the contracts must avoid audiobook-only assumptions now.

Create a dedicated **Audio Player** screen with a fuller version of the shared player, including **EQ presets and a basic equalizer**. Reuse shared playback state and services so the dedicated screen and compact player stay consistent. EQ controls, presets, and persistence behavior still need design.

## Scope and evidence

The four goals guide Alpha 6 planning; this is not a delivery order or a completed implementation checklist. Detailed implementation plans and acceptance checks should be added as each area is designed. Keep implemented behavior, planned work, and verification evidence distinct.

The full notebook vision, general plugin ecosystem, server, mobile application, and other future modules are not added to Alpha 6 merely because these foundations support them. Published Alpha 5 notes and verification records remain historical.
