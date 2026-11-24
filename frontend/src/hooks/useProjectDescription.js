import { useCallback, useEffect, useState } from 'react';
import { baseVersionFor, isStoreConflict, rememberVersion, FILE_KINDS } from '../utils/fileVersions';

const readRoots = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('projectsFoldersList') || '[]');
    return (Array.isArray(saved) ? saved : [])
      .map((item) => (typeof item === 'string' ? { path: item, mode: 'root' } : item))
      .filter((item) => item?.path && (item.mode || 'root') === 'root')
      .map((item) => item.path);
  } catch {
    return [];
  }
};

// Structured project description (Plan/project_description.json), the standard
// fields, and suggestions for the tag fields from the user's other projects.
export const useProjectDescription = (apiBaseUrl, projectPath) => {
  const [state, setState] = useState({
    loading: true, error: '', description: null, fields: [], source: '', updatedAt: '',
  });
  const [suggestions, setSuggestions] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!apiBaseUrl || !projectPath) {
      setState({ loading: false, error: '', description: null, fields: [], source: '', updatedAt: '' });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const res = await fetch(`${apiBaseUrl}/get_project_description?projectPath=${encodeURIComponent(projectPath)}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not load the project description');
      rememberVersion(projectPath, FILE_KINDS.projectDescription, data.version);
      setState({
        loading: false, error: '', description: data.description, fields: data.fields || [],
        source: data.source, updatedAt: data.updatedAt || '',
      });
    } catch (error) {
      setState({
        loading: false, error: error.message || 'Could not load the project description',
        description: null, fields: [], source: '', updatedAt: '',
      });
    }
  }, [apiBaseUrl, projectPath]);

  const loadSuggestions = useCallback(async () => {
    if (!apiBaseUrl || !projectPath) return;
    try {
      const params = new URLSearchParams({ projectPath });
      readRoots().forEach((root) => params.append('root', root));
      const res = await fetch(`${apiBaseUrl}/project_description_suggestions?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) setSuggestions(data.suggestions || {});
    } catch {
      // Suggestions are optional; typing still works without them.
    }
  }, [apiBaseUrl, projectPath]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  // Returns { ok: true } or { ok: false, error, conflict }.
  const save = useCallback(async (description) => {
    setSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/save_project_description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          description,
          baseVersion: baseVersionFor(projectPath, FILE_KINDS.projectDescription),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return {
          ok: false,
          error: data.error || 'Could not save the project description',
          conflict: isStoreConflict(res, data),
        };
      }
      rememberVersion(projectPath, FILE_KINDS.projectDescription, data.version);
      setState((prev) => ({
        ...prev, loading: false, error: '', description: data.description, source: data.source,
        updatedAt: data.updatedAt || '',
      }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not save the project description', conflict: false };
    } finally {
      setSaving(false);
    }
  }, [apiBaseUrl, projectPath]);

  return { ...state, suggestions, saving, reload: load, save };
};

export default useProjectDescription;
