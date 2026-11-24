// Record the user guide screenshots and videos from a running EXDA (MVP mode,
// light theme) with the synthetic demo projects of make_demo_project.py.
//
// Usage (from the repository root, with EXDA running against the demo projects):
//   node docs/EXDA-User-Guide/tools/record_guide_media.mjs <demo folder> [section ...]
// Environment: EXDA_URL (default http://127.0.0.1:5173), CHROME_PATH (optional
// browser executable). Sections: see SECTIONS below; default = all.
//
// Videos: MP4 (H.264, no sound) in docs/EXDA-User-Guide/videos/, screenshots in
// docs/EXDA-User-Guide/images/. Needs ffmpeg on the PATH.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('package.json'));
const { chromium } = require('playwright');

const GUIDE = path.resolve('docs/EXDA-User-Guide');
const IMAGES = path.join(GUIDE, 'images');
const VIDEOS = path.join(GUIDE, 'videos');
const RAW = path.join(GUIDE, 'tools', '.raw-videos');
const URL = process.env.EXDA_URL || 'http://127.0.0.1:5173';
const SIZE = { width: 1200, height: 750 };

const demoFolder = path.resolve(process.argv[2] || '');
const PROJECTS = path.join(demoFolder, 'EXDA-Projects');
const MAIN = path.join(PROJECTS, 'VH2D-Demo-2026');
if (!process.argv[2] || !existsSync(MAIN)) {
  console.error('Usage: node docs/EXDA-User-Guide/tools/record_guide_media.mjs <demo folder> [section ...]');
  process.exit(1);
}

// Visible mouse pointer with a click ripple (Playwright videos do not show the cursor).
const CURSOR_SCRIPT = () => {
  const install = () => {
    if (document.getElementById('__guide_cursor')) return;
    const cursor = document.createElement('div');
    cursor.id = '__guide_cursor';
    cursor.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:18px;height:18px;'
      + 'margin:-2px 0 0 -2px;left:-50px;top:-50px;transition:left .06s linear,top .06s linear;';
    cursor.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1 L2 15 L6 11 L9 17 L11.5 16 L8.6 10 L14 10 Z" '
      + 'fill="#111" stroke="#fff" stroke-width="1.2"/></svg>';
    document.body.appendChild(cursor);
    document.addEventListener('mousemove', (e) => { cursor.style.left = `${e.clientX}px`; cursor.style.top = `${e.clientY}px`; }, true);
    document.addEventListener('mousedown', (e) => {
      const ring = document.createElement('div');
      ring.style.cssText = `position:fixed;z-index:2147483646;pointer-events:none;left:${e.clientX - 14}px;top:${e.clientY - 14}px;`
        + 'width:28px;height:28px;border-radius:50%;border:2px solid rgba(20,140,170,.9);transition:all .45s ease-out;opacity:1;';
      document.body.appendChild(ring);
      requestAnimationFrame(() => {
        ring.style.transform = 'scale(1.8)';
        ring.style.opacity = '0';
      });
      setTimeout(() => ring.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
};

const pause = (page, ms) => page.waitForTimeout(ms);

// Move the visible pointer smoothly to an element, then click it.
const moveTo = async (page, locator) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('element not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await pause(page, 250);
};
const click = async (page, locator, after = 700) => {
  await moveTo(page, locator);
  await locator.click();
  await pause(page, after);
};
const typeInto = async (page, locator, text, after = 500) => {
  await click(page, locator, 200);
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 55 });
  await pause(page, after);
};

const removeLocks = () => {
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name === '.exda.lock') rmSync(full, { force: true });
      else if (statSync(full).isDirectory() && !['Raw_Data', 'History'].includes(name)) walk(full);
    }
  };
  walk(PROJECTS);
};

// Opens the demo project through the Open Project dialog (as a user would).
const openProject = async (page, projectPath = MAIN) => {
  await page.goto(`${URL}/`);
  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await page.getByRole('button', { name: 'Type or paste a path' }).click();
  await page.locator('div.max-w-xl input').fill(projectPath);
  await page.keyboard.press('Enter');
  await pause(page, 600);
  await page.locator('div.max-w-xl').getByRole('button', { name: /^Open$/ }).click();
  await page.waitForLoadState('load');
  await page.getByRole('heading', { name: /Project Description/i }).first().waitFor({ timeout: 20000 });
  await pause(page, 1200);
};

