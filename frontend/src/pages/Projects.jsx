import React, { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Folder, FileText, Trash2, Settings, Search, RefreshCw, Home } from 'lucide-react';
import ProjectPickerModal from '../components/ProjectPickerModal';

const ProjectsPage = ({
  onOpenProject,
  onEditProject,
  onCreateProject,
  activeProjectPath,
  refreshKey,
}) => {
  const [basePath, setBasePath] = useState('');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [basePickerOpen, setBasePickerOpen] = useState(false);

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

  const fetchPlanFallback = async (projectPath) => {
    const candidates = [
      `${projectPath}/Plan/Experiment_Plan_v000.json`,
      `${projectPath}/Plan/Experiment_Plan.json`,
      `${projectPath}/Plan/Experiment_Plan_v001.json`,
    ];
    for (const candidate of candidates) {
      try {
        const res = await fetch(
          `http://127.0.0.1:5000/read_project_file?path=${encodeURIComponent(candidate)}&projectPath=${encodeURIComponent(projectPath)}`
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
  };

  const loadProjects = async (path) => {
    if (!path) return;
    setLoading(true);
    setError('');
    try {
      const cacheBuster = Date.now();
      const res = await fetch(
        `http://127.0.0.1:5000/list_directories?path=${encodeURIComponent(
          path
        )}&includeStatus=1&_ts=${cacheBuster}`
      );
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to load projects');
        setProjects([]);
        return;
      }
      const entries = data.directories || [];
      const summaries = await Promise.all(
        entries.map(async (project) => {
          try {
            const summaryRes = await fetch(
              `http://127.0.0.1:5000/project_plan_summary?path=${encodeURIComponent(
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

      const merged = entries.map((project) =>
        summaryMap[project.path] ? { ...project, plan: summaryMap[project.path] } : project
      );

      setProjects(merged);
      return true;
    } catch {
      setError('Failed to load projects');
      setProjects([]);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (basePath) return;
    const initBasePath = async () => {
      const savedBase = localStorage.getItem('projectsBasePath');
      if (savedBase) {
        try {
          const res = await fetch(
            `http://127.0.0.1:5000/list_directories?path=${encodeURIComponent(savedBase)}`
          );
          const data = await res.json();
          if (data.success) {
            setBasePath(data.path);
            return;
          }
        } catch {
          // fall through to default
        }
        localStorage.removeItem('projectsBasePath');
      }
      try {
        const res = await fetch('http://127.0.0.1:5000/list_directories');
        const data = await res.json();
        if (!data.success) return;
        const projectsDir = (data.directories || []).find((dir) => dir.name === 'Projects');
        if (projectsDir?.path) {
          setBasePath(projectsDir.path);
        } else if (data.path) {
          setBasePath(data.path);
        }
      } catch {
        setError('Failed to locate Projects folder');
      }
    };
    initBasePath();
  }, [basePath]);

  useEffect(() => {
    if (!basePath) return;
    loadProjects(basePath);
  }, [refreshKey, basePath]);

  const handlePickBasePath = (pathValue) => {
    setBasePickerOpen(false);
    if (!pathValue) return;
    localStorage.setItem('projectsBasePath', pathValue);
    setBasePath(pathValue);
  };

  const resetBasePath = () => {
    localStorage.removeItem('projectsBasePath');
    setBasePath('');
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
        return 'bg-secondary/20 text-secondary border-secondary/30';
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
      const res = await fetch('http://127.0.0.1:5000/delete_project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: project.path }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Failed to archive project');
        return;
      }
      loadProjects(basePath);
    } catch {
      alert('Failed to archive project');
    }
  };

  const handleStatusChange = async (project, nextStatus) => {
    try {
      const res = await fetch('http://127.0.0.1:5000/update_project_status', {
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
      loadProjects(basePath);
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
            <p className="text-3xl font-bold text-secondary">{totalExperiments}</p>
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
              <span className="text-foreground truncate max-w-[420px]" title={basePath}>
                {basePath || 'Not set'}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setBasePickerOpen(true)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-ring hover:text-foreground"
              >
                Change Folder
              </button>
              <button
                onClick={resetBasePath}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-ring hover:text-foreground"
              >
                Use Default
              </button>
            </div>
          </div>

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

          <div className="flex flex-wrap gap-2">
            {['all', 'active', 'planning', 'archived'].map((status) => (
              <button
                key={status}
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
        title="Select Project Folder"
        confirmLabel="Use Folder"
        initialPath={basePath || localStorage.getItem('projectsBasePath') || ''}
        onClose={() => setBasePickerOpen(false)}
        onPick={handlePickBasePath}
      />
    </div>
  );
};

export default ProjectsPage;
