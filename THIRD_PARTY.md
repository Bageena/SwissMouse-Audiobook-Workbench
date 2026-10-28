# Third-party software

SwissMouse's original source code is licensed under **AGPL-3.0-or-later**, as described in [README.md](README.md) and [LICENSE](LICENSE). External projects retain their own copyright and licenses. SwissMouse's license does not replace them or apply to users' audiobooks, artwork, or model files merely because the app processes them.

## Distribution model

The release contains SwissMouse source, compiled application files, documentation, and the shipped example themes. It does **not** contain installed processing runtimes, Python packages, CUDA libraries, model caches, or `node_modules`. The browser build necessarily includes some third-party JavaScript, icons, and CSS. Its full upstream notices are generated as `dist/THIRD_PARTY_NOTICES.txt` during `npm run build` and included in the ZIP. The server build uses esbuild's `--packages=external`; server npm packages are installed separately on first launch using `npm ci --omit=dev`.

The Requirements screen first discovers compatible system tools. When the user chooses installation, downloads go directly from the external sources below to the user's machine. No SwissMouse-hosted dependency mirror is configured. npm/pip and Hugging Face can honor user-configured registries, indexes, mirrors, proxies, or caches. A download is not by itself proof of license compliance; the exact artifact and its bundled components still matter.

Never publish a ZIP of an already used installation. `runtime/`, `models/`, `.cache/`, `node_modules/`, downloaded media, and local state are excluded by the release builder. Copying those directories to other people would be a different distribution and requires an artifact-specific review of notices, source obligations, and any vendor terms.

## Processing tools and models

