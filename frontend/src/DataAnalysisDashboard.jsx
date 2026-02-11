import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { 
    FlaskConical, AudioLines, ClipboardList, FileSpreadsheet, 
    Folder, Activity, Flame, FolderOpen, BrainCircuit, BotMessageSquare,
    FileText, Beaker, BookOpen, Home, Layers, Sun, Moon, FolderPlus, RefreshCw, X, Import
} from 'lucide-react';

// --- MODULAR IMPORTS ---
import UnifiedModal from './components/UnifiedModal';
import ChecklistPage from './pages/Checklist';
import PlanPage from './pages/Plan';
import GasPage from './pages/Gas';
import DataPage from './pages/Data';
 import AnalysisPage from './pages/Analysis';
import Ewt from './pages/Ewt';
import Filter from './pages/Filter';
import FlameSpeed from './pages/FlameSpeedAnalysis';
import AiPage from './pages/Ai';
import ReportPage from './pages/Report';
import LiteraturePage from './pages/Literature';
import HomePage from './pages/Home';
import ProjectsPage from './pages/Projects';
import ProjectPickerModal from './components/ProjectPickerModal';
import PlanPickerModal from './components/PlanPickerModal';
import { getBackendBaseUrl } from './utils/backendUrl';
import { getPublicUrl } from './utils/assetUrl';
import { recordRecentProject } from './utils/recentProjects';

/**
 * Feature Flags for modular control
 */
const FLAGS = {
    ENABLE_PLAN: true,
    ENABLE_SOURCES: true,
    ENABLE_ANALYSIS: true
};

const TAB_PATHS = {
    home: '/',
    projects: '/projects',
    checklist: '/checklist',
    plan: '/plan',
    gas: '/gas',
    data: '/data',
    ewt: '/analysis/ewt',
    filter: '/analysis/pressure',
    flame_speed: '/analysis/flame',
    ai: '/ai',
    report: '/report',
    resources: '/literature',
};

