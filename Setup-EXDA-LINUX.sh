#!/usr/bin/env bash
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT" || exit 1

PYTHON_CMD=""
NPM_CMD=""
NPM_CLI_PATH=""

activate_local_venv() {
  if [ ! -f "$REPO_ROOT/.venv/bin/activate" ]; then
    return 1
  fi
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.venv/bin/activate" || return 1
  PYTHON_CMD="$REPO_ROOT/.venv/bin/python"
  return 0
}

prepend_path_if_dir() {
  local candidate="$1"
  [ -d "$candidate" ] || return 0
  case ":$PATH:" in
    *":$candidate:"*) return 0 ;;
  esac
  PATH="$candidate:$PATH"
}

seed_gui_path() {
  prepend_path_if_dir "$HOME/.local/bin"
  prepend_path_if_dir "$HOME/bin"
  prepend_path_if_dir "/usr/local/bin"
  prepend_path_if_dir "/usr/bin"
  prepend_path_if_dir "/bin"
  prepend_path_if_dir "/snap/bin"
  prepend_path_if_dir "/home/linuxbrew/.linuxbrew/bin"
  prepend_path_if_dir "/home/linuxbrew/.linuxbrew/sbin"
  prepend_path_if_dir "$HOME/.nvm/current/bin"
  if [ -d "$HOME/.nvm/versions/node" ]; then
    local nvm_bin=""
    while IFS= read -r nvm_bin; do
      prepend_path_if_dir "$nvm_bin"
    done < <(find "$HOME/.nvm/versions/node" -maxdepth 3 -type d -path '*/bin' 2>/dev/null | sort -r)
  fi
}

print_header() {
  echo "========================================"
  echo "EXDA Setup (Linux)"
  echo "========================================"
}

pause_on_exit() {
  if [ -t 0 ]; then
    read -r -p "Press Enter to exit..." _
  fi
}

fail() {
  echo ""
  echo "Setup failed: $1"
  echo ""
  pause_on_exit
  exit 1
}

resolve_npm() {
  if command -v npm >/dev/null 2>&1; then
    NPM_CMD="npm"
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    NPM_CMD="corepack npm"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    local node_bin=""
    node_bin="$(command -v node)"
    local candidates=(
      "$(dirname "$node_bin")/../lib/node_modules/npm/bin/npm-cli.js"
      "$(dirname "$node_bin")/../node_modules/npm/bin/npm-cli.js"
      "/usr/lib/node_modules/npm/bin/npm-cli.js"
      "/usr/local/lib/node_modules/npm/bin/npm-cli.js"
    )
    local candidate=""
    for candidate in "${candidates[@]}"; do
      if [ -f "$candidate" ]; then
        NPM_CMD="node-cli"
        NPM_CLI_PATH="$candidate"
        return 0
      fi
    done
  fi
  return 1
}

run_npm() {
  if [ "$NPM_CMD" = "npm" ]; then
    npm "$@"
    return $?
  fi
  if [ "$NPM_CMD" = "node-cli" ]; then
    node "$NPM_CLI_PATH" "$@"
    return $?
  fi
  corepack npm "$@"
}

archive_broken_venv() {
  if [ ! -d "$REPO_ROOT/.venv" ]; then
    return 0
  fi
  local archived_path="$REPO_ROOT/.venv.broken-$(date +%Y%m%d-%H%M%S)"
  mv "$REPO_ROOT/.venv" "$archived_path" || return 1
  echo "Archived incompatible local virtualenv to $archived_path"
}

resolve_python() {
  if [ -x "$REPO_ROOT/.venv/bin/python" ]; then
    local detected_prefix=""
    detected_prefix="$("$REPO_ROOT/.venv/bin/python" -c "import sys; print(sys.prefix)" 2>/dev/null || true)"
    if [ "$detected_prefix" = "$REPO_ROOT/.venv" ]; then
      PYTHON_CMD="$REPO_ROOT/.venv/bin/python"
      return 0
    fi
    archive_broken_venv || return 1
  fi

  local base_python=""
  if command -v python3 >/dev/null 2>&1; then
    base_python="python3"
  elif command -v python >/dev/null 2>&1; then
    base_python="python"
  else
    return 1
  fi

  echo "Creating local .venv ..."
  "$base_python" -m venv "$REPO_ROOT/.venv" || return 1
  PYTHON_CMD="$REPO_ROOT/.venv/bin/python"
  return 0
}

verify_node_packages() {
  node -e "require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')" >/dev/null 2>&1
}

verify_python_requirements() {
  "$PYTHON_CMD" scripts/check_runtime_requirements.py --requirements "$1" >/dev/null 2>&1
}

print_header
seed_gui_path

command -v node >/dev/null 2>&1 || fail "Missing tool: node"
resolve_npm || fail "Missing tool: npm"
resolve_python || fail "Missing tool: python3 or python"
activate_local_venv || fail "Could not activate the local .venv"

echo ""
echo "Installing frontend dependencies with npm ..."
run_npm install || fail "npm install failed"
verify_node_packages || fail "Frontend packages are still incomplete after npm install"

echo ""
echo "Upgrading pip in local .venv ..."
"$PYTHON_CMD" -m pip install --upgrade pip >/dev/null 2>&1 || fail "Could not upgrade pip in .venv"

echo "Installing backend requirements ..."
"$PYTHON_CMD" -m pip install -r backend/requirements.txt || fail "Failed to install backend/requirements.txt"
verify_python_requirements backend/requirements.txt || fail "Backend Python requirements are still incomplete"

echo "Installing optional feature requirements ..."
"$PYTHON_CMD" -m pip install -r backend/requirements-optional.txt || fail "Failed to install backend/requirements-optional.txt"
verify_python_requirements backend/requirements-optional.txt || fail "Optional Python requirements are still incomplete"

echo ""
echo "EXDA setup is complete."
echo ""
echo "The EXDA launcher uses .venv automatically."
echo "If you want this terminal itself to stay activated afterward, run:"
echo "  source .venv/bin/activate"
echo ""
echo "Next step:"
echo "  Run-EXDA-LINUX.sh"
echo ""
pause_on_exit
