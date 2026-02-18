# Testing Guide

## Test Types

- Backend calculations: `backend/tests/test_calculations_reference.py`
- Frontend unit tests: `frontend/tests/*.test.js`
- End-to-end (Playwright): `tests/e2e/*.spec.ts`

## Backend Test Data Layout

- Reference inputs: `backend/tests/reference_data/`
- Result exports: `backend/tests/results/`
- Octave comparison scripts: `backend/tests/scripts/comparison/octave/`
- Python comparison scripts: `backend/tests/scripts/comparison/python/`
- Python auxiliary scripts: `backend/tests/scripts/auxiliary/python/`

## E2E Files

- `tests/e2e/app-workflow-and-api.spec.ts` (15 tests)
- `tests/e2e/import-data-selection.spec.ts` (4 tests)

## Commands

- Backend only:
```bash
npm run test:backend
```

- Octave reference export (writes `backend/tests/results/pressure_metrics_octave.csv`):
```bash
npm run test:octave
```

- Python pressure metrics export (writes `backend/tests/results/pressure_metrics_python.csv`):
```bash
python3 backend/tests/scripts/comparison/python/verify_pressure_metrics_python.py
```

- EWT Octave reference export for Verification-page peak alignment:
```bash
npm run test:ewt:octave
```

- Frontend unit only:
```bash
npm run test:frontend
```

- E2E only:
```bash
npm run test:e2e
```

- Full suite:
```bash
npm run test:all
```

- Default `npm test`:
```bash
npm test
```

- E2E HTML report:
```bash
npm run test:report
```

## Notes

- Playwright output is stored in `test-report-results/`.
- Playwright starts frontend/backend servers from `playwright.config.ts`.
- Backend verification output is terminal-based (not in Playwright HTML).
