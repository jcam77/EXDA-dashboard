import React, { Suspense, lazy, useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { 
    FlaskConical, AudioLines, ClipboardList, FileSpreadsheet, 
    Folder, Activity, Flame, FolderOpen, BrainCircuit,
    FileText, Beaker, BookOpen, Home, Layers, Sun, Moon, FolderPlus, RefreshCw, X, Import, ShieldCheck
} from 'lucide-react';

// --- MODULAR IMPORTS ---
import UnifiedModal from '../../components/UnifiedModal';
import ProjectPickerModal from '../../components/ProjectPickerModal';
import PlanPickerModal from '../../components/PlanPickerModal';
import { getBackendBaseUrl } from '../../utils/backendUrl';
import { getPublicUrl } from '../../utils/assetUrl';
import { recordRecentProject } from '../../utils/recentProjects';
import { DEFAULT_INPUT_UNIT } from '../../utils/units';
import { useAnalysisPipeline } from './hooks/useAnalysisPipeline';
import { useDataImportPipeline } from './hooks/useDataImportPipeline';

/**
 * Feature Flags for modular control
 */
const FLAGS = {
    ENABLE_PLAN: true,
    ENABLE_SOURCES: true,
    ENABLE_ANALYSIS: true
};

const HomePage = lazy(() => import('../../pages/Home'));
const ProjectsPage = lazy(() => import('../../pages/Projects'));
const AppCalculationsVerificationPage = lazy(() => import('../../pages/AppCalculationsVerification'));
const ChecklistPage = lazy(() => import('../../pages/Checklist'));
const PlanPage = lazy(() => import('../../pages/Plan'));
const GasMixingPage = lazy(() => import('../../pages/GasMixing'));
const ImportDataPage = lazy(() => import('../../pages/ImportData'));
const DataPreprocessingPage = lazy(() => import('../../pages/DataPreprocessingPage'));
const EWTPage = lazy(() => import('../../pages/EwtAnalysis'));
const PressureAnalysisPage = lazy(() => import('../../pages/PressureAnalysis'));
const CFDValidationPage = lazy(() => import('../../pages/CFDValidation'));
const FlameSpeed = lazy(() => import('../../pages/FlameSpeedAnalysis'));
const AiRAPage = lazy(() => import('../../pages/AiRA'));
const ReportPage = lazy(() => import('../../pages/Report'));
const LiteraturePage = lazy(() => import('../../pages/Literature'));

const TAB_PATHS = {
    home: '/',
    projects: '/projects',
    verification: '/verification',
    checklist: '/checklist',
    plan: '/plan',
    gas: '/gas',
    data: '/data',
    data_preprocessing: '/data/preprocessing',
    ewt: '/analysis/ewt',
    pressure_analysis: '/analysis/pressure',
    cfd_validation: '/analysis/cfd-validation',
    flame_speed: '/analysis/flame',
    ai: '/ai',
    report: '/report',
    resources: '/literature',
};

const resolveTabFromPath = (pathname) => {
    if (pathname === '/' || pathname === '/home') return 'home';
    if (pathname.startsWith('/projects')) return 'projects';
    if (pathname.startsWith('/verification')) return 'verification';
    if (pathname.startsWith('/checklist')) return 'checklist';
    if (pathname.startsWith('/plan')) return 'plan';
    if (pathname.startsWith('/gas')) return 'gas';
    if (pathname.startsWith('/data/preprocessing')) return 'data_preprocessing';
    if (pathname.startsWith('/data/clean')) return 'data_preprocessing';
    if (pathname.startsWith('/data')) return 'data';
    if (pathname.startsWith('/analysis')) {
        if (pathname.includes('calculations-verification')) return 'verification';
        if (pathname.includes('cfd-validation')) return 'cfd_validation';
        if (pathname.includes('ewt')) return 'ewt';
        if (pathname.includes('flame')) return 'flame_speed';
        return 'pressure_analysis';
    }
    if (pathname.startsWith('/ai')) return 'ai';
    if (pathname.startsWith('/report')) return 'report';
    if (pathname.startsWith('/literature')) return 'resources';
    return null;
};

/**
 * Error Boundary for specialized PhD modules
 */
class SafeComponent extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) { return { hasError: true, error }; }
    componentDidCatch(error, errorInfo) { console.error("Component Crash:", error, errorInfo); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-4 bg-red-900/20 border border-red-500/50 rounded text-red-200 text-xs font-mono">
                    <strong>Plugin Error:</strong> {this.state.error?.toString()}
                </div>
            );
        }
        return this.props.children;
    }
}

const TabFallback = () => (
    <div className="flex h-full min-h-[320px] items-center justify-center text-sm font-mono text-muted-foreground">
        Loading view...
    </div>
);

