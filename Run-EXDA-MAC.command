#!/usr/bin/env bash
# Starts EXDA on macOS (double-click this file, or EXDA.app).
# Every start runs a quick check. On the first start on a Mac, or when something
# is missing, it runs Setup-EXDA-MAC.command first and then starts EXDA.
set -u

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1
DEFAULTS_FILE="$REPO_ROOT/config/exda-defaults.env"

if [ -f "$DEFAULTS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$DEFAULTS_FILE"
fi

VENV_DIR="$REPO_ROOT/.venv-mac"
VENV_PY="$VENV_DIR/bin/python"
PY_OK='import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
NODE_PKGS_OK="require('rollup'); require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')"
SETUP_REASON=""
FRONTEND_HOST="${EXDA_FRONTEND_HOST:-${EXDA_DEFAULT_FRONTEND_HOST:-}}"
FRONTEND_PORT="${EXDA_FRONTEND_PORT:-${EXDA_DEFAULT_FRONTEND_PORT:-}}"
BACKEND_HOST="${EXDA_BACKEND_HOST:-${EXDA_DEFAULT_BACKEND_HOST:-}}"
BACKEND_PORT="${EXDA_BACKEND_PORT:-${EXDA_DEFAULT_BACKEND_PORT:-}}"

prepend_path_if_dir() {
  local candidate="$1"
  [ -d "$candidate" ] || return 0
  case ":$PATH:" in
    *":$candidate:"*) return 0 ;;
  esac
  PATH="$candidate:$PATH"
}

# Same folders as Setup-EXDA-MAC.command.
seed_gui_path() {
  prepend_path_if_dir "/usr/local/bin"
  prepend_path_if_dir "/opt/homebrew/bin"
  prepend_path_if_dir "/Library/Frameworks/Python.framework/Versions/Current/bin"
  prepend_path_if_dir "$HOME/.local/bin"
  prepend_path_if_dir "$HOME/bin"
  prepend_path_if_dir "$HOME/.nvm/current/bin"
  export PATH
}

pause_on_error() {
  if [ -t 0 ]; then
    read -r -p "Press Enter to close this window..." _
  fi
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

# Quick check before every start. Returns 0 (and sets SETUP_REASON) when setup
# has to run, 1 when everything EXDA needs is in place.
needs_setup() {
  SETUP_REASON=""
  sanitize_venv
  if [ ! -x "$VENV_PY" ]; then
    SETUP_REASON="the Python environment for macOS is not set up yet"; return 0
  fi
  if [ "$("$VENV_PY" -c 'import sys; print(sys.prefix)' 2>/dev/null)" != "$VENV_DIR" ] \
    || ! "$VENV_PY" -c "$PY_OK" >/dev/null 2>&1; then
    SETUP_REASON="the Python environment does not work on this Mac"; return 0
  fi
  if ! "$VENV_PY" scripts/check_runtime_requirements.py --requirements backend/requirements.txt >/dev/null 2>&1; then
    SETUP_REASON="some Python packages are missing"; return 0
  fi
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    SETUP_REASON="Node.js is not installed"; return 0
  fi
  if ! node scripts/check_node_version.cjs >/dev/null 2>&1; then
    SETUP_REASON="Node.js is too old"; return 0
  fi
  if ! node -e "$NODE_PKGS_OK" >/dev/null 2>&1; then
    SETUP_REASON="some frontend packages are missing"; return 0
  fi
  return 1
}

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1
    wait "$BACKEND_PID" 2>/dev/null
  fi
}

start_app() {
  echo ""
  echo "Starting EXDA backend on http://${BACKEND_HOST}:${BACKEND_PORT} ..."
  EXDA_BACKEND_DEBUG=1 \
  EXDA_BACKEND_HOST="$BACKEND_HOST" \
  EXDA_BACKEND_PORT="$BACKEND_PORT" \
  EXDA_FRONTEND_HOST="$FRONTEND_HOST" \
  EXDA_FRONTEND_PORT="$FRONTEND_PORT" \
  EXDA_CORS_ORIGINS="http://${FRONTEND_HOST}:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}" \
  "$VENV_PY" backend/app.py &
  BACKEND_PID=$!
  trap cleanup EXIT INT TERM

  sleep 2
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    echo ""
    echo "The backend stopped during startup. Check the error output above."
    pause_on_error
    exit 1
  fi

  echo "Starting EXDA frontend on http://${FRONTEND_HOST}:${FRONTEND_PORT} ..."
  echo "App URL:"
  echo "  http://${FRONTEND_HOST}:${FRONTEND_PORT}/?backendPort=${BACKEND_PORT}"
  echo "==================================================="
  echo "EXDA IS RUNNING"
  echo "Close this window (or press Ctrl+C) to stop EXDA."
  echo "==================================================="
  npm run vite -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
}

echo "========================================"
echo "EXDA Launcher (macOS)"
echo "========================================"
seed_gui_path

echo "Checking requirements ..."
if needs_setup; then
  echo ""
  echo "EXDA needs to install some components on this Mac first: $SETUP_REASON."
  echo "This happens once and can take several minutes."
  echo ""
  bash "$REPO_ROOT/Setup-EXDA-MAC.command" --from-launcher || exit 1
  seed_gui_path
  hash -r
  if needs_setup; then
    echo ""
    echo "EXDA cannot start yet: $SETUP_REASON."
    echo "Run Setup-EXDA-MAC.command in this folder and read its messages."
    echo ""
    pause_on_error
    exit 1
  fi
fi
echo "Requirements OK."

if [ -z "$FRONTEND_HOST" ] || [ -z "$FRONTEND_PORT" ] || [ -z "$BACKEND_HOST" ] || [ -z "$BACKEND_PORT" ]; then
  echo ""
  echo "EXDA cannot start: host or port settings are missing in config/exda-defaults.env"
  pause_on_error
  exit 1
fi

# shellcheck disable=SC1091
. "$VENV_DIR/bin/activate"
start_app
