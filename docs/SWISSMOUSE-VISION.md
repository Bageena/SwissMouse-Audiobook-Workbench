# SwissMouse's broader scope

Current development status: Alpha 5 has launched; Alpha 6 is in development. Its [four main goals](ALPHA6.md) are Audiobook module extraction into a separate installable repository, Preferences and Quick Settings, the Notes core, and full File Manager and Audio Player screens with bulk file actions and basic EQ/presets. The broader direction below remains long-term scope beyond those goals. See the [documentation index](README.md).

Recorded from the owner's direction on October 18, 2026. This is the long-term product direction, not a claim that these features already exist.

SwissMouse is becoming a modular media and knowledge workspace. Its defining experience is a flexible interface of containers, tools, toolbars, and themes. Books and audiobooks become modules rather than defining the entire core. Existing audiobook workflows remain supported during that transition.

October 28 clarification: a future desktop opens modules/tools; a physical File Browser navigates disk content; a shared resource browser presents managed information in shelves, covers, lists, and other views. The resource browser's final name is undecided. The core must also accommodate spreadsheets, database files, list files, images, and information without backing files. See the [shared core design direction and performance requirements](SHARED-RESOURCE-CORE.md). This is broader support in the model, not a commitment to implement all of those editors in Alpha 6.

The shared core provides stable resource identities, a scalable catalog, organization, notebooks, references, search, and application boundaries. Modules can cover worldbuilding, writing, research/study, books, audiobooks, movies, gaming, music, comics, magazines, papers, and news. They contribute specialized viewers and tools such as organizing, conversion, and compression without duplicating common systems.

Libraries can show one media type, a custom grouping, or a unified view. An item may belong to multiple collections. Series use the collection foundation with ordering and series semantics. Shelves provide organized presentations. Collections and series can have their own notebooks.

Notebooks support Markdown, audio notes, sketches, sticky notes, and templates. References can target an audio/video timestamp, a location in a particular book edition, a character or other worldbuilding entity, or another note. Project notebooks retain their identities and ownership while a global knowledge hub offers filtered access across them. Viewing or referencing a notebook elsewhere must not duplicate it.

The built-in file browser supports file management, bulk editing, and basic notes in the long-term vision. Optional plugins can add graph views, providers, importers, transcription, LLM interfaces, and other capabilities to containers and toolbars. YouTube import is an example of an optional capability whose dependencies should be relevant only when that capability is used. Alpha 6 prioritizes the installable Audiobook module and shared core tools; a general third-party plugin ecosystem remains broader future work.

**Desktop/Admin:** the free main application owns administrative media processing, organization, and publication. Existing source-preserving operations and recovery protections remain essential.

**Server:** serves the catalog and media explicitly published by Desktop/Admin. It should have access only to that approved material, not unrestricted access to the administrative install. Self-hosted web access remains available without a subscription. Collaboration writes belong to a separately controlled project/user service.

**Mobile:** a future paid Android application with useful reading, listening, worldbuilding, writing, and mobile-specific modules. Private notes belong to the user and must not be readable by a media host's administrator. Optional sync must preserve that boundary; shared projects contain only deliberately shared content.

**Optional services:** subscriptions can fund managed authentication, synchronization, shared projects, storage, and cloud compute. LLM modules may support user API accounts and metered services. Private material is sent to a provider only through an explicit user action. The core stays free, and competing implementations remain possible under the applicable licenses.

The 500,000+ physical-file target requires indexed queries, bounded UI data/rendering, and background inventory work. Files, logical works, recordings/editions, and processing projects are distinct concepts. Stable identifiers must survive renaming and moving; display names and filesystem paths are not resource identities.

Current release focus is the four Alpha 6 goals linked above, building on shared resource identities, the catalog, and theme/container foundations. Broader future work includes richer organization and annotations, additional modules, server publication, and mobile privacy and optional collaboration.
