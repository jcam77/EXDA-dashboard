Plan

Detailed App Verification Plan

Summary
- Keep the E2E surface in sync with the refactored workspace architecture.
- Validate both shell-level and loaded-project flows.
- Validate import workflows for experiment selection.
- Keep API smoke coverage broad and deterministic with temp project fixtures.

Current Test Inventory
- `frontend/tests/backend-url.test.js`:
  - Backend URL parsing and default port behavior.
- `frontend/tests/recent-projects.test.js`:
  - Recent-project persistence, de-duplication, and max-size behavior.
- `tests/e2e/app-workflow-and-api.spec.ts`:
  - UI shell navigation and workspace tab coverage.
  - Backend API happy-path and validation checks.
  - AI endpoint availability and SSE header checks.
  - Integration sanity (console errors + viewport render).
- `tests/e2e/import-data-selection.spec.ts`:
  - Pressure/flame selector interaction.
  - Queue row and checkbox behavior.
  - Directory filtering in selector options.
  - Removal sync behavior.

Execution
- Full verification: `npm test`
- Frontend unit only: `npm run test:frontend`
- Smoke only: `npm run smoke`
- Import workflow only: `npx playwright test tests/e2e/import-data-selection.spec.ts`

Assumptions
- Backend is reachable at `http://127.0.0.1:5000` unless `BACKEND_URL` is set.
- Tests may require permission to bind local ports (`5173`, `5000`) in restricted environments.
- Temp projects are created under `/tmp` and cleaned automatically after test runs.
