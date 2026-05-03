# Versioning Guide

This is the EXDA versioning workflow.

## Current Release

- Latest release version: `2.13.0`
- Latest release tag: `browser-MVP-v2.13.0`
- Updated on: `2026-05-03`
The safe rule is:

- develop on `CODEX-Updates`
- release from `main`
- create the release tag from `main`

## Branch Meaning

- `CODEX-Updates`: development branch
- `main`: stable branch for releases

## Main Workflow

These are the steps:

1. Make changes in `CODEX-Updates`.
2. Test the changes in `CODEX-Updates`.
3. If the changes work, commit and push them to `CODEX-Updates`.
4. When you are ready to release, switch to `main`.
5. Pull the latest `main`.
6. Merge `CODEX-Updates` into `main`.
7. Push `main`.
8. Bump the version on `main`.
9. Create the release tag from `main`.
10. Push the tag.

Short version:

```text
develop on CODEX-Updates -> test -> commit -> merge into main -> bump version on main -> tag on main
```

## Development Steps

Use this while building features:

```bash
git switch CODEX-Updates
git status --short --branch
```

Make your changes, test them, then commit and push:

```bash
git add .
git commit -m "update"
git push origin CODEX-Updates
```

Important:

- do not create the release tag from `CODEX-Updates`
- do not make the public release from `CODEX-Updates`

## Release Steps

Use this only when you want to send a version to users.

### 1. Make sure the working tree is clean

Before switching branches:

```bash
git status --short --branch
```

If there are local edits, clean them first.

If you want to discard all local unstaged changes:

```bash
git restore .
```

Why this matters:

- if `git switch main` fails, you stay on the current branch
- if you stay on `CODEX-Updates`, the version bump and tag can be created from the wrong branch

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

### 3. Merge `CODEX-Updates` into `main`

First switch to `main`, then merge `CODEX-Updates` into it:

```bash
git switch main
git merge CODEX-Updates
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
git add package.json package-lock.json
git commit -m "Bump app version to <semver>"
git push origin main
```

Example:

```bash
npm version 1.18.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "Bump app version to 1.18.0"
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
browser-vMAJOR.MINOR.PATCH
```

Example:

```bash
git tag -a browser-v1.18.0 -m "browser-v1.18.0"
git push origin browser-v1.18.0
```

## Full Release Example

If you run the commands manually (without `./release.sh`), update `## Current Release` in this file before committing on `main`.

```bash
git switch CODEX-Updates
git status --short --branch
git add .
git commit -m "Release-ready changes"
git push origin CODEX-Updates
git status --short --branch
git restore .
git switch main
git pull --ff-only origin main
git branch --show-current
git merge CODEX-Updates -m "Merge CODEX-Updates into main"
git push origin main
npm version 2.10.0 --no-git-tag-version
git add package.json package-lock.json VERSIONING.md
git commit -m "Prepare release 2.10.0 (browser-MVP-v2.10.0)"
git push origin main
git branch --show-current
git tag -a browser-MVP-v2.10.0 -m "browser-MVP-v2.10.0"
git push origin browser-MVP-v2.10.0
git switch CODEX-Updates
git merge main
git push origin CODEX-Updates
```

## One-Command Release Script

If you do not want to copy/paste all release commands every time, use:

```bash
./release.sh
```

The script will:

- show current branch, current version, and latest tag
- ask only for the new release tag (must end with `vMAJOR.MINOR.PATCH`)
- auto-detect the new app version from the tag
- run the full release flow:
  - commit/push `CODEX-Updates` changes
  - merge `CODEX-Updates` into `main`
  - bump version on `main` if needed
  - update `VERSIONING.md` with latest release version, tag, and date
  - create and push the tag from `main`
  - merge `main` back into `CODEX-Updates`

## What To Remember

- Develop in `CODEX-Updates`
- Test in `CODEX-Updates`
- Commit to `CODEX-Updates`
- Merge into `main`
- Bump version on `main`
- Tag on `main`

## What Not To Do

- do not tag from `CODEX-Updates`
- do not bump the public release version on `CODEX-Updates`
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

Then restore, commit, or stash the blocking changes.

If you want to discard all local unstaged changes:

```bash
git restore .
```

### You created the version bump on the wrong branch

Check:

```bash
git branch --show-current
```

If it says `CODEX-Updates`, the version bump was created on the wrong branch.

### You created the tag from the wrong branch

Check:

```bash
git show --no-patch --decorate <tag-name>
```

If the tag was already pushed, be careful. In many cases, creating a new patch version is safer than rewriting a public tag.

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
git tag --list 'browser-v*'
```
