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

## Run Command

Run all calculation verification checks:

```bash
npm run test:backend
```

Run full verification sequence (backend + frontend unit + E2E):

```bash
npm run test:all
```
