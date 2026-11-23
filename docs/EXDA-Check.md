# EXDA-Check — app review and fix brief (2026-11-23)

Prepared 2026-11-23 from a read-only review of the EXDA repo and the
`VH2D-Project-Wk-27-2026` project data. No code or data were changed.

---

## 0. Hard constraint — read first

**The recorded experimental inputs must never be changed by the app or by any fix.**
These are the values entered during the week-27 tests (P0, T0, RH, target vol.%,
MFC setpoint, dosing-model coefficients, notes, timestamps). They are the
traceability record of what was done on the day.

Rules for every change below:

1. Fix the *code paths*; do **not** write to existing `gas_mixing.json`,
   `Experiment_Plan_v000.json` or any file under `Projects/` as part of the fix.
2. No migration, auto-correction or "clean-up" of saved records. Inconsistencies in
   existing records are **reported**, not repaired.
3. If a recalculation feature is added, it must be opt-in per record, keep the original
   record unchanged (new version or separate field), and log what was recomputed and when.
4. Never replace a missing or invalid input with a default value. Missing means missing.

---

## 1. Gas Mixing: results can be saved that do not match the inputs (critical)

**Where:** `frontend/src/pages/GasMixing.jsx`

- `calculateInBackend()` (~l.400–466) sends the current draft to `/calculate_gas_mix`
  and stores the response in `baseResults` (~l.459).
- `saveCurrentRecord()` (~l.505–572) saves the **current** draft inputs
  (`pChamberPa`, `tChamberC`, `tChamberK`, …) but attaches `results: baseResults`
  (~l.553) from the **last** calculation. Nothing checks that the inputs are unchanged
  since that calculation, and Save is allowed even if Calculate was never pressed.

**Effect:** if the user presses Calculate, then edits P or T, then presses Save Run,
the record stores new inputs next to results computed from old (or default) inputs.

**Evidence in week-27 data (`Plan/…/gas_mixing.json`):**

| Run | Stored input | Value used in `results` |
|---|---|---|
| VH2D-Wk27-G01-01 | `tChamberK` = 295.25 (22.1 °C) | `T_chamber_K` = 293.15 (20 °C default) |
| VH2D-Wk27-G01-08 | `pChamberPa` = 100900 | `P_chamber_Pa` = 101325 |

The stored `mH2EstimatedG` for G01-01 (10.6926 g) is consistent with 293.15 K, not
295.25 K. The **injected** mass is not affected: it comes from the linear dosing model
(`m = a·x + b`, a = 69.638, b = −0.2568) and depends only on the target fraction.
Affected fields: `results.*`, `mH2EstimatedG`, the uncorrected fill time.

**Required fix:**

- Store a snapshot of the exact inputs sent with each calculation (the backend already
  echoes them in `results.inputs`).
