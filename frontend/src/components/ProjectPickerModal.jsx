import React, { useEffect, useState } from 'react';

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
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState(null);
  const [directories, setDirectories] = useState([]);
  const [pathInput, setPathInput] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchDirectories = async (pathValue) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `http://127.0.0.1:5000/list_directories?path=${encodeURIComponent(pathValue || '')}`
      );
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Unable to read directory');
        setLoading(false);
        return;
      }
      setCurrentPath(data.path);
      setParentPath(data.parent);
      setDirectories(data.directories || []);
      setPathInput(data.path);
    } catch {
      setError('Backend not running?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const lastPath = initialPath || localStorage.getItem('lastProjectPath') || '';
    fetchDirectories(lastPath);
  }, [isOpen, initialPath]);

  const handleOpen = () => {
    if (!currentPath) return;
    onOpen?.(currentPath);
  };

  const handleCreate = () => {
    if (!currentPath || !projectName.trim()) return;
    onCreate?.(currentPath, projectName.trim());
  };

  const handlePick = () => {
    if (!currentPath) return;
    onPick?.(currentPath);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-sidebar-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">
            {title || (mode === 'create' ? 'Create Project' : mode === 'pick' ? 'Select Folder' : 'Open Project')}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <label className="text-sm text-muted-foreground">Current folder</label>
          <div className="flex gap-2">
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="/path/to/folder"
              className="flex-1 rounded-md border border-sidebar-border bg-input px-3 py-2 text-sm text-foreground"
            />
            <button
              onClick={() => fetchDirectories(pathInput)}
              className="rounded-md border border-sidebar-border px-3 text-sm"
            >
              Go
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button
              onClick={() => parentPath && fetchDirectories(parentPath)}
              className="rounded-md border border-sidebar-border px-2 py-1"
            >
              Up
            </button>
            <button
              onClick={() => fetchDirectories(currentPath)}
              className="rounded-md border border-sidebar-border px-2 py-1"
            >
              Refresh
            </button>
            {loading && <span>Loading...</span>}
            {error && <span className="text-red-400">{error}</span>}
          </div>

          <div className="max-h-64 overflow-auto rounded-md border border-sidebar-border">
            {directories.length === 0 && !loading && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No folders found.</div>
            )}
            {directories.map((dir) => (
              <button
                key={dir.path}
                onClick={() => fetchDirectories(dir.path)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-sidebar-accent"
              >
                📁 {dir.name}
              </button>
            ))}
          </div>

          {mode === 'create' && (
            <div className="space-y-2 pt-2">
              <label className="text-sm text-muted-foreground">Project name</label>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="EXDA_Project"
                className="w-full rounded-md border border-sidebar-border bg-input px-3 py-2 text-sm text-foreground"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-md border border-sidebar-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            {mode === 'open' ? (
              <button
                onClick={handleOpen}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                {confirmLabel || 'Open'}
              </button>
            ) : mode === 'create' ? (
              <button
                onClick={handleCreate}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                {confirmLabel || 'Create'}
              </button>
            ) : (
              <button
                onClick={handlePick}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                {confirmLabel || 'Select'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectPickerModal;
