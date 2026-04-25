# Versioning Guide

EXDA now uses a simplified branch model:

- `main`: stable branch and release source
- `CODEX-Updates`: ongoing work before merge to `main`

The app is currently aligned to:

- `package.json` version: `1.8.0`
- latest release tag: `desktop-v1.8.0`

## Release Rules

- Keep `package.json` and `package-lock.json` in sync.
- Create release tags from `main`.
- Use browser-first release tags in the format `browser-vMAJOR.MINOR.PATCH`.
- Keep existing `desktop-v...` tags as historical release records.

## Tag Transition Notes

- `browser-v0.0` is a historical tag from the old branch layout.
- Existing `desktop-v...` tags remain valid historical releases and should not be renamed.
- The next browser-first release should use `browser-v1.9.0`.
- From this point forward, use `browser-v...` tags for new EXDA releases.

## Recommended Flow

1. Work on `CODEX-Updates`:

```bash
git switch CODEX-Updates
git status --short
```

2. Commit and push your changes:

```bash
git switch CODEX-Updates
git add .
git commit -m "update"
git push origin CODEX-Updates
```

3. When the app is ready for release, merge into `main`.

4. Bump the version on `main`:

```bash
git switch main
git pull origin main
npm version <semver> --no-git-tag-version
git add package.json package-lock.json
git commit -m "Bump app version to <semver>"
git push origin main
```

5. Create and push the release tag from `main`:

```bash
git tag -a browser-v<semver> -m "browser-v<semver>"
git push origin browser-v<semver>
```

Example:

```bash
git switch main
git pull origin main
npm version 1.18.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "Bump app version to 1.18.0"
git push origin main
git tag -a browser-v1.18.0 -m "browser-v1.18.0"
git push origin browser-v1.18.0
```

## SemVer Notes

- npm versions must use `MAJOR.MINOR.PATCH`.
- Bug fix: increase `PATCH` (`1.8.0` -> `1.8.1`)
- Backward-compatible feature: increase `MINOR` (`1.8.0` -> `1.9.0`)
- Breaking change: increase `MAJOR` (`1.8.0` -> `2.0.0`)

## Useful Commands

Show current version string:

```bash
git describe --tags --always --dirty
```

List browser-first release tags:

```bash
git tag --list 'browser-v*'
```

List historical desktop release tags:

```bash
git tag --list 'desktop-v*'
```

Inspect the current app version:

```bash
npm pkg get version
```

Checkout a specific release:

```bash
git checkout desktop-v1.8.0
```

Return to the stable branch:

```bash
git checkout main
```

## Notes

- Commit first, then tag.
- Do not reuse tag names unless you intentionally delete and recreate them.
- Restart the dev server after a version bump if you want version labels in the UI to refresh.
