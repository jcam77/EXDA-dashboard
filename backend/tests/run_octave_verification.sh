#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OCTAVE_SCRIPT="${ROOT_DIR}/backend/tests/scripts/comparison/octave/verify_pressure_metrics_octave.m"

if ! command -v octave >/dev/null 2>&1; then
  echo "Octave is not installed or not in PATH."
  echo "Install it first, then run: octave --quiet ${OCTAVE_SCRIPT}"
  exit 1
fi

octave --quiet "${OCTAVE_SCRIPT}"
