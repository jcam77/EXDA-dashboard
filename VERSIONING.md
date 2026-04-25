# Versioning Guide

This repo uses a single app folder and release tags (no versioned folders).

## Recommended Flow
1. Commit your work:
```bash
git add .
git commit -m "Your message"
```
2. Push your branch:
```bash
git push origin <branch>
```
3. Sync `package.json` version (so `npm run ...` shows the same release family):
```bash
npm version <semver> --no-git-tag-version
git add package.json package-lock.json
git commit -m "Bump app version to <semver>"
git push origin <branch>
```
4. Create and push a release tag:
```bash
git tag -a <tag-name> -m "<tag-name>"
git push origin <tag-name>
```

Examples:
- `desktop-v0.6`
- `browser-v0.1`
- `v1.0.0`

## SemVer Note (NPM)
- `package.json` uses SemVer: `MAJOR.MINOR.PATCH`.
- `0.7` is not a valid npm version.
- Use `0.7.0` as the equivalent of your `0.7` release.
- Tiny fix (no feature change): `0.7.1`.
- New feature: `0.0.0`.
- Breaking change: `1.0.0`.

## Branch-specific Example
### `desktopBasedApp`
```bash
git branch --show-current
git switch desktopBasedApp
git status --short
git add .
git commit -m "Build app update"
git push origin desktopBasedApp
npm version 1.7.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "Bump app version to 1.7.0"
git push origin desktopBasedApp
git tag -a desktop-v1.7.0 -m "desktop-v1.7.0"
git push origin desktop-v1.7.0
git log -1 --stat
```

## Useful Commands
Current version string:
```bash
git describe --tags --always --dirty
```

List tags:
```bash
git tag --list
```

Checkout old tag:
```bash
git checkout <tag>
```
Return to branch:
```bash
git checkout main
```

## Tag Notes
- Commit first, then tag.
- Do not reuse tag names unless you intentionally delete/recreate them.
- Restart the dev server after tagging if you want version labels in UI to update.
