# EXDA Downsampling Flow (Detailed)

This document explains where and why sample reduction happens in EXDA for raw data preview and plotting.

It reflects the current `RawDataScreeningCorePage` flow for `.mf4`, `.tpc5`, and text-like files.

## Quick Answer (Method Used)

When EXDA reduces sample count, it uses **index-based decimation** (uniform row picking), not filtering and not interpolation.

- No low-pass anti-alias filter is applied.
- No interpolation is applied.
- Rows are selected from existing samples using evenly spaced indices.

## Important Warning

This method is optimized for speed, not waveform fidelity.

- It can miss narrow peaks/transients.
- It can shift apparent transient timing in the reduced view.
- It can show aliasing-like visual artifacts.

Use reduced preview for navigation, then confirm timing/amplitude conclusions with Full Resolution (or a tight time window).

## Per-channel or total?

Limits are applied to **rows/time-points**, not to the sum across channels.

- If parsed data is `N rows x C channels`, EXDA chooses row indices from `0..N-1`.
- The same chosen row indices are applied to all channels.

## Downsampling Diagram (Plain Black/White)

```text
Raw file
  |
  v
Read + optional time window
  |
  v
Full Resolution?
  |-- YES --> Keep all rows
  |
  |-- NO  --> One-step decimation at read stage
              target rows = min(maxPoints, safety_cap)
              idx = linspace(0, N-1, target)

  |
  v
/preview_multichannel parse
  |
  v
If rows > maxPoints (fallback only): decimate to maxPoints
Else: keep rows
  |
  v
Render plot
```

## 1) End-to-End Data Path

1. Frontend asks backend for file content  
   `frontend/src/pages/RawDataScreeningCorePage.jsx` -> `GET /read_project_file`

2. Backend reads and serializes file content  
   `backend/routes/state.py` -> `read_project_file()`

3. Frontend sends content to preview parser  
   `frontend/src/pages/RawDataScreeningCorePage.jsx` -> `POST /preview_multichannel`

4. Backend parses and returns plot rows  
   `backend/routes/calculation_api_routes.py::preview_multichannel()`

5. Frontend renders returned rows in uPlot  
   `frontend/src/components/HighResMultiChannelPlot.jsx`

## 2) Where Downsampling Happens (Current)

### Effective Step (read stage)

Primary decimation now happens at **read stage** in `/read_project_file`.

- If `fullResolution=1`: `max_samples=0` (no downsampling).
- If `fullResolution=0`: `max_samples = min(maxPoints, safety_cap)`.
- Current hidden `safety_cap = 2,000,000` rows (emergency guard).

This means reduced plotting data is usually prepared in one step before preview parsing.

### Fallback Step (preview stage)

`/preview_multichannel` still has a defensive fallback:

- If incoming `sampleCount > maxPoints`, it decimates again to `maxPoints`.
- In normal one-step flow this should rarely trigger.

### Integer rule used in code

Two integer-selection paths still exist in code:

1. `.mf4`/`.tpc5`/preview decimation path:
   - `idx = np.linspace(0, N-1, K, dtype=int)`
   - Uniform spacing + integer conversion.

2. Text window helper path (`_apply_time_window_to_text_content`):
   - `pick_i = round(i * (N-1) / (K-1))`, for `i = 0..K-1`
   - Explicit nearest-integer rounding.

### Rounding note (Python)

- `round(2.4) -> 2`
- `round(2.6) -> 3`
- `round(2.5) -> 2`, `round(3.5) -> 4` (ties to even)
- `int(2.9) -> 2` (truncation)

## 3) Numeric Examples

### One-step normal case

- `N = 1,000,000`, `maxPoints = 2,000`, `fullResolution = OFF`
- Read stage downsamples directly to `2,000` rows
- Preview stage keeps rows (no second pass)

### Safety/fallback case

- If read stage cannot reduce to target (or receives larger content), preview may still apply fallback decimation to `maxPoints`

## 4) Time Window Interaction

If `windowStart/windowEnd` are set, windowing happens first, then downsampling is applied to the windowed rows.

## 5) Compare Mode Behavior

In compare mode:

- Each selected file goes through the same read/preview pipeline.
- Overlay merges by exact timestamps (no interpolation).
- Mixed-rate constraints can disable overlay for correctness.

## 6) Inspector vs Plot Preview

Import tab inspector is separate from plot preview.

- Inspector 50-row table is for structure visibility only.
- It does not control screening-plot downsampling.

## 7) Practical Rules

1. For final event timing checks, use Full Resolution or a narrow time window.
2. Use reduced mode for fast browsing/navigation.
3. Be cautious with transient interpretation in heavily reduced views.

## 8) Code Reference Map

- Frontend orchestration:
  - `frontend/src/pages/RawDataScreeningCorePage.jsx`
- Read stage + window + read-time cap:
  - `backend/routes/state.py`
- Binary parsers:
  - `backend/modules/mf4_parser.py`
  - `backend/modules/tpc5_parser.py`
- Preview parser/fallback cap:
  - `backend/routes/calculation_api_routes.py`
- Plot renderer:
  - `frontend/src/components/HighResMultiChannelPlot.jsx`