const resolveTabFromPath = (pathname) => {
    if (pathname === '/' || pathname === '/home') return 'home';
    if (pathname.startsWith('/projects')) return 'projects';
    if (pathname.startsWith('/checklist')) return 'checklist';
    if (pathname.startsWith('/plan')) return 'plan';
    if (pathname.startsWith('/gas')) return 'gas';
    if (pathname.startsWith('/data')) return 'data';
    if (pathname.startsWith('/analysis')) {
        if (pathname.includes('ewt')) return 'ewt';
        if (pathname.includes('flame')) return 'flame_speed';
        return 'filter';
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

const DataAnalysisDashboard = () => {
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
  const [plotData, setPlotData] = useState([]);
  const [analysisResults, setAnalysisResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const [showShortcuts, setShowShortcuts] = useState(false);
  const [settings, setSettings] = useState({ 
    useRaw: false, cutoff: 100, order: 4, impulseDrop: 1.0, 
    showVentLines: true, useShortNames: true,
    ewtNumModes: 5, ewtSelectedPath: '', ewtMaxPoints: 2000,
    pressureTickCount: 10, ewtTickCount: 10
  });
  const [sessionFiles, setSessionFiles] = useState([]);
    const [expFiles, setExpFiles] = useState([]);
    const [selectedExpFolder, setSelectedExpFolder] = useState("");

  const activeTab = resolveTabFromPath(location.pathname) || 'home';
  const setActiveTab = (tab) => {
      const nextPath = TAB_PATHS[tab] || '/';
      setPlotData([]);
      if (location.pathname !== nextPath) {
          navigate(nextPath);
      }
  };

  useEffect(() => {
      if (location.pathname === '/analysis') {
          navigate(TAB_PATHS.filter, { replace: true });
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
  const fetchJsonWithRetry = async (url, options = {}, retries = 4, delayMs = 600) => {
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
  };

  useEffect(() => {
      const syncProject = async () => {
          const resumeOnStartup = localStorage.getItem('resumeOnStartup') === 'true';
          const resumeOnce = localStorage.getItem('resumeOnStartupOnce') === 'true';
          if (!resumeOnStartup && !resumeOnce) return;
          if (resumeOnce) localStorage.removeItem('resumeOnStartupOnce');
          const savedPath = localStorage.getItem('currentProjectPath');
          if (!savedPath) return;

          setProjectPath(savedPath);

          try {
              // Pulse check: Fetch current directory state (Plan and Raw Data) from backend
              const state = await fetchJsonWithRetry(
                  `${apiBaseUrl}/get_project_state?projectPath=${encodeURIComponent(savedPath)}`
              );

              if (state.success) {
                  // 1. Recover the most recent Experiment Plan
                  if (state.plan) {
                      setExperiments(state.plan.experiments || []);
                      setPlanName(state.plan.planName || "Loaded_Plan");
                      if (state.plan.meta) setPlanMeta(state.plan.meta);
                  }
                  
                  // 2. Recover the Data file list from the project folder
                  // This ensures the Data tab doesn't go empty after a browser refresh
                  if (state.data_files) {
                      setExpFiles(state.data_files);
                  }
                  
                  notify('success', 'Project Rehydrated', 'Data and Plan restored from folder.');
              }
          } catch (e) {
              console.error("Critical State Sync Error:", e);
              notify('error', 'Sync Failed', 'Could not restore project state from disk.');
          }
      };

      syncProject();
  }, []); // Run once on mount/refresh

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
      if (pendingTab && TAB_PATHS[pendingTab]) {
          localStorage.removeItem('pendingTab');
          setActiveTab(pendingTab);
      }
  }, [projectPath]);

  useEffect(() => {
      const root = document.documentElement;
      root.classList.toggle('light', isLight);
      window.localStorage.setItem('exda-theme', isLight ? 'light' : 'dark');
  }, [isLight]);

  const notify = (type, title, content) => setModal({ show: true, type, title, content });

  const confirmWithModal = ({
      title,
      content,
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      type = 'error',
      confirmVariant = 'destructive'
  }) => new Promise((resolve) => {
      const closeModal = () => setModal((prev) => ({ ...prev, show: false }));
      setModal({
          show: true,
          type,
          title,
          content,
          actions: [
              {
                  label: cancelLabel,
                  variant: 'ghost',
                  onClick: () => {
                      closeModal();
                      resolve(false);
                  }
              },
              {
                  label: confirmLabel,
                  variant: confirmVariant,
                  onClick: () => {
                      closeModal();
                      resolve(true);
                  }
              }
          ]
      });
  });
  
  const formatName = (p) => {
      if (!p) return "Unknown";
      const parts = p.split(/[/\\]/);
      const name = parts[parts.indexOf('postProcessing') - 1] || parts[0];
      if (!settings.useShortNames) return name;
      const m = name.match(/(VH2D-FMG-\d+).*?-(L\w+)-(D\w+)/);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : name.length>30 ? name.substring(0,27)+'...' : name;
  };
  
  const stringToColor = (str) => `hsl(${Math.abs(str.split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % 360}, 70%, 60%)`;
  const SERIES_COLORS = [
      'hsl(200, 80%, 60%)',
      'hsl(20, 80%, 60%)',
      'hsl(120, 70%, 55%)',
      'hsl(280, 70%, 65%)',
      'hsl(40, 85%, 55%)',
      'hsl(160, 65%, 55%)',
      'hsl(320, 70%, 60%)',
      'hsl(90, 70%, 55%)',
      'hsl(0, 75%, 60%)',
      'hsl(240, 70%, 65%)',
      'hsl(300, 60%, 60%)',
      'hsl(60, 80%, 55%)'
  ];

  const projectStatus = (() => {
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

  const savePlan = async ({ silent = false } = {}) => {
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
  };

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

  const autoSaveRef = useRef({ ready: false, timer: null });
  useEffect(() => {
      if (!projectPath) return;
      if (!autoSaveRef.current.ready) {
          autoSaveRef.current.ready = true;
          return;
      }
      if (autoSaveRef.current.timer) {
          clearTimeout(autoSaveRef.current.timer);
      }
      autoSaveRef.current.timer = setTimeout(() => {
          savePlan({ silent: true });
      }, 1200);
      return () => {
          if (autoSaveRef.current.timer) {
              clearTimeout(autoSaveRef.current.timer);
          }
      };
  }, [experiments, planMeta, planName, saveFormat, projectPath]);

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
  }, []);

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

  const processFile = async (fileObj, type='pressure') => {
      try {
          if (type === 'ewt') {
              const res = await fetch(`${apiBaseUrl}/analyze_ewt`, {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({
                      content: fileObj.content,
                      numModes: settings.ewtNumModes,
                      maxPoints: settings.ewtMaxPoints,
                      kneeModes: 10
                  })
              });
              const d = await res.json();
              if (d.error) throw new Error(d.error);
              const name = formatName(fileObj.path || fileObj.name);
              const colorSeed = fileObj.path || fileObj.name || name;
              return {
                  name: fileObj.name,
                  displayName: name,
                  ewt: d,
                  plotData: d.plot_data || [],
                  energy: d.energy || [],
                  summary: d.summary || {},
                  warning: d.warning || null,
                  color: stringToColor(colorSeed)
              };
          }
          const res = await fetch(`${apiBaseUrl}/analyze_pressure`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ content: fileObj.content, dataType: type, cutoff: settings.cutoff, order: settings.order, useRaw: settings.useRaw, impulseDrop: settings.impulseDrop })
          });
          const d = await res.json();
          if(d.error) throw new Error(d.error);
          const name = formatName(fileObj.path || fileObj.name);
          const colorSeed = fileObj.path || fileObj.name || name;
          if (type === 'flame_speed') return { name: fileObj.name, displayName: name, plotData: d.plot_data, color: stringToColor(colorSeed) };
          let ventTime = null;
          if (type === 'pressure' && fileObj.ventContent) {
               const vRes = await fetch(`${apiBaseUrl}/analyze_vent`, {
                   method: 'POST', headers: {'Content-Type': 'application/json'},
                   body: JSON.stringify({ content: fileObj.ventContent })
               });
               const vData = await vRes.json();
               if(vData.metrics && vData.metrics.tVent !== 'N/A') ventTime = parseFloat(vData.metrics.tVent);
          }
          return { name: fileObj.name, displayName: name, metrics: d.metrics, plotData: d.plot_data, color: stringToColor(colorSeed), ventTime };
      } catch { return null; }
  };

  const runAnalysis = async () => {
      if(selectedCases.length === 0 && !experimentalData && !experimentalFlameData) { 
          setPlotData([]); setAnalysisResults([]); return; 
      }
      setIsProcessing(true);
      const res = [];
      if (activeTab === 'ewt') {
          const candidates = selectedCases.filter(c => c && c.content && c.type !== 'flame');
          if (!settings.ewtSelectedPath) {
              setAnalysisResults([]);
              setPlotData([]);
              setIsProcessing(false);
              return;
          }
          const selected = candidates.find(c => (c.path || c.name) === settings.ewtSelectedPath);
          if (selected) {
              const r = await processFile(selected, 'ewt');
              if (r) res.push(r);
          }
          setAnalysisResults(res);
          setPlotData(res[0]?.plotData || []);
          setIsProcessing(false);
          return;
      }
      for(const c of selectedCases) {
          if(activeTab === 'flame_speed' && c.toaContent) {
              const r = await processFile({name:c.name, path:c.path, content:c.toaContent}, 'flame_speed');
              if(r) res.push(r);
          } else if(['filter'].includes(activeTab)) {
              if (c.type === 'flame') {
                  continue;
              }
              const r = await processFile(c, 'pressure');
              if(r) res.push({ ...r, sourceType: c.type === 'pressure' ? 'experiment' : 'simulation' });
          }
      }
      const seenNames = new Map();
      const uniqueResults = res.map((item, idx) => {
          const base = item.displayName || item.name || 'Series';
          const count = seenNames.get(base) || 0;
          seenNames.set(base, count + 1);
          const displayName = count === 0 ? base : `${base} (${count + 1})`;
          return {
              ...item,
              displayName,
              // Use a fixed palette for clear visual separation.
              color: SERIES_COLORS[idx % SERIES_COLORS.length]
          };
      });
      setAnalysisResults(uniqueResults);
      try {
          const aggregateRes = await fetch(`${apiBaseUrl}/aggregate_plot`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  activeTab,
                  series: uniqueResults.map((item) => ({
                      displayName: item.displayName,
                      plotData: item.plotData,
                  })),
                  experimental: (() => {
                      if (activeTab === 'flame_speed') {
                          const flame = Array.isArray(experimentalData) ? experimentalData.find(d => d.type === 'flame') : null;
                          return flame ? flame.plotData : null;
                      }
                      return null;
                  })(),
              })
          });
          const aggregateData = await aggregateRes.json();
          setPlotData(aggregateData.plotData || []);
      } catch {
          setPlotData([]);
      }
      setIsProcessing(false);
  };

  const [analysisNonce, setAnalysisNonce] = useState(0);
  const requestAnalysis = () => setAnalysisNonce((n) => n + 1);

  useEffect(() => {
      if (activeTab !== 'ewt') return;
      if (!settings.ewtSelectedPath) {
          setPlotData([]);
          setAnalysisResults([]);
          return;
      }
      const t = setTimeout(runAnalysis, 300);
      return () => clearTimeout(t);
  }, [activeTab, settings.ewtSelectedPath, settings.ewtNumModes, settings.ewtMaxPoints]);

  useEffect(() => {
      if (activeTab === 'ewt') return;
      if (analysisNonce === 0) return;
      const t = setTimeout(runAnalysis, 300);
      return () => clearTimeout(t);
  }, [analysisNonce, activeTab]);

  const readFile = (f) => new Promise((res) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsText(f); });

  // --- UPDATED SMART FOLDER HANDLERS ---

