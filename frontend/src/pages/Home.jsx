/* global __APP_VERSION__, __LAST_UPDATED__ */
import React from 'react';
import {
  ArrowRight,
  BarChart3,
  Zap,
  BookOpen,
  Microscope,
  Clock,
  Shield,
  Sun,
  Moon,
  Home,
  Layers,
  BrainCircuit,
  FolderPlus,
  FolderOpen,
} from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';
import { getPublicUrl } from '../utils/assetUrl';
import { getRecentProjects } from '../utils/recentProjects';

const HomePage = ({
  onSelectTab,
  onOpenProject,
  onCreateProject,
  onOpenProjectPath,
  showHeader = true,
  allowAira = true,
}) => {
  const apiBaseUrl = getBackendBaseUrl();
  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const [isLight, setIsLight] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    const root = document.documentElement;
    if (root.classList.contains('light')) return true;
    if (root.classList.contains('dark')) return false;
    const stored = window.localStorage.getItem('exda-theme');
    if (stored === 'light') return true;
    if (stored === 'dark') return false;
    return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ?? false;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const hasLight = root.classList.contains('light');
      setIsLight((prev) => (prev !== hasLight ? hasLight : prev));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', isLight);
    root.classList.toggle('dark', !isLight);
    window.localStorage.setItem('exda-theme', isLight ? 'light' : 'dark');
  }, [isLight]);

  const [recentProjects, setRecentProjects] = React.useState([]);
  const [activeTechCard, setActiveTechCard] = React.useState(null);
  const [showLicenseModal, setShowLicenseModal] = React.useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = React.useState(false);

  const mitLicenseText = `MIT License

Copyright (c) 2026 EXDA-Dashboard contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

  const privacyPolicyText = `Privacy Policy (GDPR)

Effective date: February 20, 2026

This Privacy Policy describes how EXDA-Dashboard processes personal data in connection with the desktop and browser-based application used for explosion research and engineering analysis.

1. Data We Process
- Project metadata (project names, paths, timestamps)
- User-provided research files
- Analysis outputs and derived metrics
- Optional AI chat prompts/responses (when enabled)

2. Purpose
- Load and analyze datasets
- Save and restore project state
- Generate plots/reports
- Support optional AI-assisted workflows

3. Storage and Location
- Local/offline mode: data is primarily processed/stored on your machine.
- If external AI/cloud features are enabled, selected content may be sent to configured providers.

4. Legal Bases (GDPR Art. 6)
- Contract performance, legitimate interests, consent (where required), and legal obligations (as applicable).

5. Data Sharing
- No sale of personal data.
- Sharing only with required service providers, authorized collaborators, or legal authorities when required.

6. Retention
- Data retention depends on deployment and project setup.
- Keep data only as long as needed for analysis purposes.

7. Security
- Reasonable technical/organizational safeguards are applied.
- Avoid uploading unnecessary personal data.

8. Your Rights
- Access, rectification, erasure, restriction, portability, objection, withdrawal of consent, complaint to supervisory authority.

9. Contact
- Add your official privacy contact email in PRIVACY_POLICY.md.

10. Changes
- This policy may be updated; effective date will be revised.

