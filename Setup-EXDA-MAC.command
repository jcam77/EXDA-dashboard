#!/usr/bin/env bash
set -u

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

PYTHON_CMD=""

prepend_path_if_dir() {
  local candidate="$1"
  [ -d "$candidate" ] || return 0
  case ":$PATH:" in
    *":$candidate:"*) return 0 ;;
  esac
  PATH="$candidate:$PATH"
}

seed_gui_path() {
  prepend_path_if_dir "/opt/homebrew/bin"
  prepend_path_if_dir "/usr/local/bin"
  prepend_path_if_dir "/usr/bin"
  prepend_path_if_dir "/bin"
  prepend_path_if_dir "$HOME/.local/bin"
  prepend_path_if_dir "$HOME/bin"
  prepend_path_if_dir "$HOME/.nvm/current/bin"
}

print_header() {
  echo "========================================"
  echo "EXDA Setup (macOS)"
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

sanitize_local_venv() {
  if [ -d "$REPO_ROOT/.venv" ]; then
    find "$REPO_ROOT/.venv" -name '._*' -type f -delete >/dev/null 2>&1 || true
    if command -v dot_clean >/dev/null 2>&1; then
      dot_clean -m "$REPO_ROOT/.venv" >/dev/null 2>&1 || true
    fi
  fi
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
  sanitize_local_venv
  if [ -x "$REPO_ROOT/.venv/bin/python" ]; then
    local detected_prefix=""
    detected_prefix="$("$REPO_ROOT/.venv/bin/python" -c "import sys; print(sys.prefix)" 2>/dev/null || true)"
    if [ "$detected_prefix" = "$REPO_ROOT/.venv" ]; then
      PYTHON_CMD="$REPO_ROOT/.venv/bin/python"
      return 0
    fi
    archive_broken_venv || return 1
  fi

  command -v python3 >/dev/null 2>&1 || return 1
  echo "Creating local .venv ..."
  python3 -m venv "$REPO_ROOT/.venv" || return 1
  sanitize_local_venv
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
command -v npm >/dev/null 2>&1 || fail "Missing tool: npm"
resolve_python || fail "Missing tool: python3"

echo ""
echo "Installing frontend dependencies with npm ..."
npm install || fail "npm install failed"
verify_node_packages || fail "Frontend packages are still incomplete after npm install"

echo ""
echo "Upgrading pip in local .venv ..."
"$PYTHON_CMD" -m pip install --upgrade pip >/dev/null 2>&1 || fail "Could not upgrade pip in .venv"

echo "Installing backend requirements ..."
"$PYTHON_CMD" -m pip install -r backend/requirements.txt || fail "Failed to install backend/requirements.txt"
sanitize_local_venv
verify_python_requirements backend/requirements.txt || fail "Backend Python requirements are still incomplete"

echo "Installing optional feature requirements ..."
"$PYTHON_CMD" -m pip install -r backend/requirements-optional.txt || fail "Failed to install backend/requirements-optional.txt"
sanitize_local_venv
verify_python_requirements backend/requirements-optional.txt || fail "Optional Python requirements are still incomplete"

echo ""
echo "EXDA setup is complete."
echo ""
echo "Next step:"
echo "  Run-EXDA-MAC.command"
echo ""
pause_on_exit