const onSimFolder = async (e) => {
      const manualPath = e.target.manualPath; 
      const browserFiles = e.target.files ? Array.from(e.target.files) : null;

      if (manualPath) {
          try {
              // We pass the projectPath and specific folder type to the backend
              const res = await fetch(`${apiBaseUrl}/get_project_state?projectPath=${encodeURIComponent(projectPath)}&sync=true`);
              const state = await res.json();
              if (state.success && state.sim_files) {
                  setSessionFiles(state.sim_files);
                  // Only count files in the selected folder
                  // Only count files in the selected folder that match the simulation selector filter
                  let count = 0;
                  if (manualPath && Array.isArray(state.sim_files)) {
                      count = state.sim_files.filter(f => {
                          const rel = f.webkitRelativePath || f.path || '';
                          // Must be in selected folder and match pTProbes/.../p
                          const inFolder = f.webkitRelativePath ? f.webkitRelativePath.startsWith(manualPath) : (f.path ? f.path.startsWith(manualPath) : false);
                          const isSim = /pTProbes\/.*\/p$/.test(rel);
                          return inFolder && isSim;
                      }).length;
                  } else if (Array.isArray(state.sim_files)) {
                      count = state.sim_files.filter(f => {
                          const rel = f.webkitRelativePath || f.path || '';
                          return /pTProbes\/.*\/p$/.test(rel);
                      }).length;
                  } else {
                      count = 0;
                  }
                  notify('success', 'Simulation Data Found', `${count} valid cases indexed in selected folder.`);
              } else {
                  throw new Error("No simulation files found in the directory.");
              }
          } catch (err) {
              notify('error', 'Sync Failed', err.message || 'Could not scan simulation directory.');
          }
      } else if (browserFiles) {
          setSessionFiles(browserFiles.sort((a,b)=>a.webkitRelativePath.localeCompare(b.webkitRelativePath)));
      }
  };

