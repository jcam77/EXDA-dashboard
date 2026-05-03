#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1"
    exit 1
  fi
}

run_cmd() {
  echo
  echo ">> $*"
  "$@"
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
const sectionRegex = /## Current Release[\s\S]*?(?=\n## |\n?$)/m;
const nextSectionMatch = text.match(sectionRegex);

const section = [
  '## Current Release',
  '',
  `- Latest release version: \`${newVersion}\``,
  `- Latest release tag: \`${tagName}\``,
  `- Updated on: \`${releaseDate}\``,
  '',
].join('\n');

if (nextSectionMatch) {
  text = text.replace(sectionRegex, section.trimEnd());
} else {
  const marker = 'This is the EXDA versioning workflow.';
  if (text.includes(marker)) {
    text = text.replace(marker, `${marker}\n\n${section.trimEnd()}`);
  } else {
    text = `${section}${text}`;
  }
}

fs.writeFileSync(path, text);
NODE
}

require_cmd git
require_cmd npm
require_cmd node

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This folder is not a Git repository."
  exit 1
fi

if ! git show-ref --verify --quiet refs/heads/CODEX-Updates; then
  echo "Branch 'CODEX-Updates' does not exist locally."
  exit 1
fi

if ! git show-ref --verify --quiet refs/heads/main; then
  echo "Branch 'main' does not exist locally."
  exit 1
fi

current_branch="$(git branch --show-current)"
current_pkg_version="$(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
latest_tag="$(git describe --tags --abbrev=0 2>/dev/null || echo 'none')"
codex_commit_msg="Release-ready changes"

echo "========================================"
echo "EXDA Release Assistant"
echo "========================================"
echo "Current branch: ${current_branch}"
echo "Current package version: ${current_pkg_version}"
echo "Latest tag: ${latest_tag}"
echo

input_tag="${1:-}"
if [[ -z "$input_tag" ]]; then
  read -r -p "New release tag (e.g. browser-MVP-v2.9.0): " input_tag
fi

tag_name="$(echo "$input_tag" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
if [[ -z "$tag_name" ]]; then
  echo "Tag is required."
  exit 1
fi

if [[ "$tag_name" =~ v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  new_version="${BASH_REMATCH[1]}"
else
  echo "Invalid tag format. Tag must end with vMAJOR.MINOR.PATCH (example: browser-MVP-v2.9.0)."
  exit 1
fi
echo "Detected version ${new_version} from tag."

if git rev-parse -q --verify "refs/tags/${tag_name}" >/dev/null 2>&1; then
  echo "Tag '${tag_name}' already exists locally. Choose a new tag."
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/${tag_name}" >/dev/null 2>&1; then
  echo "Tag '${tag_name}' already exists on origin. Choose a new tag."
  exit 1
fi

echo
echo "Planned release:"
echo "- Version bump target: ${new_version}"
echo "- Tag: ${tag_name}"

run_cmd git switch CODEX-Updates
run_cmd git status --short --branch

if [[ -n "$(git status --porcelain)" ]]; then
  run_cmd git add -A
  if git diff --cached --quiet; then
    echo "No staged changes to commit on CODEX-Updates."
  else
    run_cmd git commit -m "$codex_commit_msg"
    run_cmd git push origin CODEX-Updates
  fi
else
  echo "No local changes to commit on CODEX-Updates."
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean on CODEX-Updates. Resolve this and rerun."
  exit 1
fi

run_cmd git switch main
run_cmd git pull --ff-only origin main
run_cmd git branch --show-current
run_cmd git merge CODEX-Updates -m "Merge CODEX-Updates into main"

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

run_cmd git add package.json package-lock.json VERSIONING.md
if git diff --cached --quiet; then
  echo "No release metadata/version changes to commit on main."
else
  run_cmd git commit -m "Prepare release ${new_version} (${tag_name})"
fi

run_cmd git push origin main
run_cmd git tag -a "$tag_name" -m "$tag_name"
run_cmd git push origin "$tag_name"

run_cmd git switch CODEX-Updates
run_cmd git merge main -m "Sync main into CODEX-Updates"
run_cmd git push origin CODEX-Updates

echo
echo "Release workflow completed successfully."
echo "Final state:"
echo "- Branch: $(git branch --show-current)"
echo "- Version: $(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
echo "- Tag: ${tag_name}"
