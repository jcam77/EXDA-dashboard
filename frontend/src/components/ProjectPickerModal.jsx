import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp, Check, ChevronRight, FileText, Folder, FolderKanban, HardDrive, Home, Monitor, Pencil, RefreshCw, X,
} from 'lucide-react';
import { getBackendBaseUrl } from '../utils/backendUrl';
import ModalPortal from './ModalPortal';
import { folderName, pathCrumbs } from '../utils/pathCrumbs';

const PLACE_ICONS = { projects: FolderKanban, home: Home, desktop: Monitor, documents: FileText, drive: HardDrive };

// Folder picker drawn by EXDA itself (same style as the app). Click selects a
// folder, double-click (or the arrow) opens it; the path can also be typed.
const ProjectPickerModal = ({
  isOpen,
  mode,
  onClose,
  onOpen,
  onCreate,
  onPick,
  initialPath,
  title,
  confirmLabel
}) => {
  const apiBaseUrl = getBackendBaseUrl();
  const [currentPath, setCurrentPath] = useState('');
  const [currentIsProject, setCurrentIsProject] = useState(false);
  const [parentPath, setParentPath] = useState(null);
  const [directories, setDirectories] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [quickPlaces, setQuickPlaces] = useState([]);
  const crumbsRef = useRef(null);

  const fetchDirectories = useCallback(async (pathValue) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(
        `${apiBaseUrl}/list_directories?path=${encodeURIComponent(pathValue || '')}&fallback=nearest`
      );
      const data = await res.json();
      if (Array.isArray(data.quickPlaces)) setQuickPlaces(data.quickPlaces);
      if (!data.success) {
        setError(data.error || 'Unable to read directory');
        return;
      }
      setCurrentPath(data.path);
      setCurrentIsProject(Boolean(data.isProject));
      setParentPath(data.parent);
      setDirectories(data.directories || []);
      setSelected(null);
      setPathInput(data.path);
      setEditingPath(false);
      setNotice(data.notice || '');
    } catch {
      setError('Backend not running?');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!isOpen) return;
    // '' = the default projects folder (callers pass a projects folder, never
    // an old project path; see utils/pickerStart.js).
    fetchDirectories(initialPath || '');
  }, [isOpen, initialPath, fetchDirectories]);

  // Keep the end of a long path in view.
  useEffect(() => {
    if (crumbsRef.current) crumbsRef.current.scrollLeft = crumbsRef.current.scrollWidth;
  }, [currentPath, editingPath]);

  // The folder the main button acts on: the selected one, else the folder you are in.
  const target = selected?.path || currentPath;
  const targetName = folderName(target);
  const targetIsProject = selected ? Boolean(selected.isProject) : currentIsProject;

  const confirm = () => {
    if (!target) return;
    if (mode === 'open') onOpen?.(target);
    else if (mode === 'create') {
      if (projectName.trim()) onCreate?.(target, projectName.trim());
    } else onPick?.(target);
  };

  // Backend notice: "Folder not found: <path>. Showing the nearest existing folder."
  const missingName = notice.startsWith('Folder not found: ')
    ? folderName(notice.slice('Folder not found: '.length).replace(/\. Showing the nearest existing folder\.$/, ''))
    : '';
  const noticeText = missingName ? `"${missingName}" no longer exists here. Showing the nearest folder.` : notice;

  if (!isOpen) return null;

  const crumbs = pathCrumbs(currentPath);
  const defaultTitle = mode === 'create' ? 'Create Project' : mode === 'pick' ? 'Select Folder' : 'Open Project';
  const buttonText = confirmLabel || (mode === 'create' ? 'Create' : mode === 'pick' ? 'Select' : 'Open');
  const targetLabel = mode === 'create' ? 'Create inside' : 'Selected';

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-sidebar-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title || defaultTitle}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground transition hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Where you are: clickable path, or a text box to type/paste a path. */}
          {editingPath ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fetchDirectories(pathInput);
                  if (e.key === 'Escape') { setPathInput(currentPath); setEditingPath(false); }
                }}
                placeholder="Type or paste a folder path"
                className="min-w-0 flex-1 rounded-md border border-sidebar-border bg-input px-3 py-1.5 text-sm text-foreground"
              />
              <button onClick={() => fetchDirectories(pathInput)} className="rounded-md border border-sidebar-border px-3 text-sm">
                Go
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-md border border-sidebar-border bg-input/40 px-1.5 py-1">
              <div ref={crumbsRef} className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-sm">
                {crumbs.map((crumb, index) => {
                  const last = index === crumbs.length - 1;
                  return (
                    <React.Fragment key={crumb.path}>
                      {index > 0 && crumbs[index - 1].label !== '/' && (
                        <ChevronRight size={12} className="shrink-0 text-muted-foreground/60" />
                      )}
                      <button
                        onClick={() => !last && fetchDirectories(crumb.path)}
                        title={crumb.path}
                        className={`shrink-0 rounded px-1.5 py-0.5 ${
                          last ? 'font-semibold text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                        }`}
                      >
                        {crumb.label}
                      </button>
                    </React.Fragment>
                  );
                })}
                {currentIsProject && (
                  <span className="ml-1 shrink-0 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    Project
                  </span>
                )}
              </div>
              <button
                onClick={() => setEditingPath(true)}
                title="Type or paste a path"
                aria-label="Type or paste a path"
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <Pencil size={13} />
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={() => parentPath && fetchDirectories(parentPath)}
              disabled={!parentPath}
              title="Parent folder"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sidebar-border px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <ArrowUp size={12} /> Up
            </button>
            <button
              onClick={() => fetchDirectories(currentPath)}
              title="Refresh"
              aria-label="Refresh"
              className="inline-flex shrink-0 items-center rounded-md border border-sidebar-border p-1.5 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
            {quickPlaces.length > 0 && (
              <>
                <span className="mx-1 h-4 w-px shrink-0 bg-sidebar-border" />
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap">
                  {quickPlaces.map((place) => {
                    const PlaceIcon = PLACE_ICONS[place.kind] || HardDrive;
                    const active = currentPath === place.path;
                    return (
                      <button
                        key={place.path}
                        onClick={() => fetchDirectories(place.path)}
                        title={place.path}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 transition ${
                          active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                        }`}
                      >
                        <PlaceIcon size={12} /> {place.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          {!error && notice && (
            <div className="truncate text-xs text-[hsl(var(--warning))]" title={notice}>
              {noticeText}
            </div>
          )}

          <div className="h-64 overflow-auto rounded-md border border-sidebar-border">
            {directories.length === 0 && !loading && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No subfolders here.</div>
            )}
            {directories.map((dir) => {
              const isSelected = selected?.path === dir.path;
              const RowIcon = dir.isProject ? FolderKanban : Folder;
              return (
                <div
                  key={dir.path}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => setSelected(isSelected ? null : dir)}
                  onDoubleClick={() => fetchDirectories(dir.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') fetchDirectories(dir.path);
                    if (e.key === ' ') { e.preventDefault(); setSelected(dir); }
                  }}
                  className={`group flex cursor-pointer select-none items-center gap-2 border-l-2 px-3 py-1.5 text-sm outline-none ${
                    isSelected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent hover:bg-sidebar-accent focus-visible:bg-sidebar-accent'
                  }`}
                >
                  <RowIcon size={15} className={`shrink-0 ${dir.isProject ? 'text-primary' : 'text-primary/70'}`} />
                  <span className="min-w-0 flex-1 truncate">{dir.name}</span>
                  {dir.isProject && (
                    <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Project
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); fetchDirectories(dir.path); }}
                    title={`Open folder ${dir.name}`}
                    aria-label={`Open folder ${dir.name}`}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-60 hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Click a folder to select it · double-click (or ›) to go inside
          </p>

          {mode === 'create' && (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Project name</label>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
                placeholder="EXDA_Project"
                className="w-full rounded-md border border-sidebar-border bg-input px-3 py-2 text-sm text-foreground"
              />
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-sidebar-border pt-3">
            <div className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground" title={target}>
              <span className="shrink-0">{targetLabel}:</span>
              {targetIsProject && <Check size={12} className="shrink-0 text-primary" />}
              <span className="truncate font-semibold text-foreground">{targetName || '—'}</span>
            </div>
            <button onClick={onClose} className="shrink-0 rounded-md border border-sidebar-border px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={!target || (mode === 'create' && !projectName.trim())}
              className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {buttonText}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};

export default ProjectPickerModal;
