# SwissMouse Audiobook Workbench

This repository owns the full Audiobook workspace, processing coordination and project interpretation. SwissMouse Core lives separately at [Bageena/SwissMouse](https://github.com/Bageena/SwissMouse). Development targets Alpha 6.

Run `npm ci`, `npm run lint`, then `npm run module:build:full`. The output is .cache/full-module-packages/audiobooks-full-0.0.2.smmodule, with preferred source, license/notices, exact digest and a development trust catalog. Install the verified package through Core Modules and restart; Core does not need rebuilding.

The root src/ and tools/ trees are module-owned application source and compatibility adapters. References from packages/audiobooks to these trees are local to this repository, not imports into the Core checkout. Public neutral SDK 0.0.2 source is pinned at packages/sdk; protocol 2 uses the host React 18 instance and Node runtime.

The module uses standard host JavaScript support libraries from package.json. Python, FFmpeg, transcription packages and models are external requirements, installed separately with user intent. Removing this module does not remove those programs or saved projects.

The legacy standalone build remains for migration/regression work; it is not the new Core distribution. Test on a separate APP_ROOT before using an existing library. No personal libraries, config, dependency installations or external programs belong in this repository.

AGPL-3.0-or-later; see LICENSE and THIRD_PARTY.md.
