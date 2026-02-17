import React, { useCallback, useEffect, useState } from 'react';
import { getBackendBaseUrl } from '../utils/backendUrl';

const PlanPickerModal = ({ isOpen, projectPath, onClose, onSelect }) => {
  const apiBaseUrl = getBackendBaseUrl();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchPlans = useCallback(async () => {
    if (!projectPath) {
      setError('Select a project first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${apiBaseUrl}/list_plan_files?projectPath=${encodeURIComponent(projectPath)}`
      );
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Unable to list plan files');
        setFiles([]);
        return;
      }
      setFiles(data.files || []);
    } catch {
      setError('Backend not running?');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, projectPath]);

  useEffect(() => {
    if (!isOpen) return;
    fetchPlans();
  }, [isOpen, fetchPlans]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-sidebar-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Select Plan File</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button
              onClick={fetchPlans}
              className="rounded-md border border-sidebar-border px-2 py-1"
            >
              Refresh
            </button>
            {loading && <span>Loading...</span>}
            {error && <span className="text-red-400">{error}</span>}
          </div>

          <div className="max-h-64 overflow-auto rounded-md border border-sidebar-border">
            {files.length === 0 && !loading && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No plan files found in the Plan folder.
              </div>
            )}
            {files.map((file) => (
              <button
                key={file.path}
                onClick={() => onSelect?.(file)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-sidebar-accent"
              >
                📄 {file.name}
                {file.modified ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({file.modified})
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-md border border-sidebar-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlanPickerModal;