- On Save, compare the current draft with that snapshot (P, T, target vol.%, MFC, geometry,
  constants, dosing coefficients). If anything differs, or there are no results yet:
  block the save with a clear message ("Inputs changed since last calculation —
  recalculate before saving"), or recalculate and show the new result for confirmation.
  Do not silently save stale results.
- Mark the results panel visibly as **stale** as soon as any input changes after a calculation.

---

## 2. Silent default values replace missing inputs (high)

Defaults hide missing measurements and look like real data (e.g. P0 = 101325 Pa).

| Location | Behaviour |
|---|---|
| `GasMixing.jsx` `p0ToPa()` (~l.41–46) | missing or invalid P0 → returns **101325** |
| `GasMixing.jsx` draft init (~l.374–377) | T falls back to **'20.00' °C** when no record exists |
| `GasMixing.jsx` draft init (~l.224–225) | initial `tChamberC: '20.00'` |
| `backend/modules/gas_mixing.py` l.10, ~l.107 | blank `T_chamber_K` → `DEFAULT_T_CHAMBER_K = 293.15` |
| `backend/modules/gas_mixing.py` ~l.112–116 | blank `P_chamber_Pa` → ambient-pressure default |

**Required fix:** chamber P and T fields start **empty**. The frontend requires them
before Calculate, which it already does for blank fields. The backend returns an error
(HTTP 400) for missing or blank `P_chamber_Pa` / `T_chamber_K` instead of defaulting.
Standard conditions (T_std, P_std, Ru, M_H2) may keep documented constants, but show
them as constants, not as measured values.

Week-27 records with P0 = 101325 Pa exactly, possibly a default:
G01-06, G01-12, G04-03 (in the Plan and Gas Mixing). **Report only — do not change.**

---

## 3. Pressure unit guessing in `p0ToPa()` (high)

`if (numeric < 2000) return numeric * 100000.0; // bar -> Pa`

A value entered in **mbar/hPa** (e.g. 1013) is treated as bar and becomes
1.013 × 10⁸ Pa. **Fix:** no unit guessing. Use an explicit unit for P0 (Pa, with
bar/mbar conversion only through a unit selector) and validate a plausible range
(e.g. 80–120 kPa), with a warning outside it.

---

## 4. Saving overwrites the record with no history (high, traceability)

`saveCurrentRecord()` drops the old record and appends the new one (~l.564–568). The
previous inputs and results are lost, and `deleteSavedRecord()` removes a record entirely.

**Fix:** keep history, append-only. For example:
`records[i].history[] = {savedAt, inputs, results, dosageModel}`, or a separate
`gas_mixing_audit.jsonl` with one line per save or delete. The record's first saved
version (the test-day entry) must stay retrievable. Deleting should need confirmation
and should archive, not destroy.

---

## 5. Viewing an old record can show a different corrected mass from the one saved (medium)

`results` is a `useMemo` of `applyDosageModel(baseResults, draft.targetVol, dosageModel)`
(~l.249–252), where `dosageModel` is the **current global** model. If a or b are changed
later, opening an old run shows a corrected mass and fill time different from the
saved `mH2InjectedG` / `injectionTimeS`.

**Fix:** for saved records, display the saved values and the a, b stored in the record.
If the current global model differs, show a notice; don't recompute.

---

## 6. Two fill times with unclear labels (low)

A record holds `injectionTimeS` (from the corrected mass, e.g. 396.3 s at 16 %) and
`results.InjectionTime_s` / `FillTime_s` (from the estimated mass, e.g. 386.8 s).
Name them unambiguously, for example `fillTimeCorrected_s` and `fillTimeEstimated_s`,
and record which one was applied on the MFC. Keep reading the old field names for
existing records; don't rename keys in existing files.

---

## 7. Add a read-only consistency report (requested)

Add a "Check records" action (frontend or a backend endpoint) that **only reports**:

- records where stored inputs ≠ `results.inputs` (expected for week 27: G01-01 T, G01-08 P)
- P0 exactly 101325, or T exactly 293.15 / 20.00 °C (possible defaults)
- missing RH (week 27: G00-01)
- `calibrationApplied` = Yes but `mH2InjectedG` ≠ a·x + b computed with the record's own a and b
- results missing

Output to screen and to an exportable CSV. No write-back.

---

## 8. Minor

- **Floating-point noise in saved, displayed and exported values.** Examples from the week-27
  Metadata Report PDF and CSV: `T0: 295.34999999999997 K` (22.2 + 273.15), while 22.5 °C
  shows cleanly as `295.65 K`; `H2 Injected: 13.670800000000002 g` (69.638 × 0.20 − 0.2568).
  The values are correct (error about 1e-14). The problem is presentation.
  Fix: keep the °C as entered as the recorded value and derive K when needed. Format on
  output everywhere (screen, Plan, Gas Mixing, Metadata Report PDF and CSV, other exports):
  T to 2 decimals in K (1 decimal in °C), P as whole Pa, H₂ mass to 3 decimals, fill time
  to 1 decimal. Do not rewrite existing stored values. Format at display and export time only.
- `tChamberK` "keep existing" logic (~l.516–528) can store a K that came from a different
  path than the °C on screen. With the inputs-snapshot check (item 1) the saved K should
  simply equal the K that was used.

---

## 9. Windows launcher `Run-EXDA-WIN.bat` (separate, blocking on Windows)

1. **l.139–151:** `%ERRORLEVEL%` and `%PY_CHECK_EXIT%` are expanded when the
   `( … )` block is parsed, so the launcher always reports "Could not verify Python
   packages" and exits. Use `!ERRORLEVEL!` / `!PY_CHECK_EXIT!` (delayed expansion is
   already enabled).