| Project | Purpose and license | How it reaches the user |
| --- | --- | --- |
| [FFmpeg / FFprobe](https://ffmpeg.org/) | Audio conversion, probing, previews, and export. [FFmpeg licensing](https://ffmpeg.org/legal.html) depends on the build: LGPL-2.1-or-later by default; optional GPL components change the applicable terms. The selected [Gyan essentials builds](https://www.gyan.dev/ffmpeg/builds/) are GPLv3 builds; the installer does not assume that license for every build. | Compatible system pair, or direct Windows download of `ffmpeg-release-essentials.zip` and its SHA-256 from Gyan. The two executables go in `runtime/bin`. Upstream companion files (including licenses, copyright, notices, readmes, and documentation) are preserved byte-for-byte, with archive paths intact, under `runtime/licenses/ffmpeg/<archive-sha256>/`. Binary/library/debug payloads are excluded from that companion directory. Neither binaries nor these local installation files are included in SwissMouse ZIPs. Automatic installation on other OSes is not implemented. |
| [Faster Whisper](https://github.com/SYSTRAN/faster-whisper) | Speech transcription; MIT. | Existing complete Python environment or `pip install faster-whisper` into `runtime/venv`, normally from PyPI. Its dependencies also arrive through pip. Not shipped in SwissMouse. |
| [CTranslate2](https://github.com/OpenNMT/CTranslate2) | Faster Whisper inference engine; MIT, with separately licensed components in binary wheels. | System environment or pip (`ctranslate2`); not shipped. |
| [PyAV](https://github.com/PyAV-Org/PyAV) | Faster Whisper's audio support; BSD-3-Clause for PyAV itself. Binary wheels bundle FFmpeg libraries with their own build-dependent licenses. | Transitive pip dependency. The absence of FFmpeg executables in the SwissMouse ZIP does not mean the installed Python environment contains no FFmpeg code. Do not redistribute the venv without reviewing the wheel and its libraries. |
| [OpenAI Whisper](https://github.com/openai/whisper) | Compatibility transcription backend; MIT for code and released model weights. | System environment or `pip install openai-whisper`, normally from PyPI. No package or weights are shipped. |
| [PyTorch](https://github.com/pytorch/pytorch) | Whisper inference; BSD-style license plus the project's [third-party notices](https://github.com/pytorch/pytorch/blob/main/NOTICE). Wheel components can have additional terms. | System environment, transitive pip resolution, or explicit `torch==2.8.0+cpu/cu126/cu128` installation from `https://download.pytorch.org/whl/<variant>`. The direct build-selection path is pinned; a transitive install by Whisper is not the same pinned path. Not shipped. |
| [NVIDIA CUDA libraries](https://developer.nvidia.com/cuda-toolkit) / [cuDNN](https://docs.nvidia.com/deeplearning/cudnn/backend/latest/reference/eula.html) | Optional GPU support. NVIDIA proprietary license/EULA terms apply; these are not AGPL or uniformly open source. | User-selected pip installation of `nvidia-cublas-cu12` and `nvidia-cudnn-cu12>=9,<10`, or libraries delivered by upstream PyTorch wheels. SwissMouse does not ship them or install a GPU driver. Review exact vendor redistribution terms before any offline bundle. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp#licensing) | YouTube inspection/import. Source is Unlicense; the downloaded PyInstaller Windows executable includes GPLv3-or-later components and is distributed by upstream under GPLv3-or-later, with further third-party notices. | System executable or direct `yt-dlp.exe` and `SHA2-256SUMS` download from `github.com/yt-dlp/yt-dlp/releases/latest`. Installed locally in `runtime/bin`; not shipped by SwissMouse. Uses the user's Node.js for JavaScript execution. |
| [CPython](https://www.python.org/) | Python runtime; [PSF license and historical/component notices](https://docs.python.org/3/license.html). | System Python 3.10–3.13, or direct Windows [python 3.10.11 NuGet package](https://www.nuget.org/packages/python/3.10.11). The non-Windows fallback URL targets the established `indygreg/python-build-standalone` Linux x86_64 3.10.15 build dated 20241016; its [component licenses](https://github.com/astral-sh/python-build-standalone/blob/main/LICENSE) also matter. Extracted locally, then a private venv is created. No runtime shipped in current ZIPs; historical Git exception is documented in the audit. |
| [pip](https://pip.pypa.io/) and Python dependencies | Package installation and supporting libraries. pip is MIT; packages and their bundled libraries have individual licenses. | Provided by Python/venv and installed separately from package repositories. Wheel license directories remain in the local installation. This table is not an exhaustive Python environment SBOM. |
| [OpenAI Whisper checkpoints](https://github.com/openai/whisper#license) | MIT model weights: tiny, base, small, medium, large-v3, large-v3-turbo. | Direct downloads from OpenAI's `openaipublic.azureedge.net/main/whisper/models/` URLs into `models/openai-whisper`; checksums are verified. Not shipped. |
| [Systran converted models](https://huggingface.co/Systran) and [large-v3-turbo conversion](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo) | Faster Whisper weights. Reviewed model cards declare MIT; each repository's files and revision are authoritative. | Hugging Face `snapshot_download` for `Systran/faster-whisper-{tiny,base,small,medium,large-v3}` or `mobiuslabsgmbh/faster-whisper-large-v3-turbo`, cached under `models/whisperx`. The latter URL currently redirects to `dropbox-dash/faster-whisper-large-v3-turbo`. Revisions are not pinned. Faster Whisper can also download its configured model when loading. Not shipped. |
| [WhisperX](https://github.com/m-bain/whisperX) | Historical backend; BSD-2-Clause for the project, with independent dependency/model terms. | Legacy constants and an unused compatibility function remain; the current Requirements installer does not install WhisperX, torchaudio, or torchvision explicitly. The `models/whisperx` name now also holds Faster Whisper caches. Existing old environments are local state, not release inputs. |

## Preservation of downloaded runtime notices

FFmpeg installation completes companion-file preservation before replacing the active executables or deleting the downloaded archive. A failed preservation step leaves the archive for retry/review. The archive hash separates different upstream distributions, so an upgrade does not overwrite another build's license files. The installer does not synthesize a license or require a particular license filename. Existing installations are not changed retroactively; preservation occurs on subsequent FFmpeg installation/repair that actually extracts an archive. Compatible system FFmpeg installations remain managed externally.

The other acquisition paths were checked for selective notice removal:

- Python ZIP/tar archives are extracted in full (the Linux tar extraction removes the enclosing path component, not selected license files). The installed Windows runtime retains `runtime/python/tools/LICENSE.txt`.
- pip and npm handle their normal package installations; SwissMouse does not strip their LICENSE/NOTICE or package metadata files. Local installed packages retain upstream license files, including PyAV, Whisper, PyTorch and CUDA package notices where supplied.
- Hugging Face `snapshot_download` is called without file filters, preserving repository companion files when supplied. OpenAI's checkpoint path downloads a single `.pt` file, without acquiring a separate notice sidecar.
- yt-dlp downloads a standalone executable and checksum, not an archive whose notice files are discarded. SwissMouse preserves the executable intact but does **not** separately download upstream `LICENSE`/`THIRD_PARTY_LICENSES.txt`. This is a notice-acquisition gap, distinct from the fixed FFmpeg extraction issue; no yt-dlp behavior was changed here.

This verifies SwissMouse's extraction/installation logic and available local files, not the completeness of every upstream package or embedded executable notice.

## JavaScript, icons, and build tools

The npm lockfile records exact package versions, registry URLs, integrity hashes, and available license metadata. Metadata is an inventory aid, not a substitute for full upstream license text.

| Project | Purpose / license | Distribution |
| --- | --- | --- |
| [React / React DOM](https://github.com/facebook/react) and Scheduler | Browser UI and scheduling; MIT. | Browser code bundled. Full notices generated from installed packages. npm also installs runtime dependencies separately. |
| [Lucide React](https://lucide.dev/license) | Icons; ISC with MIT notices for Feather-derived icons. | Selected icons bundled. The entire upstream LICENSE, including Feather attribution, is preserved in generated notices. |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | UI styles; MIT. | Generated CSS and preflight styles included; notice preserved. Compiler installed by npm for builds. |
| [Vite](https://github.com/vitejs/vite) | Build/dev server and small browser helpers; MIT with additional upstream third-party notices. | Compiler not shipped; browser helpers included. Full Vite notice file preserved conservatively. |
| [Express](https://expressjs.com/), [cors](https://github.com/expressjs/cors), [Multer](https://github.com/expressjs/multer), [adm-zip](https://github.com/cthackers/adm-zip) | Server, HTTP/CORS, uploads, ZIP extraction; MIT. | External to compiled server; acquired through locked npm installation with their dependency notices. |
| [saxes](https://github.com/lddubeau/saxes) and [xmlchars](https://github.com/lddubeau/xmlchars) | Local playlist/chapter XML parsing; ISC and MIT respectively. | External to compiled server; installed through locked npm dependencies with their upstream license files. |
| [Node.js](https://nodejs.org/) / npm | Application runtime/package installation; Node.js MIT plus bundled component licenses; npm Artistic-2.0 plus dependency licenses. | Installed separately by the user. Launcher recognizes `runtime/node` if manually provided, but SwissMouse has no Node downloader and excludes this directory from releases. |
| [TypeScript](https://github.com/microsoft/TypeScript), [esbuild](https://github.com/evanw/esbuild), [tsx](https://github.com/privatenumber/tsx), Vite/React/Tailwind plugins and type packages | Build/development tools; TypeScript Apache-2.0; esbuild/tsx and most plugins/types MIT. Transitive build dependencies also include ISC, BSD-3-Clause, MPL-2.0 (Lightning CSS), CC-BY-4.0 (caniuse-lite), and Apache-2.0. | npm installs them for development/builds; their executables and package trees are not copied into the release. Generated output does not automatically inherit compiler licenses. Review copied code/data on build changes. |
| [Audiobookshelf](https://github.com/advplyr/audiobookshelf) | Independent metadata compatibility reference in CI; GPL-3.0 project. | Workflow downloads one hash-verified `prober.js` at commit `64e9ac9d8f27353f9f588cb4c70cb5b0b6b2989c` into `audio-test-reference`. Test-only, excluded from the package. |

The current lockfile omits license fields for `busboy` and `streamsearch`; their installed upstream LICENSE files specify MIT. No dependency license fields were rewritten to SwissMouse's license. For shipping additional modules, offline packages, custom themes/assets, or models, review that exact artifact rather than assuming this table covers it.

## Rebuilding and publishing

### Theme artwork and adapted icons

The Paper & Ink utility SVGs adapt Lucide geometry. Their provenance is recorded in
`src/assets/paper-ink/manifest.json`; the full Lucide/Feather notice is retained in
`src/assets/paper-ink/LUCIDE-LICENSE.txt`, in addition to the browser build notices.
These are intentional licensed assets, not a copied dependency installation.

Forest photographs use the [Unsplash license](https://unsplash.com/license).
Patrick Hendry's snowy pines photo and the moss image have source records beside
the files in `src/assets/textures/forest-snow-pines-source.md` and
`forest-moss-source.md`. They retain their own license rather than the source-code
AGPL. The generated oak desktop has its creation record in
`src/assets/textures/Cheese/old-oak-desk-v1.md`. No font binaries are shipped.

Parchment's writing-desk player background is original built-in imagegen artwork.
Its final prompt is recorded in `src/assets/textures/parchment-writing-desk-v1-source.md`;
no external photograph, real map or personal library data was supplied.

Light's sunlit-library player background was generated with the built-in imagegen
tool. Its creation details and final prompt are recorded in
`src/assets/textures/light-sunlit-library-v1-source.md`; no external photograph or
user library image was used.

From the included source root with Node.js 22 and npm, run `npm ci --include=dev`, then `npm run build`. The Vite notice generator fails when a bundled package has no recognized license text; review new packages rather than bypassing the failure. `npx tsx scripts/build-release.ts` assembles the release and requires generated notices. Both the Windows build script and GitHub workflow use this assembler.

Keep `LICENSE`, source/build scripts, `THIRD_PARTY.md`, and `dist/THIRD_PARTY_NOTICES.txt` with the distribution. Publish from a clean checkout; do not inject personal/custom themes into the example-theme directories. See [LICENSING_AUDIT.md](LICENSING_AUDIT.md) for the dated evidence, limitations, and historical follow-up.
