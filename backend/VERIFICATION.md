# Backend Calculation Verification

This document defines the canonical calculation checks for EXDA backend modules.

## Scope

The files below are part of the calculation verification path:

- `backend/modules/pressure_analysis.py`
- `backend/modules/ewt_analysis.py`
- `backend/modules/flame_analysis.py`
- `backend/modules/plot_interpolation.py` (visualization interpolation only)
- `backend/routes/calculation_api_routes.py` (API glue: parameter plumbing and response wrapping)

Notes:

- `backend/routes/calculation_api_routes.py` is **not** where formulas are implemented.
- `backend/modules/plot_interpolation.py` is **display-only interpolation**, not a physics calculator.

## Canonical Definitions

### Pressure Metrics

- `pMax`: maximum pressure value in processed signal.
- `tMax`: timestamp at `pMax`.
- `Impulse`: integral from start of signal to the first post-peak point where pressure is at or below the configured end threshold.
- `End threshold`: backend threshold as `% of Pmax`.
- UI control is `Allowed Decay From Pmax (%)` (`D`), mapped as:
  - `threshold = 100 - D`
  - `P_end = (1 - D/100) * Pmax`

Interpretation:

- `D = 0%` means integrate from start to peak only.
- `D = 50%` means integrate until pressure decays below `0.5 * Pmax`.
- `D = 95%` means integrate until pressure decays below `0.05 * Pmax`.

### EWT Metadata

- Mode energies are calculated per mode and normalized to percentages.
- Peak frequency per mode is estimated from periodogram maxima.
- Suggested filter cutoff is derived from cumulative energy trend when data is sufficient.

## Reference Test Suite

Reference tests live in:

- `backend/tests/test_calculations_reference.py`

These tests validate:

1. Formula-level pressure metric behavior on deterministic signals.
2. API vs module parity for pressure metrics.
3. Aggregation behavior as visualization-only transformation.
4. EWT output metadata shape (skipped automatically when `ewtpy` is unavailable).
5. Butterworth recovery behavior on a real reference trace with injected multi-frequency noise.

## Run Command

Run all calculation verification checks:

```bash
npm run test:backend
```

Run full verification sequence (backend + frontend unit + E2E):

```bash
npm run test:all
```

## Optional Cross-Platform Fixture Export

To generate a clean/noisy CSV pair for validation in Excel or MATLAB:

```bash
python3 backend/tests/scripts/auxiliary/python/generate_reference_data.py
```

Outputs are written to `backend/tests/reference_data/`.

## External Validation (MATLAB / Octave / Excel)

Reference files for external double-checks:

- `backend/tests/reference_data/experimental_data_001_clean.csv`
- `backend/tests/reference_data/experimental_data_001_noisy.csv`
- `backend/tests/reference_data/experimental_data_001_noisy_metadata.json`

MATLAB/Octave scripts implementing EXDA-style pressure calculations:

- `backend/tests/scripts/comparison/octave/verify_pressure_metrics_core.m`
- `backend/tests/scripts/comparison/octave/verify_pressure_metrics_octave.m` (writes pressure metrics CSV for the UI comparison)
- `backend/tests/results/pressure_metrics_octave.csv` (Octave export target for UI comparison table)
- `backend/tests/results/pressure_metrics_python.csv` (optional Python export target for direct CSV comparison)

Expected CSV header:

```csv
series,pMax,tMax,impulse,status
```

Expected `series` values:

- `clean_raw`
- `noisy_raw`
- `noisy_filtered`

Quick command (Octave):

```bash
npm run test:octave
```

Direct Octave command:

```bash
octave --quiet backend/tests/scripts/comparison/octave/verify_pressure_metrics_octave.m
```

Note for Octave users:

- Install/load the `signal` package for Butterworth filtering (`butter`, `filtfilt`).
- If unavailable, the script prints a warning and falls back to unfiltered resampled data.

Example (MATLAB/Octave function calls):

```matlab
metrics_clean = verify_pressure_metrics_core("backend/tests/reference_data/experimental_data_001_clean.csv", ...
    "DecayPercent", 95, "CutoffHz", 20, "Order", 4, "UseRaw", true);
metrics_noisy = verify_pressure_metrics_core("backend/tests/reference_data/experimental_data_001_noisy.csv", ...
    "DecayPercent", 95, "CutoffHz", 20, "Order", 4, "UseRaw", false);
```

## EWT Octave Reference (MATLAB-Compatible)

Goal: generate EWT mode peak frequencies using the Octave/MATLAB toolbox implementation and compare them in the Verification page against app Python EWT peaks.

Files involved:

- Octave script: `backend/tests/scripts/comparison/octave/verify_ewt_peak_metrics_octave.m`
- Wrapper: `backend/tests/run_octave_ewt_verification.sh`

Output file:

- `backend/tests/results/ewt_peak_metrics_octave.csv`

Setup:

1. Install the Empirical-Wavelets toolbox from GitHub.
2. Set toolbox path:

```bash
export EWT_TOOLBOX_PATH=/path/to/Empirical-Wavelets-master
```

Run:

```bash
npm run test:ewt:octave
```

This command:

1. Runs Octave EWT decomposition on the fixed noisy fixture.
2. Exports mode peak frequencies and energy percentages.
3. The Verification page computes Python-vs-Octave deltas live from this Octave reference.
