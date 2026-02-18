import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:5000";
const BACKEND_WAIT_TIMEOUT_MS = 30_000;
const SSE_PROBE_TIMEOUT_MS = 10_000;
const TEMP_PROJECT_PREFIX = "exda-smoke-";

let tempRoot: string | undefined;
let projectPath: string | undefined;
let planPath: string | null = null;

async function waitForBackend(request: APIRequestContext) {
  const start = Date.now();
  let lastError = "unknown";
  while (Date.now() - start < BACKEND_WAIT_TIMEOUT_MS) {
    try {
      const url = `${BACKEND_URL}/list_directories?path=${encodeURIComponent(os.tmpdir())}`;
      const response = await request.get(url);
      if (response.ok()) return;
      lastError = `status ${response.status()}`;
    } catch (err: any) {
      lastError = err?.message ?? String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Backend not reachable at ${BACKEND_URL}. Last error: ${lastError}`);
}

async function probeSse(url: string) {
  const fetchFn = (globalThis as any).fetch as ((input: any, init?: any) => Promise<any>) | undefined;
  if (!fetchFn) {
    throw new Error("global fetch is not available; Node 18+ is required for SSE probe");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SSE_PROBE_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    });
    const contentType = response.headers?.get?.("content-type") ?? "";
    controller.abort();
    return { status: response.status, contentType };
  } finally {
    clearTimeout(timer);
  }
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

test.beforeAll(async ({ request }) => {
  await waitForBackend(request);

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PROJECT_PREFIX));
  const createResponse = await request.post(`${BACKEND_URL}/create_project_at_path`, {
    data: {
      parentPath: tempRoot,
      projectName: "SmokeTestProject",
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const createData = await createResponse.json();
  expect(createData.success).toBe(true);
  projectPath = createData.path;

  const activeProject = requireProjectPath(projectPath);
  const rawDataRoot = path.join(activeProject, "Raw_Data");
  fs.mkdirSync(path.join(rawDataRoot, "exp"), { recursive: true });
  fs.writeFileSync(path.join(rawDataRoot, "exp", "sample.csv"), "0,100000\n0.1,101000\n0.2,102000\n");

  const simProbeDir = path.join(rawDataRoot, "postProcessing", "CaseA", "pTProbes", "probe1");
  fs.mkdirSync(simProbeDir, { recursive: true });
  fs.writeFileSync(path.join(simProbeDir, "p"), "0 100000\n0.001 101000\n0.002 101500\n");

  const toaDir = path.join(rawDataRoot, "postProcessing", "CaseA", "TOAProbs", "0");
  fs.mkdirSync(toaDir, { recursive: true });
  fs.writeFileSync(path.join(toaDir, "b"), "0 0\n0.1 1\n");

  const ventDir = path.join(rawDataRoot, "postProcessing", "CaseA", "ventTOAProb", "0");
  fs.mkdirSync(ventDir, { recursive: true });
  fs.writeFileSync(path.join(ventDir, "b"), "0 0\n0.1 1\n");

  const planContent = JSON.stringify(
    {
      planName: "Smoke_Test_Plan",
      meta: { objective: "Smoke Test Plan", description: "Validation of smoke path" },
      experiments: [{ id: "exp-1", name: "Smoke Exp", done: false }],
    },
    null,
    2
  );

  const saveResponse = await request.post(`${BACKEND_URL}/save_plan`, {
    data: {
      projectPath: activeProject,
      filename: "smoke-plan.json",
      content: planContent,
    },
  });
  expect(saveResponse.ok()).toBeTruthy();
  const saveData = await saveResponse.json();
  if (saveData?.path) planPath = saveData.path;
});

test.afterAll(() => {
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test.describe("UI: Home and Shell", () => {
  test("renders hero content and global actions", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Hydrogen Explosion/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Projects", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "AiRA", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Project" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Project" }).first()).toBeVisible();
  });

  test("opens keyboard shortcuts overlay with ?", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "?",
          shiftKey: true,
          bubbles: true,
        })
      );
    });
    await expect(page.getByText("Keyboard Shortcuts")).toBeVisible();
  });

  test("navigates to Projects and AiRA from home shell", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Research Projects/i })).toBeVisible();

    await page.getByRole("button", { name: "AiRA", exact: true }).click();
    await expect(page.getByText(/AiRA can make mistakes/i)).toBeVisible();
  });
});

test.describe("UI: Workspace Tabs With Loaded Project", () => {
  test.beforeEach(async ({ page }) => {
    await seedProjectForWorkspace(page);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Checklist", exact: true })).toBeVisible();
  });

  test("shows all primary workspace tabs", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Checklist", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Plan", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Gas Mixing", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import Data", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Empirical Wavelet Transform|EWT/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pressure Analysis", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "CFD Validation", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Flame Speed Analysis", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "AiRA", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Report", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Literature", exact: true })).toBeVisible();
  });

  test("navigates key analysis/report/resource pages", async ({ page }) => {
    await page.getByRole("link", { name: "Import Data", exact: true }).click();
    await expect(page.getByText(/Experiments Data/i)).toBeVisible();

    await page.getByRole("link", { name: /Empirical Wavelet Transform|EWT/i }).click();
    await expect(page.getByText(/Empirical Wavelet Transform/i)).toBeVisible();

    await page.getByRole("link", { name: "Pressure Analysis", exact: true }).click();
    await expect(page.getByText(/Pressure vs Time \(Experiments\)/i)).toBeVisible();

    await page.getByRole("link", { name: "CFD Validation", exact: true }).click();
    await expect(page.getByText(/CFD Validation: Pressure vs Time/i)).toBeVisible();

    await page.getByRole("link", { name: "Report", exact: true }).click();
    await expect(page.getByText(/Experimental Test Report/i)).toBeVisible();

    await page.getByRole("link", { name: "Literature", exact: true }).click();
    await expect(page.getByText(/Research Library/i)).toBeVisible();
  });
});

test.describe("API: Core and Analysis", () => {
  test("GET /list_directories returns directories", async ({ request }) => {
    if (!tempRoot) throw new Error("Temp root not initialized");
    const response = await request.get(`${BACKEND_URL}/list_directories?path=${encodeURIComponent(tempRoot)}`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.directories)).toBe(true);
  });

  test("GET /projects_overview and /project_plan_summary return data", async ({ request }) => {
    const activeProject = requireProjectPath(projectPath);
    const overviewRes = await request.get(`${BACKEND_URL}/projects_overview`);
    expect(overviewRes.ok()).toBeTruthy();
    const overviewData = await overviewRes.json();
    expect(overviewData.success).toBe(true);

    const summaryRes = await request.get(
      `${BACKEND_URL}/project_plan_summary?path=${encodeURIComponent(activeProject)}`
    );
    expect(summaryRes.ok()).toBeTruthy();
    const summaryData = await summaryRes.json();
    expect(summaryData.success).toBe(true);
  });

  test("GET /get_project_state returns seeded files", async ({ request }) => {
    const activeProject = requireProjectPath(projectPath);
    const response = await request.get(
      `${BACKEND_URL}/get_project_state?projectPath=${encodeURIComponent(activeProject)}`
    );
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);

    const dataNames = (data.data_files || []).map((file: any) => file.name || file.rel || file.path || "");
    expect(dataNames.some((name: string) => name.includes("sample.csv"))).toBeTruthy();

    const simNames = (data.sim_files || []).map((file: any) => file.name || file.rel || file.path || "");
    expect(simNames.some((name: string) => name === "p" || name.includes("/p"))).toBeTruthy();
  });

  test("POST /analyze_pressure and /aggregate_plot process requests", async ({ request }) => {
    const pressureRes = await request.post(`${BACKEND_URL}/analyze_pressure`, {
      data: {
        content: "0.0 100000\n0.001 101000\n0.002 102000\n0.003 101500",
        cutoff: 100,
        order: 4,
        impulseDrop: 1.0,
      },
    });
    expect(pressureRes.ok()).toBeTruthy();
    const pressureData = await pressureRes.json();
    expect(pressureData.metrics || pressureData.plot_data).toBeTruthy();

    const aggregateRes = await request.post(`${BACKEND_URL}/aggregate_plot`, {
      data: {
        activeTab: "pressure_analysis",
        series: [
          {
            displayName: "SmokeSeries",
            plotData: [
              { time: 0, SmokeSeries: 100 },
              { time: 0.1, SmokeSeries: 120 },
            ],
          },
        ],
      },
    });
    expect(aggregateRes.ok()).toBeTruthy();
    const aggregateData = await aggregateRes.json();
    expect(Array.isArray(aggregateData.plotData)).toBe(true);
  });

  test("POST /analyze rejects invalid payload gracefully", async ({ request }) => {
    const response = await request.post(`${BACKEND_URL}/analyze`, {
      data: {
        content: "not-a-number",
        dataType: "pressure",
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
    const data = await response.json();
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });
});

test.describe("API: AI and State Safety", () => {
  test("GET /get_models and /app_repo_context return valid payloads", async ({ request }) => {
    const modelsRes = await request.get(`${BACKEND_URL}/get_models`);
    expect(modelsRes.ok()).toBeTruthy();
    const modelsData = await modelsRes.json();
    expect(modelsData.success).toBe(true);
    expect(Array.isArray(modelsData.models) || typeof modelsData.models === "object").toBeTruthy();

    const contextRes = await request.get(`${BACKEND_URL}/app_repo_context`);
    expect(contextRes.ok()).toBeTruthy();
    const contextData = await contextRes.json();
    expect(contextData.success).toBe(true);
    expect(typeof contextData.context).toBe("string");
    expect(contextData.context).toContain("Primary app structure files:");
  });

  test("GET /ai_research_stream returns SSE content type", async () => {
    const sseUrl = `${BACKEND_URL}/ai_research_stream?query=smoke&include_repo_context=0`;
    const { status, contentType } = await probeSse(sseUrl);
    expect(status).toBe(200);
    expect(contentType.toLowerCase()).toContain("text/event-stream");
  });

  test("Invalid path and invalid status are rejected", async ({ request }) => {
    const invalidPathRes = await request.get(`${BACKEND_URL}/list_directories?path=/definitely-not-real`);
    expect(invalidPathRes.status()).toBe(404);
    const invalidPathData = await invalidPathRes.json();
    expect(invalidPathData.success).toBe(false);

    const activeProject = requireProjectPath(projectPath);
    const invalidStatusRes = await request.post(`${BACKEND_URL}/update_project_status`, {
      data: {
        projectPath: activeProject,
        status: "not-a-real-status",
      },
    });
    expect(invalidStatusRes.status()).toBeGreaterThanOrEqual(400);
    const invalidStatusData = await invalidStatusRes.json();
    expect(invalidStatusData.success).toBe(false);
  });
});

test.describe("Integration: Stability", () => {
  test("no critical console errors on initial load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const criticalErrors = errors.filter(
      (err) => !err.includes("Failed to fetch") && !err.includes("net::ERR")
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("renders on desktop and tablet viewports", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Hydrogen Explosion/i })).toBeVisible();

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    await expect(page.getByRole("heading", { name: /Hydrogen Explosion/i })).toBeVisible();
  });
});
