import { useCallback, useEffect, useMemo, useState } from 'react';

// Procedure sections that every test campaign must have; RAMS-Appendices and
// Other-Procedures are optional.
export const REQUIRED_PROCEDURE_SECTIONS = ['RAMS', 'SOPs'];

// Procedure documents of the project, read from Procedures/ by the backend.
export const useProcedures = (apiBaseUrl, projectPath) => {
  const [state, setState] = useState({ loading: false, error: '', exists: false, documents: [] });

  const load = useCallback(async () => {
    if (!apiBaseUrl || !projectPath) {
      setState({ loading: false, error: '', exists: false, documents: [] });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const res = await fetch(`${apiBaseUrl}/list_procedures?projectPath=${encodeURIComponent(projectPath)}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not list procedures');
      setState({ loading: false, error: '', exists: Boolean(data.exists), documents: data.documents || [] });
    } catch (error) {
      setState({ loading: false, error: error.message || 'Could not list procedures', exists: false, documents: [] });
    }
  }, [apiBaseUrl, projectPath]);

  useEffect(() => { load(); }, [load]);

  const missingSections = useMemo(
    () => REQUIRED_PROCEDURE_SECTIONS.filter((section) => !state.documents.some((doc) => doc.section === section)),
    [state.documents]
  );

  return { ...state, missingSections, reload: load };
};

export default useProcedures;
