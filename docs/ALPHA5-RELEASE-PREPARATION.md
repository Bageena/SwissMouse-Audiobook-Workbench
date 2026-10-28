# Alpha 5 release preparation — 2026-10-27

Prepared version: `0.1.0-alpha.5`; intended tag: `v0.1.0-alpha.5`.
This is preparation evidence on Windows, not final maintainer acceptance.
Nothing was pushed, tagged, dispatched or published during preparation.

## Checks

| Check | Result |
| --- | --- |
| Package/lockfile/header version | Alpha 5; release workflow rejects a mismatched input tag or existing tag at another commit. |
| Type-check | `npm.cmd run lint` passed. |
| Production build | Passed; existing large-browser-bundle warning remains. |
| Foundation suite | 55 passed, no failures or skips. |
| Workspace suite | 62 passed, no failures or skips. |
| Audio suite | 403 passed, no failures, 2 optional real-inference tests skipped; 405 total. |
| Audiobookshelf compatibility reference | Workflow's pinned file and SHA-256 checked; parser compatibility test included in the audio run. Reference stays in ignored `.cache/`. |
| Metadata regression | M4A/M4B language read-back included in the passing metadata-write test. |
| Production package | Separate disposable copy installed 93 production packages with `npm ci --omit=dev`; package-local dependency resolution, catalog worker/query, jobs API, webpage and served notices passed the smoke check. |
| Public input audit | Tracked/staged source and assembled package passed; an injected test runtime payload was rejected. |
| Gitleaks 8.30.1 | Staged changes, exported public tree, assembled package and Git history passed with no findings. Final outgoing commits are scanned again after commit/merge. Reports stay local and ignored. |
| Screenshots | Cheese and Forest captured from an isolated empty installation; images visually inspected, with no personal paths, library titles, account data or logs visible. |

The two skipped audio tests require real Whisper/Faster Whisper inference inputs
or runtime configuration. Online YouTube import, full-book transcription, GPU
combinations, physical USB/NAS failures, pristine-machine installation and final
maintainer testing are not established by these checks. CI was prepared but not
dispatched. See the existing verification guides for earlier, separately dated
evidence and limits.

## Corrections found during preparation

- Register the waveform and interactive transcript in the shared panel catalog.
- Preserve the M4A/M4B audio language when remuxing metadata.
- Keep a current Final Check report associated with verified destination paths
  after transfer/cleanup and same-file reorganization. Equivalent contributor
  arrays and empty memberships discovered from sidecars do not stale the check;
  changed contributors still do.
- Update old transfer/Inbox fixtures to contain genuinely matching output tags,
  duration, artwork and sidecars, restore actual source bytes, and recheck after
  rollback. Move eligibility is tested through its current shared component.

## Public file boundaries

The commits and package exclude local job/config/preferences files and backups,
SQLite databases/WALs, downloaded tools, models, dependency installations,
working audio, generated test directories and loose root-level review captures.
Original local files were preserved. New public screenshots are under
`docs/screenshots/`; they replace the old remote README captures.

Source tests, `REQUIREMENTS.md`, first-party installer logic, the npm lockfile,
example themes and source/build instructions are intentional public inputs.
The browser bundle includes licensed dependencies. Paper & Ink SVG adaptations
retain Lucide/Feather notices; Forest photographs have Unsplash source/license
records. These intentional assets are documented in `THIRD_PARTY.md`.

The historical Python executable at commit `30b8cd5` is already an ancestor of
`origin/main`. It is not introduced by the outgoing commits and is absent from
the current source tree/package. History was not rewritten; the earlier
`LICENSING_AUDIT.md` retains this separate historical follow-up.

## Handoff

### Manual chapter-detection rerun follow-up

The chapter editor retained its previous in-memory draft after a successful
Detect chapters rerun, masking the replacement saved by the server. Successful
detection/extraction now clears that retained draft before the project refresh;
failed or cancelled runs do not reach that reset. The existing 13 focused
rerun/editor/API tests, type-check and production build passed. In an isolated
browser project, a manual rerun replaced an old draft with the new Prologue and
Chapter 2, while ordinary screen navigation still retained unsaved manual edits.
The app's normal confirmation was accepted manually during this check.

### Player theme follow-up

Added a separate warm ivory/amber ambient-light layer around the player, enabled
by default. Settings → Appearance / Theme → Player ambient glow saves an on/off
preference. Only fixed decorative light layers drift; the player never scales.
Visibility was increased with an outward warm edge halo, 34% paused brightness
and a smoothed 46–66% playing range. Build/lint and 20 relevant tests passed;
the isolated Slate browser preview verified the clearer light without transforms.
Supported browsers can sample a captured copy of playing audio (256 samples at
10 Hz) to drive a smoothed, capped brightness envelope without rerouting output.
Unsupported capture falls back to subtle ambient drift. Sampling stops when
paused, muted, hidden, disabled or reduced-motion is requested; reduced-motion
also keeps the glow static. No canvas, dependencies or React updates per sample.
The isolated browser verified audio response and saved off/on persistence.
Lint/build, 33 focused unit/render tests and 11 playback/API tests passed.

Same-book source checks now block input separately from unavailable controls,
preventing Stop/Previous from briefly dimming on Play. Unavailable actions retain
their dimmed appearance. Lint, build and all 18 playback tests passed.

Play revalidation now retains the same book's duration, position and playlist
while fetching a fresh manifest, preventing temporary row removal and header
collapse. The numeric elapsed label is retained too. All 17 playback tests,
including a delayed-response regression, lint and build passed.

Removed the shared playback-only scaling glow from every theme to prevent screen
movement when the top player runs. Browser playback confirmed the player has no
animation or glow pseudo-elements while playing. Lint, build and 11 focused
player/header tests passed.

Floating controls, cover art, text and stars now apply across all seven themes.
Light uses an original generated sunlit library background with an ivory and
pearl overlay; Forest retains its snowy pines and existing overlay. Other themes
use their own palette and paper assets. No personal library data or external
photograph was used for the new image; its prompt is recorded beside the asset.
Slate's lake revision preserves the mountain/cloud scene, changes the water to a
Lake Crescent-inspired turquoise-to-deep-blue shift, and substantially reduces
the right-side overlay. Pale shadowed timing labels remain readable over the
deeper water. Original generated artwork and research sources are recorded
beside the asset; no external photograph is redistributed.
Slate now uses a medium smoky blue-grey workspace, pewter panels, darker header
strips and muted copper accents. Its original mountain-lake player artwork uses
a silver/smoky-blue overlay. The isolated browser preview, lint, build and 22
focused player/header/theme tests passed.
Blue's workspace adds a deeper sea-glass backdrop, pearl panel interiors, broad
faint shadows and clearer aqua fields/selections. Player, header strip and workflow
note colors are preserved. The isolated browser preview, lint and build passed.
Blue now uses a soft ocean palette throughout: pale aqua surfaces, misty ivory
highlights, sea-glass accents and slate text, with matching waveform/chapter
highlights. Its original misty-ocean player artwork and floating details were
checked in the isolated browser project. Lint, build and 22 focused tests passed.
Parchment additionally uses original writing-desk/map artwork, an ivory-to-honey
and sepia overlay, warm brown shadows, cream highlights and antique-gold stars.
Its final player appearance was checked with synthetic metadata in the browser.
All seven themes were checked in an isolated synthetic browser project. Lint,
the production build and 22 focused player/header/theme tests passed.

Complete final testing and commit any fixes, then follow
[the release command and packaging guide](RELEASING.md). The release notes are
[prepared here](releases/alpha5.md). Package files remain generated and ignored.
