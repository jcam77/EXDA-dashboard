import { useCallback, useEffect, useState } from 'react';
import { baseVersionFor, isStoreConflict, rememberVersion, FILE_KINDS } from '../utils/fileVersions';

// The project's checklist definition (groups and items) from Reports/checklist.json,
// or EXDA's built-in checklist for older projects without that file.
export const useChecklistDefinition = (apiBaseUrl, projectPath) => {
  const [state, setState] = useState({ loading: true, error: '', checklist: null, source: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!apiBaseUrl || !projectPath) {
      setState({ loading: false, error: '', checklist: null, source: '' });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const res = await fetch(`${apiBaseUrl}/get_checklist?projectPath=${encodeURIComponent(projectPath)}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not load the checklist');
      rememberVersion(projectPath, FILE_KINDS.checklistDefinition, data.version);
      setState({ loading: false, error: '', checklist: data.checklist, source: data.source });
    } catch (error) {
      setState({ loading: false, error: error.message || 'Could not load the checklist', checklist: null, source: '' });
    }
  }, [apiBaseUrl, projectPath]);

  useEffect(() => { load(); }, [load]);

  // Returns { ok: true } or { ok: false, error, conflict }.
  const save = useCallback(async (checklist) => {
    setSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/save_checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          checklist,
          baseVersion: baseVersionFor(projectPath, FILE_KINDS.checklistDefinition),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { ok: false, error: data.error || 'Could not save the checklist', conflict: isStoreConflict(res, data) };
      }
      rememberVersion(projectPath, FILE_KINDS.checklistDefinition, data.version);
      setState({ loading: false, error: '', checklist: data.checklist, source: data.source });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not save the checklist', conflict: false };
    } finally {
      setSaving(false);
    }
  }, [apiBaseUrl, projectPath]);

  return { ...state, saving, reload: load, save };
};

export default useChecklistDefinition;