const WorkspacePage = () => {
    const apiBaseUrl = getBackendBaseUrl();
    // Add flame folder picker state
    const [selectedFlameFolder, setSelectedFlameFolder] = useState("");
    const [flamePicker, setFlamePicker] = useState({ open: false });

    const onOpenFlamePicker = () => setFlamePicker({ open: true });
    const closeFlamePicker = () => setFlamePicker({ open: false });
    const handleFlameFolderPick = (pathValue) => {
        setSelectedFlameFolder(pathValue);
        closeFlamePicker();
        // Optionally, filter expFiles for flame CSVs here or trigger backend sync
        // You can add logic to fetch flame files if needed
    };
  const [projectPath, setProjectPath] = useState(null); 
    const [modal, setModal] = useState({ show: false, type: 'success', title: '', content: null });
    const [picker, setPicker] = useState({ open: false, mode: 'open' });
    const [dataPicker, setDataPicker] = useState({ open: false, type: 'sim' });
    const [planPickerOpen, setPlanPickerOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
  const [aiChatHistory, setAiChatHistory] = useState([]); 
  const [checklistState, setChecklistState] = useState({});
    const [projectsRefreshKey, setProjectsRefreshKey] = useState(0);
    const [isLight, setIsLight] = useState(() => {
            if (typeof window === 'undefined') return false;
            const stored = window.localStorage.getItem('exda-theme');
            if (stored === 'light') return true;
            if (stored === 'dark') return false;
            return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ?? false;
    });

  // --- PLAN STATE ---
  const [experiments, setExperiments] = useState([]);
  const [planName, setPlanName] = useState("Experiment_Plan"); 
  const [planMeta, setPlanMeta] = useState({ objective: "", description: "" });
  
  const [saveFormat, setSaveFormat] = useState('json');
  const [simulationData, setSimulationData] = useState([]);
  const [experimentalData, setExperimentalData] = useState([]);
  const experimentalFlameData = null;
  const [selectedCases, setSelectedCases] = useState([]);
  const [projectStatusFromFile, setProjectStatusFromFile] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [settings, setSettings] = useState({ 
    useRaw: false, cutoff: 100, order: 4, impulseDrop: 0.05, 
    showVentLines: true, useShortNames: true,
    ewtMaxNumPeaks: 5, ewtNumModes: 5, ewtSelectedPath: '', ewtMaxPoints: 2000,
    pressureChannelIndex: 0, ewtChannelIndex: 0,
    pressureInputUnit: DEFAULT_INPUT_UNIT, ewtInputUnit: DEFAULT_INPUT_UNIT,
    pressureConvertToKpa: true, ewtConvertToKpa: true,
    pressureTickCount: 10, ewtTickCount: 10,
    showRawReference: true,
    experimentalUseRaw: false,
    experimentalCutoff: 100,
    experimentalOrder: 4,
    analysisFullResolution: false,
    analysisLimitTimeWindow: false,
    analysisWindowStart: '',
    analysisWindowEnd: '',
  });
  const [sessionFiles, setSessionFiles] = useState([]);
    const [expFiles, setExpFiles] = useState([]);
    const [selectedExpFolder, setSelectedExpFolder] = useState("");

  const activeTab = resolveTabFromPath(location.pathname) || 'home';
  const setActiveTab = useCallback((tab) => {
      const nextPath = TAB_PATHS[tab] || '/';
      if (location.pathname !== nextPath) {
          navigate(nextPath);
      }
  }, [location.pathname, navigate]);

  useEffect(() => {
      if (location.pathname === '/analysis') {
          navigate(TAB_PATHS.pressure_analysis, { replace: true });
          return;
      }
      if (!resolveTabFromPath(location.pathname)) {
          navigate('/', { replace: true });
      }
  }, [location.pathname, navigate]);


  /**
   * REFRESH PERSISTENCE LOGIC: Sync with Backend Folder State
   * Replaces volatile localStorage-only logic with server-side truth.
   */
  const fetchJsonWithRetry = useCallback(async (url, options = {}, retries = 4, delayMs = 600) => {
      let lastError = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
          try {
              const res = await fetch(url, options);
              const data = await res.json();
              if (!res.ok) {
                  throw new Error(data?.error || `Request failed (${res.status})`);
              }
              return data;
          } catch (err) {
              lastError = err;
              if (attempt === retries) break;
              await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
      }
      throw lastError || new Error('Request failed');
  }, []);

  useEffect(() => {
      const syncProject = async () => {
          const resumeOnStartup = localStorage.getItem('resumeOnStartup') === 'true';
          const resumeOnce = localStorage.getItem('resumeOnStartupOnce') === 'true';
          if (!resumeOnStartup && !resumeOnce) return;
          if (resumeOnce) localStorage.removeItem('resumeOnStartupOnce');
          const savedPath = localStorage.getItem('currentProjectPath');
          if (!savedPath) return;

          try {
              // Pulse check: Fetch current directory state (Plan and Raw Data) from backend
              const state = await fetchJsonWithRetry(
                  `${apiBaseUrl}/get_project_state?projectPath=${encodeURIComponent(savedPath)}`
              );

              if (state.success) {
                  setProjectPath(savedPath);
                  // 1. Recover the most recent Experiment Plan
                  if (state.plan) {
                      setExperiments(state.plan.experiments || []);
                      setPlanName(state.plan.planName || "Loaded_Plan");
                      if (state.plan.meta) setPlanMeta(state.plan.meta);
                  }
                  const statusFromFile = (state.project_status?.status || '').toString().toLowerCase();
                  setProjectStatusFromFile(statusFromFile);
                  
                  // 2. Recover the Data file list from the project folder
                  // This ensures the Data tab doesn't go empty after a browser refresh
                  if (state.data_files) {
                      setExpFiles(state.data_files);
                  }
                  
                  setModal({
                      show: true,
                      type: 'success',
                      title: 'Project Loaded',
                      content: 'Data and Plan restored from folder.',
                  });
              }
          } catch (e) {
              console.error("Critical State Sync Error:", e);
              const message = (e?.message || '').toString();
              const missingSavedPath = /Project path (not found|is not a directory|required)/i.test(message);

              if (missingSavedPath) {
                  setProjectPath(null);
                  setExperiments([]);
                  setExpFiles([]);
                  setProjectStatusFromFile('');
                  localStorage.removeItem('currentProjectPath');
                  localStorage.removeItem('lastProjectPath');
                  localStorage.removeItem('pendingTab');
                  setModal({
                      show: true,
                      type: 'error',
                      title: 'Saved Project Not Available',
                      content: 'The last saved project path does not exist on this machine. This can happen when switching between macOS and Linux/VM environments. Please reopen the project from its local path.',
                  });
                  return;
              }

              setModal({
                  show: true,
                  type: 'error',
                  title: 'Sync Failed',
                  content: `Could not restore project state from disk.${message ? ` ${message}` : ''}`,
              });
          }
      };

      syncProject();
  }, [apiBaseUrl, fetchJsonWithRetry]); // Run once on mount/refresh

  /**
   * Effect: Local Backup (Redundancy)
   */
  useEffect(() => {
      if (projectPath) {
          localStorage.setItem('experimentPlanData', JSON.stringify({ 
              planName, 
              experiments, 
              meta: planMeta 
          }));
      }
  }, [experiments, planName, planMeta, projectPath]);

  useEffect(() => {
      if (!projectPath) return;
      const pendingTab = localStorage.getItem('pendingTab');
      const resolvedPendingTab = pendingTab === 'filter' ? 'pressure_analysis' : pendingTab;
      if (resolvedPendingTab && TAB_PATHS[resolvedPendingTab]) {
          localStorage.removeItem('pendingTab');
          setActiveTab(resolvedPendingTab);
      }
  }, [projectPath, setActiveTab]);

  useEffect(() => {
      const root = document.documentElement;
      root.classList.toggle('light', isLight);
      window.localStorage.setItem('exda-theme', isLight ? 'light' : 'dark');
  }, [isLight]);

  const notify = useCallback((type, title, content) => {
      setModal({ show: true, type, title, content });
  }, []);

  const confirmWithModal = ({
      title,
      content,
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      type = 'error',
      confirmVariant = 'destructive'
  }) => new Promise((resolve) => {
      let settled = false;
      const finalize = (value) => {
          if (settled) return;
          settled = true;
          setModal((prev) => ({ ...prev, show: false }));
          resolve(value);
      };
      setModal({
          show: true,
          type,
          title,
          content,
          onClose: () => finalize(false),
          actions: [
              {
                  label: cancelLabel,
                  variant: 'ghost',
                  onClick: () => {
                      finalize(false);
                  }
              },
              {
                  label: confirmLabel,
                  variant: confirmVariant,
                  onClick: () => {
                      finalize(true);
                  }
              }
          ]
      });
  });
  
  const formatName = useCallback((p) => {
      if (!p) return "Unknown";
      const parts = String(p).split(/[/\\]/).filter(Boolean);
      if (!parts.length) return "Unknown";
      const postProcessingIdx = parts.indexOf('postProcessing');
      const baseName =
          postProcessingIdx > 0
              ? (parts[postProcessingIdx - 1] || parts[parts.length - 1])
              : parts[parts.length - 1];

      if (!settings.useShortNames) return baseName;
      const m = baseName.match(/(VH2D-FMG-\d+).*?-(L\w+)-(D\w+)/);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : baseName.length > 30 ? `${baseName.substring(0, 27)}...` : baseName;
  }, [settings.useShortNames]);
  
  const stringToColor = useCallback(
      (str) => `hsl(${Math.abs(String(str || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360}, 70%, 60%)`,
      []
  );

  const {
      plotData,
      analysisResults,
      isProcessing,
      processFile,
      requestAnalysis,
  } = useAnalysisPipeline({
      apiBaseUrl,
      projectPath,
      activeTab,
      selectedCases,
      experimentalData,
      experimentalFlameData,
      settings,
      formatName,
      stringToColor,
  });

  const {
      onSimFolder,
      onExpFolder,
      onFileSelect,
      onRemoveCase,
      onToggleCase,
  } = useDataImportPipeline({
      apiBaseUrl,
      projectPath,
      sessionFiles,
      expFiles,
      simulationData,
      experimentalData,
      settings,
      processFile,
      notify,
      setSessionFiles,
      setExpFiles,
      setSelectedExpFolder,
      setSimulationData,
      setSelectedCases,
      setExperimentalData,
  });

  const projectStatus = (() => {
      const fromFile = (projectStatusFromFile || '').toString().toLowerCase();
      if (['planning', 'active', 'archived'].includes(fromFile)) return fromFile;
      const explicit = (planMeta?.status || '').toString().toLowerCase();
      if (['planning', 'active', 'archived'].includes(explicit)) return explicit;
      const total = experiments.length;
      const done = experiments.filter((e) => e.done).length;
      if (!total) return 'planning';
      if (done >= total) return 'archived';
      return 'active';
  })();

  const formatLastSaved = (value) => {
      if (!value) return 'Not saved yet';
      try {
          return `Saved ${new Date(value).toLocaleTimeString()}`;
      } catch {
          return 'Saved';
      }
  };

  const openPicker = (mode) => setPicker({ open: true, mode });
  const closePicker = () => setPicker((prev) => ({ ...prev, open: false }));

    const openDataPicker = (type) => setDataPicker({ open: true, type });
    const closeDataPicker = () => setDataPicker((prev) => ({ ...prev, open: false }));

    const openProjectByPath = async (projectPathValue, nextTab) => {
      try {
          const res = await fetch(`${apiBaseUrl}/open_project_path`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectPath: projectPathValue })
          });
          const d = await res.json();
              if (d.success) {
                  setProjectPath(d.path);
                  localStorage.setItem('currentProjectPath', d.path);
                  localStorage.setItem('lastProjectPath', d.path);
                  localStorage.setItem('resumeOnStartupOnce', 'true');
                  recordRecentProject(d.path);
                  if (nextTab) localStorage.setItem('pendingTab', nextTab);
                  window.location.reload();
              } else {
              notify('error', 'Open Failed', d.error || 'Could not open project');
          }
      } catch {
          notify('error', 'Connection Failed', 'Backend not running?');
      }
  };

  const createProjectAtPath = async (parentPath, projectName) => {
      try {
          const res = await fetch(`${apiBaseUrl}/create_project_at_path`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ parentPath, projectName })
          });
          const d = await res.json();
              if (d.success) {
                  setProjectPath(d.path);
                  localStorage.setItem('currentProjectPath', d.path);
                  localStorage.setItem('lastProjectPath', d.path);
                  localStorage.setItem('resumeOnStartupOnce', 'true');
                  recordRecentProject(d.path);
                  window.location.reload();
              } else {
              notify('error', 'Create Failed', d.error || 'Could not create project');
          }
      } catch {
          notify('error', 'Connection Failed', 'Backend not running?');
      }
  };

    const handleDataFolderPick = (pathValue, type) => {
            const manualEvent = { target: { manualPath: pathValue } };
            if (type === 'sim') onSimFolder(manualEvent);
            else onExpFolder(manualEvent);
    };

  const savePlan = useCallback(async ({ silent = false } = {}) => {
      if(!projectPath) return silent ? null : notify('error', 'Save Failed', 'No project selected');
      let content = JSON.stringify({ planName, experiments, meta: planMeta }, null, 2);
      try {
          const res = await fetch(`${apiBaseUrl}/save_plan`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ projectPath, filename: `${planName}.${saveFormat}`, content })
          });
          const d = await res.json();
          if(d.success) {
              setLastSavedAt(new Date());
              if (!silent) notify('success', 'Plan Saved', d.path);
          } else if (!silent) {
              notify('error', 'Save Failed', d.error);
          }
      } catch {
          if (!silent) notify('error', 'Network Error', 'Save failed');
      }
  }, [apiBaseUrl, experiments, notify, planMeta, planName, projectPath, saveFormat]);

  const handleCloseProject = async () => {
      const confirmClose = await confirmWithModal({
          title: 'Close project?',
          content: 'Are you sure you want to close this project? This will return you to the home screen.',
          confirmLabel: 'Close Project',
          cancelLabel: 'Keep Open',
          type: 'error',
          confirmVariant: 'destructive'
      });
      if (!confirmClose) return;

      const confirmSave = await confirmWithModal({
          title: 'Save changes?',
          content: 'Do you want to save the latest plan changes before closing?',
          confirmLabel: 'Save and Close',
          cancelLabel: 'Close Without Saving',
          type: 'success',
          confirmVariant: 'primary'
      });
      try {
          if (confirmSave) {
              await savePlan({ silent: true });
          }
      } catch {
          notify('error', 'Auto-save Failed', 'Could not save the latest plan before closing.');
      } finally {
          setProjectPath(null);
          setProjectStatusFromFile('');
          localStorage.removeItem('currentProjectPath');
      }
  };

  const openProjectFolder = async () => {
      if (!projectPath) return;
      try {
          const res = await fetch(`${apiBaseUrl}/reveal_project_path`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectPath })
          });
          const d = await res.json();
          if (!d.success) {
              notify('error', 'Open Folder Failed', d.error || 'Could not open project folder');
          }
      } catch {
          notify('error', 'Open Folder Failed', 'Could not connect to backend');
      }
  };

  const autoSaveRef = useRef({ ready: false });
  useEffect(() => {
      if (!projectPath) {
          autoSaveRef.current.ready = false;
          return;
      }
      if (!autoSaveRef.current.ready) {
          autoSaveRef.current.ready = true;
          return;
      }
      const timerId = setTimeout(() => {
          savePlan({ silent: true });
      }, 1200);
      return () => clearTimeout(timerId);
  }, [projectPath, savePlan]);

  useEffect(() => {
      const handler = (event) => {
          const target = event.target;
          const tag = target?.tagName?.toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

          if (event.key === '?' || (event.shiftKey && event.key === '/')) {
              event.preventDefault();
              setShowShortcuts((prev) => !prev);
              return;
          }

          if (event.key.toLowerCase() === 'h' || event.code === 'KeyH') {
              setActiveTab('home');
          }
          if (event.key.toLowerCase() === 'p' || event.code === 'KeyP') {
              setActiveTab('projects');
          }
          if (event.key.toLowerCase() === 'd' || event.code === 'KeyD') {
              setActiveTab('data');
          }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
  }, [setActiveTab]);

  const importPlan = () => {
      if (!projectPath) return notify('error', 'Import Failed', 'Select project first');
      setPlanPickerOpen(true);
  };

  const loadPlanFromPath = async (filePath, fileName) => {
      try {
          const res = await fetch(
              `${apiBaseUrl}/read_project_file?path=${encodeURIComponent(filePath)}&projectPath=${encodeURIComponent(projectPath || '')}`
          );
          const d = await res.json();
          if (!d.success) {
              notify('error', 'Import Failed', d.error || 'Could not read plan');
              return;
          }
          const content = JSON.parse(d.content);
          setExperiments(content.experiments || []);
          setPlanName(content.planName || "Loaded");
          if (content.meta) setPlanMeta(content.meta);
          notify('success', 'Imported', fileName || 'Plan');
      } catch {
          notify('error', 'Import Error', 'Failed to load plan');
      }
  };

  if (!projectPath) {
      return (
          <div className="w-full h-screen bg-background text-foreground flex flex-col overflow-hidden">
              <header className="w-full sticky top-0 z-50 border-b border-sidebar-border/60 bg-background/80 backdrop-blur">
                  <div className="flex min-h-[96px] items-center justify-between gap-4 px-4 pt-3 pb-4 sm:px-6 lg:px-8">
                      <div className="flex items-center gap-4">
                          <a
                              href="https://www.lunduniversity.lu.se/lucat/group/v1000219"
                              target="_blank"
                              rel="noreferrer"
                              aria-label="University research group"
                          >
                              <img src={getPublicUrl('university_logo-DarkMode.png')} alt="U" className="h-12 object-contain logo-dark" onError={(e) => {e.target.style.display='none'}} />
                              <img src={getPublicUrl('university_logo-LightMode.png')} alt="U" className="h-12 object-contain logo-light" onError={(e) => {e.target.style.display='none'}} />
                          </a>
                          <div className="h-7 w-px bg-sidebar-border mx-1 hidden md:block"></div>
                          <a
                              href="https://brandogsikring.dk/en/research-and-development/energy-and-transport/validation-in-depth-analysis-and-development-of-available-explosion-models-for-p2x-applications/"
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Institute research project"
                          >
                              <img src={getPublicUrl('institute_logo-DarkMode.png')} alt="I" className="h-12 object-contain logo-dark" onError={(e) => {e.target.style.display='none'}} />
                              <img src={getPublicUrl('institute_logo-LightMode.png')} alt="I" className="h-12 object-contain logo-light" onError={(e) => {e.target.style.display='none'}} />
                          </a>
                          {activeTab === 'projects' && (
                              <div className="ml-3 hidden md:block">
                                  <h1 className="text-lg font-bold text-foreground">Research Projects</h1>
                                  <p className="text-xs text-muted-foreground">
                                      Manage your hydrogen explosion research experiments
                                  </p>
                              </div>
                          )}
                          {activeTab === 'ai' && (
                              <div className="ml-3 hidden md:block">
                                  <h1 className="text-lg font-bold text-foreground">AiRA Workspace</h1>
                                  <p className="text-xs text-muted-foreground">
                                      Artificial Intelligence Research Assistant
                                  </p>
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
                                      LLM-Based Analysis Module
                                  </p>
                              </div>
                          )}
                          {activeTab === 'verification' && (
                              <div className="ml-3 hidden md:block">
                                  <h1 className="text-lg font-bold text-foreground">Verification Workspace</h1>
                                  <p className="text-xs text-muted-foreground">
                                      Dedicated environment to verify app calculations
                                  </p>
                              </div>
                          )}
                      </div>
                      <div className="flex items-center gap-2">
                          <div className="hidden md:flex items-center gap-2">
                              <button
                                  onClick={() => setActiveTab('home')}
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'home' ? 'border-primary bg-primary/15 text-primary' : 'border-border text-foreground hover:border-ring'}`}
                                  title="Home"
                                  aria-label="Home"
                              >
                                  <Home size={16} />
                              </button>
                              <button
                                  onClick={() => setActiveTab('projects')}
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'projects' ? 'border-primary bg-primary/15 text-primary' : 'border-border text-foreground hover:border-ring'}`}
                                  title="Projects"
                                  aria-label="Projects"
                              >
                                  <Layers size={16} />
                              </button>
                              <button
                                  onClick={() => setActiveTab('verification')}
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'verification' ? 'border-primary bg-primary/15 text-primary' : 'border-border text-foreground hover:border-ring'}`}
                                  title="Verification"
                                  aria-label="Verification"
                              >
                                  <ShieldCheck size={16} />
                              </button>
                              <button
                                  onClick={() => setActiveTab('ai')}
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'ai' ? 'border-primary bg-primary/15 text-primary' : 'border-border text-foreground hover:border-ring'}`}
                                  title="AiRA"
                                  aria-label="AiRA"
                              >
                                  <BrainCircuit size={16} />
                              </button>
                          </div>
                          <div className="hidden md:flex items-center gap-3">
                              {activeTab === 'projects' && (
                                  <button
                                      onClick={() => setProjectsRefreshKey((value) => value + 1)}
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-xs font-semibold text-foreground hover:border-ring"
                                      title="Refresh"
                                      aria-label="Refresh"
                                  >
                                      <RefreshCw size={16} />
                                  </button>
                              )}
                              <button
                                  onClick={() => openPicker('open')}
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-xs font-semibold text-foreground hover:border-ring"
                                  title="Open Project"
                                  aria-label="Open Project"
                              >
                                  <FolderOpen size={16} />
                              </button>
                              <button
                                  onClick={() => openPicker('create')}
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-xs font-semibold text-foreground hover:border-ring"
                                  title="Create Project"
                                  aria-label="Create Project"
                              >
                                  <FolderPlus size={16} />
                              </button>
                          </div>
                          <button
                              onClick={() => setIsLight((value) => !value)}
                              className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition"
                              aria-pressed={isLight}
                              role="switch"
                              aria-checked={isLight}
                              title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
                          >
                              <span className={`relative inline-flex h-5 w-9 items-center rounded-full border border-sidebar-border transition ${isLight ? 'bg-primary/25' : 'bg-muted/60'}`}>
                                  <span
                                      className={`inline-flex h-3.5 w-3.5 transform items-center justify-center rounded-full bg-foreground text-background transition ${isLight ? 'translate-x-4' : 'translate-x-1'}`}
                                  >
                                      {isLight ? <Sun size={10} /> : <Moon size={10} />}
                                  </span>
                              </span>
                          </button>
                      </div>
                  </div>
              </header>
              <div className={`w-full px-6 py-10 flex-1 ${activeTab === 'home' ? 'overflow-hidden' : 'overflow-y-auto scroll-smooth'}`}>
                  {activeTab === 'projects' ? (
                      <ProjectsPage
                          onOpenProject={openProjectByPath}
                          onEditProject={(pathValue) => openProjectByPath(pathValue, 'plan')}
                          onCreateProject={() => openPicker('create')}
                          onBackHome={() => setActiveTab('home')}
                          refreshKey={projectsRefreshKey}
                      />
                  ) : activeTab === 'verification' ? (
                      <AppCalculationsVerificationPage />
                  ) : activeTab === 'ai' ? (
                      <AiRAPage
                          projectPath={null}
                          chatHistory={aiChatHistory}
                          setChatHistory={setAiChatHistory}
                          planMeta={{}}
                          checklistState={{}}
                      />
                  ) : (
                          <HomePage
                          onSelectTab={setActiveTab}
                          onOpenProject={() => openPicker('open')}
                          onCreateProject={() => openPicker('create')}
                          onOpenProjectPath={openProjectByPath}
                          allowAira={true}
                          showHeader={false}
                      />
                  )}
              </div>
              <ProjectPickerModal
                  isOpen={picker.open}
                  mode={picker.mode}
                  initialPath={localStorage.getItem('lastProjectPath') || ''}
                  onClose={closePicker}
                  onOpen={(pathValue) => {
                      closePicker();
                      openProjectByPath(pathValue);
                  }}
                  onCreate={(parentPath, projectName) => {
                      closePicker();
                      createProjectAtPath(parentPath, projectName);
                  }}
              />
              <ProjectPickerModal
                  isOpen={dataPicker.open}
                  mode="pick"
                  title={dataPicker.type === 'sim' ? 'Select Simulation Folder' : 'Select Experiments Folder'}
                  confirmLabel="Use Folder"
                  initialPath={projectPath ? `${projectPath}/Raw_Data` : ''}
                  onClose={closeDataPicker}
                  onPick={(pathValue) => {
                      closeDataPicker();
                      handleDataFolderPick(pathValue, dataPicker.type);
                  }}
              />
              <PlanPickerModal
                  isOpen={planPickerOpen}
                  projectPath={projectPath}
                  onClose={() => setPlanPickerOpen(false)}
                  onSelect={(file) => {
                      setPlanPickerOpen(false);
                      loadPlanFromPath(file.path, file.name);
                  }}
              />
              {showShortcuts && (
                  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                      <div className="bg-card border border-border rounded-xl w-[420px] p-6 shadow-sm">
                          <div className="flex items-center justify-between">
                              <h3 className="text-lg font-bold">Keyboard Shortcuts</h3>
                              <button
                                  onClick={() => setShowShortcuts(false)}
                                  className="text-muted-foreground hover:text-foreground"
                              >
                                  <X size={18} />
                              </button>
                          </div>
                          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                              <li className="flex items-center justify-between"><span>Toggle shortcuts</span><span className="font-mono text-foreground">?</span></li>
                              <li className="flex items-center justify-between"><span>Go to Home</span><span className="font-mono text-foreground">H</span></li>
                              <li className="flex items-center justify-between"><span>Go to Projects</span><span className="font-mono text-foreground">P</span></li>
                              <li className="flex items-center justify-between"><span>Go to Import Data</span><span className="font-mono text-foreground">D</span></li>
                          </ul>
                      </div>
                  </div>
              )}
          </div>
      );
  }

  return (
      <div className="w-full h-screen bg-background text-foreground overflow-hidden font-sans flex flex-col relative transition-colors duration-500">
          <UnifiedModal modal={modal} setModal={setModal} />
                    <ProjectPickerModal
                        isOpen={picker.open}
                        mode={picker.mode}
                        initialPath={localStorage.getItem('lastProjectPath') || ''}
                        onClose={closePicker}
                        onOpen={(pathValue) => {
                            closePicker();
                            openProjectByPath(pathValue);
                        }}
                        onCreate={(parentPath, projectName) => {
                            closePicker();
                            createProjectAtPath(parentPath, projectName);
                        }}
                    />
                    <ProjectPickerModal
                        isOpen={dataPicker.open}
                        mode="pick"
                        title={dataPicker.type === 'sim' ? 'Select Simulation Folder' : 'Select Experiments Folder'}
                        confirmLabel="Use Folder"
                        initialPath={projectPath ? `${projectPath}/Raw_Data` : ''}
                        onClose={closeDataPicker}
                        onPick={(pathValue) => {
                            closeDataPicker();
                            handleDataFolderPick(pathValue, dataPicker.type);
                        }}
                    />
                    <PlanPickerModal
                        isOpen={planPickerOpen}
                        projectPath={projectPath}
                        onClose={() => setPlanPickerOpen(false)}
                        onSelect={(file) => {
                            setPlanPickerOpen(false);
                            loadPlanFromPath(file.path, file.name);
                        }}
                    />

                    {/* DASHBOARD HEADER */}
                    <header className="w-full sticky top-0 z-50 border-b border-sidebar-border/60 bg-background/80 backdrop-blur">
                        <div className="w-full min-h-[96px] px-6 pt-6 pb-4">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="flex items-center gap-4">
                                                <a
                                                    href="https://www.lunduniversity.lu.se/lucat/group/v1000219"
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    aria-label="University research group"
                                                >
                                                    <img src={getPublicUrl('university_logo-DarkMode.png')} alt="U" className="h-10 object-contain logo-dark" onError={(e) => {e.target.style.display='none'}} />
                                                    <img src={getPublicUrl('university_logo-LightMode.png')} alt="U" className="h-10 object-contain logo-light" onError={(e) => {e.target.style.display='none'}} />
                                                </a>
                                                <div className="h-8 w-px bg-sidebar-border mx-1 hidden md:block"></div> 
                                                <a
                                                    href="https://brandogsikring.dk/en/research-and-development/energy-and-transport/validation-in-depth-analysis-and-development-of-available-explosion-models-for-p2x-applications/"
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    aria-label="Institute research project"
                                                >
                                                    <img src={getPublicUrl('institute_logo-DarkMode.png')} alt="I" className="h-10 object-contain logo-dark" onError={(e) => {e.target.style.display='none'}} />
                                                    <img src={getPublicUrl('institute_logo-LightMode.png')} alt="I" className="h-10 object-contain logo-light" onError={(e) => {e.target.style.display='none'}} />
                                                </a>
                                            <div className="ml-4">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <h1
                                                        className="text-xl font-bold text-foreground flex items-center gap-2 cursor-pointer hover:text-primary transition"
                                                        title={projectPath}
                                                        aria-label={`Project path: ${projectPath}`}
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={openProjectFolder}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter' || event.key === ' ') {
                                                                event.preventDefault();
                                                                openProjectFolder();
                                                            }
                                                        }}
                                                    >
                                                        <FlaskConical className="text-foreground"/><Activity className="text-red-500"/> 
                                                        {projectPath.split(/[/\\]/).pop()}
                                                    </h1>
                                                    <span
                                                        className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-full border ${
                                                            projectStatus === 'active'
                                                                ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10'
                                                                : projectStatus === 'archived'
                                                                ? 'border-muted text-muted-foreground bg-muted/20'
                                                                : 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                                                        }`}
                                                    >
                                                        {projectStatus}
                                                    </span>
                                                </div>
                                                
                                            </div>
                                        </div>
                                    <div className="flex items-center gap-3">
                                            <div className="hidden md:flex items-center gap-2">
                                                <button
                                                    onClick={() => setActiveTab('home')}
                                                    className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'home' ? 'border-primary bg-primary/15 text-primary' : 'border-border text-foreground hover:border-ring'}`}
                                                    title="Home"
                                                    aria-label="Home"
                                                >
                                                    <Home size={16} />
                                                </button>
                                                <button
                                                    onClick={() => setActiveTab('projects')}
                                                    className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'projects' ? 'border-primary bg-primary/15 text-primary' : 'border-border text-foreground hover:border-ring'}`}
                                                    title="Projects"
                                                    aria-label="Projects"
                                                >
                                                    <Layers size={16} />
                                                </button>
                                                <button
                                                    onClick={() => setActiveTab('verification')}
                                                    className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'verification' ? 'border-primary bg-primary/15 text-primary' : 'border-border text-foreground hover:border-ring'}`}
                                                    title="Verification"
                                                    aria-label="Verification"
                                                >
                                                    <ShieldCheck size={16} />
                                                </button>
                                                <button
                                                    onClick={() => setActiveTab('ai')}
                                                    className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'ai' ? 'border-primary bg-primary/15 text-primary' : 'border-border text-foreground hover:border-ring'}`}
                                                    title="AiRA"
                                                    aria-label="AiRA"
                                                >
                                                    <BrainCircuit size={16} />
                                                </button>
                                            </div>
                                            <div className="hidden md:flex items-center gap-2">
                                                <button
                                                    onClick={() => setProjectsRefreshKey((value) => value + 1)}
                                                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-xs font-semibold text-foreground hover:border-ring"
                                                    title="Refresh"
                                                    aria-label="Refresh"
                                                >
                                                    <RefreshCw size={16} />
                                                </button>
                                                <button
                                                    onClick={() => openPicker('open')}
                                                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-xs font-semibold text-foreground hover:border-ring"
                                                    title="Open Project"
                                                    aria-label="Open Project"
                                                >
                                                    <FolderOpen size={16} />
                                                </button>
                                                <button
                                                    onClick={() => openPicker('create')}
                                                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-xs font-semibold text-foreground hover:border-ring"
                                                    title="Create Project"
                                                    aria-label="Create Project"
                                                >
                                                    <FolderPlus size={16} />
                                                </button>
                                            </div>
                                            <button
                                                onClick={() => setIsLight((value) => !value)}
                                                className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition"
                                                aria-pressed={isLight}
                                                role="switch"
                                                aria-checked={isLight}
                                                title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
                                            >
                                                <span className={`relative inline-flex h-5 w-9 items-center rounded-full border border-sidebar-border transition ${isLight ? 'bg-primary/25' : 'bg-muted/60'}`}>
                                                    <span
                                                        className={`inline-flex h-3.5 w-3.5 transform items-center justify-center rounded-full bg-foreground text-background transition ${isLight ? 'translate-x-4' : 'translate-x-1'}`}
                                                    >
                                                        {isLight ? <Sun size={10} /> : <Moon size={10} />}
                                                    </span>
                                                </span>
                                            </button>
                                            <div className="hidden md:block text-[10px] text-muted-foreground uppercase tracking-widest">
                                                Press ? for shortcuts
                                            </div>
                                            <div className="hidden md:block text-[10px] text-muted-foreground uppercase tracking-widest">
                                                {formatLastSaved(lastSavedAt)}
                                            </div>
                                            <button 
                                                onClick={handleCloseProject} 
                                                className="text-[10px] font-bold uppercase tracking-widest bg-red-500/15 px-4 py-2 rounded border border-red-500/40 hover:bg-red-500/25 transition-all shadow-sm text-red-500 flex items-center gap-2"
                                            >
                                                <X size={12} /> Close Project
                                            </button>
                                    </div>
                            </div>

                            {/* MAIN NAVIGATION */}
                            <nav className="mt-4 flex flex-wrap gap-2 pb-3">
                                        {[
                                            {id:'checklist', l:'Checklist', i:ClipboardList, to: TAB_PATHS.checklist},
                                            {id:'plan', l:'Plan', i:FileSpreadsheet, to: TAB_PATHS.plan}, 
                                            {id:'gas', l:'Gas Mixing', i:FlaskConical, to: TAB_PATHS.gas}, 
                                            {id:'data', l:'Import Data', i:Import, to: TAB_PATHS.data}, 
                                            {id:'data_preprocessing', l:'Data Preprocessing', i:FolderOpen, to: TAB_PATHS.data_preprocessing},
                                            {id:'ewt', l:'EWT', i:AudioLines, to: TAB_PATHS.ewt},
                                            {id:'pressure_analysis', l:'Pressure Analysis', i:Activity, to: TAB_PATHS.pressure_analysis}, 
                                            {id:'cfd_validation', l:'CFD Validation', i:Beaker, to: TAB_PATHS.cfd_validation},
                                            {id:'flame_speed', l:'Flame Speed Analysis', i:Flame, to: TAB_PATHS.flame_speed},
                                            {id:'ai', l:'AiRA', i:BrainCircuit, to: TAB_PATHS.ai},
                                            {id:'report', l:'Report', i:FileText, to: TAB_PATHS.report},
                                            {id:'resources', l:'Literature', i:BookOpen, to: TAB_PATHS.resources}
                                    ].map(t=>{
                                            const isActive = activeTab === t.id;
                                            return (
                                                    <NavLink 
                                                        key={t.id} 
                                                        to={t.to} 
                                                        title={t.id === 'ewt' ? 'Empirical Wavelet Transform filter data analysis' : undefined}
                                                        aria-label={t.id === 'ewt' ? 'Empirical Wavelet Transform filter data analysis' : t.l}
                                                        className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-semibold transition ${isActive ? 'border-primary bg-primary/15 text-primary' : 'border-sidebar-border text-muted-foreground hover:border-primary/60 hover:text-foreground'}`}
                                                    >
                                                        <t.i size={16} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                                                        <span className="tracking-wide">{t.l}</span>
                                                    </NavLink>
                                            );
                                    })}
                            </nav>
                        </div>
                    </header>

          <div className={`w-full p-6 flex-1 animate-in fade-in slide-in-from-bottom-2 duration-700 relative z-0 ${activeTab === 'home' ? 'overflow-hidden' : 'overflow-y-auto scroll-smooth'}`}>
              {activeTab === 'home' && (
                  <SafeComponent>
                      <Suspense fallback={<TabFallback />}>
                          <HomePage onSelectTab={setActiveTab} onOpenProjectPath={openProjectByPath} showHeader={false} />
                      </Suspense>
                  </SafeComponent>
              )}

              {activeTab === 'projects' && (
                  <SafeComponent>
                      <Suspense fallback={<TabFallback />}>
                          <ProjectsPage
                              activeProjectPath={projectPath}
                              onEditProject={(pathValue) => openProjectByPath(pathValue, 'plan')}
                          />
                      </Suspense>
                  </SafeComponent>
              )}
              {activeTab === 'verification' && (
                  <SafeComponent>
                      <Suspense fallback={<TabFallback />}>
                          <AppCalculationsVerificationPage />
                      </Suspense>
                  </SafeComponent>
              )}

              {activeTab === 'checklist' && (
                  <SafeComponent>
                      <Suspense fallback={<TabFallback />}>
                          <ChecklistPage checklistState={checklistState} setChecklistState={setChecklistState} />
                      </Suspense>
                  </SafeComponent>
              )}

              {activeTab === 'plan' && FLAGS.ENABLE_PLAN && (
                  <SafeComponent>
                      <Suspense fallback={<TabFallback />}>
                          <PlanPage 
                              experiments={experiments} setExperiments={setExperiments} 
                              planName={planName} setPlanName={setPlanName} 
                              planMeta={planMeta} setPlanMeta={setPlanMeta}
                              saveFormat={saveFormat} setSaveFormat={setSaveFormat} 
                              projectPath={projectPath}
                              onSave={savePlan} onImport={importPlan}
                          />
                      </Suspense>
                  </SafeComponent>
              )}

              {activeTab === 'gas' && (
                  <SafeComponent>
                      <Suspense fallback={<TabFallback />}>
                          <GasMixingPage 
                              projectPath={projectPath} 
                              checklistState={checklistState} 
                              setChecklistState={setChecklistState} 
                          />
                      </Suspense>
                  </SafeComponent>
              )}

              {activeTab === 'data' && FLAGS.ENABLE_SOURCES && (
                                    <SafeComponent>
                                        <Suspense fallback={<TabFallback />}>
                                            <ImportDataPage 
                                                    projectPath={projectPath}
                                                    onSimFolderSelect={onSimFolder} 
                                                    onExpFolderSelect={onExpFolder} 
                                                    onOpenSimPicker={() => openDataPicker('sim')}
                                                    onOpenExpPicker={() => openDataPicker('exp')}
                                                    onOpenFlamePicker={onOpenFlamePicker}
                                                    sessionFiles={sessionFiles} 
                                                    expFiles={expFiles} 
                                                    selectedExpFolder={selectedExpFolder}
                                                    selectedFlameFolder={selectedFlameFolder}
                                                    simulationData={simulationData} 
                                                    selectedCases={selectedCases} 
                                                    experimentalData={experimentalData} 
                                                    onSelectionChange={onFileSelect} 
                                                    onRemoveCase={onRemoveCase} 
                                                    onToggleCase={onToggleCase} 
                                                    formatName={formatName} 
                                            />
                                        </Suspense>
                                        <ProjectPickerModal
                                                isOpen={flamePicker.open}
                                                mode="pick"
                                                title="Select Flame Folder"
                                                confirmLabel="Use Folder"
                                                initialPath={projectPath ? `${projectPath}/Raw_Data` : ''}
                                                onClose={closeFlamePicker}
                                                onPick={handleFlameFolderPick}
                                        />
                                    </SafeComponent>
              )}
              {activeTab === 'data_preprocessing' && FLAGS.ENABLE_SOURCES && (
                                    <SafeComponent>
                                        <Suspense fallback={<TabFallback />}>
                                            <DataPreprocessingPage
                                                apiBaseUrl={apiBaseUrl}
                                                projectPath={projectPath}
                                                selectedCases={selectedCases}
                                            />
                                        </Suspense>
                                    </SafeComponent>
              )}

                             {activeTab === 'ewt' && FLAGS.ENABLE_ANALYSIS && (
                                 <SafeComponent>
                                     <Suspense fallback={<TabFallback />}>
                                         <EWTPage
                                             plotData={plotData}
                                             analysisResults={analysisResults}
                                             experimentalData={experimentalData}
                                             isProcessing={isProcessing}
                                             settings={settings}
                                             setSettings={setSettings}
                                             selectedCases={selectedCases}
                                             formatName={formatName}
                                         />
                                     </Suspense>
                                 </SafeComponent>
                             )}
                             {activeTab === 'pressure_analysis' && FLAGS.ENABLE_ANALYSIS && (
                                 <SafeComponent>
                                     <Suspense fallback={<TabFallback />}>
                                         <PressureAnalysisPage
                                             plotData={plotData}
                                             analysisResults={analysisResults}
                                             experimentalData={experimentalData}
                                             selectedCases={selectedCases}
                                             isProcessing={isProcessing}
                                             settings={settings}
                                             setSettings={setSettings}
                                             simulationData={simulationData}
                                             onRunAnalysis={requestAnalysis}
                                             formatName={formatName}
                                         />
                                     </Suspense>
                                 </SafeComponent>
                             )}
                             {activeTab === 'cfd_validation' && FLAGS.ENABLE_ANALYSIS && (
                                 <SafeComponent>
                                     <Suspense fallback={<TabFallback />}>
                                         <CFDValidationPage
                                             plotData={plotData}
                                             analysisResults={analysisResults}
                                             experimentalData={experimentalData}
                                             selectedCases={selectedCases}
                                             isProcessing={isProcessing}
                                             settings={settings}
                                             setSettings={setSettings}
                                             simulationData={simulationData}
                                             onRunAnalysis={requestAnalysis}
                                             formatName={formatName}
                                         />
                                     </Suspense>
                                 </SafeComponent>
                             )}
                             {activeTab === 'flame_speed' && FLAGS.ENABLE_ANALYSIS && (
                                 <SafeComponent>
                                     <Suspense fallback={<TabFallback />}>
                                         <FlameSpeed
                                             plotData={plotData}
                                             analysisResults={analysisResults}
                                             experimentalData={experimentalData}
                                             isProcessing={isProcessing}
                                             settings={settings}
                                             setSettings={setSettings}
                                         />
                                     </Suspense>
                                 </SafeComponent>
                             )}

              {activeTab === 'ai' && (
                  <SafeComponent>
                      <Suspense fallback={<TabFallback />}>
                          <AiRAPage 
                              projectPath={projectPath} 
                              chatHistory={aiChatHistory} 
                              setChatHistory={setAiChatHistory} 
                              planMeta={planMeta}
                              checklistState={checklistState}
                              />
                      </Suspense>
                  </SafeComponent>
              )}

              {activeTab === 'report' && (
                  <SafeComponent>
                      <Suspense fallback={<TabFallback />}>
                          <ReportPage 
                              experiments={experiments} 
                              checklistState={checklistState} 
                              analysisResults={analysisResults} 
                              planMeta={planMeta} 
                          />
                      </Suspense>
                  </SafeComponent>
              )}

              {activeTab === 'resources' && 
              <SafeComponent>
                  <Suspense fallback={<TabFallback />}>
                    <LiteraturePage 
                        projectPath={projectPath} />
                  </Suspense>
                </SafeComponent>}
          </div>
          {showShortcuts && (
              <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                  <div className="bg-card border border-border rounded-xl w-[420px] p-6 shadow-sm">
                      <div className="flex items-center justify-between">
                          <h3 className="text-lg font-bold">Keyboard Shortcuts</h3>
                          <button
                              onClick={() => setShowShortcuts(false)}
                              className="text-muted-foreground hover:text-foreground"
                          >
                              <X size={18} />
                          </button>
                      </div>
                      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                          <li className="flex items-center justify-between"><span>Toggle shortcuts</span><span className="font-mono text-foreground">?</span></li>
                          <li className="flex items-center justify-between"><span>Go to Home</span><span className="font-mono text-foreground">H</span></li>
                          <li className="flex items-center justify-between"><span>Go to Projects</span><span className="font-mono text-foreground">P</span></li>
                          <li className="flex items-center justify-between"><span>Go to Import Data</span><span className="font-mono text-foreground">D</span></li>
                      </ul>
                  </div>
              </div>
          )}
      </div>
  );
};

export default WorkspacePage;
