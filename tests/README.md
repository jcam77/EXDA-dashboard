# Testing Guide

## Test Types

- Backend calculations: `backend/tests/test_calculations_reference.py`
- Frontend unit tests: `frontend/tests/*.test.js`
- End-to-end (Playwright): `tests/e2e/*.spec.ts`

## E2E Files

- `tests/e2e/app-workflow-and-api.spec.ts` (15 tests)
- `tests/e2e/import-data-selection.spec.ts` (4 tests)

## Commands

- Backend only:
```bash
npm run test:backend
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
