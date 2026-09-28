# Licensing and distribution audit — 2026-09-27

## Scope and conclusions

Inspected the current Git index and working source, reachable local Git history, package manifests/lockfile and relevant installed upstream licenses, `server.ts` installers/model routes, runtime selection, launchers, Vite/esbuild configuration, both release scripts, cleanup script, `.gitignore`, and the sole GitHub Actions release workflow. Existing unrelated working changes were preserved. Repository-wide tracked-text searches covered MIT, GPL, LGPL, AGPL, Apache, BSD, proprietary, copyright, license/licence, and notices. There was no existing root license or contradictory SwissMouse license claim. Dependency license fields and audiobook copyright metadata are not SwissMouse license declarations.

SwissMouse now declares **AGPL-3.0-or-later**. `LICENSE` is the verbatim official GNU AGPLv3 text downloaded from `https://www.gnu.org/licenses/agpl-3.0.txt`; the README and package metadata select “or later.” The source notices use SwissMouse contributors as the collective copyright credit, without changing ownership or claiming third-party code. No additional attribution, noncommercial, or hosting condition was added.

## Verified acquisition paths

- **FFmpeg/FFprobe:** `installManagedFfmpeg` in `server.ts` downloads Gyan's essentials ZIP and upstream SHA-256 directly and verifies the archive. The follow-up fix preserves upstream companion files under `runtime/licenses/ffmpeg/<archive-sha256>/` before installing `bin/ffmpeg.exe` and `bin/ffprobe.exe` to `runtime/bin` and removing the successful archive/checksum. Failed installs preserve the local download for retry. PATH discovery prefers a compatible pair in the same directory. No SwissMouse dependency mirror, resource embedding, or FFmpeg package-copy step was found. CI installs Ubuntu FFmpeg for tests only. External acquisition is unchanged.
- **Python:** compatible system base or direct python.org NuGet / python-build-standalone download, extracted into `runtime/python`; venv under `runtime/venv`. Python archives are removed after extraction. No independent digest verification is implemented for the Python download. This is an integrity/maintenance limitation, not evidence of a license violation.
- **Speech packages:** pip installs Faster Whisper, CTranslate2, or OpenAI Whisper into the private venv. Explicit PyTorch selection uses the PyTorch wheel index; installing Whisper can also resolve torch transitively. Optional NVIDIA cuBLAS/cuDNN packages come through pip. Default pip sources can be overridden by user configuration. Packages are not all pinned, so the installed environment's licenses can change.
- **Models:** OpenAI checkpoint downloads validate their SHA-256; Faster Whisper model snapshots come directly from Hugging Face using the configured repository map, without pinned revisions. The legacy `models/whisperx` directory name does not mean WhisperX is currently installed. No models or CUDA DLLs are release inputs.
- **yt-dlp:** direct official GitHub executable/checksum download on Windows, hash validation, local copy in `runtime/bin`, temporary files removed. Source Unlicense must not be confused with the GPLv3-or-later combined upstream Windows executable. No SwissMouse copy is hosted by the current release process.
- **JavaScript:** release first launch runs `npm ci --omit=dev`; source first launch includes build dependencies. Server build marks packages external. Vite embeds React, React DOM, Scheduler, Lucide icons, Tailwind CSS, and its browser helpers, so calling the entire compiled release “SwissMouse code only” would be inaccurate. License notices now accompany those embedded components.
- **Development resources:** CI downloads a hash-verified Audiobookshelf prober to `audio-test-reference`, never the release directory. The tracked PNG logo is the only current tracked binary asset identified; no current tracked executables, archives, models, runtime directories, vendored package trees, fonts, or DLLs were found. Ignored local runtime DLLs/executables and model/cache files are installation state, not evidence of release inclusion. No installer/resource-packaging system beyond the launcher and ZIP builders was found.

Project URLs, license distinctions, and precise acquisition sources are recorded in [THIRD_PARTY.md](THIRD_PARTY.md). External acquisition reduces SwissMouse redistribution scope; it does not certify all upstream binary builds or their terms.

