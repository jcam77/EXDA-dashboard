#!/usr/bin/env bash
#
# EXDA release assistant.
#
# Usage:
#   ./versioning.sh [--dev-branch <name>] [--dry-run] [<release-tag>]
#
#   <release-tag>        must end with vMAJOR.MINOR.PATCH (e.g. browser-MVP-v3.12.0);
#                        prompted for if omitted.
#   --dev-branch <name>  development branch to release from (must match *-Updates).
#                        Default: $DEV_BRANCH, else the current branch if it is not main.
#   --dry-run            run all safety checks and show what would be staged,
#                        without committing, merging, tagging or pushing.
#
# Safety rules (see EXDA-Check.md, Part D):
#   - Never stages with `git add -A` / `git add .`. Only paths in ALLOWED_DIRS and
#     ALLOWED_FILES below are staged, by explicit path.
#   - Aborts if anything is changed, untracked or staged outside those paths
#     (Projects/ is never allowed).
#   - Aborts if any file to be staged is larger than MAX_FILE_MB (default 50).
#   - Asks for confirmation before every commit/push step; aborts if it cannot ask.
#
# Works with bash 3.2 (macOS default): no mapfile, empty arrays guarded under set -u.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# --- Paths that the script is allowed to stage ------------------------------
# Directories (everything below them) and individual top-level files.
# Projects/, Demo Projects/, appsTestEnviroment/ and experiment data are
# deliberately NOT listed. Add paths here only for application code/docs.
ALLOWED_DIRS=(
  backend
  frontend
  electron
  scripts
  tests
  config
  docs
)
ALLOWED_FILES=(
  .gitattributes
  .gitignore
  .ollama_hostname.example
  BASHRC_SETUP.md
  BUILD_LINUX.md
  BUILD_MACOS.md
  BUILD_WINDOWS.md
  LICENSE
  PACKAGING.md
  PRIVACY_POLICY.md
  README.md
  RUN_EXDA.md
  Run-EXDA-LINUX.sh
  Run-EXDA-MAC.command
  Run-EXDA-WIN.bat
  Setup-EXDA-LINUX.sh
  Setup-EXDA-MAC.command
  Setup-EXDA-WIN.bat
  VERSIONING.md
  copilot-instructions.md
  design_guidelines.json
  find_and_run_backend.sh
  package-lock.json
  package.json
  playwright.config.ts
  run
  run.cmd
  versioning.sh
)

MAX_FILE_MB="${MAX_FILE_MB:-50}"
MAX_FILE_BYTES=$((MAX_FILE_MB * 1024 * 1024))

die() {
  echo
  echo "ABORTED: $*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1"
    exit 1
  fi
}

run_cmd() {
  local status=0

  echo
  echo ">> $*"
  if [[ "${1:-}" == "git" ]]; then
    ensure_git_index_lock_clear
  fi

  if "$@"; then
    return 0
  else
    status=$?
  fi
  if [[ "${1:-}" == "git" && -e ".git/index.lock" ]]; then
    echo "Git command failed with an index lock present. Retrying once..."
    if ! ensure_git_index_lock_clear; then
      return "$status"
    fi
    if "$@"; then
      return 0
    else
      status=$?
    fi
  fi

  return "$status"
}

ensure_git_index_lock_clear() {
  local lock_file=".git/index.lock"

  if [[ ! -e "$lock_file" ]]; then
    return 0
  fi

  echo "Git lock detected: ${lock_file}. Waiting briefly..."
  for _ in 1 2 3 4 5; do
    sleep 1
    if [[ ! -e "$lock_file" ]]; then
      echo "Git lock cleared."
      return 0
    fi
  done

  if command -v lsof >/dev/null 2>&1 && lsof "$lock_file" >/dev/null 2>&1; then
    echo "Lock is still held by another process. Finish/close that process, then rerun."
    return 1
  fi

  echo "Stale git lock detected. Removing ${lock_file}."
  rm -f "$lock_file"
}

