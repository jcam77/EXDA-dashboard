import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, Folder, FileText, Trash2, Settings, Search, RefreshCw, Home } from 'lucide-react';
import ProjectPickerModal from '../components/ProjectPickerModal';
import { getBackendBaseUrl } from '../utils/backendUrl';

const ProjectsPage = ({
  onOpenProject,
  onEditProject,
  onCreateProject,
  activeProjectPath,
  refreshKey,
}) => {
  const apiBaseUrl = getBackendBaseUrl();
  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const [basePickerMode, setBasePickerMode] = useState('root');
  const [projectFolders, setProjectFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState('all');

  const buildSummaryFromPlan = (data) => {
    if (!data || typeof data !== 'object') return null;
    const experiments = Array.isArray(data.experiments) ? data.experiments : [];
    const doneCount = experiments.filter((exp) => exp?.done).length;
    const total = experiments.length;
    const progress = total ? Math.round((doneCount / total) * 100) : 0;
    const meta = data.meta || {};
    return {
      plan_name: data.planName || 'Experiment_Plan',
      objective: meta.objective || '',
      description: meta.description || '',
      start_date: meta.startDate || '',
      deadline: meta.deadline || '',
      created_date: meta.startDate || '',
      experiments_total: total,
      experiments_done: doneCount,
      progress,
      status: progress >= 100 ? 'archived' : total === 0 ? 'planning' : 'active',
    };
  };

  const fetchPlanFallback = useCallback(async (projectPath) => {
    const candidates = [
      `${projectPath}/Plan/Experiment_Plan_v000.json`,
      `${projectPath}/Plan/Experiment_Plan.json`,
      `${projectPath}/Plan/Experiment_Plan_v001.json`,
    ];
    for (const candidate of candidates) {
      try {
        const res = await fetch(
          `${apiBaseUrl}/read_project_file?path=${encodeURIComponent(candidate)}&projectPath=${encodeURIComponent(projectPath)}`
        );
        const data = await res.json();
        if (data.success && data.content) {
          const planData = JSON.parse(data.content);
          const summary = buildSummaryFromPlan(planData);
          if (summary) return summary;
        }
      } catch {
        continue;
      }
    }
    return null;
  }, [apiBaseUrl]);

  const loadProjects = useCallback(async (paths) => {
    const pathList = Array.isArray(paths) ? paths : [paths].filter(Boolean);
    if (pathList.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const cacheBuster = Date.now();
      const allEntries = [];
      for (const item of pathList) {
        const path = item.path || item;
        const mode = item.mode || 'root';
        if (!path) continue;
        if (mode === 'project') {
          const parts = String(path).split('/').filter(Boolean);
          const name = parts[parts.length - 1] || path;
          allEntries.push({ name, path });
          continue;
        }
        const res = await fetch(
          `${apiBaseUrl}/list_directories?path=${encodeURIComponent(
            path
          )}&includeStatus=1&_ts=${cacheBuster}`
        );
        const data = await res.json();
        if (!data.success) {
          continue;
        }
        (data.directories || []).forEach((entry) => {
          allEntries.push(entry);
        });
      }
      const summaries = await Promise.all(
        allEntries.map(async (project) => {
          try {
            const summaryRes = await fetch(
              `${apiBaseUrl}/project_plan_summary?path=${encodeURIComponent(
                project.path
              )}&_ts=${cacheBuster}`
            );
            const summaryData = await summaryRes.json();
            if (summaryData.success) {
              return { path: project.path, plan: summaryData.plan };
            }
            const fallback = await fetchPlanFallback(project.path);
            if (fallback) {
              return { path: project.path, plan: fallback };
            }
          } catch {
            const fallback = await fetchPlanFallback(project.path);
            if (fallback) {
              return { path: project.path, plan: fallback };
            }
            return null;
          }
          return null;
        })
      );

      const summaryMap = summaries
        .filter(Boolean)
        .reduce((acc, item) => {
          acc[item.path] = item.plan;
          return acc;
        }, {});

      const mergedMap = new Map();
      allEntries.forEach((project) => {
        const enriched = summaryMap[project.path] ? { ...project, plan: summaryMap[project.path] } : project;
        mergedMap.set(project.path, enriched);
      });

      setProjects(Array.from(mergedMap.values()));
      return true;
    } catch {
      setError('Failed to load projects');
      setProjects([]);
      return false;
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, fetchPlanFallback]);

  useEffect(() => {
    if (projectFolders.length > 0) return;
    const initFolders = async () => {
      const savedFoldersRaw = localStorage.getItem('projectsFoldersList');
      const savedFolders = savedFoldersRaw ? JSON.parse(savedFoldersRaw) : [];
      if (Array.isArray(savedFolders) && savedFolders.length > 0) {
        const normalized = savedFolders.map((item) => {
          if (typeof item === 'string') return { path: item, mode: 'root' };
          return item;
        });
        setProjectFolders(normalized);
        setSelectedFolder('all');
        return;
      }
      if (demoMode) {
        try {
          const res = await fetch(`${apiBaseUrl}/list_directories`);
          const data = await res.json();
          if (!data.success) return;
          const projectsDir = (data.directories || []).find((dir) => dir.name === 'Projects');
          if (!projectsDir?.path) return;
          const demoRes = await fetch(
            `${apiBaseUrl}/list_directories?path=${encodeURIComponent(projectsDir.path)}`
          );
          const demoData = await demoRes.json();
          const demoFolder = (demoData.directories || []).find((dir) => dir.name === 'Demo Projects');
          if (!demoFolder?.path) return;
          const demoProjectsRes = await fetch(
            `${apiBaseUrl}/list_directories?path=${encodeURIComponent(demoFolder.path)}`
          );
          const demoProjectsData = await demoProjectsRes.json();
          const vh2dProject = (demoProjectsData.directories || []).find((dir) => dir.name === 'VH2D-Project');
          const resolved = vh2dProject?.path || demoFolder.path;
          setProjectFolders([resolved]);
          setSelectedFolder(resolved);
          return;
        } catch {
          setError('Failed to locate demo projects folder');
          return;
        }
      }
      try {
        const res = await fetch(`${apiBaseUrl}/list_directories`);
        const data = await res.json();
        if (!data.success) return;
        const projectsDir = (data.directories || []).find((dir) => dir.name === 'Projects');
        if (projectsDir?.path) {
          setError('Select a project folder to get started.');
        }
      } catch {
        setError('Select a project folder to get started.');
      }
    };
    initFolders();
  }, [apiBaseUrl, projectFolders.length, demoMode]);

  useEffect(() => {
    if (projectFolders.length === 0) return;
    if (selectedFolder === 'all') {
      loadProjects(projectFolders);
      return;
    }
    const selected = projectFolders.find((item) => item.path === selectedFolder);
    loadProjects(selected || selectedFolder);
  }, [refreshKey, projectFolders, selectedFolder, loadProjects]);

  const reloadProjects = useCallback(() => {
    if (selectedFolder === 'all') {
      return loadProjects(projectFolders);
    }
    const selected = projectFolders.find((item) => item.path === selectedFolder);
    return loadProjects(selected || selectedFolder);
  }, [loadProjects, projectFolders, selectedFolder]);

  const handlePickBasePath = (pathValue) => {
    setBasePickerOpen(false);
    if (!pathValue) return;
    const next = [
      { path: pathValue, mode: basePickerMode },
      ...projectFolders.filter((item) => item.path !== pathValue),
    ];
    setProjectFolders(next);
    setSelectedFolder(pathValue);
    localStorage.setItem('projectsFoldersList', JSON.stringify(next));
  };


  const formatDate = (value) => {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString();
  };

  const normalizedProjects = useMemo(() => {
    const normalizeText = (value) => {
      if (!value) return '';
      const trimmed = String(value).trim();
      if (!trimmed) return '';
      const lowered = trimmed.toLowerCase();
      if (['objective', 'n/a', 'na', 'none', 'tbd', 'todo'].includes(lowered)) return '';
      return trimmed;
    };

    return (projects || []).map((project) => {
      const plan = project.plan || {};
      const statusValue = project.status?.status || plan.status || 'planning';
      const objectiveText = normalizeText(plan.objective);
      const descriptionText = normalizeText(plan.description);
      const description = descriptionText || objectiveText || '';
      return {
        id: project.path,
        name: project.name,
        path: project.path,
        status: statusValue,
        objective: objectiveText,
        description,
        createdDate: plan.created_date || plan.start_date || '',
        experiments: plan.experiments_total || 0,
        progress: Number.isFinite(plan.progress) ? plan.progress : 0,
      };
    });
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const scopedProjects = activeProjectPath
      ? normalizedProjects.filter((project) => project.path === activeProjectPath)
      : normalizedProjects;
    return scopedProjects
      .filter((project) => {
        const matchesSearch =
          project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          project.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = selectedStatus === 'all' || project.status === selectedStatus;
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [normalizedProjects, searchQuery, selectedStatus, activeProjectPath]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'planning':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'archived':
        return 'bg-muted/20 text-muted-foreground border-border';
      default:
        return 'bg-muted/20 text-muted-foreground border-border';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'active':
        return '🟢';
      case 'planning':
        return '📋';
      case 'archived':
        return '📦';
      default:
        return '📁';
    }
  };

  const totalProjects = normalizedProjects.length;
  const activeProjects = normalizedProjects.filter((p) => p.status === 'active').length;
  const totalExperiments = normalizedProjects.reduce((sum, p) => sum + p.experiments, 0);
  const avgCompletion = totalProjects
    ? Math.round(normalizedProjects.reduce((sum, p) => sum + p.progress, 0) / totalProjects)
    : 0;

  const handleDeleteProject = async (project) => {
    if (activeProjectPath && project.path === activeProjectPath) {
      alert('Close the current project before archiving it.');
      return;
    }
    const confirmed = window.confirm(
      `Archive project "${project.name}"? It will be moved to a .trash folder.`
    );
    if (!confirmed) return;
    try {
      const res = await fetch(`${apiBaseUrl}/delete_project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: project.path }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Failed to archive project');
        return;
      }
      reloadProjects();
    } catch {
      alert('Failed to archive project');
    }
  };

  const handleStatusChange = async (project, nextStatus) => {
    try {
      const res = await fetch(`${apiBaseUrl}/update_project_status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: project.path, status: nextStatus }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Failed to update status');
        return;
      }
      setProjects((prev) =>
        prev.map((item) =>
          item.path === project.path
            ? { ...item, status: { ...(item.status || {}), status: nextStatus } }
            : item
        )
      );
      reloadProjects();
    } catch (e) {
      alert(`Failed to update status: ${e?.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="w-full bg-background">
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-6">
            <p className="mb-2 text-sm text-muted-foreground">Total Projects</p>
            <p className="text-3xl font-bold text-primary">{totalProjects}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <p className="mb-2 text-sm text-muted-foreground">Active Projects</p>
            <p className="text-3xl font-bold text-primary">{activeProjects}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <p className="mb-2 text-sm text-muted-foreground">Total Experiments</p>
            <p className="text-3xl font-bold text-primary">{totalExperiments}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <p className="mb-2 text-sm text-muted-foreground">Avg. Completion</p>
            <p className="text-3xl font-bold text-primary">{avgCompletion}%</p>
          </div>
        </div>

        <div className="mb-8 space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Home size={16} className="text-primary" />
              <span className="text-xs font-semibold uppercase text-muted-foreground">Project Folder</span>
              <span className="text-foreground truncate max-w-[420px]" title={selectedFolder}>
                {selectedFolder === 'all' ? 'All folders' : selectedFolder || 'Not set'}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setBasePickerMode('project');
                  setBasePickerOpen(true);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-ring hover:text-foreground"
                title="Add a single project folder (contains Plan/Data/etc.)"
              >
                Add Project Folder
              </button>
              <button
                onClick={() => {
                  setBasePickerMode('root');
                  setBasePickerOpen(true);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-ring hover:text-foreground"
                title="Add a folder that contains multiple projects"
              >
                Add Projects Root
              </button>
              <button
                onClick={() => {
                  setProjectFolders([]);
                  setSelectedFolder('all');
                  localStorage.removeItem('projectsFoldersList');
                  setProjects([]);
                  setError('');
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-ring hover:text-foreground"
              >
                Clear All
              </button>
            </div>
          </div>
          {projectFolders.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedFolder('all')}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  selectedFolder === 'all'
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                All folders
              </button>
              {projectFolders.map((folder) => (
                <div
                  key={folder.path}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selectedFolder === folder.path
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                  title={folder.path}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedFolder(folder.path)}
                    className="text-xs font-semibold"
                  >
                    {folder.path.split('/').filter(Boolean).slice(-1)[0]}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = projectFolders.filter((item) => item.path !== folder.path);
                      setProjectFolders(next);
                      localStorage.setItem('projectsFoldersList', JSON.stringify(next));
                      if (selectedFolder === folder.path) {
                        setSelectedFolder(next.length ? next[0].path : 'all');
                      }
                    }}
                    className="rounded-full border border-transparent px-1 text-[10px] text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                    aria-label={`Remove ${folder.path}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={18}
            />
            <input
              type="text"
              placeholder="Search projects by name or objective..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-10 py-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex flex-wrap gap-2" data-testid="project-status-filters">
            {['all', 'active', 'planning', 'archived'].map((status) => (
              <button
                key={status}
                data-testid={`project-status-filter-${status}`}
                onClick={() => setSelectedStatus(status)}
                className={`rounded-lg border px-4 py-2 text-xs font-semibold transition-colors ${
                  selectedStatus === status
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-ring'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <div className="col-span-full rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
              Loading projects...
            </div>
          ) : filteredProjects.length > 0 ? (
            filteredProjects.map((project) => (
              <div
                key={project.id}
                className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/50"
              >
                <div className="border-b border-border bg-gradient-to-r from-primary/10 to-secondary/10 p-6">
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20">
                        <Folder className="text-primary" size={20} />
                      </div>
                      <span className="mt-1 text-2xl">{getStatusIcon(project.status)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={project.status}
                        onChange={(e) => handleStatusChange(project, e.target.value)}
                        className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase ${getStatusColor(
                          project.status
                        )}`}
                      >
                        <option value="planning">Planning</option>
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-foreground transition-colors group-hover:text-primary">
                    {project.name}
                  </h3>
                </div>

                <div className="space-y-4 p-6">
                  <div className="space-y-2">
                    {project.objective ? (
                      <p className="text-sm text-foreground">
                        <span className="text-xs font-semibold uppercase text-muted-foreground">
                          Objective
                        </span>
                        <br />
                        <span className="line-clamp-2 text-sm text-foreground">
                          {project.objective}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">No objective yet.</p>
                    )}
                    {project.description && project.description !== project.objective && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        <span className="font-semibold uppercase">Description</span>: {project.description}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">Progress</span>
                      <span className="text-xs font-bold text-primary">{project.progress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                        style={{ width: `${project.progress}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Experiments</p>
                      <p className="text-lg font-bold text-primary">{project.experiments}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Created</p>
                      <p className="text-sm font-medium text-foreground">
                        {formatDate(project.createdDate)}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 border-t border-border pt-4">
                    <button
                      onClick={() => onOpenProject?.(project.path)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary/20 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/30"
                    >
                      <FileText size={14} /> View
                    </button>
                    <button
                      onClick={() => onEditProject?.(project.path)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-primary"
                    >
                      <Settings size={14} /> Edit
                    </button>
                    <button
                      onClick={() => handleDeleteProject(project)}
                      className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full rounded-xl border border-border bg-card p-12 text-center">
              <Folder className="mx-auto mb-4 text-muted-foreground" size={48} />
              <h3 className="mb-2 text-lg font-bold text-foreground">No projects found</h3>
              <p className="mb-6 text-sm text-muted-foreground">
                {searchQuery ? 'Try adjusting your search criteria.' : 'Get started by creating your first project.'}
              </p>
              <button
                onClick={onCreateProject}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <FolderPlus size={16} /> Create New Project
              </button>
            </div>
          )}
        </div>
      </main>
      <ProjectPickerModal
        isOpen={basePickerOpen}
        mode="pick"
        title={basePickerMode === 'project' ? 'Select Project Folder' : 'Select Projects Root'}
        confirmLabel={basePickerMode === 'project' ? 'Add Project' : 'Add Root'}
        initialPath={
          (selectedFolder !== 'all' ? selectedFolder : projectFolders[0]?.path) ||
          localStorage.getItem('projectsBasePath') ||
          ''
        }
        onClose={() => setBasePickerOpen(false)}
        onPick={handlePickBasePath}
      />
    </div>
  );
};

export default ProjectsPage;
