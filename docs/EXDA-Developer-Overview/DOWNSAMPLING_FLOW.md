# EXDA Downsampling Flow (Detailed)

This document explains where and why sample reduction happens in EXDA for raw data preview and plotting.

## Pressure analysis is never decimated (EXDA-Check B1)

Everything below applies to **preview and plotting only**.

Pressure metrics (pMax, tMax, impulse) are computed by `POST /analyze_pressure_file`,
which reads the selected channel directly from the TPC5/MF4/text file at full resolution
(`backend/modules/daq_reader.py`) and processes every sample
(`pressure_analysis.analyze_pressure_signal`). There is no "full-resolution" toggle for
analysis any more. The plot series returned with the metrics is reduced with a
**min/max envelope** (each of 2,000 time bins keeps its minimum and maximum sample), so
peaks stay visible; index picking is not used there. Each result carries a `processing`
record: samples analysed, fs, unit and its origin, gauge/absolute and P0, baseline,
filter (type, order, cutoff, fs, applied, resampled) and warnings.

It reflects the current `RawDataScreeningCorePage` flow for `.mf4`, `.tpc5`, and text-like files.

## Quick Answer (Method Used)

When EXDA reduces sample count for the preview, it uses a **min/max envelope**
(`backend/modules/signal_reduction.py`), not uniform index picking, filtering or interpolation.

- The signal is split into equal intervals; in every interval each channel keeps its
  lowest and its highest sample (existing samples only, no new values).
- Peaks and clipped plateaus are therefore always visible, and the plotted maximum
  equals the true maximum of the file (checked on a real 1 MHz DAQ-1 file: uniform
  picking showed peaks up to 46 % too low; the envelope matched exactly).
- No low-pass filter and no interpolation are applied.
- The first and last sample are always kept.

The readers also report the **real** sample count and sampling rate (before reduction)
in `sampleInfo` (`/read_project_file`), and `/preview_multichannel` shows them in its
summary (`totalSamples`, `samplingRateHz`, `reduction`). Before, the sampling rate was
computed from the reduced rows and was wrong in fast preview.

## What the envelope does not show

Between the kept points the line is drawn straight, so the exact waveform shape (and
fine timing between extremes) needs Full Resolution or a tight time window.

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
  |-- NO  --> One-step reduction at read stage (TPC5 / MF4)
              min/max envelope, about maxPoints rows
              (at most ~2 x maxPoints for many channels)

  |
  v
/preview_multichannel parse
  |
  v
If rows > maxPoints (text files): min/max envelope to about maxPoints
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

`/preview_multichannel` reduces text files (read in full) the same way:

- If `sampleCount > maxPoints`, it keeps a min/max envelope of about `maxPoints` rows.
- TPC5/MF4 content arrives already reduced; its real `totalSamples` and
  `samplingRateHz` come from the reader via `sourceInfo`.

### All reduction paths use the same envelope

`signal_reduction.envelope_row_indices` is used by the TPC5 reader, the MF4 reader,
the text-file time window (`_apply_time_window_to_text_content`) and
`/preview_multichannel`. No path picks evenly spaced samples any more.

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
