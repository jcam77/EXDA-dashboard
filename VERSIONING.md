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
3. Create and push a release tag:
```bash
git tag -a <tag-name> -m "<tag-name>"
git push origin <tag-name>
```

Examples:
- `desktop-v0.6`
- `browser-v0.1`
- `v1.0.0`

## Branch-specific Example
### `desktopBasedApp`
```bash
git branch --show-current
git switch desktopBasedApp
git status --short
git add .
git commit -m "Build app update"
git push origin desktopBasedApp
git tag -a desktop-v0.7 -m "desktop-v0.7"
git push origin desktop-v0.7
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
