# Smoke Tests (v0.2)

## Coverage Overview

This suite uses Playwright to check both UI and backend health:

### UI checks (Playwright browser)
- Home page: hero heading, project action buttons, footer headings
- Main navigation: Home, Projects, AiRA tabs
- Projects page: cards, status filter, filter options
- AiRA page: workspace heading, cloud badge, warning
- Analysis tabs: navigation and controls (if project loaded)
- Keyboard shortcuts overlay (press `?`)
- Theme toggle button
- Responsive layout: desktop and tablet
- No React error boundary or console errors on load

### API checks (Playwright request)
- `/list_directories` responds and returns directories
- `/get_models` responds and returns models
- `/projects_overview` responds and returns overview
- `/analyze` (POST) accepts pressure data
- `/aggregate_plot` (POST) endpoint exists
- `/list_research_pdfs` (GET) accepts projectPath param
- `/get_state` returns session state (if implemented)

### Integration
- App loads without React or console errors
- Works on desktop and tablet viewports

## How to run

```bash
npm run smoke
```
npx playwright test tests/experiment-selection.spec.ts

If Playwright reports missing system libraries, run:

```bash
npx playwright install-deps
```

## Reports

After running tests, open the HTML report:

```bash
npm run test:report
```

The report (and any minimal artifacts) are stored in the single folder:

- test-report-results/

If you see "No report found", run the smoke tests first:

```bash
npx playwright test tests/smoke.spec.ts --reporter=html
```

## Notes

- Frontend dev server is started automatically by Playwright.
- Backend must be running before executing the smoke tests (suite fails fast if it is not reachable).
- Smoke tests now create a temporary project under `/tmp` for deterministic API checks.
- You can override the backend URL with `BACKEND_URL`, for example:

```bash
BACKEND_URL="http://127.0.0.1:5000" npm run smoke
```
