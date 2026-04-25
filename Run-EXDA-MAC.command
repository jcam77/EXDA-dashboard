#!/usr/bin/env bash
set -u

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1
DEFAULTS_FILE="$REPO_ROOT/config/exda-defaults.env"

if [ -f "$DEFAULTS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$DEFAULTS_FILE"
fi

MISSING_ITEMS=()
PYTHON_CMD=""
FRONTEND_HOST="${EXDA_FRONTEND_HOST:-${EXDA_DEFAULT_FRONTEND_HOST:-}}"
FRONTEND_PORT="${EXDA_FRONTEND_PORT:-${EXDA_DEFAULT_FRONTEND_PORT:-}}"
BACKEND_HOST="${EXDA_BACKEND_HOST:-${EXDA_DEFAULT_BACKEND_HOST:-}}"
BACKEND_PORT="${EXDA_BACKEND_PORT:-${EXDA_DEFAULT_BACKEND_PORT:-}}"

sanitize_local_venv() {
  if [ -d "$REPO_ROOT/.venv" ]; then
    find "$REPO_ROOT/.venv" -name '._*' -type f -delete >/dev/null 2>&1 || true
  fi
}

print_header() {
  echo "========================================"
  echo "EXDA Launcher (macOS)"
  echo "========================================"
}

pause_on_error() {
  if [ -t 0 ]; then
    read -r -p "Press Enter to exit..." _
  fi
}

add_missing() {
  MISSING_ITEMS+=("$1")
}

check_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    add_missing "Missing tool: $command_name"
    return 1
  fi
  return 0
}

resolve_python() {
  sanitize_local_venv
  if [ -x "$REPO_ROOT/.venv/bin/python" ]; then
    local detected_prefix=""
    detected_prefix="$("$REPO_ROOT/.venv/bin/python" -c "import sys; print(sys.prefix)" 2>/dev/null || true)"
    if [ "$detected_prefix" = "$REPO_ROOT/.venv" ]; then
      PYTHON_CMD="$REPO_ROOT/.venv/bin/python"
      return
    fi
    add_missing "Broken local virtualenv: recreate .venv with python3 -m venv .venv"
  fi
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
    return
  fi
  if command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
    return
  fi
  add_missing "Missing tool: python3 or python"
}

check_node_packages() {
  if ! node -e "require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')" >/dev/null 2>&1; then
    add_missing "Missing npm packages: run npm install"
  fi
}

check_python_packages() {
  if [ -z "$PYTHON_CMD" ]; then
    return
  fi

  local missing_output=""
  missing_output="$("$PYTHON_CMD" scripts/check_runtime_requirements.py --requirements backend/requirements.txt 2>/dev/null)"
  local status=$?

  if [ "$status" -eq 0 ]; then
    return
  fi

  if [ "$status" -eq 1 ]; then
    while IFS= read -r package_name; do
      [ -n "$package_name" ] && add_missing "Missing Python package: $package_name"
    done <<< "$missing_output"
    return
  fi

  add_missing "Could not verify Python packages in backend/requirements.txt"
}

check_runtime_defaults() {
  [ -n "$FRONTEND_HOST" ] || add_missing "Missing runtime setting: EXDA_DEFAULT_FRONTEND_HOST in config/exda-defaults.env"
  [ -n "$FRONTEND_PORT" ] || add_missing "Missing runtime setting: EXDA_DEFAULT_FRONTEND_PORT in config/exda-defaults.env"
  [ -n "$BACKEND_HOST" ] || add_missing "Missing runtime setting: EXDA_DEFAULT_BACKEND_HOST in config/exda-defaults.env"
  [ -n "$BACKEND_PORT" ] || add_missing "Missing runtime setting: EXDA_DEFAULT_BACKEND_PORT in config/exda-defaults.env"
}

print_missing_summary() {
  echo ""
  echo "EXDA cannot start yet. Please install the missing requirements:"
  for item in "${MISSING_ITEMS[@]}"; do
    echo " - $item"
  done
  echo ""
  echo "Recommended setup commands:"
  echo "  npm install"
  echo "  python3 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  pip install -r backend/requirements.txt"
  echo ""
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
  "$PYTHON_CMD" backend/app.py &
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
  npm run vite -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
}

print_header
check_command node
check_command npm
resolve_python
check_runtime_defaults
check_node_packages
check_python_packages

if [ "${#MISSING_ITEMS[@]}" -gt 0 ]; then
  print_missing_summary
  pause_on_error
  exit 1
fi

start_app
