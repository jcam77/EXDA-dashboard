# Playwright Tests

## Test Files

- `tests/smoke.spec.ts` (15 tests)
- `tests/experiment-selection.spec.ts` (4 tests)

Total: 19 tests.

## Coverage Overview

### `smoke.spec.ts`
- Home shell and top-level navigation.
- Loaded-project workspace tabs and page navigation.
- Core backend endpoints and validation paths.
- AI endpoints (`/get_models`, `/app_repo_context`, SSE headers).
- Stability checks (console errors, viewport rendering).

### `experiment-selection.spec.ts`
- Import Data selectors for pressure/flame files.
- Queue insertion + checkbox state after selection.
- Dropdown options exclude directory entries.
- Queue item removal sync.

## How to run

Run complete suite:

```bash
npm test
```

Run smoke-only:

```bash
npm run smoke
```

Run experiment-selection only:

```bash
npx playwright test tests/experiment-selection.spec.ts
```

## Reports

```bash
npm run test:report
```

Artifacts are stored in `test-report-results/`.

## Notes

- Playwright starts frontend and backend using `playwright.config.ts` web servers.
- Both specs create isolated temp projects under `/tmp` for deterministic test data.
- Override backend URL with `BACKEND_URL` if needed.