## Published release ZIP inspection

Read the public GitHub releases API and downloaded **all three listed release assets** for ZIP-entry inspection (without executing their contents):

| GitHub tag | Asset | Bytes | Entries | Findings |
| --- | --- | ---: | ---: | --- |
| `v0.1.0-alpha.4` | `SwissMouse-0.1.0-alpha.4.zip` | 2,246,504 | 33 | Compiled app/docs; no runtime, model, node_modules, processing binary, or standalone license/notice file. |
| `0.1.0-alpha.3` | `SwissMouse-0.1.0-alpha.2.zip` | 2,064,327 | 16 | Same exclusions; asset/version naming mismatch. |
| `v0.1.0-alpha.2` | `SwissMouse-0.1.0-alpha.2.zip` | 2,062,411 | 16 | Same exclusions; no standalone license/notice file. |

Source: [SwissMouse releases](https://github.com/Bageena/SwissMouse-Audiobook-Workbench/releases). This is a dated public inventory, not a claim about deleted/private assets. Embedded JavaScript comments were not accepted as proof that all upstream license obligations were satisfied. Existing assets were not changed.

## Corrections made

1. Added the official license, README permissions/obligations, package SPDX metadata, and representative original-source notices. Third-party files and lockfile dependency license values were left intact.
2. Added a Vite build plugin that discovers npm packages from emitted JavaScript chunks and preserves complete LICENSE/COPYING/NOTICE texts. Tailwind and Vite are explicitly included for CSS and virtual helper code. Missing license texts stop the build. This preserves Lucide's Feather MIT attribution as well as its ISC text.
3. Release assembly now carries the preferred SwissMouse source, assets, manifests, configuration, and build/installation scripts alongside the compiled app, so source corresponds to the packaged working tree rather than an assumed tag. It includes the license/audit documents and requires generated bundle notices. It excludes runtime/cache directories and downloaded `tools/yt-dlp`, rejects symlinks and unexpected file types, and copies only shipped example themes. Both existing ZIP paths inherit these changes.

## Manual review and remaining risks

1. **Historical Python redistribution:** commit `30b8cd5` (2026-09-13) added a 5,937,672-byte Linux ELF at `runtime/venv/bin/python`, `python3`, and `python3.10` (same Git blob `3722510a2d31da94f503b243f99c49a51cb90ad7`). A later commit removed it, but it remains in reachable history. That tree contains the executable copies and `pyvenv.cfg`, without an accompanying runtime license. Identify its exact distribution and component notices, then decide how to remediate historical availability. Adding the AGPL does not relicense Python or fix old distributions. No history rewrite was performed.
2. **Older releases:** review the exact embedded dependency versions and notices in the three existing ZIPs and their source correspondence. Rebuild a properly licensed release from a reviewed commit; decide whether to supplement or retire old assets. New local edits do not retroactively update those releases or establish permission from every previous contributor.
3. **Authority and provenance:** the maintainer should confirm rights to license all original contributions and shipped artwork under the stated terms, and review any third-party-derived material. No contributor copyright assignments or comprehensive artwork provenance records were available in the repository. Representative headers are not evidence of exclusive ownership.
4. **FFmpeg local notices — extraction finding fixed:** upstream companion content is now retained intact in an archive-specific directory under `runtime/licenses/ffmpeg`, with original paths. No license text or LGPL/GPL assumption is substituted. Preservation failures prevent installation completion and archive cleanup. Existing installations are not automatically re-downloaded. If offline redistribution is ever introduced, separately review its build-specific notices and source obligations; preserving local notices alone is not a complete redistribution solution.
5. **Python wheels and proprietary GPU components:** PyAV wheels include FFmpeg libraries; PyTorch wheels can include NVIDIA components. Repackaging a populated runtime would require its own inventory and review, even though the release currently excludes it. Check vendor terms for the exact CUDA/cuDNN artifacts. Do not infer universal compatibility merely from a top-level package's MIT/BSD label.
6. **Moving upstream inputs:** pip packages, some download URLs, and Hugging Face revisions are not all pinned. Model ownership/URLs can redirect (the turbo model currently does); revisit cards/licenses and integrity before mirroring or pinning. The Linux-only Python fallback is also used for other non-Windows platforms in current code, so macOS acquisition needs separate technical review.
7. **Hosted modified versions:** a host modifying SwissMouse must implement the applicable section 13 source offer for remote users. This licensing/documentation task adds no new hosted-service deployment or source-offer UI. Independent surrounding services are not automatically covered merely through communication; review actual integration boundaries where uncertain.

## Validation

FFmpeg-preservation follow-up: four archive-fixture tests and six Requirements tests passed, together with type-checking, production build, and release smoke checks. The rebuilt 142-file ZIP excludes FFmpeg/FFprobe and all runtime directories despite both executables being installed in the working tree. Fixtures verify byte-preserving ZIP extraction, separate notices for different archive hashes, invalid paths/duplicates/symlinks, incomplete archives, and preservation failures leaving existing binaries untouched. No real runtime download or installation was performed. The other installers were traced again: no similar selective notice-discard step was found in Python extraction, pip/npm installation, or Hugging Face snapshot acquisition. yt-dlp and direct OpenAI checkpoint downloads do not separately acquire notice sidecars; see [THIRD_PARTY.md](THIRD_PARTY.md#preservation-of-downloaded-runtime-notices). Local Python, Whisper, PyTorch, PyAV, and NVIDIA package license files were inspected as supporting evidence.

Initial licensing-audit validation:

- `npm run lint` and `npm run build` passed. The generated notice file contains complete upstream license text for React, React DOM, Scheduler, Lucide (including Feather), Tailwind, and Vite.
- Assembled 140 files and compared their bytes with the current source/build inputs; no processing executable, DLL, model, archive, runtime directory, or dependency tree was included. The Windows ZIP was also read back and checked against those inputs.
- Negative assembly checks in a temporary fixture confirmed that an unexpected `.exe` and a missing generated notice file each stop release assembly.
- The updated release smoke check passed: packaged license/source files, served notices, webpage, and jobs API. This local smoke check resolved npm dependencies from the workspace; a fresh isolated npm installation and the full audio suite were not rerun for these licensing/build changes.
- The sandbox's `tsx` launcher hit the known `uv_os_get_passwd`/ENOMEM host issue. Assembly was verified with Node 24's native TypeScript support (`node scripts/build-release.ts`); the existing CI invocation remains `npx tsx` on Node 22.

## Changed-file inventory

- `LICENSE`: official, unmodified AGPLv3 text.
- `README.md`: AGPLv3-or-later, commercial use, hosting, architecture boundaries, optional credit, and distribution links.
- `THIRD_PARTY.md`: dependency licenses, origins, acquisition/distribution distinctions, rebuild instructions.
- `LICENSING_AUDIT.md`: this evidence, remediation, and manual-review record.
- `package.json`, `package-lock.json`: root project SPDX license; `package.json` also registers the FFmpeg distribution tests. Unrelated existing script edits retained.
- `server.ts`, `src/main.tsx`: representative SwissMouse copyright/SPDX notices; the FFmpeg-preservation follow-up also updates the server installer. Existing application edits retained.
- `tools/ffmpeg-distribution.ts`, `tools/ffmpeg-distribution.test.ts`: preserve upstream companion content and verify extraction/failure handling with archive fixtures.
- `scripts/third-party-notices.ts`: automatic build-time upstream notice preservation.
- `vite.config.ts`: register that build plugin.
- `scripts/build-release.ts`: license/notices/source inclusion and guarded release inputs.
- `scripts/smoke-release.mjs`: checks packaged license/source files, runtime exclusions, and served third-party notices in the existing release smoke workflow.

Generated `dist/` and `release/` output is ignored and is not source to commit. Downloaded historical ZIPs remain in the ignored audit cache. No dependency installers, model downloads, production publishing, or Git history modifications were run for this audit.
