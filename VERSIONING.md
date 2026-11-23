# Versioning Guide

This is the EXDA versioning workflow.

## Current Release

- Latest release version: `4.0.1`
- Latest release tag: `browser-MVP-v4.0.1`
- Updated on: `2026-11-23`

## Safe Rule

- develop on a development branch named `<name>-Updates` (for example `CLAUDE-Updates` or `CODEX-Updates`)
- release from `main`
- create the release tag from `main`
- never stage with `git add -A` or `git add .`: stage explicit paths only
- never commit experiment data or project records under `Projects/`

In the commands below, `<dev-branch>` means your development branch.

## Branch Meaning

- `<dev-branch>` (any `*-Updates` branch): development branch
- `main`: stable branch for releases

## Main Workflow

These are the steps:

1. Make changes in `<dev-branch>`.
2. Test the changes in `<dev-branch>`.
3. If the changes work, commit them (explicit paths) and push them to `<dev-branch>`.
4. When you are ready to release, switch to `main`.
5. Pull the latest `main`.
6. Merge `<dev-branch>` into `main`.
7. Push `main`.
8. Bump the version on `main`.
9. Create the release tag from `main`.
10. Push the tag.

Short version:

```text
develop on <dev-branch> -> test -> commit -> merge into main -> bump version on main -> tag on main
```

## What Must Never Be Committed

Project data lives outside the app folder (for example `EXDA-Projects/` and
`EXDA-Projects-Demo/` next to it), so app updates never touch it. `.gitignore`
also excludes, in case data ends up inside the app folder:

- `Projects/` and `Demo Projects/`
- `*.seq`, `*.tpc5`, `*.mf4` anywhere

Project records must never be staged as part of app changes or releases. The
repository is public.

Files that were tracked before these rules existed stay tracked; `.gitignore` only affects
new files.

## Development Steps

Use this while building features:

```bash
git switch <dev-branch>
git status --short --branch
```

Make your changes, test them, then commit and push **explicit paths**:

```bash
git add -- frontend/src/... backend/...
git status --short          # check nothing under Projects/ is staged
git commit -m "Describe the change"
git push origin <dev-branch>
```

Important:

- do not use `git add -A` or `git add .`
- do not create the release tag from `<dev-branch>`
- do not make the public release from `<dev-branch>`

## Release Steps

Use this only when you want to send a version to users.

### 1. Make sure the working tree is clean

Before switching branches:

```bash
git status --short --branch
```

If there are local edits, commit (explicit paths) or move them first.
Do **not** use `git restore .` or `git stash` while project records under `Projects/` are
modified: both rewrite those files and the recorded values would be lost.

Why this matters:

- if `git switch main` fails, you stay on the current branch
- if you stay on `<dev-branch>`, the version bump and tag can be created from the wrong branch

### 2. Switch to `main`

```bash
git switch main
git pull --ff-only origin main
git branch --show-current
```

This must print:

```text
main
```

If Git prints `Aborting`, stop there. You are not on `main`.

### 3. Merge `<dev-branch>` into `main`

```bash
git switch main
git merge <dev-branch>
git push origin main
```

This is the step that moves the tested development work into the release branch.

If there are merge conflicts:

- resolve them first
- complete the merge
- push `main`
- only then continue

### 4. Bump the version on `main`

```bash
npm version <semver> --no-git-tag-version
git add -- package.json package-lock.json
git commit -m "Bump app version to <semver>"
git push origin main
```

### 5. Confirm you are still on `main`

```bash
git branch --show-current
```

This must still print:

```text
main
```

### 6. Create the release tag from `main`

Use the format:

```text
browser-MVP-vMAJOR.MINOR.PATCH
```

Example:

```bash
git tag -a browser-MVP-v3.12.0 -m "browser-MVP-v3.12.0"
git push origin browser-MVP-v3.12.0
```

## Full Release Example

If you run the commands manually (without `./versioning.sh`), update `## Current Release` in this file before committing on `main`.

```bash
git switch <dev-branch>
git status --short --branch
git add -- <explicit app paths>
git commit -m "Release-ready changes"
git push origin <dev-branch>
git status --short --branch          # must be clean before switching
git switch main
git pull --ff-only origin main
git branch --show-current
git merge <dev-branch> -m "Merge <dev-branch> into main"
git push origin main
npm version 3.12.0 --no-git-tag-version
git add -- package.json package-lock.json VERSIONING.md
git commit -m "Prepare release 3.12.0 (browser-MVP-v3.12.0)"
git push origin main
git branch --show-current
git tag -a browser-MVP-v3.12.0 -m "browser-MVP-v3.12.0"
git push origin browser-MVP-v3.12.0
git switch <dev-branch>
git merge main
git push origin <dev-branch>
```