# Ask a yes/no question on the terminal. Returns 0 only for an explicit "y"/"yes".
# Aborts the script if no terminal is available to ask on.
confirm() {
  local prompt="$1"
  local answer=""

  if ! (: </dev/tty) 2>/dev/null; then
    die "Confirmation required but no terminal is available. Run this script interactively."
  fi
  read -r -p "${prompt} [y/N]: " answer </dev/tty || answer=""
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" || "$answer" == "YES" ]]
}

is_allowed_path() {
  local path="$1"
  local entry

  case "$path" in
    Projects/* | Projects) return 1 ;;
  esac
  for entry in "${ALLOWED_FILES[@]}"; do
    [[ "$path" == "$entry" ]] && return 0
  done
  for entry in "${ALLOWED_DIRS[@]}"; do
    [[ "$path" == "$entry"/* ]] && return 0
  done
  return 1
}

# Print, NUL-separated and de-duplicated, every path that is changed in the
# working tree or index, or untracked (not ignored).
list_changed_paths() {
  {
    git diff -z --name-only --no-renames
    git diff -z --name-only --no-renames --cached
    git ls-files -z --others --exclude-standard
  } | sort -z -u
}

# Print, NUL-separated, every path currently staged.
list_staged_paths() {
  git diff -z --name-only --no-renames --cached
}

update_versioning_file() {
  local new_version="$1"
  local tag_name="$2"
  local release_date="$3"

  node - "$new_version" "$tag_name" "$release_date" <<'NODE'
const fs = require('fs');
const path = 'VERSIONING.md';
const [newVersion, tagName, releaseDate] = process.argv.slice(2);

let text = fs.readFileSync(path, 'utf8');
const section = [
  '## Current Release',
  '',
  `- Latest release version: \`${newVersion}\``,
  `- Latest release tag: \`${tagName}\``,
  `- Updated on: \`${releaseDate}\``,
  '',
].join('\n');

const currentReleaseBlock = /(?:^|\n)## Current Release\n\n- Latest release version: `[^`]*`\n- Latest release tag: `[^`]*`\n- Updated on: `[^`]*`\n*/g;
text = text.replace(currentReleaseBlock, '\n');

const marker = 'This is the EXDA versioning workflow.';
if (text.includes(marker)) {
  text = text.replace(marker, `${marker}\n\n${section.trimEnd()}`);
} else {
  text = `${section}${text}`;
}

text = text.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(path, text);
NODE
}

# --- Arguments --------------------------------------------------------------

opt_dev_branch=""
dry_run=0
input_tag=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev-branch)
      [[ $# -ge 2 && -n "$2" ]] || die "--dev-branch needs a branch name."
      opt_dev_branch="$2"
      shift 2
      ;;
    --dev-branch=*)
      opt_dev_branch="${1#--dev-branch=}"
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h | --help)
      sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      die "Unknown option: $1 (see --help)"
      ;;
    *)
      [[ -z "$input_tag" ]] || die "Only one release tag may be given."
      input_tag="$1"
      shift
      ;;
  esac
done

# --- Pre-flight checks (read-only) -----------------------------------------

require_cmd git
require_cmd npm
require_cmd node

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This folder is not a Git repository."
  exit 1
fi

if ! ensure_git_index_lock_clear; then
  echo
  echo "Cannot continue while git index is locked."
  echo "If needed, after confirming no git process is active, run:"
  echo "  rm -f .git/index.lock"
  exit 1
fi

if ! git show-ref --verify --quiet refs/heads/main; then
  die "Branch 'main' does not exist locally."
fi

current_branch="$(git branch --show-current)"

dev_branch="${opt_dev_branch:-${DEV_BRANCH:-}}"
if [[ -z "$dev_branch" ]]; then
  if [[ -n "$current_branch" && "$current_branch" != "main" ]]; then
    dev_branch="$current_branch"
  else
    die "Cannot infer the development branch while on '${current_branch:-detached HEAD}'. Use --dev-branch <name> or DEV_BRANCH=<name>."
  fi
fi

if [[ "$dev_branch" != *-Updates ]]; then
  die "Development branch '${dev_branch}' does not match '*-Updates'."
