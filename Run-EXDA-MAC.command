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
OPTIONAL_ITEMS=()
PYTHON_CMD=""
FRONTEND_HOST="${EXDA_FRONTEND_HOST:-${EXDA_DEFAULT_FRONTEND_HOST:-}}"
FRONTEND_PORT="${EXDA_FRONTEND_PORT:-${EXDA_DEFAULT_FRONTEND_PORT:-}}"
BACKEND_HOST="${EXDA_BACKEND_HOST:-${EXDA_DEFAULT_BACKEND_HOST:-}}"
BACKEND_PORT="${EXDA_BACKEND_PORT:-${EXDA_DEFAULT_BACKEND_PORT:-}}"

activate_local_venv() {
  if [ "$PYTHON_CMD" = "$REPO_ROOT/.venv/bin/python" ] && [ -f "$REPO_ROOT/.venv/bin/activate" ]; then
    # shellcheck disable=SC1091
    . "$REPO_ROOT/.venv/bin/activate" || return 1
    PYTHON_CMD="$REPO_ROOT/.venv/bin/python"
  fi
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
  prepend_path_if_dir "/opt/homebrew/bin"
  prepend_path_if_dir "/usr/local/bin"
  prepend_path_if_dir "/usr/bin"
  prepend_path_if_dir "/bin"
  prepend_path_if_dir "$HOME/.local/bin"
  prepend_path_if_dir "$HOME/bin"
  prepend_path_if_dir "$HOME/.nvm/current/bin"
}

sanitize_local_venv() {
  if [ -d "$REPO_ROOT/.venv" ]; then
    find "$REPO_ROOT/.venv" -name '._*' -type f -delete >/dev/null 2>&1 || true
    if command -v dot_clean >/dev/null 2>&1; then
      dot_clean -m "$REPO_ROOT/.venv" >/dev/null 2>&1 || true
    fi
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

add_optional() {
  OPTIONAL_ITEMS+=("$1")
}

using_local_venv() {
  [ -n "$PYTHON_CMD" ] && [ "$PYTHON_CMD" = "$REPO_ROOT/.venv/bin/python" ]
}

install_missing_python_packages() {
  if [ -z "$PYTHON_CMD" ] || ! using_local_venv; then
    return 1
  fi
  local package_names=("$@")
  if [ "${#package_names[@]}" -eq 0 ]; then
    return 1
  fi
  "$PYTHON_CMD" -m pip install "${package_names[@]}" >/dev/null 2>&1
}

archive_broken_venv() {
  if [ ! -d "$REPO_ROOT/.venv" ]; then
    return 0
  fi
  local archived_path="$REPO_ROOT/.venv.broken-$(date +%Y%m%d-%H%M%S)"
  mv "$REPO_ROOT/.venv" "$archived_path"
  echo "Archived incompatible local virtualenv to $archived_path"
}

repair_local_venv() {
  if ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi
  if [ -d "$REPO_ROOT/.venv" ]; then
    archive_broken_venv || return 1
  fi
  echo "Recreating local .venv for macOS ..."
  if ! python3 -m venv "$REPO_ROOT/.venv" >/dev/null 2>&1; then
    return 1
  fi
  sanitize_local_venv
  PYTHON_CMD="$REPO_ROOT/.venv/bin/python"
  return 0
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
    echo "Local .venv looks incompatible on this Mac. Trying to repair it ..."
    if repair_local_venv; then
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

  if [ "$status" -eq 1 ] && using_local_venv; then
    echo "Python runtime packages are missing. Trying to install backend requirements ..."
    if "$PYTHON_CMD" -m pip install -r backend/requirements.txt >/dev/null 2>&1; then
      sanitize_local_venv
      missing_output="$("$PYTHON_CMD" scripts/check_runtime_requirements.py --requirements backend/requirements.txt 2>/dev/null)"
      status=$?
      if [ "$status" -eq 0 ]; then
        echo "Python runtime packages repaired in .venv."
        return
      fi
    fi
  fi

  if [ "$status" -eq 1 ]; then
    while IFS= read -r package_name; do
      [ -n "$package_name" ] && add_missing "Missing Python package: $package_name"
    done <<< "$missing_output"
    return
  fi

  add_missing "Could not verify Python packages in backend/requirements.txt"
}

check_optional_python_packages() {
  if [ -z "$PYTHON_CMD" ]; then
    return
  fi

  local missing_output=""
  missing_output="$("$PYTHON_CMD" scripts/check_runtime_requirements.py --requirements backend/requirements-optional.txt 2>/dev/null)"
  local status=$?

  if [ "$status" -eq 0 ]; then
    return
  fi

  if [ "$status" -eq 1 ] && using_local_venv; then
    echo "Feature packages are missing. Trying to install AiRA/PDF extras ..."
    if "$PYTHON_CMD" -m pip install -r backend/requirements-optional.txt >/dev/null 2>&1; then
      sanitize_local_venv
      missing_output="$("$PYTHON_CMD" scripts/check_runtime_requirements.py --requirements backend/requirements-optional.txt 2>/dev/null)"
      status=$?
      if [ "$status" -eq 0 ]; then
        echo "Feature packages repaired in .venv."
        return
      fi
    fi
    if [ "$status" -eq 1 ]; then
      mapfile -t missing_packages < <(printf '%s\n' "$missing_output" | sed '/^$/d')
      if [ "${#missing_packages[@]}" -gt 0 ]; then
        echo "Trying targeted install for missing feature packages ..."
        if install_missing_python_packages "${missing_packages[@]}"; then
          sanitize_local_venv
          missing_output="$("$PYTHON_CMD" scripts/check_runtime_requirements.py --requirements backend/requirements-optional.txt 2>/dev/null)"
          status=$?
          if [ "$status" -eq 0 ]; then
            echo "Feature packages repaired in .venv."
            return
          fi
        fi
      fi
    fi
  fi

  if [ "$status" -eq 1 ]; then
    while IFS= read -r package_name; do
      [ -n "$package_name" ] && add_optional "Feature package missing: $package_name"
    done <<< "$missing_output"
    return
  fi

  add_optional "Could not verify feature packages in backend/requirements-optional.txt"
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
  if [ "${#OPTIONAL_ITEMS[@]}" -gt 0 ]; then
    echo ""
    echo "Optional features may stay limited until these are installed:"
    for item in "${OPTIONAL_ITEMS[@]}"; do
      echo " - $item"
    done
  fi
  echo ""
  echo "Recommended setup commands:"
  echo "  npm install"
  echo "  python3 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  pip install -r backend/requirements.txt"
  echo "  pip install -r backend/requirements-optional.txt"
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
  sanitize_local_venv
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
seed_gui_path
check_command node
check_command npm
resolve_python
activate_local_venv || add_missing "Could not activate the local .venv"
check_runtime_defaults
check_node_packages
check_python_packages
check_optional_python_packages

if [ "${#MISSING_ITEMS[@]}" -gt 0 ]; then
  print_missing_summary
  pause_on_error
  exit 1
fi

start_app
