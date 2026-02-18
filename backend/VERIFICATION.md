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
- `Impulse`: integral from start of signal to first point where pressure decays below the configured cutoff fraction of `pMax`.
- `Impulse cutoff`: user-configurable as `% of Pmax` in UI.

Interpretation:

- `100%` means integrate from start to peak only.
- `50%` means integrate until pressure decays below `0.5 * Pmax`.
- `5%` means integrate until pressure decays below `0.05 * Pmax`.

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

## Run Command

Run all calculation verification checks:

```bash
python3 -m unittest -v backend/tests/test_calculations_reference.py
```