## One-Command Release Script

If you do not want to copy/paste all release commands every time, use `./versioning.sh`
from the repository root, **while on your development branch**.

### How to use `versioning.sh`

```bash
./versioning.sh [--dev-branch <name>] [--dry-run] [<release-tag>]
```

- `<release-tag>`: must end with `vMAJOR.MINOR.PATCH`; prompted for if omitted.
  The app version is taken from it (`browser-MVP-v2.30.1` -> `2.30.1`).
- `--dev-branch <name>`: the development branch. Default: the `DEV_BRANCH` environment
  variable, otherwise the current branch if it is not `main`. It must match `*-Updates`,
  exist locally, and be the branch you are on.
- `--dry-run`: run every check and list what would be staged, without changing anything.
  Run this first.

Examples:

```bash
./versioning.sh --dry-run browser-MVP-v3.12.0
./versioning.sh browser-MVP-v3.12.0
DEV_BRANCH=CLAUDE-Updates ./versioning.sh browser-MVP-v3.12.0
```

### Safety checks

The script stops before staging anything if:

- any file is modified, staged or untracked **outside the allow-list** (`ALLOWED_DIRS` and
  `ALLOWED_FILES` at the top of `versioning.sh`: app code folders and the top-level app
  files). `Projects/` is never allowed. The offending paths are listed.
- any file to be staged is larger than 50 MB (change with `MAX_FILE_MB=<n>`).

It stages only the allowed paths, by name (never `git add -A`), re-checks what was staged,
shows `git diff --cached --stat`, and asks for confirmation:

1. before committing and pushing on `<dev-branch>`;
2. before merging into `main`, bumping, tagging and pushing.

If no terminal is available to ask, it stops before making any change.

### What the script does after confirmation

- commits/pushes the allowed changes on `<dev-branch>`
- merges `<dev-branch>` into `main`
- bumps the version on `main` if needed
- updates `VERSIONING.md` with latest release version, tag, and date
- creates and pushes the tag from `main`
- merges `main` back into `<dev-branch>` and pushes it

## What To Remember

- Develop in `<dev-branch>`
- Test in `<dev-branch>`
- Commit explicit paths to `<dev-branch>`
- Merge into `main`
- Bump version on `main`
- Tag on `main`

## What Not To Do

- do not use `git add -A` or `git add .`
- do not commit anything under `Projects/` together with app changes
- do not tag from `<dev-branch>`
- do not bump the public release version on `<dev-branch>`
- do not continue if `git switch main` fails
- do not ignore an `Aborting` message from Git
- do not reuse an existing tag name unless you intentionally want to replace it

## If Something Goes Wrong

### `git switch main` fails

That usually means you still have local changes.

Check:

```bash
git status --short --branch
```

Then commit (explicit paths) or move the blocking changes. Do not discard modified
project records under `Projects/`.

### You created the version bump on the wrong branch

Check:

```bash
git branch --show-current
```

If it prints your development branch, the version bump was created on the wrong branch.

### You created the tag from the wrong branch

Check:

```bash
git show --no-patch --decorate <tag-name>
```

If the tag was already pushed, be careful. In many cases, creating a new patch version is safer than rewriting a public tag.

### Git prints `non-monotonic index .git/objects/pack/._pack-....idx`

macOS created AppleDouble (`._*`) files inside `.git` (common on external or shared
drives). They are not git data and can be deleted:

```bash
find .git -name '._*' -type f -delete
```

## SemVer Notes

- Bug fix: increase `PATCH`
  Example: `1.17.0` -> `1.17.1`
- Backward-compatible feature: increase `MINOR`
  Example: `1.17.0` -> `1.18.0`
- Breaking change: increase `MAJOR`
  Example: `1.17.0` -> `2.0.0`

## Useful Commands

Show current branch:

```bash
git branch --show-current
```

Show current version string:

```bash
git describe --tags --always --dirty
```

Inspect app version:

```bash
npm pkg get version
```

List browser tags:

```bash
git tag --list 'browser-*'
```
