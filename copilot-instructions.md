# AI Coding Agent Instructions

## Project Overview

This is a **hybrid CFD research workspace** combining:
- **OpenFOAM v2306** - Customized combustion simulation environment (jcam-v2306)
- **VH2D Dashboard** - React/Flask web application for hydrogen venting deflagration experiment management
- **Python analysis tools** - Scientific data processing for CFD and experimental validation

The workspace supports vented hydrogen deflagration research with integrated simulation, experimentation planning, and post-processing capabilities.

## Architecture & Key Components

### 1. OpenFOAM Custom Build (`jcam-v2306/`)
- **Custom solvers**: Located in `applications/solvers/combustion/` - Modified HyXiFOAM solver for H2/air combustion
- **Mesh utilities**: `applications/smoothMesh-main/` - Centroidal smoothing algorithm with boundary layer preservation
- **Dynamic mesh refinement**: `src/dynamicFvMesh/dynamicRefineBalancedFvMesh/` - Multi-field adaptive mesh refinement with load balancing
- **Turbulence models**: Custom k-ε implementations in `src/TurbulenceModels/`

**Build workflow**:
```bash
cd jcam-v2306/applications/smoothMesh-main
./Allwmake  # Builds with OpenFOAM's wmake system
./Allwclean # Cleans build artifacts
```

### 2. VH2D Dashboard (`run/.../apps/VH2D-dashboard/`)
**Stack**: React 19 + Vite + TailwindCSS (frontend) | Flask + NumPy/SciPy (backend)

**Architecture**:
- **Frontend tabs**: 
  - `TabPlan.jsx` - Experiment planning with scientific metadata (H2%, ignition config, venting setup)
  - `TabSources.jsx` - Project/data source management
  - `TabAnalysis.jsx` - Post-processing and visualization
- **Backend modules**:
  - `backend/app.py` - Flask REST API with auto-folder-structure enforcement
  - `backend/modules/dataAnalysis.py` - Butterworth filtering, flame speed calculation, pressure impulse metrics
  - `backend/modules/project_manager.py` - Native OS dialogs for file/folder selection

**Data flow**: 
1. User selects project folder → Backend auto-creates `Plan/` and `Raw_Data/` dirs
2. Experiments designed in TabPlan → Saved to localStorage + JSON export
3. CFD/experimental data loaded from standardized OpenFOAM `postProcessing/` structure
4. Analysis applied via SciPy signal processing → Recharts visualization

**Run commands**:
```bash
cd run/.../VH2D-dashboard
npm run dev  # Starts both Vite (port 5173) and Flask (port 5000) concurrently
```

### 3. Simulation Cases (`run/EMP2X-Project-OFv2306/VHD_using_HyXiFOAM/`)
Standard OpenFOAM case structure:
- `system/` - controlDict, fvSchemes, fvSolution
- `constant/` - Mesh, thermophysicalProperties, turbulenceProperties
- `0/` - Initial conditions (U, p, T, Y_H2)
- `postProcessing/` - Probe data follows naming: `pressure_<location>` or `flameProgress_<location>`

## Critical Conventions

### OpenFOAM Integration
- **Never run OpenFOAM commands without sourcing environment first**: Check for `WM_PROJECT_DIR` env var
- **Compilation uses wmake**: Not standard make. Use `Allwmake` scripts in project directories
- **Library linking**: Custom libs loaded at runtime via `system/controlDict`:
  ```
  libs ("libdynamicRefineBalancedFvMesh.so");
  ```

### Dashboard Data Contracts
**Experiment metadata schema** (TabPlan.jsx line 65-70):
```javascript
meta: { 
  h2: "10.5",        // H2 vol%
  p0: "1.013",       // Initial pressure (bar)
  t0: "293",         // Initial temperature (K)
  ignition: "...",   // Mandatory for run readiness
  vent: "...",       // Mandatory for run readiness
  cfdHash: "..."     // CFD case traceability
}
```
**Gating function**: `isReady(exp)` checks h2/ignition/vent before allowing execution

**Numerical grouping pattern** (TabPlan.jsx line 95-108):
- Groups experiments by `\d+pctV` pattern (e.g., "10pctV", "15pctV")
- Sorts numerically, not alphabetically (10% before 5%)
- Always has fallback "GENERAL" group

