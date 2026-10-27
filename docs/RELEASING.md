# Preparing Alpha 5

Version: `0.1.0-alpha.5` · release tag: `v0.1.0-alpha.5`.

The source is prepared for release; final maintainer testing is still required.
The checked-in release notes describe the prerelease, not a completed acceptance
run. Do not publish until that testing is complete.

## After final testing

From the repository on `main`, review and commit any testing fixes, then:

```powershell
git status --short
git push origin main
```

Run the existing **Build release** GitHub Actions workflow on the pushed `main`
commit with the exact tag above. With GitHub CLI installed and authenticated:

```powershell
gh workflow run release.yml --ref main -f tag=v0.1.0-alpha.5
```

Alternatively open Actions → Build release → Run workflow, select `main`, and
enter `v0.1.0-alpha.5`. The workflow verifies the tag/package/lockfile versions,
checks types, builds, runs the audio suite, assembles the ZIP, installs production
dependencies in an isolated copy, smoke-tests it, and publishes a prerelease
using [the prepared notes](releases/alpha5.md). It uses the selected commit SHA.
An existing tag pointing to another commit is rejected.

GitHub CLI is not required to run the workflow through the website. No tag,
push, workflow dispatch, or public release is performed during preparation.

## Local package rehearsal

```powershell
npm.cmd ci --include=dev
npm.cmd run lint
npm.cmd run build
npm.cmd run test:foundations
npm.cmd run test:workspace
npx.cmd tsx scripts/build-release.ts
node scripts/audit-release.mjs
node scripts/audit-release.mjs release/SwissMouse-0.1.0-alpha.5
```

The assembled folder is `release/SwissMouse-0.1.0-alpha.5`. It is generated and
ignored, as are `dist/` and downloaded dependencies. Smoke-test a disposable copy
with its own `npm ci --omit=dev` installation; the smoke server writes empty local
state, so do not use a folder containing real books for the smoke check.

The assembler includes application source, documentation/screenshots, compiled
output, licenses, notices, tests and example themes. It excludes downloaded
processing tools, models, dependency trees, personal state and root-level review
captures. Intentional licensed browser dependencies, adapted icons and theme
photos are documented in [THIRD_PARTY.md](../THIRD_PARTY.md).

## Secrets and file review

Run Gitleaks after staging changes and again after the final commits:

```powershell
gitleaks git . --staged --redact
gitleaks git . --log-opts="origin/main..HEAD" --redact
git diff --cached --name-only
git log --oneline origin/main..HEAD
```

Review the complete committed file list and assembled package as well: Gitleaks
does not identify every personal path, private book, or licensing problem.
Keep local scan reports in ignored `.gitleaks-report*.json` files. Historical Git
objects are separate from the newly prepared source and package; known historic
distribution issues remain documented in [LICENSING_AUDIT.md](../LICENSING_AUDIT.md).

`scripts/prepare-public-release.ps1` is a **destructive local cleanup tool** that
removes data/runtime directories. It is not needed for committing or packaging
and must not be run against a working installation with personal data.
