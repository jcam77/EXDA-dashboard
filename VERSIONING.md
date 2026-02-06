# Versioning Guide (Tags + Optional Branches)

This repo uses a **single folder** for the app (no versioned folders).  
Versions are tracked with **git tags**.

## Tags vs Branches (Quick Rule)
- **Tags** = stable snapshots (release points like `v0.0`, `v0.1`, `v1.0`)
- **Branches** = ongoing work (use if changes are risky or long‑running)

**Recommendation:** use **tags** for every stable milestone, and **branches** only when you want a safe sandbox.

## Standard Workflow (Tags Only)
1. Make your changes.
2. Commit them:
```bash
git add .
git commit -m "Your message"
```
3. Tag the version (First time pushing a tag):
```bash
git tag -a v0.0 -m "v0.0"
```
4. Push commits and tag:
```bash
git push origin main
git push origin v0.0
```
5. Local tag delete
```bash
git tag -d v0.0
```
6. Remote (GitHub) tag delete
```bash
git push --delete origin v0.0
```

7. If you moved the tag to a new commit (re‑tagged):

### Main Branch
```bash
git status --short
git add .
git commit -m "Build app Update"
git push origin main
# Only when you want to mark a release:
git tag -a main-v0.0 -m "main-v0.0"
git push origin main-v0.0
git log -1 --stat
```

### desktopBasedApp Branch
```bash
git status --short
git add .
git commit -m "Build app Update"
git push origin desktopBasedApp
# Only when you want to mark a desktop release:
git tag -a desktop-v0.0 -m "desktop-v0.0"
git push origin desktop-v0.0
git log -1 --stat
```

### browserBasedApp Branch
```bash
git status --short
git add .
git commit -m "Build app Update"
git push origin browserBasedApp
# Only when you want to mark a browser release:
git tag -a browser-v0.0 -m "browser-v0.0"
git push origin browser-v0.0
git log -1 --stat
```


## Workflow With a Branch (Optional)
1. Create a branch:
```bash
git checkout -b dev-v0.1
```
2. Work and commit as usual.
3. Merge into main when stable:
```bash
git checkout main
git merge dev-v0.1
```
4. Tag the release:
```bash
git tag -a v0.1 -m "v0.1"
git push origin main
git push origin v0.1
```

## Useful Commands
Check current version tag:
```bash
git describe --tags --always --dirty
```

## Run an Older Version (Tag)
If you want to run version `v0.2` while you are working on `main`:
```bash
git checkout v0.2
run exda
```
When you are done:
```bash
git checkout main
```

If Git says you have uncommitted changes, you can temporarily stash them:
```bash
git stash
git checkout v0.2
run exda
git checkout main
git stash pop
```

List all tags:
```bash
git tag --list
```

Checkout an old version:
```bash
git checkout v0.0
```
(To return to main: `git checkout main`)

## App Version Display
The app reads the git tag using:
```
git describe --tags --always --dirty
```
So after tagging, **restart the dev server** to see the version in the browser tab and Home page.

## Notes
- **Do not reuse tag names.** If you need a new version, create a new tag (e.g., `v0.1`, `v0.2`, `v1.0`).
- Tags are attached to commits. Always **commit first**, then tag.
