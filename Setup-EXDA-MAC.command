#!/usr/bin/env bash
# EXDA setup for macOS.
#  - Checks Node.js (20.19+ or 22.12+) and Python (3.10+); offers to install them
#    with Homebrew, or opens the download pages.
#  - Creates the macOS Python environment .venv-mac and installs the Python packages.
#  - Installs the frontend packages (npm install).
# Run-EXDA-MAC.command (and EXDA.app) call this automatically, with --from-launcher,
# when something is missing.
set -u

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

FROM_LAUNCHER=0
[ "${1:-}" = "--from-launcher" ] && FROM_LAUNCHER=1

VENV_DIR="$REPO_ROOT/.venv-mac"
VENV_PY="$VENV_DIR/bin/python"
PY_OK='import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
NODE_PKGS_OK="require('rollup'); require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')"
BASE_PYTHON=""

prepend_path_if_dir() {
  local candidate="$1"
  [ -d "$candidate" ] || return 0
  case ":$PATH:" in
    *":$candidate:"*) return 0 ;;
  esac
  PATH="$candidate:$PATH"
}

# Usual install folders, so tools installed a moment ago (or when started from
# Finder, which has a short PATH) are found.
seed_gui_path() {
  prepend_path_if_dir "/usr/local/bin"
  prepend_path_if_dir "/opt/homebrew/bin"
  prepend_path_if_dir "/Library/Frameworks/Python.framework/Versions/Current/bin"
  prepend_path_if_dir "$HOME/.local/bin"
  prepend_path_if_dir "$HOME/bin"
  prepend_path_if_dir "$HOME/.nvm/current/bin"
  export PATH
}

pause_on_exit() {
  if [ -t 0 ]; then
    read -r -p "Press Enter to close this window..." _
  fi
}

fail() {
  echo ""
  echo "Setup failed: $1"
  echo ""
  pause_on_exit
  exit 1
}

ask_yes() {
  [ -t 0 ] || return 1
  local answer=""
  read -r -p "$1 [y/N] " answer
  case "$answer" in
    [yY]|[yY][eE][sS]) return 0 ;;
  esac
  return 1
}

# Removes macOS "._" helper files that external drives collect; they break Python.
sanitize_venv() {
  if [ -d "$VENV_DIR" ]; then
    find "$VENV_DIR" -name '._*' -type f -delete >/dev/null 2>&1 || true
    if command -v dot_clean >/dev/null 2>&1; then
      dot_clean -m "$VENV_DIR" >/dev/null 2>&1 || true
    fi
  fi
}

node_ok() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 \
    && node "$REPO_ROOT/scripts/check_node_version.cjs" >/dev/null 2>&1
}

# A Python 3.10+ to build .venv-mac from. Apple's /usr/bin/python3 (3.9) is too
# old, and calling it without the developer tools opens an install dialog, so it
# is only tried when the developer tools are installed.
find_base_python() {
  BASE_PYTHON=""
  local name path
  for name in python3.13 python3.12 python3.11 python3.10 python3; do
    path="$(command -v "$name" 2>/dev/null)" || continue
    if [ "$path" = "/usr/bin/python3" ] && ! xcode-select -p >/dev/null 2>&1; then
      continue
    fi
    if "$path" -c "$PY_OK" >/dev/null 2>&1; then
      BASE_PYTHON="$path"
      return 0
    fi
  done
  return 1
}

# offer_install <brew formula> <name> <download page>
offer_install() {
  if command -v brew >/dev/null 2>&1; then
    if ask_yes "Install $2 now with Homebrew?"; then
      brew install "$1"
      seed_gui_path
      hash -r
      return 0
    fi
  fi
  echo ""
  echo "Please install $2 from $3"
  echo "and then double-click EXDA again. Opening the download page ..."
  open "$3" >/dev/null 2>&1 || true
  return 1
}

echo "========================================"
echo "EXDA Setup (macOS)"
echo "========================================"
seed_gui_path

# ---- Node.js ---------------------------------------------------------------
echo ""
echo "Checking Node.js ..."
if ! node_ok; then
  if command -v node >/dev/null 2>&1; then
    echo "Node.js $(node -v) is too old for EXDA. EXDA needs Node.js 22.12 or newer."
  else
    echo "Node.js is not installed on this Mac."
  fi
  offer_install node "Node.js LTS" "https://nodejs.org/en/download"
  node_ok || fail "Node.js 22.12 or newer is required. If you just installed it, close this window and double-click EXDA again."
fi
echo "Node.js $(node -v) found."

# ---- Python ----------------------------------------------------------------
echo ""
echo "Checking Python ..."
if ! find_base_python; then
  echo "Python 3.10 or newer is not installed on this Mac."
  offer_install python@3.12 "Python 3.12" "https://www.python.org/downloads/macos/"
  find_base_python || fail "Python 3.10 or newer is required. If you just installed it, close this window and double-click EXDA again."
fi
echo "$("$BASE_PYTHON" --version) found ($BASE_PYTHON)."

# ---- Python environment (.venv-mac) -----------------------------------------
sanitize_venv
if [ -d "$VENV_DIR" ]; then
  prefix="$("$VENV_PY" -c 'import sys; print(sys.prefix)' 2>/dev/null || true)"
  if [ "$prefix" != "$VENV_DIR" ] || ! "$VENV_PY" -c "$PY_OK" >/dev/null 2>&1; then
    old_venv="$VENV_DIR.broken-$(date +%Y%m%d-%H%M%S)"
    echo ""
    echo "The existing .venv-mac does not work on this Mac. Moving it aside to $(basename "$old_venv") ..."
    mv "$VENV_DIR" "$old_venv" || fail "Could not move the old .venv-mac aside."
  fi
fi
if [ ! -x "$VENV_PY" ]; then
  echo ""
  echo "Creating the Python environment .venv-mac ..."
  "$BASE_PYTHON" -m venv "$VENV_DIR" || fail "Could not create .venv-mac"
  sanitize_venv
fi

# ---- Frontend packages -------------------------------------------------------
echo ""
echo "Installing frontend packages with npm. The first time this takes a few minutes ..."
npm install || fail "npm install failed. Check the internet connection and try again."
if ! node -e "$NODE_PKGS_OK" >/dev/null 2>&1; then
  echo "Frontend packages are incomplete for this Mac. Reinstalling them from scratch ..."
  rm -rf "$REPO_ROOT/node_modules"
  npm install || fail "npm install failed. Check the internet connection and try again."
  node -e "$NODE_PKGS_OK" >/dev/null 2>&1 || fail "Frontend packages are still incomplete after npm install"
fi

# ---- Python packages -----------------------------------------------------------
echo ""
echo "Installing Python packages into .venv-mac ..."
"$VENV_PY" -m pip install --upgrade pip >/dev/null 2>&1
"$VENV_PY" -m pip install -r backend/requirements.txt || fail "Failed to install backend/requirements.txt"
sanitize_venv
"$VENV_PY" scripts/check_runtime_requirements.py --requirements backend/requirements.txt >/dev/null 2>&1 \
  || fail "Backend Python packages are still incomplete"
echo "Installing optional feature packages ..."
"$VENV_PY" -m pip install -r backend/requirements-optional.txt || fail "Failed to install backend/requirements-optional.txt"
sanitize_venv

echo ""
echo "EXDA setup is complete."
if [ "$FROM_LAUNCHER" = "1" ]; then
  echo "Starting EXDA ..."
  exit 0
fi
echo ""
echo "Start EXDA by double-clicking EXDA.app (or Run-EXDA-MAC.command) in this folder."
echo ""
pause_on_exit
