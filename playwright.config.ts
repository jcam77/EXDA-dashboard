import { defineConfig, devices } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// The e2e tests run their own EXDA on separate ports with a temporary projects
// folder, so they never use the maintainer's running EXDA (5077/5173) or real
// project data. Override with EXDA_E2E_BACKEND_PORT / EXDA_E2E_FRONTEND_PORT.
const BACKEND_PORT = process.env.EXDA_E2E_BACKEND_PORT ?? "5055";
const FRONTEND_PORT = process.env.EXDA_E2E_FRONTEND_PORT ?? "5175";
const PROJECTS_ROOT = path.join(os.tmpdir(), "exda-e2e-projects");
fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [["html", { outputFolder: "test-report-results", open: "never" }]],
  outputDir: "test-report-results",
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: [
    {
      command: `npx vite --config frontend/vite.config.js --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      env: { EXDA_BACKEND_PORT: BACKEND_PORT },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "node scripts/run-python.mjs backend/app.py",
      url: `http://127.0.0.1:${BACKEND_PORT}/list_directories?path=/tmp`,
      env: {
        EXDA_BACKEND_DEBUG: "0",
        EXDA_BACKEND_PORT: BACKEND_PORT,
        EXDA_FRONTEND_PORT: FRONTEND_PORT,
        EXDA_PROJECTS_ROOT: PROJECTS_ROOT,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
