Plan

Enhance v0.2 Smoke Tests for Broader Error Coverage
Summary
We’ll expand smoke.spec.ts to add deterministic project‑lifecycle API checks using a temp project in /tmp, add negative tests to validate error handling (4xx/5xx), add a strict backend preflight that fails fast if the API is down, and add a safe AI SSE header check. We’ll also update README.md to document the new behavior and the BACKEND_URL override.

Important Changes or Additions to Public APIs/Interfaces/Types

No product API changes.
Test interface addition: BACKEND_URL environment variable used by smoke.spec.ts (default remains http://127.0.0.1:5000).
Plan

Update test config constants and helpers in smoke.spec.ts.

Replace BACKEND_URL constant with 127.0.0.1:5000".
Add Node imports: fs, os, path.
Add a waitForBackend(request) helper that polls GET /list_directories?path=/tmp for up to 15–30s and throws a clear error if unreachable.
Add a lightweight probeSse(url) helper that uses fetch plus AbortController to validate SSE headers without waiting for the stream to finish.
Add deterministic project setup and cleanup in a serial API describe block.

Add test.describe("API: Project Lifecycle", () => { test.describe.configure({ mode: "serial" }); ... }).
In beforeAll:
Create a temp parent folder via fs.mkdtempSync(path.join(os.tmpdir(), "exda-smoke-")).
Call POST /create_project_at_path with parentPath=<tempRoot> and projectName="SmokeTestProject".
Create a small CSV in sample.csv via fs.writeFileSync.
Call POST /save_plan with a minimal JSON plan string to create a plan file.
Store projectPath and returned plan path for later tests.
In afterAll:
fs.rmSync(tempRoot, { recursive: true, force: true }) to clean up.
Replace or upgrade API checks to cover more endpoints and error conditions.

Keep existing happy‑path checks for:
GET /list_directories (switch to ?path=<tempRoot> so it’s deterministic and avoids repo mutation).
GET /get_models (assert success: true and models length > 0).
GET /projects_overview (assert success: true and overview string).
POST /analyze with valid sample content (assert status < 500).
POST /aggregate_plot (assert status !== 404).
GET /list_research_pdfs?projectPath=<projectPath> (assert success: true).
Replace /get_state check with /get_project_state?projectPath=<projectPath> and assert:
success: true
plan is object or null but not an error
data_files includes sample.csv
Add negative/error‑path tests:
POST /analyze with invalid content (expect 400 and { error: "Parse Error" }).
GET /list_directories?path=/definitely-not-real (expect 404 and success: false).
POST /update_project_status with invalid status (expect status >= 400 and success: false).
Add AI streaming endpoint smoke check with safe abort.

New test GET /ai_research_stream?query=smoke:
Use fetch + AbortController (timeout ~1–2s).
Assert status === 200.
Assert content-type includes text/event-stream.
Abort immediately after headers are received (or after timeout) to avoid hanging.
Keep UI tests intact, but add a strict backend preflight.

Add a top‑level test.beforeAll in the API section calling waitForBackend so the suite fails fast if the backend is not running.
Leave UI checks unchanged to avoid selector churn, unless we discover a selector failure during implementation.
Update documentation in README.md.

Note the new temp‑project behavior in /tmp.
Document BACKEND_URL override.
Re‑emphasize that backend must be running (tests will now fail fast if it is not).
Test Cases and Scenarios

npm run smoke
smoke.spec.ts
Validate fast‑fail behavior by stopping backend and running smoke (should fail with clear message).
Validate that temp project is created and removed from /tmp after tests.
Assumptions and Defaults

We will use /tmp for temporary project data and fully clean it after the suite.
Backend checks are strict: the suite fails if the backend is not reachable.
AI endpoint check only validates SSE headers and does not require a full model response.
We will not add new UI selectors or change frontend code unless a test is failing without stable selectors.