import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PathText from '../components/PathText';
import { AlertTriangle, ChevronDown, FolderPlus, Folder, FolderOpen, Folders, Trash2, Search, RefreshCw, Home, Pencil, Copy, X } from 'lucide-react';
import CapabilityCloud from '../components/CapabilityCloud';
import { fetchJsonShared } from '../utils/sharedFetch';
import { folderName } from '../utils/pathCrumbs';
import ProjectPickerModal from '../components/ProjectPickerModal';
import UnifiedModal from '../components/UnifiedModal';
import { getBackendBaseUrl } from '../utils/backendUrl';
import { formatExdaDate } from '../utils/timezone';
import { useAppDialog } from '../hooks/useAppDialog';

const ProjectsPage = ({
  onOpenProject,
  onCreateProject,
  activeProjectPath,
  refreshKey,
}) => {
  const apiBaseUrl = getBackendBaseUrl();
  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Set when the default projects folder lies inside the app folder (older installs).
  const [appFolderWarning, setAppFolderWarning] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Folded project groups (by group folder path), remembered in this browser.
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('projectsCollapsedGroups') || '[]'));
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem('projectsCollapsedGroups', JSON.stringify([...next]));
      } catch {
        // Folding still works for this visit without storage.
      }
      return next;
    });
  };
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const [basePickerMode, setBasePickerMode] = useState('root');
  const [projectFolders, setProjectFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState('all');
  const { dialogModal, setDialogModal, showAlert, showConfirm, showPrompt } = useAppDialog();

  const validateFolderEntry = useCallback(async (item) => {
    const entry = typeof item === 'string' ? { path: item, mode: 'root' } : item;
    const path = (entry?.path || '').trim();
    const mode = entry?.mode || 'root';
    if (!path) return null;

    try {
      if (mode === 'project') {
        const data = await fetchJsonShared(
          `${apiBaseUrl}/get_project_state?projectPath=${encodeURIComponent(path)}`
        );
        return data.success ? { path, mode } : null;
      }

      const data = await fetchJsonShared(
        `${apiBaseUrl}/list_directories?path=${encodeURIComponent(path)}`
      );
      return data.success ? { path, mode } : null;
    } catch {
      return null;
    }
  }, [apiBaseUrl]);

  const locateDefaultProjectsRoot = useCallback(async () => {
    try {
      // Without a path the backend answers for the default projects folder
      // (EXDA-Projects next to the app, or EXDA_PROJECTS_ROOT); 404 if it is missing.
      const data = await fetchJsonShared(`${apiBaseUrl}/list_directories`);
      if (!data.success || !data.path) return null;
      setAppFolderWarning(
        data.insideAppFolder ? { path: data.path, recommended: data.recommendedProjectsRoot } : null
      );
      return { path: data.path, mode: 'root' };
    } catch {
      return null;
    }
  }, [apiBaseUrl]);

  const countProjectsForEntry = useCallback(async (item) => {
    const entry = typeof item === 'string' ? { path: item, mode: 'root' } : item;
    const path = (entry?.path || '').trim();
    const mode = entry?.mode || 'root';
    if (!path) return 0;

    try {
      if (mode === 'project') {
        const data = await fetchJsonShared(
          `${apiBaseUrl}/get_project_state?projectPath=${encodeURIComponent(path)}`
        );
        return data.success ? 1 : 0;
      }

      // Same request as loadProjects below, so the list is fetched once.
      const data = await fetchJsonShared(
        `${apiBaseUrl}/list_projects?path=${encodeURIComponent(path)}`
      );
      if (!data.success) return 0;
      return Array.isArray(data.projects) ? data.projects.length : 0;
    } catch {
      return 0;
    }
  }, [apiBaseUrl]);

  const resolvePreferredProjectFolders = useCallback(async (savedFolders) => {
    const defaultProjectsRoot = await locateDefaultProjectsRoot();
    const defaultProjectCount = defaultProjectsRoot
      ? await countProjectsForEntry(defaultProjectsRoot)
      : 0;

    const normalized = (Array.isArray(savedFolders) ? savedFolders : [])
      .map((item) => {
        if (typeof item === 'string') return { path: item, mode: 'root' };
        return item;
      })
      .filter((item) => item?.path);
    const validated = (await Promise.all(normalized.map(validateFolderEntry))).filter(Boolean);
    const savedProjectCounts = await Promise.all(validated.map(countProjectsForEntry));
    const savedWithProjects = validated.filter((_, index) => savedProjectCounts[index] > 0);

    if (defaultProjectsRoot && defaultProjectCount > 0) {
      return [
        defaultProjectsRoot,
        ...savedWithProjects.filter((item) => item.path !== defaultProjectsRoot.path),
      ];
    }

    return savedWithProjects;
  }, [countProjectsForEntry, locateDefaultProjectsRoot, validateFolderEntry]);

  // force: ask the backend again (Refresh, after a change); otherwise answers
  // fetched a moment ago (e.g. while counting projects) are reused.
  const loadProjects = useCallback(async (paths, { force = false } = {}) => {
    const pathList = Array.isArray(paths) ? paths : [paths].filter(Boolean);
    if (pathList.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const allEntries = [];
      for (const item of pathList) {
        const path = item.path || item;
        if (!path) continue;
        // Projects in the root and inside group folders (e.g. a bigger project
        // holding several test campaigns); see /list_projects in the backend.
        // A single project folder lists only itself; a folder that is not an
        // EXDA project (no exda-project.json) is never shown as a project.
        // Each entry already carries its plan summary (or none if the project
        // has no readable plan), so no further requests are needed per project.
        const data = await fetchJsonShared(
          `${apiBaseUrl}/list_projects?path=${encodeURIComponent(path)}`,
          { force }
        );
        if (!data.success) {
          continue;
        }
        (data.projects || []).forEach((entry) => {
          allEntries.push(entry);
        });
      }

      const mergedMap = new Map();
      allEntries.forEach((project) => {
        mergedMap.set(project.path, project);
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
  }, [apiBaseUrl]);

  useEffect(() => {
    if (projectFolders.length > 0) return;
    const initFolders = async () => {
      const savedFoldersRaw = localStorage.getItem('projectsFoldersList');
      const savedFolders = savedFoldersRaw ? JSON.parse(savedFoldersRaw) : [];
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
      // An empty saved list means the user cleared the folders on purpose (Clear All
      // or removing the last folder). Only a first visit (nothing saved yet) adds
      // the default projects folder automatically.
      if (savedFoldersRaw !== null && Array.isArray(savedFolders) && savedFolders.length === 0) {
        setError('Select a project folder to get started.');
        return;
      }
      const preferredFolders = await resolvePreferredProjectFolders(savedFolders);
      if (preferredFolders.length > 0) {
        setProjectFolders(preferredFolders);
        setSelectedFolder(preferredFolders[0].path);
        localStorage.setItem('projectsFoldersList', JSON.stringify(preferredFolders));
        return;
      }
      localStorage.removeItem('projectsFoldersList');
      setError('Select a project folder to get started.');
    };
    initFolders();
  }, [apiBaseUrl, projectFolders.length, demoMode, resolvePreferredProjectFolders]);

  // The Refresh button changes refreshKey: then the lists are fetched fresh.
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (projectFolders.length === 0) return;
    const force = lastRefreshKey.current !== refreshKey;
    lastRefreshKey.current = refreshKey;
    if (selectedFolder === 'all') {
      loadProjects(projectFolders, { force });
      return;
    }
    const selected = projectFolders.find((item) => item.path === selectedFolder);
    loadProjects(selected || selectedFolder, { force });
  }, [refreshKey, projectFolders, selectedFolder, loadProjects]);

  // After a change (create, rename, copy, archive …) always ask the backend again.
  const reloadProjects = useCallback(() => {
    if (selectedFolder === 'all') {
      return loadProjects(projectFolders, { force: true });
    }
    const selected = projectFolders.find((item) => item.path === selectedFolder);
    return loadProjects(selected || selectedFolder, { force: true });
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
    const formatted = formatExdaDate(value);
    return formatted || value;
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
        group: project.group || '',
        descriptionText: project.descriptionText || '',
        capabilities: project.capabilities || {},
        path: project.path,
        status: statusValue,
        objective: objectiveText,
        description,
        startDate: plan.start_date || plan.created_date || '',
        finishDate: plan.deadline || '',
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
          project.group.toLowerCase().includes(searchQuery.toLowerCase()) ||
          project.descriptionText.toLowerCase().includes(searchQuery.toLowerCase()) ||
          project.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = selectedStatus === 'all' || project.status === selectedStatus;
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  }, [normalizedProjects, searchQuery, selectedStatus, activeProjectPath]);

  // The capabilities cloud follows the loaded folder(s) and the status filter,
  // but not the search, so clicking a word does not shrink the cloud.
  const cloudProjects = useMemo(() => {
    const scopedProjects = activeProjectPath
      ? normalizedProjects.filter((project) => project.path === activeProjectPath)
      : normalizedProjects;
    return scopedProjects.filter((project) => selectedStatus === 'all' || project.status === selectedStatus);
  }, [normalizedProjects, selectedStatus, activeProjectPath]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return 'bg-success/15 text-success border-success/40';
      case 'planning':
        return 'bg-warning/15 text-warning border-warning/40';
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
      await showAlert({
        title: 'Project Is Open',
        content: 'Close the current project before archiving it.',
        type: 'error',
      });
      return;
    }
    const confirmed = await showConfirm({
      title: 'Archive Project?',
      content: `Archive project "${project.name}"? It will be moved to a .trash folder.`,
      type: 'error',
      confirmLabel: 'Archive',
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`${apiBaseUrl}/delete_project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: project.path }),
      });
      const data = await res.json();
      if (!data.success) {
        await showAlert({
          title: 'Archive Failed',
          content: data.error || 'Failed to archive project',
          type: 'error',
        });
        return;
      }
      reloadProjects();
    } catch {
      await showAlert({
        title: 'Archive Failed',
        content: 'Failed to archive project',
        type: 'error',
      });
    }
  };

  const handleRenameProject = async (project) => {
    if (!project?.path) return;
    if (activeProjectPath && project.path === activeProjectPath) {
      await showAlert({
        title: 'Project Is Open',
        content: 'Close the current project before renaming it.',
        type: 'error',
      });
      return;
    }
    const nextName = await showPrompt({
      title: 'Rename Project',
      content: 'Enter the new project name.',
      label: 'Project Name',
      defaultValue: project.name || '',
      placeholder: 'My-Renamed-Project',
      confirmLabel: 'Rename',
      type: 'success',
      confirmVariant: 'primary',
    });
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    if (trimmed === project.name) return;

    try {
      const res = await fetch(`${apiBaseUrl}/rename_project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: project.path,
          newProjectName: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        await showAlert({
          title: 'Rename Failed',
          content: data?.error || 'Failed to rename project',
          type: 'error',
        });
        return;
      }
      reloadProjects();
    } catch {
      await showAlert({
        title: 'Rename Failed',
        content: 'Failed to rename project',
        type: 'error',
      });
    }
  };

  const handleCopyProject = async (project) => {
    if (!project?.path) return;
    const suggestedName = `${project.name || 'Project'}-Copy`;
    const nextName = await showPrompt({
      title: 'Copy Project',
      content: 'Enter a name for the copied project.',
      label: 'Copy Name',
      defaultValue: suggestedName,
      placeholder: 'Project-Copy',
      confirmLabel: 'Create Copy',
      type: 'success',
      confirmVariant: 'primary',
    });
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;

    try {
      const res = await fetch(`${apiBaseUrl}/copy_project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: project.path,
          newProjectName: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        await showAlert({
          title: 'Copy Failed',
          content: data?.error || 'Failed to copy project',
          type: 'error',
        });
        return;
      }
      reloadProjects();
    } catch {
      await showAlert({
        title: 'Copy Failed',
        content: 'Failed to copy project',
        type: 'error',
      });
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
        await showAlert({
          title: 'Status Update Failed',
          content: data.error || 'Failed to update status',
          type: 'error',
        });
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
      await showAlert({
        title: 'Status Update Failed',
        content: `Failed to update status: ${e?.message || 'Unknown error'}`,
        type: 'error',
      });
    }
  };

  // Projects grouped by the folder that holds them (e.g. a bigger project with
  // several campaigns); projects directly in a root come first, without a block.
  const projectSections = (() => {
    // Keyed by the group's folder path, so equal group names under two roots stay apart.
    const sections = [];
    const byGroup = new Map();
    filteredProjects.forEach((project) => {
      const key = project.group ? String(project.path).replace(/[\\/][^\\/]+[\\/]?$/, '') : '';
      if (!byGroup.has(key)) {
        const section = { key, group: project.group, projects: [] };
        byGroup.set(key, section);
        sections.push(section);
      }
      byGroup.get(key).projects.push(project);
    });
    return sections;
  })();

  const renderProjectCard = (project) => (
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
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold uppercase ${getStatusColor(
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

          <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Experiments</p>
              <p className="text-lg font-bold text-primary">{project.experiments}</p>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Start</p>
              <p className="text-sm font-medium text-foreground">
                {formatDate(project.startDate)}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Finish</p>
              <p className="text-sm font-medium text-foreground">
                {formatDate(project.finishDate)}
              </p>
            </div>
          </div>

          <div className="flex gap-2 border-t border-border pt-4">
            <button
              onClick={() => onOpenProject?.(project.path)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary/20 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/30"
            >
              <FolderOpen size={14} /> Open
            </button>
            <button
              onClick={() => handleRenameProject(project)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              title="Rename project"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => handleCopyProject(project)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              title="Copy project"
            >
              <Copy size={14} />
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
  );

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

        <CapabilityCloud
          projects={cloudProjects}
          loading={loading}
          searchQuery={searchQuery}
          onSelectTerm={setSearchQuery}
        />

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
                  localStorage.setItem('projectsFoldersList', '[]');
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
                    {folderName(folder.path)}
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
                    className="rounded-full border border-transparent px-1 text-[11px] text-muted-foreground hover:border-destructive/40 hover:text-destructive"
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
              placeholder="Search projects by name, objective or description (methods, facility, keywords…)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-10 py-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                title="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X size={16} />
              </button>
            )}
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

        {searchQuery.trim() && !loading && (
          <div
            role="status"
            className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm text-foreground"
          >
            <span>
              Showing {filteredProjects.length} of {cloudProjects.length}{' '}
              {cloudProjects.length === 1 ? 'project' : 'projects'} matching{' '}
              <span className="font-semibold text-primary">&ldquo;{searchQuery.trim()}&rdquo;</span>
            </span>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/50 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              <X size={14} />
              Show all
            </button>
          </div>
        )}

        {appFolderWarning && (
          <div role="alert" className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-warning">
              <AlertTriangle size={14} />
              Projects inside the app folder
            </div>
            <p className="mt-2 text-sm text-foreground">
              Your projects are in <PathText className="text-[12px]" path={appFolderWarning.path} />, inside the
              EXDA app folder. Replacing or deleting the app folder for an update would delete them. Close EXDA and move
              them to <PathText className="text-[12px]" path={appFolderWarning.recommended} />, next to the app
              folder. EXDA uses that folder automatically from the next start.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <div className="col-span-full rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
              Loading projects...
            </div>
          ) : filteredProjects.length > 0 ? (
            projectSections.map((section) => {
              if (!section.group) return section.projects.map(renderProjectCard);
              // A search shows every match, so groups unfold while searching.
              const folded = collapsedGroups.has(section.key) && !searchQuery.trim();
              const statusSummary = ['active', 'planning', 'archived']
                .map((status) => [status, section.projects.filter((p) => p.status === status).length])
                .filter(([, count]) => count > 0)
                .map(([status, count]) => `${count} ${status}`)
                .join(' · ');
              return (
                <section
                  key={section.key}
                  className={`col-span-full rounded-2xl border border-primary/25 bg-primary/[0.03] ${folded ? 'px-4 py-2.5 sm:px-5' : 'p-4 sm:p-5'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(section.key)}
                    aria-expanded={!folded}
                    title={folded ? 'Show the projects in this group' : 'Fold this group'}
                    className={`flex w-full items-center gap-2 rounded-lg text-left ${folded ? '' : 'mb-4'}`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                      <Folders className="text-primary" size={16} />
                    </div>
                    <h2 className="truncate text-base font-bold text-foreground" title={section.key}>
                      {section.group.split('/').join(' › ')}
                    </h2>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {section.projects.length} {section.projects.length === 1 ? 'project' : 'projects'}
                      {folded && statusSummary ? ` · ${statusSummary}` : ''}
                    </span>
                    <ChevronDown
                      size={16}
                      className={`ml-auto shrink-0 text-muted-foreground transition-transform ${folded ? '-rotate-90' : ''}`}
                    />
                  </button>
                  {!folded && (
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {section.projects.map(renderProjectCard)}
                    </div>
                  )}
                </section>
              );
            })
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
      <UnifiedModal modal={dialogModal} setModal={setDialogModal} />
    </div>
  );
};

export default ProjectsPage;
