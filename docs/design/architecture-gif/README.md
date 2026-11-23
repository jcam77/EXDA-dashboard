# EXDA Architecture GIF Workspace

This folder stores editable source material for the architecture animation.

## Goal
Create a simple, reusable architecture GIF that explains EXDA workflow in ~20 seconds.

## Target style
- Match the style of the current `EXDAArchitectureFlow.gif` in this folder
- 640x360
- 10 fps
- ~20 seconds
- Minimal text and clean node/arrow flow

## Recommended workflow
1. Edit scene content in `storyboard.md`
2. Build visuals in your design tool (Figma/PowerPoint/Canva)
3. Export as `exda-architecture-flow.mp4` into this folder
4. Run:
   `bash scripts/gif/build_architecture_gif.sh docs/design/architecture-gif/exda-architecture-flow.mp4`
5. Final GIF is written to:
   `docs/design/architecture-gif/EXDAArchitectureFlow.gif`

## Files in this folder
- `storyboard.md`: phase-by-phase animation script
- `scene-spec.json`: quick machine-readable scene reference
- `palette.md`: app-aligned color palette (hex + token mapping)