const goToTab = async (page, name) => {
  await click(page, page.getByRole('link', { name: new RegExp(`^\\W*${name}$`) }).first(), 1500);
};

const browserPromise = chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--no-sandbox'],
});

// Runs one section: `prepare` is not in the video, `act` is recorded.
const record = async (id, { prepare, act, video = true }) => {
  removeLocks();
  const browser = await browserPromise;
  mkdirSync(RAW, { recursive: true });
  const context = await browser.newContext({
    viewport: SIZE,
    colorScheme: 'light',
    ...(video ? { recordVideo: { dir: RAW, size: SIZE } } : {}),
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'light');
      localStorage.setItem('exda-mvp-mode', 'true');
    } catch { /* ignore */ }
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  const started = Date.now();
  if (prepare) await prepare(page);
  const trimSeconds = (Date.now() - started) / 1000;
  await act(page);
  await pause(page, 900);
  const videoHandle = video ? page.video() : null;
  await context.close();
  if (videoHandle) {
    const raw = await videoHandle.path();
    const out = path.join(VIDEOS, `${id}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', trimSeconds.toFixed(2), '-i', raw,
      '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    rmSync(raw, { force: true });
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
    console.log(`${id}.mp4  ${seconds.toFixed(0)} s`);
  }
};

const shot = (page, name) => page.screenshot({ path: path.join(IMAGES, `${name}.png`) });

// ---------------------------------------------------------------------------
// Sections (in the order of the guide)

const SECTIONS = {
  home: () => record('00-home', {
    video: false,
    act: async (page) => {
      await page.goto(`${URL}/`);
      await page.getByRole('button', { name: /Open Project/i }).first().waitFor();
      await pause(page, 1500);
      await shot(page, '00-home');
    },
  }),

  'open-project': () => record('01-open-project', {
    prepare: async (page) => {
      await page.goto(`${URL}/`);
      await page.getByRole('button', { name: /Open Project/i }).first().waitFor();
      await pause(page, 800);
    },
    act: async (page) => {
      await click(page, page.getByRole('button', { name: /Open Project/i }).nth(1), 1200);
      const dialog = page.locator('div.max-w-xl');
      await click(page, dialog.getByRole('button', { name: /EXDA projects/ }), 1000);
      await click(page, dialog.locator('[role=option]', { hasText: 'VH2D-Demo-2026' }), 900);
      await shot(page, '01-open-project');
      await click(page, dialog.getByRole('button', { name: /^Open$/ }), 400);
      await page.getByRole('heading', { name: /Project Description/i }).first().waitFor({ timeout: 20000 });
      await pause(page, 1800);
      await shot(page, '00-workspace');
    },
  }),

  'project-description': () => record('03-project-description', {
    prepare: openProject,
    act: async (page) => {
      await pause(page, 800);
      const field = page.getByLabel('Partners / funding', { exact: true });
      await click(page, field, 300);
      await field.pressSequentially('L', { delay: 120 });
      await pause(page, 1200);
      await shot(page, '03-project-description');
      await page.keyboard.press('ArrowDown');
      await pause(page, 500);
      await page.keyboard.press('Enter');
      await pause(page, 600);
      await field.pressSequentially('D', { delay: 120 });
      await pause(page, 800);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await pause(page, 1600);
      const status = page.getByText('All changes saved');
      await status.waitFor({ timeout: 10000 }).catch(() => {});
      await moveTo(page, page.getByRole('heading', { name: 'Extra fields' }));
      await click(page, page.getByRole('button', { name: 'Add field' }), 600);
      await typeInto(page, page.getByLabel('Name of extra field 1'), 'Vent configuration');
      await typeInto(page, page.getByRole('textbox', { name: 'Vent configuration', exact: true }), 'Thin film, 0.5 m2', 2500);
    },
  }),

  'projects-page': () => record('02-projects-page', {
    prepare: async (page) => {
      await page.goto(`${URL}/projects`);
      await page.getByText('VH2D-Demo-Wk22-2026').first().waitFor({ timeout: 20000 });
      await pause(page, 1200);
    },
    act: async (page) => {
      await page.locator('section', { hasText: 'EMP2X-Demo' }).first().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 160);
      await pause(page, 1200);
      await shot(page, '02-projects-page');
      await click(page, page.getByRole('button', { name: /EMP2X-Demo/ }).first(), 1300);
      await click(page, page.getByRole('button', { name: /EMP2X-Demo/ }).first(), 1300);
      await typeInto(page, page.getByPlaceholder(/Search projects/), 'flame arrival', 1800);
    },
  }),

  checklist: () => record('04-checklist', {
    prepare: async (page) => {
      await openProject(page);
      await goToTab(page, 'Checklist');
    },
    act: async (page) => {
      const boxes = page.locator('input[type=checkbox]');
      for (const index of [0, 1, 2]) await click(page, boxes.nth(index), 500);
      await shot(page, '04-checklist');
      await typeInto(page, page.getByPlaceholder('Responsible Name'), 'A. Example', 400);
      await typeInto(page, page.getByPlaceholder(/Initials/), 'LU', 600);
      await click(page, page.getByRole('button', { name: /See Safety Procedures/ }), 1500);
      await shot(page, '04-safety-procedures');
      await click(page, page.getByRole('button', { name: /Preview/ }).first(), 2500);
      await page.keyboard.press('Escape');
      await pause(page, 800);
    },
  }),

  plan: () => record('05-plan', {
    prepare: async (page) => {
      await openProject(page);
      await goToTab(page, 'Plan');
    },
    act: async (page) => {
      await shot(page, '05-plan');
      await typeInto(page, page.getByPlaceholder('Group ID'), 'VH2D-Demo-G02', 300);
      await typeInto(page, page.getByPlaceholder(/Run #/), '3', 300);
      await typeInto(page, page.getByPlaceholder(/H2 vol/), '20', 600);
      await click(page, page.getByRole('button', { name: /Add Planned Run/ }), 1500);
      const edit = page.getByRole('button', { name: 'Edit run card VH2D-Demo-G01-01' });
      await page.locator('div.group', { hasText: 'VH2D-Demo-G01-01' }).first().hover();
      await click(page, edit, 1800);
      await shot(page, '05-run-card');
      await page.mouse.wheel(0, 500);
      await pause(page, 1500);
      await page.keyboard.press('Escape');
      await pause(page, 800);
    },
  }),

  'daq-systems': () => record('06-daq-systems', {
    prepare: async (page) => {
      await openProject(page);
      await goToTab(page, 'DAQ Systems');
    },
    act: async (page) => {
      await shot(page, '06-daq-systems');
      await click(page, page.getByRole('button', { name: /Add DAQ/ }), 1000);
      await typeInto(page, page.getByLabel(/DAQ System Name/), 'DAQ-2', 300);
      await typeInto(page, page.getByLabel('Vendor'), 'Example Instruments', 300);
      await typeInto(page, page.getByLabel('Model'), 'TR-2000', 300);
      await typeInto(page, page.getByLabel('Sampling Rate (Hz)'), '200000', 600);
      await click(page, page.getByRole('button', { name: 'Save DAQ' }), 1800);
    },
  }),

  'sensors-mapping': () => record('07-sensors-mapping', {
    prepare: async (page) => {
      await openProject(page);
      await goToTab(page, 'Sensors Mapping');
    },
    act: async (page) => {
      await pause(page, 600);
      await shot(page, '07-sensors-mapping');
      await click(page, page.locator('summary', { hasText: /Per-run overrides/ }).first(), 900);
      const runSelect = page.locator('select', { hasText: 'Choose a run' }).first();
      await moveTo(page, runSelect);
      await runSelect.selectOption({ label: 'VH2D-Demo-G01-03' }).catch(() => runSelect.selectOption({ index: 3 }));
      await pause(page, 700);
      await click(page, page.getByRole('button', { name: /run override/i }).first(), 1800);
      await shot(page, '07-run-override');
      await goToTab(page, 'Cameras Mapping');
      await pause(page, 1000);
      await shot(page, '07-cameras-mapping');
    },
  }),

  'gas-mixing': () => record('08-gas-mixing', {
    prepare: async (page) => {
      await openProject(page);
      await goToTab(page, 'Gas Mixing');
    },
    act: async (page) => {
      const selects = page.locator('select');
      const groupSelect = selects.filter({ hasText: 'VH2D-Demo-G02' }).first();
      await moveTo(page, groupSelect);
      await groupSelect.selectOption({ label: 'VH2D-Demo-G02' });
      await pause(page, 800);
      const runSelect = selects.filter({ hasText: 'VH2D-Demo-G02-01' }).first();
      await moveTo(page, runSelect);
      await runSelect.selectOption({ label: 'VH2D-Demo-G02-01' });
      await pause(page, 1000);
      await typeInto(page, page.getByLabel(/Relative Humidity/), '49', 300);
      await typeInto(page, page.getByLabel(/MFC Setpoint/), '20', 300);
      await typeInto(page, page.getByLabel(/Chamber Pressure Pchamber/), '100800', 300);
      await typeInto(page, page.getByLabel(/Chamber Temperature/), '19.4', 600);
      await click(page, page.getByRole('button', { name: /^Calculate$/ }), 1800);
      await shot(page, '08-gas-mixing');
      await click(page, page.getByRole('button', { name: /^Save Run$/ }), 1800);
    },
  }),

  'import-data': () => record('09-import-data', {
    prepare: async (page) => {
      await openProject(page);
      await goToTab(page, 'Import Data');
    },
    act: async (page) => {
      await click(page, page.getByRole('button', { name: /Select Import Folder/ }).first(), 1200);
      const dialog = page.locator('div.max-w-xl');
      await click(page, dialog.locator('[role=option]', { hasText: 'VH2D-Demo-G01-01' }), 800);
      await click(page, dialog.getByRole('button', { name: 'Use Folder' }), 1500);
      await click(page, page.getByRole('button', { name: 'Close' }).last(), 800);
      const pressure = page.locator('select', { hasText: 'Pressure data' }).first();
      await moveTo(page, pressure);
      const pValues = await pressure.locator('option').evaluateAll((els) => els.map((e) => e.value));
      await pressure.selectOption(pValues.find((v) => v.endsWith('.tpc5')));
      await pause(page, 1000);
      const conc = page.locator('select', { hasText: 'Concentration data' }).first();
      await moveTo(page, conc);
      const cValues = await conc.locator('option').evaluateAll((els) => els.map((e) => e.value));
      await conc.selectOption(cValues.find((v) => v.endsWith('.csv')));
      await pause(page, 1500);
      await shot(page, '09-import-data');
    },
  }),

  'screening-pressure': () => record('10-screening-pressure', {
    prepare: async (page) => {
      await openProject(page);
      await importRun(page);
      await goToTab(page, 'Raw Data Screening — Pressure');
      await page.getByLabel('Peak range start (s)').waitFor({ timeout: 30000 });
      await pause(page, 1500);
    },
    act: async (page) => {
      await page.locator('.u-wrap').first().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, -120);
      await pause(page, 1500);
      await shot(page, '10-screening-pressure');
      const start = page.getByLabel('Peak range start (s)');
      await typeInto(page, start, '0', 300);
      await typeInto(page, page.getByLabel('Peak range end (s)'), '0.3', 800);
      await click(page, page.getByRole('button', { name: /Calculate peaks/ }), 400);
      await page.getByText(/Samples in range/).waitFor();
      await pause(page, 6000);
      const table = page.locator('div.rounded-xl', { hasText: 'Peak pressures' }).last();
      await table.scrollIntoViewIfNeeded();
      await pause(page, 1500);
      await shot(page, '10-peak-table');
    },
  }),

  'screening-h2': () => record('11-screening-h2', {
    prepare: async (page) => {
      await openProject(page);
      await importRun(page);
      await goToTab(page, 'Raw Data Screening — H2 Concentration');
      await pause(page, 3000);
    },
    act: async (page) => {
      const toggle = page.getByLabel(/ppm to vol/i).first();
      await moveTo(page, toggle);
      await pause(page, 800);
      if (!(await toggle.isChecked())) await click(page, toggle, 1500);
      await page.locator('.u-wrap').first().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, -120);
      await pause(page, 1500);
      const plot = page.locator('.u-over').first();
      const box = await plot.boundingBox();
      if (box) {
        // Move along the curve so the live values are shown.
        for (const fraction of [0.2, 0.45, 0.7, 0.9]) {
          await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 20 });
          await pause(page, 700);
        }
      }
      await shot(page, '11-screening-h2');
      await pause(page, 1200);
    },
  }),

  ignition: () => record('12-ignition-time', {
    prepare: async (page) => {
      await openProject(page);
      await goToTab(page, 'Plan');
    },
    act: async (page) => {
      await page.locator('div.group', { hasText: 'VH2D-Demo-G01-01' }).first().hover();
      await click(page, page.getByRole('button', { name: 'Edit run card VH2D-Demo-G01-01' }), 1500);
      const suggest = page.getByRole('button', { name: /Suggest from instrument files/ });
      await click(page, suggest, 2500);
      await shot(page, '12-ignition-time');
      await click(page, page.getByRole('button', { name: /^Use$/ }).first(), 1200);
      await click(page, page.getByRole('button', { name: 'Save Run Card' }), 1500);
    },
  }),

  report: () => record('13-report', {
    prepare: async (page) => {
      await openProject(page);
      await goToTab(page, 'Report');
    },
    act: async (page) => {
      await click(page, page.getByRole('button', { name: /Export PDF/ }).first(), 6000);
      await shot(page, '13-report');
    },
  }),

  'create-project': () => record('02-create-project', {
    prepare: async (page) => {
      await page.goto(`${URL}/`);
      await page.getByRole('button', { name: /Create Project/i }).first().waitFor();
      await pause(page, 800);
    },
    act: async (page) => {
      await click(page, page.getByRole('button', { name: /Create Project/i }).nth(1), 1200);
      const dialog = page.locator('div.max-w-xl');
      await click(page, dialog.getByRole('button', { name: /EXDA projects/ }), 900);
      await typeInto(page, dialog.getByPlaceholder('EXDA_Project'), 'VH2D-Demo-2027', 700);
      await shot(page, '02-create-project');
      await click(page, dialog.getByRole('button', { name: /^Create$/ }), 400);
      await page.getByRole('heading', { name: /Project Description/i }).first().waitFor({ timeout: 20000 });
      await pause(page, 2000);
    },
  }),

  'read-only': () => record('14-read-only-second-window', {
    prepare: async (page) => {
      const browser = await browserPromise;
      const first = await browser.newContext({ viewport: SIZE, colorScheme: 'light' });
      await first.addInitScript(() => { localStorage.setItem('theme', 'light'); localStorage.setItem('exda-mvp-mode', 'true'); });
      const firstPage = await first.newPage();
      await openProject(firstPage);
      await pause(firstPage, 3000);
      page.__firstWindow = first;
    },
    act: async (page) => {
      await openProject(page);
      await pause(page, 2500);
      await shot(page, '14-read-only');
      await page.__firstWindow.close();
    },
  }),
};

// Selects the first run's DAQ-1 and BGA files in Import Data (not recorded).
async function importRun(page) {
  await page.getByRole('link', { name: /Import Data/ }).first().click();
  await page.getByRole('button', { name: /Select Import Folder/ }).first().click();
  const dialog = page.locator('div.max-w-xl');
  await dialog.locator('[role=option]', { hasText: 'VH2D-Demo-G01-01' }).click();
  await dialog.getByRole('button', { name: 'Use Folder' }).click();
  await pause(page, 1200);
  await page.getByRole('button', { name: 'Close' }).last().click();
  const pressure = page.locator('select', { hasText: 'Pressure data' }).first();
  const pValues = await pressure.locator('option').evaluateAll((els) => els.map((e) => e.value));
  await pressure.selectOption(pValues.find((v) => v.endsWith('.tpc5')));
  const conc = page.locator('select', { hasText: 'Concentration data' }).first();
  const cValues = await conc.locator('option').evaluateAll((els) => els.map((e) => e.value));
  await conc.selectOption(cValues.find((v) => v.endsWith('.csv')));
  await pause(page, 1000);
}

const wanted = process.argv.slice(3);
const run = async () => {
  mkdirSync(IMAGES, { recursive: true });
  mkdirSync(VIDEOS, { recursive: true });
  for (const [name, section] of Object.entries(SECTIONS)) {
    if (wanted.length && !wanted.includes(name)) continue;
    try {
      await section();
    } catch (error) {
      console.error(`Section ${name} failed: ${error.message.split('\n')[0]}`);
      process.exitCode = 1;
    }
  }
  await (await browserPromise).close();
  rmSync(RAW, { recursive: true, force: true });
};
run();