const onExpFolder = async (e) => {
    const manualPath = e.target.manualPath;
    if (manualPath) {
        setSelectedExpFolder(manualPath);
        // We tell the backend: "Scan ONLY this specific folder I just picked"
        const res = await fetch(`${apiBaseUrl}/get_project_state?projectPath=${encodeURIComponent(projectPath)}&folderPath=${encodeURIComponent(manualPath)}`);
        const state = await res.json();
        if (state.success) {
            setExpFiles(state.data_files);
            // Count only files that would show in the experiment selector for the selected folder
            let count = 0;
            if (manualPath && Array.isArray(state.data_files)) {
                count = state.data_files.filter(f => {
                    if (f.webkitRelativePath) return f.webkitRelativePath.startsWith(manualPath);
                    if (f.path) return f.path.startsWith(manualPath);
                    return false;
                }).length;
            } else {
                count = state.data_files.length;
            }
            notify('success', 'Folder Synced', `${count} files detected in selected directory.`);
        }
    }
};

  const onFileSelect = async (e, type) => {
      const p = e.target.value; 
      if(!p) return;

      if(type==='simulation') {
          // ...existing code...
          const main = sessionFiles.find(f => (f.webkitRelativePath === p || f.path === p));
          if(main) {
              // ...existing code...
              let content, toaContent, ventContent;
              if (main.path) {
                  // ...existing code...
                  const getFile = async (filePath) => {
                      const res = await fetch(`${apiBaseUrl}/read_project_file?path=${encodeURIComponent(filePath)}&projectPath=${encodeURIComponent(projectPath || '')}`);
                      const d = await res.json();
                      return d.success ? d.content : null;
                  };
                  content = await getFile(main.path);
                  const dir = main.path.substring(0, main.path.lastIndexOf('/'));
                  toaContent = await getFile(`${dir}/toaprobs`);
                  ventContent = await getFile(`${dir}/venttoaprob`);
              } else {
                  // ...existing code...
                  content = await readFile(main);
                  const root = main.webkitRelativePath.split('/').slice(0, -2).join('/');
                  const flame = sessionFiles.find(f=>f.webkitRelativePath.startsWith(root) && f.webkitRelativePath.includes('toaprobs'));
                  const vent = sessionFiles.find(f=>f.webkitRelativePath.startsWith(root) && f.webkitRelativePath.includes('venttoaprob'));
                  toaContent = flame ? await readFile(flame) : null;
                  ventContent = vent ? await readFile(vent) : null;
              }
              const newCase = { 
                  name: main.name, 
                  path: main.path || main.webkitRelativePath, 
                  content, 
                  toaContent, 
                  ventContent 
              };
              setSimulationData(prev => [...prev.filter(x=>x.path!==newCase.path), newCase]);
              setSelectedCases(prev => [...prev.filter(x=>x.path!==newCase.path), newCase]);
          }
      } else if(type==='exp_pressure' || type==='exp_flame') {
          const f = expFiles.find(f => (f.webkitRelativePath === p || f.path === p));
          if(f) {
              let content;
              if (f.path) {
                  const res = await fetch(`${apiBaseUrl}/read_project_file?path=${encodeURIComponent(f.path)}&projectPath=${encodeURIComponent(projectPath || '')}`);
                  const d = await res.json();
                  content = d.content;
              } else {
                  content = await readFile(f);
              }
              // Add experiment file to selectedCases for queue/tick sync
              const expCase = { 
                  name: f.name, 
                  path: f.path || f.webkitRelativePath, 
                  content,
                  type: type === 'exp_pressure' ? 'pressure' : 'flame'
              };
              setSelectedCases(prev => {
                  // Avoid duplicates
                  if (prev.some(c => (c.path || c.name) === (expCase.path || expCase.name))) return prev;
                  return [...prev, expCase];
              });
              if (type === 'exp_pressure') {
                  processFile({name: f.name, content}, 'pressure').then(r => {
                      if (r) setExperimentalData(prev => [...prev.filter(d => d.name !== r.name || d.type !== 'pressure'), { ...r, type: 'pressure', path: f.path || f.webkitRelativePath }]);
                  });
              } else {
                  processFile({name: f.name, content}, 'flame_speed').then(r => {
                      if (r) setExperimentalData(prev => [...prev.filter(d => d.name !== r.name || d.type !== 'flame'), { ...r, type: 'flame', path: f.path || f.webkitRelativePath }]);
                  });
              }
          }
      }
      e.target.value = "";
  };



    const onRemoveCase = (path) => {
        setSelectedCases(selectedCases.filter(c => c.path !== path));
        setSimulationData(simulationData.filter(c => c.path !== path));
        setExperimentalData(prev => prev.filter(d => (d.path || d.name) !== path));
    };
  const onToggleCase = (path) => {
      if(selectedCases.find(c=>c.path===path || c.name===path)) {
          setSelectedCases(selectedCases.filter(c=>!(c.path===path || c.name===path)));
      } else {
          // Try to find in simulationData first
          const s = simulationData.find(c=>c.path===path);
          if(s) setSelectedCases([...selectedCases, s]);
          else {
              // Try to find in experimentalData
              const e = experimentalData.find(c=>c.path===path || c.name===path);
              if(e) setSelectedCases([...selectedCases, e]);
          }
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
                      </div>
                      <div className="flex items-center gap-2">
                          <div className="hidden md:flex items-center gap-2">
                              <button
                                  onClick={() => setActiveTab('home')}
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'home' ? 'border-primary bg-primary/15 text-primary shadow-[0_0_12px_rgba(56,189,248,0.25)]' : 'border-border text-foreground hover:border-ring'}`}
                                  title="Home"
                                  aria-label="Home"
                              >
                                  <Home size={16} />
                              </button>
                              <button
                                  onClick={() => setActiveTab('projects')}
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'projects' ? 'border-primary bg-primary/15 text-primary shadow-[0_0_12px_rgba(56,189,248,0.25)]' : 'border-border text-foreground hover:border-ring'}`}
                                  title="Projects"
                                  aria-label="Projects"
                              >
                                  <Layers size={16} />
                              </button>
                              <button
                                  onClick={() => setActiveTab('ai')}
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-md border text-xs font-semibold transition ${activeTab === 'ai' ? 'border-primary bg-primary/15 text-primary shadow-[0_0_12px_rgba(56,189,248,0.25)]' : 'border-border text-foreground hover:border-ring'}`}
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
                  ) : activeTab === 'ai' ? (
                      <AiPage
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
                      <div className="bg-card border border-border rounded-xl w-[420px] p-6 shadow-2xl">
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
                                                                : 'border-secondary/30 text-secondary bg-secondary/10'
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
                                                className="text-[10px] font-bold uppercase tracking-widest bg-red-500/15 px-4 py-2 rounded border border-red-500/40 hover:bg-red-500/25 transition-all shadow-lg text-red-500 flex items-center gap-2"
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
                                            {id:'ewt', l:'EWT', i:AudioLines, to: TAB_PATHS.ewt},
                                            {id:'filter', l:'Pressure Analysis', i:Activity, to: TAB_PATHS.filter}, 
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
                                                        className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-semibold transition ${isActive ? 'border-primary bg-primary/15 text-primary shadow-[0_0_12px_rgba(56,189,248,0.25)]' : 'border-sidebar-border text-muted-foreground hover:border-primary/60 hover:text-foreground'}`}
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
                      <HomePage onSelectTab={setActiveTab} onOpenProjectPath={openProjectByPath} showHeader={false} />
                  </SafeComponent>
              )}

              {activeTab === 'projects' && (
                  <SafeComponent>
                                            <ProjectsPage
                                                activeProjectPath={projectPath}
                                                onEditProject={(pathValue) => openProjectByPath(pathValue, 'plan')}
                                            />
                  </SafeComponent>
              )}

              {activeTab === 'checklist' && (
                  <SafeComponent>
                      <ChecklistPage checklistState={checklistState} setChecklistState={setChecklistState} />
                  </SafeComponent>
              )}

              {activeTab === 'plan' && FLAGS.ENABLE_PLAN && (
                  <SafeComponent>
                      <PlanPage 
                          experiments={experiments} setExperiments={setExperiments} 
                          planName={planName} setPlanName={setPlanName} 
                          planMeta={planMeta} setPlanMeta={setPlanMeta}
                          saveFormat={saveFormat} setSaveFormat={setSaveFormat} 
                          onSave={savePlan} onImport={importPlan}
                      />
                  </SafeComponent>
              )}

              {activeTab === 'gas' && (
                  <SafeComponent>
                                            <GasPage 
                        projectPath={projectPath} 
                        checklistState={checklistState} 
                        setChecklistState={setChecklistState} 
                      />
                  </SafeComponent>
              )}

              {activeTab === 'data' && FLAGS.ENABLE_SOURCES && (
                                    <SafeComponent>
                                        <DataPage 
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

                             {activeTab === 'ewt' && FLAGS.ENABLE_ANALYSIS && (
                                 <SafeComponent>
                                     <Ewt
                                         plotData={plotData}
                                         analysisResults={analysisResults}
                                         experimentalData={experimentalData}
                                         isProcessing={isProcessing}
                                         settings={settings}
                                         setSettings={setSettings}
                                         selectedCases={selectedCases}
                                         formatName={formatName}
                                     />
                                 </SafeComponent>
                             )}
                             {activeTab === 'filter' && FLAGS.ENABLE_ANALYSIS && (
                                 <SafeComponent>
                                 <Filter
                                         plotData={plotData}
                                         analysisResults={analysisResults}
                                         experimentalData={experimentalData}
                                         isProcessing={isProcessing}
                                         settings={settings}
                                         setSettings={setSettings}
                                         simulationData={simulationData}
                                         onRunAnalysis={requestAnalysis}
                                         formatName={formatName}
                                     />
                                 </SafeComponent>
                             )}
                             {activeTab === 'flame_speed' && FLAGS.ENABLE_ANALYSIS && (
                                 <SafeComponent>
                                     <FlameSpeed
                                         plotData={plotData}
                                         analysisResults={analysisResults}
                                         experimentalData={experimentalData}
                                         isProcessing={isProcessing}
                                         settings={settings}
                                         setSettings={setSettings}
                                     />
                                 </SafeComponent>
                             )}

              {activeTab === 'ai' && (
                  <SafeComponent>
                      <AiPage 
                          projectPath={projectPath} 
                          chatHistory={aiChatHistory} 
                          setChatHistory={setAiChatHistory} 
                          planMeta={planMeta}
                          checklistState={checklistState}
                          />
                  </SafeComponent>
              )}

              {activeTab === 'report' && (
                  <SafeComponent>
                                            <ReportPage 
                        experiments={experiments} 
                        checklistState={checklistState} 
                        analysisResults={analysisResults} 
                        planMeta={planMeta} 
                      />
                  </SafeComponent>
              )}

              {activeTab === 'resources' && 
              <SafeComponent>
                <LiteraturePage 
                    projectPath={projectPath} />
                </SafeComponent>}
          </div>
          {showShortcuts && (
              <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                  <div className="bg-card border border-border rounded-xl w-[420px] p-6 shadow-2xl">
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

export default DataAnalysisDashboard;
