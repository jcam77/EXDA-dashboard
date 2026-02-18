#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OCTAVE_SCRIPT="${ROOT_DIR}/backend/tests/scripts/comparison/octave/verify_ewt_peak_metrics_octave.m"

if [[ -z "${EWT_TOOLBOX_PATH:-}" ]]; then
  for candidate in \
    "${ROOT_DIR}/backend/tests/third_party/Empirical-Wavelets-master" \
    "${ROOT_DIR}/backend/tests/third_party/Empirical-Wavelets" \
    "${ROOT_DIR}/backend/tests/third_party/ewt"; do
    if [[ -d "${candidate}" ]]; then
      export EWT_TOOLBOX_PATH="${candidate}"
      break
    fi
  done
fi

if ! command -v octave >/dev/null 2>&1; then
  echo "Octave is not installed or not in PATH."
  exit 1
fi

if [[ -z "${EWT_TOOLBOX_PATH:-}" ]]; then
  echo "EWT_TOOLBOX_PATH is not set."
  echo "Set it to your Empirical-Wavelets toolbox path, for example:"
  echo "  export EWT_TOOLBOX_PATH=/path/to/Empirical-Wavelets-master"
  echo "Or place the toolbox under backend/tests/third_party/Empirical-Wavelets-master"
  echo "Then rerun this command."
  exit 1
fi

echo "Running Octave EWT peak export..."
octave --quiet "${OCTAVE_SCRIPT}"