Full version is available in repository file: PRIVACY_POLICY.md`;

  React.useEffect(() => {
    let mounted = true;
    const loadRecent = async () => {
      const storedRecents = getRecentProjects();
      const storedMapped = storedRecents.map((item) => {
        const parts = String(item.path || '').split('/').filter(Boolean);
        const name = parts[parts.length - 1] || item.path || 'Unknown';
        return {
          name,
          path: item.path,
          status: 'recent',
          lastOpened: item.lastOpened || '',
        };
      });
      if (mounted && storedMapped.length > 0) {
        setRecentProjects(storedMapped);
      }
      try {
        let basePath = '';
        const defaultRes = await fetch(`${apiBaseUrl}/list_directories`);
        const defaultData = await defaultRes.json();
        if (defaultData.success && Array.isArray(defaultData.directories) && defaultData.directories.length > 0) {
          basePath = defaultData.path || '';
        }
        const savedFoldersRaw = window.localStorage.getItem('projectsFoldersList');
        const savedFolders = savedFoldersRaw ? JSON.parse(savedFoldersRaw) : [];
        const savedRoot = Array.isArray(savedFolders)
          ? savedFolders.find((item) => typeof item === 'string' || item?.mode !== 'project')
          : null;
        if (!basePath && savedRoot) {
          const candidatePath = typeof savedRoot === 'string' ? savedRoot : savedRoot.path || '';
          if (candidatePath) {
            const savedRes = await fetch(
              `${apiBaseUrl}/list_directories?path=${encodeURIComponent(candidatePath)}`
            );
            const savedData = await savedRes.json();
            if (savedData.success && Array.isArray(savedData.directories) && savedData.directories.length > 0) {
              basePath = savedData.path;
            }
          }
        }
        if (!basePath) return;
        if (demoMode) {
          const demoRes = await fetch(
            `${apiBaseUrl}/list_directories?path=${encodeURIComponent(basePath)}`
          );
          const demoData = await demoRes.json();
          const demoFolder = (demoData.directories || []).find((dir) => dir.name === 'Demo Projects');
          if (demoFolder?.path) {
            const demoProjectsRes = await fetch(
              `${apiBaseUrl}/list_directories?path=${encodeURIComponent(demoFolder.path)}`
            );
            const demoProjectsData = await demoProjectsRes.json();
            const vh2dProject = (demoProjectsData.directories || []).find((dir) => dir.name === 'VH2D-Project');
            basePath = vh2dProject?.path || demoFolder.path;
          }
        }
        const listRes = await fetch(
          `${apiBaseUrl}/list_directories?path=${encodeURIComponent(
            basePath
          )}&includeStatus=1`
        );
        const listData = await listRes.json();
        if (!listData.success) return;
        const recent = (listData.directories || [])
          .map((project) => {
            const status = project.status || {};
            const lastOpened = status.last_opened_at || status.updated_at || status.created_at || '';
            return {
              name: project.name,
              path: project.path,
              status: status.status || 'planning',
              lastOpened,
            };
          })
          .sort((a, b) => new Date(b.lastOpened || 0) - new Date(a.lastOpened || 0))
          .slice(0, 3);
        const mergedMap = new Map();
        [...recent, ...storedMapped].forEach((project) => {
          if (project?.path) mergedMap.set(project.path, project);
        });
        const merged = Array.from(mergedMap.values());
        if (mounted) setRecentProjects(merged);
      } catch {
        if (mounted) {
          setRecentProjects(storedMapped);
        }
      }
    };

    loadRecent();
    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, demoMode]);

  const formatDate = (value) => {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  };
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
  const displayVersion = appVersion.replace(/\.0$/, '');
  const hasUncommittedChanges = /-dirty$/.test(displayVersion);
  const lastUpdatedRaw = typeof __LAST_UPDATED__ !== 'undefined' ? __LAST_UPDATED__ : '';
  const effectiveLastUpdated = hasUncommittedChanges ? new Date().toISOString() : lastUpdatedRaw;
  const lastUpdatedLabel = effectiveLastUpdated ? formatDate(effectiveLastUpdated) : 'Unknown';

  return (
    <div className="w-full h-full overflow-y-auto scroll-smooth snap-y snap-mandatory">
      {showHeader && (
        <header className="w-full sticky top-0 z-50 border-b border-sidebar-border/60 bg-background/80 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-4 pt-0 pb-2 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4">
              <a
                href="https://www.lunduniversity.lu.se/lucat/group/v1000219"
                target="_blank"
                rel="noreferrer"
                aria-label="University research group"
              >
                <img
                  src={getPublicUrl(isLight ? 'university_logo-LightMode.png' : 'university_logo-DarkMode.png')}
                  alt="University"
                  className="h-12 object-contain"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </a>
              <div className="h-7 w-px bg-sidebar-border hidden md:block"></div>
              <a
                href="https://brandogsikring.dk/en/research-and-development/energy-and-transport/validation-in-depth-analysis-and-development-of-available-explosion-models-for-p2x-applications/"
                target="_blank"
                rel="noreferrer"
                aria-label="Institute research project"
              >
                <img
                  src={getPublicUrl(isLight ? 'institute_logo-LightMode.png' : 'institute_logo-DarkMode.png')}
                  alt="Institute"
                  className="h-12 object-contain"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </a>
            </div>
            <div className="flex items-center gap-2">
              {onSelectTab && (
                <div className="hidden md:flex items-center gap-2">
                  <button
                    onClick={() => onSelectTab('home')}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-sidebar-border text-xs font-semibold text-foreground hover:border-primary/60 transition"
                    title="Home"
                    aria-label="Home"
                  >
                    <Home size={14} />
                  </button>
                  <button
                    onClick={() => onSelectTab('projects')}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-sidebar-border text-xs font-semibold text-foreground hover:border-primary/60 transition"
                    title="Projects"
                    aria-label="Projects"
                  >
                    <Layers size={14} />
                  </button>
                  {allowAira && (
                    <button
                      onClick={() => onSelectTab('ai')}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-sidebar-border text-xs font-semibold text-foreground hover:border-primary/60 transition"
                      title="AiRA"
                      aria-label="AiRA"
                    >
                      <BrainCircuit size={14} />
                    </button>
                  )}
                </div>
              )}
              <div className="hidden md:flex items-center gap-3">
                {onOpenProject && (
                  <button
                    onClick={onOpenProject}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-primary/30 text-xs font-semibold text-foreground hover:border-primary/60 transition"
                    title="Open Project"
                    aria-label="Open Project"
                  >
                    <FolderOpen size={16} />
                  </button>
                )}
                {onCreateProject && (
                  <button
                    onClick={onCreateProject}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-primary/30 text-xs font-semibold text-foreground hover:border-primary/60 transition"
                    title="Create Project"
                    aria-label="Create Project"
                  >
                    <FolderPlus size={16} />
                  </button>
                )}
                {!onOpenProject && !onCreateProject && (
                  <>
                    <button
                      onClick={() => onSelectTab('checklist')}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition"
                      title="Start Checklist"
                      aria-label="Start Checklist"
                    >
                      <ArrowRight size={16} />
                    </button>
                    <button
                      onClick={() => onSelectTab('data')}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-primary/30 text-xs font-semibold text-foreground hover:border-primary/60 transition"
                      title="Load Data"
                      aria-label="Load Data"
                    >
                      <BarChart3 size={16} />
                    </button>
                  </>
                )}
              </div>
              <button
                onClick={() => setIsLight((value) => !value)}
                className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition"
                aria-pressed={isLight}
                role="switch"
                aria-checked={isLight}
                title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
              >
                <span className="hidden sm:inline">{isLight ? 'Light' : 'Dark'}</span>
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
      )}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden px-4 sm:px-6 lg:px-8 pt-0 pb-12 snap-start">
        <div className="absolute inset-0 z-0">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/5 rounded-full blur-3xl"></div>
        </div>
        <div className="relative z-10 max-w-5xl mx-auto text-center">
{/*           <img
            src="/h2-Logo-NObackGround-ratio1-002.png"
            alt="Hydrogen illustration"
            className="pointer-events-none absolute left-[-5%] -top-10 w-64 max-w-xs opacity-75 blur-0"
            style={{ zIndex: 1 }}
            decoding="async"
            aria-hidden="true"
          /> */}
          <h1 className="normal-case text-5xl sm:text-6xl lg:text-7xl font-bold mb-4 leading-tight">
            <span className="text-foreground">Hydrogen Explosion</span>
            <br />
            <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Research Platform
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-6 max-w-2xl mx-auto">
{/*             A unified workspace for experimental/simulations planning, data analysis,
            literature management, and AI-assisted research workflows. */}
            Professional analysis and research management system for industrial engineering projects. Analyse experimental data, manage projects, and leverage AI-assisted literature review all in one unified platform.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
            {onSelectTab && (
              <button
                onClick={() => onSelectTab('projects')}
                className="inline-flex items-center gap-2 rounded-md border border-primary/30 px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/60 hover: transition"
              >
                <Layers size={18} /> View Projects
              </button>
            )}
            {onOpenProject && (
              <button
                onClick={onOpenProject}
                className="inline-flex items-center gap-2 rounded-md border border-primary/30 px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/60 hover: transition"
              >
                <FolderOpen size={18} /> Open Project
              </button>
            )}
            {onCreateProject && (
              <button
                onClick={onCreateProject}
                className="inline-flex items-center gap-2 rounded-md border border-primary/30 px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/60 hover: transition"
              >
                <FolderPlus size={18} /> Create Project
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-16 text-sm">
            <div className="p-4 rounded-lg border border-sidebar-border/30 bg-card/50">
              <p className="text-2xl font-bold text-primary">User‑Managed</p>
              <p className="text-muted-foreground text-xs mt-1">Literature Library</p>
            </div>
            <div className="p-4 rounded-lg border border-sidebar-border/30 bg-card/50">
              <p className="text-2xl font-bold text-primary">Interactive</p>
              <p className="text-muted-foreground text-xs mt-1">Data Post‑Processing</p>
            </div>
            <div className="p-4 rounded-lg border border-sidebar-border/30 bg-card/50">
              <p className="text-2xl font-bold text-primary">AI‑Assisted</p>
              <p className="text-muted-foreground text-xs mt-1">Analysis & Reporting</p>
            </div>
          </div>
          {recentProjects.length > 0 && (
            <div className="mt-12 text-left">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Recent Projects</h3>
                <button
                  type="button"
                  onClick={() => onSelectTab?.('projects')}
                  className="text-xs font-semibold text-primary hover:text-primary/80 transition"
                >
                  View All
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {recentProjects.map((project) => (
                  <div
                    key={project.path}
                    className="rounded-xl border border-sidebar-border bg-card/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground" title={project.path}>
                          {project.name}
                        </p>
                        <p className="text-xs text-muted-foreground">Last opened: {formatDate(project.lastOpened)}</p>
                      </div>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {project.status}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenProjectPath?.(project.path, 'plan')}
                      className="mt-4 inline-flex items-center gap-2 rounded-md border border-primary/30 px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/60 transition"
                    >
                      <FolderOpen size={14} /> Open
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-card/20 snap-start">
        <div className="max-w-[90rem] mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">
              Core Capabilities Designed for Researchers
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Everything you need for professional explosion research,
              experimental work, and CFD (Computational Fluid Dynamics) simulation validation
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="rounded-xl border border-sidebar-border bg-card p-8 hover:border-primary/50 transition">
              <div className="w-12 h-12 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center mb-4">
                <BarChart3 className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-bold mb-3">Advanced Analytics</h3>
              <p className="text-muted-foreground">
              Plot Pmax, tmax, impulse, and compare experimental vs. simulation data.
            </p>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-card p-8 hover:border-primary/50 transition">
              <div className="w-12 h-12 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center mb-4">
                <Microscope className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-bold mb-3">Experiment Planning</h3>
              <p className="text-muted-foreground">
              Define matrices, objectives, and experimental metadata with structured plans.
            </p>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-card p-8 hover:border-primary/50 transition">
              <div className="w-12 h-12 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center mb-4">
                <Zap className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-bold mb-3">Signal Processing</h3>
              <p className="text-muted-foreground">
              Apply filtering and data conditioning for robust interpretation.
            </p>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-card p-8 hover:border-primary/50 transition">
              <div className="w-12 h-12 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center mb-4">
                <BrainCircuit className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-bold mb-3">AI Research Assistant</h3>
              <p className="text-muted-foreground">
              AiRA helps summarize literature and guide analysis workflows.
            </p>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-card p-8 hover:border-primary/50 transition">
              <div className="w-12 h-12 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center mb-4">
                <BookOpen className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-bold mb-3">Literature Management</h3>
              <p className="text-muted-foreground">
              Organise books, papers, and standards with searchable structure.
            </p>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-card p-8 hover:border-primary/50 transition">
              <div className="w-12 h-12 rounded-md border border-primary/30 bg-primary/10 flex items-center justify-center mb-4">
                <Clock className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-bold mb-3">Project History</h3>
              <p className="text-muted-foreground">
              Persisted plans, data sessions, and AI logs for repeatable research.
            </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 snap-start">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl sm:text-5xl font-bold text-center mb-4">Unified Workflow</h2>
          <p className="text-center text-lg text-muted-foreground mb-12">
          From experimental and simulation planning to AI-assisted analysis
          </p>
          <div className="space-y-6">
            {[
              {
                title: 'Initialise Project Structure',
                body: 'Create a standardised project hierarchy with Plan/, Raw_Data/, Clean_Data/, Literature/, and aiChat/ directories for organised research management.'
              },
              {
                title: 'Plan & Design Experiments',
                body: 'Define experimental matrices, customisable calculations, and research objectives. Store configuration in JSON format.'
              },
              {
                title: 'Collect & Process Data',
                body: 'Import experimental CSV/TXT/DAT/ASC/ASCII/MF4/TPC5 files and OpenFOAM simulation data. Apply advanced signal processing (EWT: Empirical Wavelet Transform) and filters; time-window optimization is format-dependent.'
              },
              {
                title: 'Analyse & Visualise',
                body: 'Visualise complex metrics and patterns. Create publication-ready charts with interactive dashboards using Recharts and high-resolution uPlot views.'
              },
              {
                title: 'AI-Assisted Research',
                body: 'Leverage AiRA for intelligent literature review and analysis guidance with project-aware, context-rich responses.'
              }
            ].map((step, idx) => (
              <div key={step.title} className="flex gap-6 items-start">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-primary text-primary-foreground font-bold">
                    {idx + 1}
                  </div>
                </div>
                <div className="flex-grow">
                  <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                  <p className="text-muted-foreground">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 px-4 sm:px-6 lg:px-8 bg-card/30 snap-start">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-4xl sm:text-5xl font-bold text-center mb-4">Built on Modern Tech</h2>
          <p className="text-center text-lg text-muted-foreground mb-12">
            Production-ready stack optimised for scientific research
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center justify-between text-[10px] uppercase text-muted-foreground">
                  <span className="px-2 py-1 rounded-md border border-primary/20 bg-primary/10 text-primary">UI</span>
                  <ArrowRight size={12} className="text-primary/60" />
                  <span className="px-2 py-1 rounded-md border border-primary/20 bg-primary/10 text-primary">State</span>
                  <ArrowRight size={12} className="text-primary/60" />
                  <span className="px-2 py-1 rounded-md border border-primary/20 bg-primary/10 text-primary">Charts</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">React + Tailwind + Recharts/uPlot pipeline</p>
              </div>
              <div
                className="rounded-xl border border-sidebar-border bg-card/40 p-8 h-full cursor-pointer hover:border-primary/50 transition"
                onClick={() => setActiveTechCard((prev) => (prev === 'frontend' ? null : 'frontend'))}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveTechCard((prev) => (prev === 'frontend' ? null : 'frontend'));
                  }
                }}
                aria-pressed={activeTechCard === 'frontend'}
              >
                <h3 className="text-xl font-bold mb-4 text-primary">Frontend</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  React 18 + Vite UI layer designed for scientific workflows and fast iteration.
                </p>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  JavaScript (React)
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Vite dev server & bundler
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Recharts visualisation
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  uPlot high-resolution charts
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Marked (Markdown rendering)
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Lucide React icons
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Tailwind CSS dark theme
                </li>
              </ul>
                {activeTechCard === 'frontend' && (
                  <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                    The frontend handles navigation, plan entry, data import, and analysis views. It renders
                    plots with Recharts and uPlot, and supports Markdown responses from AiRA using the marked renderer.
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center justify-between text-[10px] uppercase text-muted-foreground">
                  <span className="px-2 py-1 rounded-md border border-primary/20 bg-primary/10 text-primary">API</span>
                  <ArrowRight size={12} className="text-primary/60" />
                  <span className="px-2 py-1 rounded-md border border-primary/20 bg-primary/10 text-primary">Analysis</span>
                  <ArrowRight size={12} className="text-primary/60" />
                  <span className="px-2 py-1 rounded-md border border-primary/20 bg-primary/10 text-primary">Storage</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Flask + NumPy + Local files</p>
              </div>
              <div
                className="rounded-xl border border-sidebar-border bg-card/40 p-8 h-full cursor-pointer hover:border-primary/50 transition"
                onClick={() => setActiveTechCard((prev) => (prev === 'backend' ? null : 'backend'))}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveTechCard((prev) => (prev === 'backend' ? null : 'backend'));
                  }
                }}
                aria-pressed={activeTechCard === 'backend'}
              >
                <h3 className="text-xl font-bold mb-4 text-primary">Backend</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Flask + Python services for project state, analysis workflows, and AI integration.
                </p>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Flask RESTful API + CORS
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  NumPy signal processing
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Python 3.10+
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Ollama AI integration (Cloud-Powered)
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  PyMuPDF (PDF ingestion, optional)
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Tkinter file dialogs
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={14} className="text-primary" />
                  Local file system access
                </li>
              </ul>
                {activeTechCard === 'backend' && (
                  <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                    The backend manages project folders, plan persistence, signal processing, and AI routing.
                    It exposes REST endpoints for analysis and can reveal project folders on the host OS.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 sm:px-6 lg:px-8 pb-8 snap-start">
        <div className="max-w-6xl mx-auto">
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-warning font-bold text-[11px] uppercase tracking-widest">
              <Shield size={14} />
              Usage Disclaimer
            </div>
            <p className="mt-2 text-sm text-foreground text-justify">
              EXDA-Dashboard is designed to support rapid on-site engineering assessment and preliminary interpretation
              of experimental data during explosion tests. The implemented tools are intended to facilitate timely operational
              decisions (e.g., assessing data quality and determining whether a test repetition may be warranted). Outputs generated
              by the application are therefore indicative and must not be treated as final, publication-grade results or as
              definitive scientific conclusions.
            </p>
            <p className="mt-2 text-xs text-muted-foreground text-justify">
              All results intended for reporting, publication, verification and validation (V&V), or uncertainty quantification (UQ)
              must be independently reviewed and processed using validated workflows outside this application, including appropriate
              documentation of assumptions, processing steps, and uncertainty evaluation.
            </p>
          </div>
        </div>
      </section>

      <section className="py-0 px-4 sm:px-6 lg:px-8 border-t border-sidebar-border/60 snap-start">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-1">
            <h3 className="text-sm font-bold">EXDA-Dashboard</h3>
            <p className="text-[11px] text-muted-foreground mt-1">Explosion Analysis</p>
            <p className="text-[11px] text-muted-foreground mt-2">
              Professional research management system for explosion experiments and modelling data analysis.
            </p>
          </div>
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Product</h4>
            <ul className="mt-1 space-y-0.5 text-[11px] text-foreground">
              <li>Exda-Dashboard</li>
              <li>Project Creation</li>
              <li>Data Analysis</li>
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Resources</h4>
            <ul className="mt-1 space-y-0.5 text-[11px] text-foreground">
              <li>Literature</li>
              <li>AI Research Chat</li>
              <li>Documentation</li>
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">About</h4>
            <ul className="mt-1 space-y-0.5 text-[11px] text-foreground">
              <li>About Us</li>
              <li>Contact</li>
              <li>
                <button
                  type="button"
                  onClick={() => setShowPrivacyModal(true)}
                  className="text-left text-foreground hover:text-primary transition"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setShowLicenseModal(true)}
                  className="text-left text-foreground hover:text-primary transition"
                >
                  MIT License
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-1 flex flex-col md:flex-row md:items-center md:justify-between border-t border-sidebar-border/60 pt-4 text-[10px] text-muted-foreground">
          <span>© 2026 EXDA-Dashboard. All rights reserved.</span>
          <span>Built for explosion research and industrial engineering.</span>
          <span className="inline-block text-xs text-muted-foreground bg-card/70 rounded px-2 py-0.5 mt-1 md:mt-0 md:ml-4">
            EXDA-Dashboard {displayVersion} &nbsp;|&nbsp; Last updated: {lastUpdatedLabel}
          </span>
        </div>
      </section>

      {showLicenseModal && (
        <div
          className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowLicenseModal(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-xl border border-border bg-card p-5 shadow-sm"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="MIT License"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-foreground">MIT License</h3>
              <button
                type="button"
                onClick={() => setShowLicenseModal(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition"
              >
                Close
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground font-mono">
              {mitLicenseText}
            </pre>
          </div>
        </div>
      )}

      {showPrivacyModal && (
        <div
          className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowPrivacyModal(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-xl border border-border bg-card p-5 shadow-sm"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Privacy Policy"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-foreground">Privacy Policy (GDPR)</h3>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition"
              >
                Close
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground font-mono">
              {privacyPolicyText}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;
