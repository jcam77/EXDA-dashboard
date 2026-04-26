#!/usr/bin/env bash
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT" || exit 1
DEFAULTS_FILE="$REPO_ROOT/config/exda-defaults.env"

if [ -f "$DEFAULTS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$DEFAULTS_FILE"
fi

MISSING_ITEMS=()
OPTIONAL_ITEMS=()
PYTHON_CMD=""
NPM_CMD=""
NPM_CLI_PATH=""
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

sanitize_local_venv() {
  if [ -d "$REPO_ROOT/.venv" ]; then
    find "$REPO_ROOT/.venv" -name '._*' -type f -delete >/dev/null 2>&1 || true
  fi
}

print_header() {
  echo "========================================"
  echo "EXDA Launcher (Linux)"
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

check_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    add_missing "Missing tool: $command_name"
    return 1
  fi
  return 0
}

resolve_npm() {
  if command -v npm >/dev/null 2>&1; then
    NPM_CMD="npm"
    return
  fi
  if command -v corepack >/dev/null 2>&1; then
    NPM_CMD="corepack npm"
    return
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
        return
      fi
    done
  fi
  add_missing "Missing tool: npm"
}

run_npm() {
  if [ -z "$NPM_CMD" ]; then
    return 127
  fi
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

node_packages_ok() {
  node -e "require('rollup'); require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')" >/dev/null 2>&1
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
  if [ -z "$NPM_CMD" ]; then
    add_missing "Missing npm packages: run npm install"
    return
  fi
  if ! node_packages_ok; then
    echo "Node packages look incomplete for this machine. Trying npm install ..."
    if run_npm install >/dev/null 2>&1 && node_packages_ok; then
      echo "npm packages repaired for this Linux environment."
      return
    fi
    add_missing "Missing npm packages: run npm install"
    add_missing "If Rollup native modules are still missing on Linux/ARM, remove node_modules and package-lock.json and reinstall inside the VM"
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
      missing_output="$("$PYTHON_CMD" scripts/check_runtime_requirements.py --requirements backend/requirements.txt 2>/dev/null)"
      status=$?
      if [ "$status" -eq 0 ]; then
        echo "Python runtime packages repaired in .venv."
        return
      fi
    fi
    if [ "$status" -eq 1 ]; then
      mapfile -t missing_packages < <(printf '%s\n' "$missing_output" | sed '/^$/d')
      if [ "${#missing_packages[@]}" -gt 0 ]; then
        echo "Trying targeted install for missing runtime packages ..."
        if install_missing_python_packages "${missing_packages[@]}"; then
          missing_output="$("$PYTHON_CMD" scripts/check_runtime_requirements.py --requirements backend/requirements.txt 2>/dev/null)"
          status=$?
          if [ "$status" -eq 0 ]; then
            echo "Python runtime packages repaired in .venv."
            return
          fi
        fi
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

check_ollama_status() {
  if [ -z "$PYTHON_CMD" ]; then
    add_optional "Python environment unavailable; AiRA cannot load the Ollama client"
    return
  fi

  if ! "$PYTHON_CMD" -c "import ollama" >/dev/null 2>&1; then
    add_optional "Ollama Python package missing; AiRA will stay unavailable until it installs"
    return
  fi

  if command -v ollama >/dev/null 2>&1 && ! ollama list >/dev/null 2>&1; then
    add_optional "Ollama is installed but the local Ollama server is not responding"
  fi
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
  echo "  pip install -r backend/requirements-optional.txt"
  echo ""
}

print_optional_summary() {
  if [ "${#OPTIONAL_ITEMS[@]}" -eq 0 ]; then
    echo "AiRA / feature tooling: ready"
    return
  fi

  echo "AiRA / feature tooling status:"
  for item in "${OPTIONAL_ITEMS[@]}"; do
    echo " - $item"
  done
  echo " - EXDA can still run; only optional features stay limited"
}

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1
    wait "$BACKEND_PID" 2>/dev/null
  fi
  if [ -n "${VITE_PID:-}" ] && kill -0 "$VITE_PID" >/dev/null 2>&1; then
    kill "$VITE_PID" >/dev/null 2>&1
    wait "$VITE_PID" 2>/dev/null
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

  local app_url="http://${FRONTEND_HOST}:${FRONTEND_PORT}/?backendPort=${BACKEND_PORT}"
  echo "Starting EXDA frontend on http://${FRONTEND_HOST}:${FRONTEND_PORT} ..."
  echo "App URL:"
  echo "  ${app_url}"

  "$REPO_ROOT/node_modules/.bin/vite" --config frontend/vite.config.js --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" &
  VITE_PID=$!

  if [ "${EXDA_OPEN_BROWSER:-1}" != "0" ] && command -v xdg-open >/dev/null 2>&1; then
    (
      for _ in $(seq 1 30); do
        if curl -fsS "http://${FRONTEND_HOST}:${FRONTEND_PORT}" >/dev/null 2>&1; then
          xdg-open "$app_url" >/dev/null 2>&1 || true
          exit 0
        fi
        sleep 1
      done
    ) &
  fi

  wait "$VITE_PID"
}

print_header
seed_gui_path
check_command node
resolve_npm
resolve_python
activate_local_venv || add_missing "Could not activate the local .venv"
check_runtime_defaults
check_node_packages
check_python_packages
check_optional_python_packages
check_ollama_status

if [ "${#MISSING_ITEMS[@]}" -gt 0 ]; then
  print_missing_summary
  pause_on_error
  exit 1
fi

print_optional_summary
start_app