2. **l.76–78:** `%PY_PREFIX%` has the same problem. Also, `%REPO_ROOT%` already ends in
   `\`, so `%REPO_ROOT%\.venv` never matches `sys.prefix`. Use `!PY_PREFIX!` and
   `%REPO_ROOT%.venv`. Without this, a valid Windows `.venv` is rejected.
3. **l.133:** also check `require('rollup')`, as the Linux launcher does. The node
   package check passes on a copied `node_modules` that lacks Windows native binaries,
   and Vite then crashes.
4. Use CRLF line endings for `.bat` / `.cmd` (`.gitattributes`:
   `*.bat text eol=crlf`, `*.cmd text eol=crlf`). `run.cmd` uses `goto` labels.
5. l.11: `%%~A:~0,1%%` does not work on `for` variables, so comment lines in
   `exda-defaults.env` are not skipped. Harmless today, because the file has no comments.

These can't be tested on Linux. Test on a Windows machine or VM, or a GitHub Actions
Windows runner.

---

## Acceptance checks

- Calculate → change T → Save is blocked, or forces a recalculation. The saved record's
  `tChamberK` always equals `results.inputs.T_chamber_K`, and likewise for P.
- Calculate with blank P or T is refused by both frontend and backend. No 293.15 or
  101325 appears unless typed.
- Entering P0 = 1013 does not produce 1.013e8 Pa.
- Re-saving a run keeps the previous version retrievable.
- Opening an old record after changing the global a, b shows the saved values plus a notice.
- The consistency report on week 27 lists G01-01 (T), G01-08 (P), G01-06 / G01-12 /
  G04-03 (P0 = 101325), G00-01 (RH missing), and changes no files.
- `git diff` shows no changes under `Projects/`.

---

# Part B — Data processing and parsing issues (found in a second review)

The same hard constraint applies: **do not modify raw data or saved project files.**
These are processing and traceability fixes only. Items B1–B4 affect the reported peak
overpressure, the primary measurand of the campaign.

## B1. Pressure analysis runs on decimated data by default (critical)

- `WorkspacePage.jsx` ~l.265: `analysisFullResolution: false` by default.
- `useAnalysisPipeline.js` ~l.36–56 then calls `/read_project_file` without
  `fullResolution`, and `state.py read_project_file()` (~l.3030–3040) caps the data at
  **200,000 rows** using `np.linspace` index picking in `tpc5_parser.py` ~l.148–150 and
  `mf4_parser.py` ~l.78–81. There is no anti-alias filter. The project's own
  `docs/DOWNSAMPLING_FLOW.md` says this is for preview only.
- Week-27 files: DAQ-1 has 2,097,152 samples at 1 MHz, so it keeps about 1 in 10.5
  (stride alternates 10 and 11, so the time step is non-uniform). DAQ-2/3 have 618,800
  samples at 200 kHz, so they keep about 1 in 3.
- `pressure_analysis.analyze_pressure_content()` computes **pMax, tMax and impulse on
  that decimated signal**. Without filtering (`use_raw`) the true peak can be missed;
  with filtering, content above the new Nyquist frequency has already aliased.

**Fix:** analysis always reads full resolution, or applies a proper anti-aliased
decimation (e.g. `scipy.signal.decimate` / FIR) with a fixed integer factor. Decimation
by index picking stays for plotting only. Report the sample rate actually used in the results.

**Background — why decimation was introduced (performance), and how to keep performance
without losing accuracy:** the slow part is not the computation. It is serialising the
full file to CSV text (`tpc5_parser.tpc5_to_content` builds the string row by row),
shipping it to the browser, and posting it back to `/analyze_pressure`.

Recommended architecture:
1. New backend endpoint that takes the **file path + channel + settings** (not text
   content), reads the TPC5/MF4 directly with numpy, and computes filter, baseline, pMax,
   tMax and impulse at full resolution. Numpy handles 2 M samples per channel in well under
   a second.
2. Return metrics plus a **plot series reduced with min/max (envelope) decimation**:
   for each of ~2,000–4,000 time bins, keep that bin's min and max. Peaks stay visible,
   which index picking cannot guarantee.
3. Zooming requests full-resolution data for the visible time window only (the existing
   `windowStart`/`windowEnd` support can be reused).
4. Results record that they were computed at full resolution (fs, N samples).

## B2. No baseline (zero-offset) correction before pMax (high)

`calculate_metrics()` uses `np.argmax(y)` on the absolute signal. Pre-trigger offsets from
the charge amplifiers go straight into pMax.

**Fix:** offer a pre-trigger baseline (for example the mean or median of a user-set
window before t = 0), subtract it, and store the window and the offset value in the result.
Off by default only if that is documented.

## B3. Filtering is silently skipped or silently changed (high)

`pressure_analysis.py`:
- `apply_butterworth()` returns the **unfiltered** signal when `cutoff_hz >= 0.5*fs`
  (~l.41–42), with no warning. This is likely after decimation (B1).
- An invalid cutoff silently becomes 100 Hz, and an invalid order becomes 4 (~l.120–133).
- `resample_uniform()` linearly interpolates onto a uniform grid, which hides the
  non-uniform stride from B1.

**Fix:** return an error or an explicit warning in `metrics.status`, and record in every
result the filter type, order, cutoff, fs, whether the filter was applied, and whether
resampling happened. This is required for a documented data processing procedure (DPP).

## B4. Pa→kPa conversion assumes absolute pressure with a fixed 101,325 Pa (high)

`data_parser.normalize_pressure_to_kpa()` (~l.462–507):
- `input_unit="pa"` → `(p − 101325)/1000`, so input is always treated as absolute.
- `auto`: any |value| > 1000 → treated as absolute Pa and shifted by −101.325 kPa. Gauge
  data in Pa (e.g. a CFD overpressure export) would come out as about −100 kPa.
- Measured P0 in week 27 is 100,000–101,600 Pa. Using 101,325 instead of the run's P0
  gives offsets up to about 1.3 kPa, a large fraction of peaks around 5–30 kPa. This
  matters for CFD validation.

**Fix:** explicit absolute/gauge choice, the run's measured P0 for absolute→gauge
conversion (taken from the plan, not a constant), and no magnitude-based guessing.

## B5. Channel units in the header are ignored (medium)

TPC5/MF4 content carries units (`A1 (0.A1) [bar]`, `A5 … [V]`, MF4 unit fields), but
`auto` unit detection uses magnitude heuristics. A trigger channel in V (0–5 V) would be
multiplied by 100 and reported as "kPa". **Fix:** use the unit from the file. Never
convert V channels to pressure.

## B6. H2S sensor files cannot be parsed (medium)

Tested with the repo's own `data_parser.parse_multichannel_content()` on
`VH2D0-Wk27-G01-07-D2-H2S.txt` and `…G01-08-D2-H2S.txt`: **"No numeric rows found"**.
The files are tab-separated, Latin-1, with a two-line device header, then a column
header, then time-of-day stamps (`12:28:25.89`).

Some files contain **several recordings** (repeated `Device address` header blocks):
G01-08 (the first block is a duplicate of G01-07), G01-17, G05-01 (empty first block),
G05-06.

**Fix:** add a dedicated H2S parser that splits blocks, keeps the device metadata (ID,
factory ID, calibration constants), and returns each block separately with its time span.
It must never silently concatenate blocks. Let the user choose a block.

## B7. BGA units not stated (low)

`Conc5_TC` values are in ppm (e.g. 164670 means 16.47 vol.%). The parser reads them but
nothing converts or labels them. **Fix:** explicit ppm → vol.% conversion with the unit
shown. Some BGA logs have repeated or skipped seconds (G01-04, G01-14, G05-03). Keep
the logged timestamps; don't "fix" them.

## B8. Silent fallback to previously loaded content (medium)

`useAnalysisPipeline.js` `readAnalysisContent()` returns `fileObj.content` when the
`/read_project_file` request fails. Analysis can then run on stale or decimated content
without telling the user. **Fix:** show the error and stop.

## B9. DAQ readers listed as optional dependencies (medium)

`h5py` (TPC5) and `asammdf` (MF4) are only in `backend/requirements-optional.txt`, yet
they are needed to read the DAQ-1 and DAQ-2/3 data. The Windows run launcher does not
check optional requirements. **Fix:** move both to `requirements.txt`.

---

# Part C — Project records and traceability

## C1. Project files are overwritten in place, with no backup or history (high)

Plan, Gas Mixing, Sensors Mapping, Cameras Mapping, DAQ Systems, Checklist and
project status are saved with `open(path, "w")` + `json.dump(...)`
(`routes/state.py` ~l.3427, 3488, 3586, 3817, 3864, 4860;
`modules/project_manager.py` ~l.119, 248, 263, 410, 481).

- A crash, power loss or full disk during the write leaves a truncated or empty JSON file.
  The project lives on an external drive used through a VM shared folder, which makes
  this more likely.
- Every save replaces the previous version. Nothing records what the test-day entry was.

**Fix:** atomic writes (write to a temp file in the same folder, `flush`/`fsync`, then
`os.replace`). Keep a timestamped copy or an append-only change log per file (who, when,
which fields changed: old → new). The first version saved on the test day must stay retrievable.

## C2. Renaming a group in Plan renames the raw data folders on disk (high)

`Plan.jsx renameGroupRuns()` (~l.457–570) calls `/rename_run_data_folders`
(`state.py` ~l.4700–4770), which `shutil.move`s
`Raw_Data/<run>`, `Clean_Data/<run>` and `CFD_Data/<run>` to the new names.

- No confirmation dialog. It also runs for runs already marked done.
- If some moves fail, the plan is already updated, so folders and plan disagree.
  Only a warning banner is shown.
- A leftover `groupObjectives` entry `"VH2D-Wk27-04"` (no `G`) in the week-27 plan
  suggests an earlier rename left an orphan.

**Fix:** confirmation that lists every folder to be moved. Block renaming of completed
runs, or require an explicit override. Make it all-or-nothing (roll back moves on failure).
Log every rename to the change log from C1.

## C3. Checklist is stored once per project, not per run (medium)

`checklist_state.json` holds one set of ticks for the whole project, so it can't show which
safety and pre-test checks were completed before **each** test. **Fix:** save a timestamped
checklist snapshot per run, attached to the run record.

## C4. Sensor and camera mapping is per group, not per run (medium)

Configurations changed within groups, but the mapping can't represent that:
- pencil probes (PP1–PP3) absent in G01-01…03, G01-16…18 and G05-04…06, yet listed for G01 and G05
- P7 moved or re-mounted for G04
- the G02 cable swap

**Fix:** allow per-run overrides, or an "effective from run X" change on a group mapping.

## C5. Mapping fields aren't validated (low)

Seen in week-27 data: trigger channel `Trig-3` saved as measured quantity "pressure" with
mounting "flush"; H2S sensors default to `sensitivityUnit: "pC/bar"`; P2's `model` field
holds its serial number. **Fix:** set the allowed fields and units from the sensor type
(trigger → voltage and no sensitivity; concentration → no pC/bar). Warn on duplicate
coordinates and on an empty location for an active sensor.

## C6. `project_status.json` stores an absolute machine-specific path (low)

`"project_path": "/media/psf/Sim_Back_Up/…"` (the Linux VM path) is kept from the first
save (`project_manager.py` ~l.109). On a colleague's Windows PC it's wrong. **Fix:** don't
store an absolute path, or treat it as informational and update it on open. Never use it
to resolve files.

## C7. Actual test time isn't recorded on the run (low)

The plan holds planned dates only. Run order had to be reconstructed from instrument
timestamps; G03 ran 02 → 01 → 03. **Fix:** an "actual ignition time" field on each run,
optionally pre-filled from the DAQ/BGA file timestamps, with time zone stated.

---

# Part D — Git, release script and repository hygiene (do this FIRST)

## D1. `versioning.sh` stages everything with `git add -A` and pushes (critical)

`versioning.sh` ~l.178–187: on the development branch it runs `git add -A`, commits
"Release-ready changes" and pushes to `origin`.

- `Projects/VH2D-Project-Wk-27-2026/Raw_Data/` (about 21 GB: `.seq`, `.tpc5`, `.mf4`) is
  untracked and **not** in `.gitignore`. Running the script would commit it locally and try
  to push it. GitHub rejects files over 100 MB, but the local repo would already hold
  the huge commit.
- The project metadata JSON (`Projects/*/Plan/*.json`, `Projects/*/Reports/*.json`) is
  tracked, so it is pushed with every release.

**Fix:** never `git add -A` in the script. Stage explicit paths only (app code,
`package.json`, `package-lock.json`, `VERSIONING.md`). Abort if untracked files exist
outside the allowed paths, or if any staged file is over e.g. 50 MB. Show
`git status` and ask for confirmation before committing or pushing.

## D2. The development branch is hard-coded as `CODEX-Updates` (medium)

`versioning.sh` l.121–123, 178–194, 201, 226–228 and `VERSIONING.md` l.13–88 assume
`CODEX-Updates`. A `CLAUDE-Updates` branch now exists on GitHub (not yet local).

**Fix:** take the development branch as an argument or environment variable
(`DEV_BRANCH`, default = current branch if it is not `main`). Accept any `*-Updates`
branch. Update `VERSIONING.md` to describe the general workflow
(develop on `<dev-branch>` → merge to `main` → bump → tag on `main`).

## D3. `.gitignore` does not exclude experiment data (high)

Add:
```
._*
.DS_Store
Projects/*/Raw_Data/
Projects/*/Clean_Data/
Projects/*/CFD_Data/
*.seq
*.tpc5
*.mf4
```
Keep the existing `WaterTest-Project` exception for its test `.tpc5` files.
Decide whether `Projects/` metadata belongs in the app repo at all. The repo appears to
be **public** (`git ls-remote` works without credentials). Recommendation: move
`Projects/` out of the repo and point the app at it.

## D4. Repository clean-up (low)

- AppleDouble file `.git/objects/pack/._pack-….idx` causes "non-monotonic index"
  errors on every git command. Delete `._*` files inside `.git` on macOS.
- Stray local branches `list` and `status` (at an old commit, 2026-05-24) look accidental.
- Local clone is on `CODEX-Updates` with 40 uncommitted changes (mostly project
  metadata JSON). Commit or stash deliberately, tag a snapshot (`pre-EXDA-Check`), then
  `git fetch && git switch CLAUDE-Updates`.

---

## Not reviewed

AiRA (`routes/ai.py`), report generation, EWT and flame analysis, CFD validation page,
Electron packaging.

## Additional acceptance checks

- pMax for a week-27 DAQ-1 file is identical with and without the "full resolution"
  toggle, because analysis always uses full data.
- Every pressure result records fs, decimation, filter settings, filter-applied flag,
  baseline window and offset, unit conversion, and the P0 used.
- Analysing a V (trigger) channel never reports kPa.
- All week-27 H2S files load, and multi-block files show their blocks separately.
