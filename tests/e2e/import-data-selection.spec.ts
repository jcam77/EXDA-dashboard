import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:5000";
const TEMP_PROJECT_PREFIX = "exda-exp-select-";
const BACKEND_WAIT_TIMEOUT_MS = 30_000;

let tempRoot: string | undefined;
let projectPath: string | undefined;

async function waitForBackend(request: APIRequestContext) {
  const start = Date.now();
  while (Date.now() - start < BACKEND_WAIT_TIMEOUT_MS) {
    try {
      const response = await request.get(
        `${BACKEND_URL}/list_directories?path=${encodeURIComponent(os.tmpdir())}`
      );
      if (response.ok()) return;
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Backend not reachable at ${BACKEND_URL}`);
}

function requireProjectPath(value: string | undefined) {
  if (!value) throw new Error("Temp project not initialized");
  return value;
}

async function seedProjectForWorkspace(page: Page) {
  const activeProject = requireProjectPath(projectPath);
  await page.addInitScript((pathValue: string) => {
    window.localStorage.setItem("currentProjectPath", pathValue);
    window.localStorage.setItem("resumeOnStartupOnce", "true");
  }, activeProject);
}

async function openImportData(page: Page) {
  await seedProjectForWorkspace(page);
  await page.goto("/data");
  await expect(page.getByRole("heading", { name: "Experiments Data", exact: true })).toBeVisible();
}

function queueRowFor(page: Page, fileName: string) {
  const escapedName = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page
    .locator("div.group")
    .filter({ has: page.locator('input[type="checkbox"]') })
    .filter({ hasText: new RegExp(`\\b${escapedName}\\b`) })
    .first();
}

async function dismissModalIfPresent(page: Page) {
  const overlay = page.locator("div.fixed.inset-0.z-50");
  const hasOverlay = await overlay.isVisible().catch(() => false);
  if (!hasOverlay) return;
  const closeButton = overlay.getByRole("button", { name: "Close", exact: true });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await expect(overlay).toBeHidden();
  }
}

test.beforeAll(async ({ request }) => {
  await waitForBackend(request);
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PROJECT_PREFIX));

  const createResponse = await request.post(`${BACKEND_URL}/create_project_at_path`, {
    data: { parentPath: tempRoot, projectName: "ExperimentSelectionProject" },
  });
  expect(createResponse.ok()).toBeTruthy();
  const createData = await createResponse.json();
  expect(createData.success).toBe(true);
  projectPath = createData.path;

  const activeProject = requireProjectPath(projectPath);
  const expRoot = path.join(activeProject, "Raw_Data", "exp");
  fs.mkdirSync(path.join(expRoot, "subfolder"), { recursive: true });
  fs.writeFileSync(path.join(expRoot, "pressure.csv"), "0.0,100000\n0.1,101000\n0.2,102000\n");
  fs.writeFileSync(path.join(expRoot, "flame.csv"), "0.0,0.0\n0.1,0.3\n0.2,0.8\n");
});

test.afterAll(() => {
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test.describe("Experiment Selection", () => {
  test("Selecting Pressure CSV adds to queue and checks tick box", async ({ page }) => {
    await openImportData(page);
    await page.getByTestId("pressure-csv-select").selectOption({ label: "pressure.csv" });

    const row = queueRowFor(page, "pressure.csv");
    await expect(row).toBeVisible();
    await expect(row.locator('input[type="checkbox"]')).toBeChecked();
  });

  test("Selecting Flame CSV adds to queue and checks tick box", async ({ page }) => {
    await openImportData(page);
    await page.getByTestId("flame-csv-select").selectOption({ label: "flame.csv" });

    const row = queueRowFor(page, "flame.csv");
    await expect(row).toBeVisible();
    await expect(row.locator('input[type="checkbox"]')).toBeChecked();
  });

  test("Only files are selectable, not folders", async ({ page, request }) => {
    await openImportData(page);
    const activeProject = requireProjectPath(projectPath);
    const stateResponse = await request.get(
      `${BACKEND_URL}/get_project_state?projectPath=${encodeURIComponent(activeProject)}`
    );
    expect(stateResponse.ok()).toBeTruthy();
    const stateData = await stateResponse.json();
    expect(stateData.success).toBe(true);

    const directoryPaths = new Set(
      (stateData.data_files || [])
        .filter((fileObj: any) => fileObj.isDirectory)
        .map((fileObj: any) => fileObj.path || fileObj.webkitRelativePath || "")
    );
    const optionValues = await page.locator('[data-testid="pressure-csv-select"] option').evaluateAll((opts) =>
      opts
        .map((opt) => (opt as HTMLOptionElement).value)
        .filter((value) => value && value !== "__all__")
    );

    for (const value of optionValues) {
      expect(directoryPaths.has(value)).toBeFalsy();
    }
  });

  test("Queue and selector stay in sync after removal", async ({ page }) => {
    await openImportData(page);
    await page.getByTestId("pressure-csv-select").selectOption({ label: "pressure.csv" });

    const row = queueRowFor(page, "pressure.csv");
    await expect(row).toBeVisible();
    await dismissModalIfPresent(page);
    await row.getByRole("button").click();
    await expect(row).toHaveCount(0);
  });
});
