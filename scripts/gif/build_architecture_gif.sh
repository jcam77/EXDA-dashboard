#!/usr/bin/env bash
set -euo pipefail

INPUT_MP4="${1:-frontend/assets/architecture-gif/exda-architecture-flow.mp4}"
OUTPUT_GIF="${2:-frontend/public/EXDAArchitectureFlow.gif}"
PALETTE_FILE="/tmp/exda_arch_palette.png"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required but was not found." >&2
  exit 1
fi

if [[ ! -f "$INPUT_MP4" ]]; then
  echo "Input video not found: $INPUT_MP4" >&2
  exit 1
fi

echo "Generating palette..."
ffmpeg -y -i "$INPUT_MP4" -vf "fps=10,scale=640:360:flags=lanczos,palettegen" "$PALETTE_FILE"

echo "Building GIF..."
ffmpeg -y -i "$INPUT_MP4" -i "$PALETTE_FILE" -lavfi "fps=10,scale=640:360:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "$OUTPUT_GIF"

echo "Done: $OUTPUT_GIF"