### Python Analysis Pipeline
**Signal processing defaults** (`dataAnalysis.py`):
- Auto-resamples to uniform timestep via median dt
- Butterworth filter: 4th order, user-defined cutoff (default 100 Hz)
- Pressure impulse calculation: Trapezoidal integration with configurable decay cutoff

**Flame speed calculation**:
- Expects multi-probe data with header format: `# Probe <n> (<x-coord> ...)`
- Ignition location hardcoded: `2.4` (line 82) - **adjust per geometry**
- Detects flame arrival at threshold `0.5` via linear interpolation

## Development Workflows

### Adding New React Components
1. Create in `src/components/`
2. Import into `DataAnalysisDashboard.jsx` (line 5-8 pattern)
3. Add feature flag to `FLAGS` object if experimental (line 10-14)
4. Wrap in `<SafeComponent>` for error boundary isolation

### Extending Backend Analysis
1. Add function to `backend/modules/dataAnalysis.py`
2. Create route in `backend/app.py` with `/endpoint_name` pattern
3. Frontend fetch from `http://127.0.0.1:5000/endpoint_name`
4. Always return JSON with `{"success": bool, "data": ..., "message": str}`

### OpenFOAM Solver Modifications
1. Edit solver source in `applications/solvers/combustion/`
2. Run `wmake` from solver directory (not `make`)
3. Test with minimal case in `testcase/` before production runs
4. Update `README.md` with algorithmic changes

## File Naming & Organization

**Dashboard project structure** (enforced by backend line 25-36):
```
ProjectFolder/
├── Plan/              # Experiment plan JSONs (auto-created)
├── Raw_Data/          # Experimental datasets (auto-created)
└── CFD_Simulations/   # OpenFOAM case directories (user-managed)
```

**OpenFOAM probe naming**:
- Pressure: `pressure_<location>` → Creates `postProcessing/pressure_<location>/p`
- Flame progress: `flameProgress_<location>` → Creates .../alpha.gas`

## Common Pitfalls

1. **TabPlan "No Metadata" warnings**: Experiments require ALL of h2/ignition/vent to be ready (line 167-176)
2. **Backend CORS errors**: Flask CORS enabled (line 15), but frontend must use `http://127.0.0.1:5000` not `localhost`
3. **OpenFOAM version mismatch**: This build expects v2306 - check `WM_PROJECT_VERSION`
4. **Python env**: Backend expects system Python3 with numpy/scipy/flask/flask-cors installed
5. **Recharts responsive containers**: Always wrap in `<ResponsiveContainer width="100%" height="100%">` (TabPlan.jsx line 228, 256)

## Testing & Validation

**Dashboard**:
```bash
npm run lint  # ESLint check
npm run build # Production bundle test
```

**OpenFOAM utilities**:
```bash
cd applications/smoothMesh-main
./run_tests.sh  # Runs all test cases in testcase*/ dirs
```

## Key Files Reference

- [TabPlan.jsx](jcam-v2306/run/EMP2X-Project-OFv2306/VHD_using_HyXiFOAM/FMGlobal-Simulations/2025/Auxilliary_Files/PostProcessing/apps/VH2D-dashboard/src/components/TabPlan.jsx) - Experiment planning UI patterns
- [dataAnalysis.py](jcam-v2306/run/EMP2X-Project-OFv2306/VHD_using_HyXiFOAM/FMGlobal-Simulations/2025/Auxilliary_Files/PostProcessing/apps/VH2D-dashboard/backend/modules/dataAnalysis.py) - Signal processing algorithms
- [algorithm_description.md](jcam-v2306/applications/smoothMesh-main/algorithm_description.md) - Mesh smoothing theory
- [dynamicRefineBalancedFvMesh README](jcam-v2306/src/dynamicFvMesh/dynamicRefineBalancedFvMesh/README.md) - AMR setup

## Domain Knowledge Notes

- **Vented deflagration**: Combustion in enclosure with pressure relief - requires coupled flame/pressure tracking
- **H2/air mixtures**: Highly reactive - simulations use detailed chemistry (13-species mechanism typical)
- **FM Global**: Fire research organization - cases follow their experimental protocols
- **Mylar venting**: Thin membrane (20 μm typical) - rupture modeled as instantaneous boundary condition change