fi
if ! git show-ref --verify --quiet "refs/heads/${dev_branch}"; then
  die "Branch '${dev_branch}' does not exist locally. Try: git fetch origin && git switch ${dev_branch}"
fi
if [[ "$current_branch" != "$dev_branch" ]]; then
  die "You are on '${current_branch:-detached HEAD}', not '${dev_branch}'. Run 'git switch ${dev_branch}' first."
fi

current_pkg_version="$(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
latest_tag="$(git describe --tags --abbrev=0 2>/dev/null || echo 'none')"
dev_commit_msg="Release-ready changes"

echo "========================================"
echo "EXDA Release Assistant"
[[ "$dry_run" -eq 1 ]] && echo "(DRY RUN: no commits, merges, tags or pushes)"
echo "========================================"
echo "Current branch: ${current_branch}"
echo "Development branch: ${dev_branch}"
echo "Current package version: ${current_pkg_version}"
echo "Latest tag: ${latest_tag}"
echo

if [[ -z "$input_tag" ]]; then
  read -r -p "New release tag (e.g. browser-MVP-v2.9.0): " input_tag || true
fi

tag_name="$(echo "$input_tag" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
if [[ -z "$tag_name" ]]; then
  die "Tag is required."
fi

if [[ "$tag_name" =~ v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  new_version="${BASH_REMATCH[1]}"
else
  die "Invalid tag format. Tag must end with vMAJOR.MINOR.PATCH (example: browser-MVP-v2.9.0)."
fi
echo "Detected version ${new_version} from tag."

if git rev-parse -q --verify "refs/tags/${tag_name}" >/dev/null 2>&1; then
  die "Tag '${tag_name}' already exists locally. Choose a new tag."
fi

if git ls-remote --exit-code --tags origin "refs/tags/${tag_name}" >/dev/null 2>&1; then
  die "Tag '${tag_name}' already exists on origin. Choose a new tag."
fi

# --- Check working tree against the allow-list -----------------------------

echo
echo ">> git status --short --branch"
git --no-pager status --short --branch

stage_paths=()
blocked_paths=()
oversize_paths=()

while IFS= read -r -d '' path; do
  if is_allowed_path "$path"; then
    stage_paths+=("$path")
    if [[ -f "$path" ]]; then
      size_bytes="$(wc -c <"$path" | tr -d '[:space:]')"
      if [[ "$size_bytes" -gt "$MAX_FILE_BYTES" ]]; then
        oversize_paths+=("${path} (${size_bytes} bytes)")
      fi
    fi
  else
    blocked_paths+=("$path")
  fi
done < <(list_changed_paths)

if [[ ${#blocked_paths[@]} -gt 0 ]]; then
  echo
  echo "These paths are changed, staged or untracked OUTSIDE the release allow-list:"
  printf '  %s\n' "${blocked_paths[@]}"
  echo
  echo "The script will not stage them. Commit them yourself (explicit paths), move them"
  echo "out of the repo, add them to .gitignore, or add app paths to ALLOWED_DIRS /"
  echo "ALLOWED_FILES in versioning.sh. Never add Projects/ data to a release."
  die "Working tree contains changes outside the allowed paths."
fi

if [[ ${#oversize_paths[@]} -gt 0 ]]; then
  echo
  echo "These files are larger than ${MAX_FILE_MB} MB:"
  printf '  %s\n' "${oversize_paths[@]}"
  die "Refusing to stage files over ${MAX_FILE_MB} MB."
fi

echo
if [[ ${#stage_paths[@]} -gt 0 ]]; then
  echo "Paths to stage on ${dev_branch}:"
  printf '  %s\n' "${stage_paths[@]}"
else
  echo "No changes to stage on ${dev_branch}."
fi

echo
echo "Planned release:"
echo "- Commit + push allowed changes on ${dev_branch} (if any)"
echo "- Merge ${dev_branch} into main, bump version to ${new_version}, update VERSIONING.md"
echo "- Tag ${tag_name} on main and push main + tag"
echo "- Merge main back into ${dev_branch} and push"

if [[ "$dry_run" -eq 1 ]]; then
  echo
  echo "Dry run finished: all checks passed. Nothing was changed."
  exit 0
fi

# Confirmations are mandatory; fail before any git write if we cannot ask.
if ! (: </dev/tty) 2>/dev/null; then
  die "Confirmation required but no terminal is available. Run this script interactively."
fi

# --- Step 1: commit allowed changes on the development branch --------------

if [[ ${#stage_paths[@]} -gt 0 ]]; then
  run_cmd git add -- "${stage_paths[@]}"

  # Re-check what actually got staged (blob sizes, allow-list).
  staged_bad=()
  while IFS= read -r -d '' path; do
    if ! is_allowed_path "$path"; then
      staged_bad+=("${path} (outside allow-list)")
      continue
    fi
    if git cat-file -e ":${path}" 2>/dev/null; then
      size_bytes="$(git cat-file -s ":${path}")"
      if [[ "$size_bytes" -gt "$MAX_FILE_BYTES" ]]; then
        staged_bad+=("${path} (${size_bytes} bytes)")
      fi
    fi
  done < <(list_staged_paths)

  if [[ ${#staged_bad[@]} -gt 0 ]]; then
    git restore --staged -- "${stage_paths[@]}" || true
    echo "Staged paths failed the safety check:"
    printf '  %s\n' "${staged_bad[@]}"
    die "Staging undone. Nothing was committed."
  fi

  echo
  echo ">> git diff --cached --stat"
  git --no-pager diff --cached --stat
  echo
  if ! confirm "Commit these changes on '${dev_branch}' and push to origin/${dev_branch}?"; then
    git restore --staged -- "${stage_paths[@]}" || true
    die "Cancelled by user. Staging undone; nothing was committed."
  fi

  if git diff --cached --quiet; then
    echo "No staged changes to commit on ${dev_branch}."
  else
    run_cmd git commit -m "$dev_commit_msg"
    run_cmd git push origin "$dev_branch"
  fi
fi

if [[ -n "$(git status --porcelain)" ]]; then
  git --no-pager status --short
  die "Working tree is not clean on ${dev_branch}. Resolve this and rerun."
fi

# --- Step 2: merge, bump, tag and push on main ------------------------------

echo
if ! confirm "Merge '${dev_branch}' into main, bump to ${new_version}, tag '${tag_name}' and push main + tag?"; then
  die "Cancelled by user before touching main."
fi

run_cmd git switch main
if [[ "$(git branch --show-current)" != "main" ]]; then
  die "Not on main after 'git switch main'."
fi
run_cmd git pull --ff-only origin main
run_cmd git merge "$dev_branch" -m "Merge ${dev_branch} into main"

merged_pkg_version="$(node -p "require('./package.json').version" 2>/dev/null || echo '')"
if [[ "$merged_pkg_version" == "$new_version" ]]; then
  echo "package.json is already at ${new_version}; skipping npm version bump."
else
  run_cmd npm version "$new_version" --no-git-tag-version
fi

release_date="$(date +%F)"
echo
echo ">> Updating VERSIONING.md release metadata"
update_versioning_file "$new_version" "$tag_name" "$release_date"

run_cmd git add -- package.json package-lock.json VERSIONING.md
if git diff --cached --quiet; then
  echo "No release metadata/version changes to commit on main."
else
  run_cmd git commit -m "Prepare release ${new_version} (${tag_name})"
fi

run_cmd git push origin main
run_cmd git tag -a "$tag_name" -m "$tag_name"
run_cmd git push origin "$tag_name"

# --- Step 3: sync main back into the development branch --------------------

run_cmd git switch "$dev_branch"
run_cmd git merge main -m "Sync main into ${dev_branch}"
run_cmd git push origin "$dev_branch"

echo
echo "Release workflow completed successfully."
echo "Final state:"
echo "- Branch: $(git branch --show-current)"
echo "- Version: $(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
echo "- Tag: ${tag_name}"
