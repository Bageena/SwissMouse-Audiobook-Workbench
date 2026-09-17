## ❤️ Support the Project

If you find this project useful and would like to support its continued development, you can join me on Patreon:

[**Patreon — Bageena**](https://www.patreon.com/c/Bageena)

Financial support is always appreciated, but please **only contribute if you can comfortably afford to do so**.

I have relied on free and open source software for years, including during times when I simply couldn't afford to financially support the developers whose work I depended on. I haven't forgotten how valuable that software was to me, and I want to extend that same philosophy to my own work.

If a paid Patreon tier isn't within your budget, **free Patreon members are just as welcome and appreciated**. Following the project, reading the dev posts, reporting bugs, sharing the software, and providing feedback are all meaningful ways to support its development.

**Nothing related to this project is locked behind a Patreon paywall.** Posts and project updates are available to free members, and the software itself remains free and open source.

If you can support financially, thank you. If you can't, you're still every bit as welcome here.

# SwissMouse

Current release: `0.1.0-alpha.1`

The open source audiobook workbench.

> There are no paid or locked features—only my appreciation and the warm fuzzy feeling of helping an independent project continue.

> **Status: Work in Progress**
>
> SwissMouse is under active development, testing, and refinement. It is not yet recommended for general installation or production use.

## Overview

**SwissMouse** is an open-source, local web application for preparing, organizing, and preserving audiobooks.

Built with **Node.js**, it provides a browser-based interface while processing files locally on your own computer. It is primarily intended for Windows.

SwissMouse began as a collection of practical Windows batch-file workflows for audiobook conversion, merging, chaptering, and metadata work. Those batch files became the functional foundation of the project. With assistance from AI, the workflows were translated and expanded into a Node.js web application with a browser-based interface.

Original source audio files are never intentionally modified, and the application does not automatically delete files.

## First Run (Windows)

**The only requirement to start SwissMouse for the first time is [Node.js](https://nodejs.org/en/download).** Download and install the current **LTS** version from the official Node.js site, then:

1. Download and extract SwissMouse, or clone this repository.
2. Double-click `Start Audiobook Workbench.bat`.

On its first launch, SwissMouse automatically installs its locked JavaScript dependencies, builds the application, and opens it at `http://127.0.0.1:3000`. Later launches reuse those files.

After the app opens, use its **System Requirements** screen to install the processing tools you want to use. SwissMouse can set up its application-local FFmpeg/FFprobe and transcription runtime from there; these are not required just to complete the initial launch.

The first launch needs an internet connection to download the app's JavaScript dependencies. Keep the server window open while using SwissMouse; closing it stops the local app.

## Local Development

For development, run the following from the repository folder after installing Node.js:

```bash
npm install
npm run dev
```

This uses `tsx` to run the TypeScript server directly without a separate build step. To run the compiled production build instead:

```bash
npm run build
npm run start
```

## Features

See [verified format support and chapter repair](FORMAT-SUPPORT.md) for the input/output matrix, preservation rules, short-fixture tests and known verification limits.

- Merge multiple audio files into a single M4B audiobook
- Optionally decode source files to PCM before processing
- Bypass PCM decoding when direct processing is preferred
- Use Faster Whisper by default to identify likely spoken chapter headings and propose chapter timestamps
- Switch to the OpenAI Whisper/PyTorch compatibility backend when troubleshooting requires it
- Skip AI chapter detection when input files are already chapterized
- Review, add, remove, rename, and fine-tune chapter markers in a browser-based interface
- Edit audiobook metadata, including title, author, narrator, cover art, and other supported fields
- Download the best available YouTube audio stream without re-encoding by default and process it through the same workflow
- Preserve original audio files; the app is designed not to overwrite, alter, or automatically delete them
- Run locally as a Node.js web application
- Open-source code available for inspection, learning, testing, and improvement

## Development Note

SwissMouse is not a professionally engineered commercial application. It is a personal project built through experimentation, iterative testing, trial and error, and a considerable amount of AI-assisted development.

Put plainly: this project is heavily “vibe coded.”

The core functionality began as a set of Windows batch files developed for personal audiobook-processing workflows. Gemini was used to help turn those processes into a Node.js web application and expand them into a browser-based interface.

That does not mean the project is unsafe or unusable. It does mean there may be rough edges, unexpected bugs, incomplete error handling, environment-specific assumptions, and features that have not been tested in every possible configuration.

The code is fully open source. Please feel free to inspect it, learn from it, report problems, suggest improvements, or contribute fixes.

If you choose to test the application, use copies of your files and verify the finished audiobook before relying on it for a large, valuable, or irreplaceable collection.

## How It Works

SwissMouse is intended to run locally rather than as a public cloud service.

You start the application on your computer and access its interface through a web browser. The browser provides the GUI, while file processing takes place on your local system.

The application is primarily intended for Windows because its launcher and original workflows are Windows-based. Docker is not currently a supported installation method; this repository does not include maintained Docker configuration or setup instructions.

## Local transcription architecture

Faster Whisper is the default and recommended engine. It runs the selected Whisper model through CTranslate2, uses CPU INT8 on CPU-only systems, and first attempts FP16 acceleration when a compatible NVIDIA GPU is detected. GPU initialization is verified when transcription starts; if it fails, the same job automatically retries on CPU without changing the original audio timeline.

OpenAI Whisper remains available as a compatibility engine. Its PyTorch dependency and `.pt` model files are installed and tracked separately from Faster Whisper's CTranslate2 model snapshots. The Faster Whisper toggle switches execution, the model catalog, downloads, and installed-model status together. Saved choices are respected; new configurations default to Faster Whisper. Hardware is detected from the actual machine.

FFmpeg and FFprobe remain core requirements because audiobook preparation, merging, inspection, encoding, chapter work, and export use them independently of the transcription engine. The Requirements screen describes both engines independently of the active toggle. Select optional components before choosing **Install Selected Missing Requirements**; engine dependencies are included automatically, and core components cannot be deselected. GPU acceleration is optional and unchecked by default. When selected on NVIDIA hardware, its CUDA 12/cuDNN 9 libraries are installed into the private Python environment, without installing a system driver. These libraries follow the [Faster Whisper GPU requirements](https://github.com/SYSTRAN/faster-whisper#gpu). On Windows, the Microsoft Visual C++ runtime may still be required by native Python packages; import and DLL failures are reported in the installer diagnostic log while CPU fallback remains available when possible.

## File Safety

SwissMouse is designed with preservation in mind:

- Source audio files should not be altered
- Original files should not be overwritten
- Nothing should be deleted automatically
- Output and working files should be created separately from source files

Even so, this is work-in-progress software. Always maintain backups and test the application with copies before using it on an important collection.

## Windows Security Notice

Because SwissMouse is not distributed by a registered Windows trusted publisher, Windows SmartScreen may display a warning when you run downloaded batch files, scripts, or executables.

This does not automatically mean the project is harmful. However, download it only from a source you trust. If possible, inspect the included scripts and source code before running them.

### Removing the Windows Download Block

Before extracting a downloaded `.zip` or `.rar` archive:

1. Right-click the downloaded archive.
2. Select **Properties**.
3. On the **General** tab, look for the security section near the bottom of the window.
4. Check the **Unblock** box, if it appears.
5. Click **Apply**, then **OK**.
6. Extract the archive normally.

Unblocking the archive before extraction can prevent Windows from applying its “downloaded from the internet” security marker to extracted files. This may reduce warning prompts when launching included scripts.

## Intended Use

SwissMouse is intended for lawful personal audiobook organization, preservation, conversion, metadata editing, and chaptering of audio that you own or are authorized to process.

If you use YouTube downloads or other online sources, you are responsible for ensuring that your use complies with applicable copyright law, platform terms, and the rights of authors, narrators, publishers, musicians, and other creators.

## Contributing

This is an evolving personal project, and feedback is welcome.

If you find a bug, have an idea for a feature, discover a compatibility issue, or would like to improve the code, please consider opening an issue or submitting a pull request.

Requirements reports runtime dependencies only: green for core tools plus Faster Whisper/CTranslate2, yellow for the compatibility engine or an optional GPU improvement, and red for missing core tools or no installed engine. Manage model weights in Step 1 using the shared Install/Uninstall controls. The Faster Transcription toggle selects the backend-specific catalog and installation state. Optional packages never become mandatory merely because a backend is selected.

System checks are asynchronous and cached on demand (hardware: 10 minutes; package/binary versions: 5 minutes). Opening Requirements reuses those snapshots; **Check again** refreshes them. Installation invalidates affected dependency snapshots, with native import checks performed only during deliberate installation verification or transcription. Ordinary status reads never import Whisper, PyTorch, or CTranslate2. CUDA package detection is not a compatibility guarantee; transcription still tests acceleration and falls back to CPU.

Model discovery uses asynchronous filesystem access when opening or refreshing the model area. Background download polling reads in-memory progress without scanning model folders. Other model reads share a one-minute snapshot; model operations update or invalidate the affected backend's state.
