# Requirements: system-first tools and safe removal

Open **System setup and tools** to see the active source, version and path for each requirement. Core tools are listed separately from recommended transcription, optional acceleration and other optional tools. Hardware and GPU/PyTorch details expand when needed.

## How startup chooses tools

By default, SwissMouse checks the `PATH` inherited by its launcher before using its app-managed copies:

1. FFmpeg and FFprobe: check working supported executables in PATH (release version 5 or later). Use the system pair when both resolve in the same directory; otherwise use `runtime/bin` together. Keeping the pair together also supports yt-dlp's single media-tool-directory setting.
2. yt-dlp: use the first working executable dated 2025.11.12 or later (needed for the Node JavaScript-runtime option), otherwise use the app copy.
3. Python: check 64-bit Python 3.10–3.13 executables in PATH. Each transcription engine uses a **complete importable environment**, including its dependencies. An incomplete system engine falls back to `runtime/venv`; individual packages are never combined across environments. Faster Whisper and regular Whisper may use different interpreters.

Checks are bounded: up to six PATH candidates per executable and three Python candidates. Relative PATH entries, Windows Store aliases and SwissMouse's own runtime are excluded from system discovery. No registry/Conda-environment search or automatic system installation is performed. Date/git FFmpeg builds are recognized through their reported libavformat version (59 or later); unverifiable builds fall back to app tools.

Startup discovery imports Python engines to verify availability, but does not load or download speech models. Subsequent status requests reuse the discovery result and cached capability checks. The chosen paths are used for processing, playback-preview creation, exports, validation, YouTube import and Faster Whisper model downloads. CUDA support is still verified separately; finding a system engine does not guarantee GPU acceleration.

Use **Check again** while idle to rediscover tools. If you changed Windows PATH after starting SwissMouse, restart its terminal/launcher so it inherits the new PATH. Missing/broken candidates appear in **Discovery notes** and the terminal. Paths remain fixed during active work; a disappeared system tool should be rescanned, not silently switched midway through a job.

To retain the old isolated behavior, set `SWISSMOUSE_RUNTIME_MODE=managed` before launching. This disables system discovery. Node/npm launcher selection is unchanged.

## Installing missing components

Select optional tools and click **Install selected missing tools**. Core requirements and selected engine dependencies are included automatically. All package changes stay in SwissMouse's private environment. If a suitable system Python exists but an engine is missing, it can create that isolated environment without downloading another Python. The resulting venv still depends on that base Python remaining installed.

An active system PyTorch build cannot be replaced from this screen. Manage its CPU/CUDA build with its original package manager, then check again. App-managed PyTorch replacement still requires confirmation. System Faster Whisper CUDA libraries likewise belong in its selected Python environment, not SwissMouse's unused private environment.

## Removing optional components

Every installed app-owned optional component offers **Remove app copy**: Faster Whisper, CTranslate2, regular Whisper, PyTorch, NVIDIA CUDA libraries and yt-dlp. This also applies to an unused app backup when a system copy is active.

- Confirm the displayed path and dependency warning. Removing CTranslate2 disables app-managed Faster Whisper; removing PyTorch disables app-managed regular Whisper. GPU-library removal may cause CPU fallback.
- System copies are protected. Remove/update them outside SwissMouse using the installer or package manager that owns them. Core Python, FFmpeg and FFprobe are not removable here.
- Only the selected package(s) or app-local yt-dlp executable are removed. Other dependencies are not automatically swept away. Reinstall missing tools here when needed.
- Downloaded models, projects, audio, metadata and settings are preserved. Use the Models screen to remove speech-model downloads separately.
- Changes are blocked during imports, processing, exports, downloads or another runtime operation. Removal runs to completion rather than being interrupted midway through a package operation.

The execution log and terminal show removal output and errors. Python removal verifies the private interpreter and package ownership first, then checks that the selected distributions are gone. Redirected runtime directories are refused. If a damaged private runtime cannot inspect or uninstall its packages, repair it before retrying. There is no automatic rollback; removed components can be downloaded again.
