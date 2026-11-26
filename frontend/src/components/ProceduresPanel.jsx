import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, FolderOpen, RefreshCw, ShieldCheck } from 'lucide-react';

// Safety procedures of the project (Procedures/: RAMS, RAMS-Appendices, SOPs).
// Read from the folder each time, so new or updated documents appear without
// typing a procedure reference. Styled like the Sensor Mounting reference card.

const APPENDIX_SECTION = 'RAMS-Appendices';

const BUTTON = 'inline-flex items-center gap-1 rounded border border-sidebar-border bg-muted/30 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/60';

const formatDate = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};

// Header badge: how many procedure documents the project has, or which required
// sections are missing (replaces the old fixed "[Proc.Ref. xxx]" text).
export const ProceduresBadge = ({ count, missingSections = [], loading, onClick }) => {
  if (loading) return null;
  const ok = count > 0 && missingSections.length === 0;
  const text = ok
    ? `Safety Procedures: ${count} document${count === 1 ? '' : 's'}`
    : (count === 0 ? 'No safety procedures in this project' : `Safety procedures missing: ${missingSections.join(', ')}`);
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show the safety procedures (bottom of this page)"
      className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-colors ${ok
        ? 'bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20'
        : 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20'}`}
    >
      {ok ? <ShieldCheck size={20} className="text-amber-500" /> : <AlertTriangle size={20} className="text-red-500" />}
      <span className={`text-[11px] font-bold uppercase tracking-widest ${ok ? 'text-amber-500' : 'text-red-500'}`}>{text}</span>
    </button>
  );
};

const ProceduresPanel = ({ apiBaseUrl, projectPath, procedures }) => {
  const { loading, error, exists, documents, missingSections = [], reload } = procedures;
  const [previewPath, setPreviewPath] = useState('');
  const [message, setMessage] = useState('');

  const fileUrl = useCallback((path, download = false) => (
    `${apiBaseUrl}/project_artifact_file?projectPath=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`
  ), [apiBaseUrl, projectPath]);

  const openOnComputer = useCallback(async (path) => {
    setMessage('');
    try {
      const res = await fetch(`${apiBaseUrl}/open_project_item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, path }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not open');
    } catch (err) {
      setMessage(err.message || 'Could not open');
    }
  }, [apiBaseUrl, projectPath]);

  // Section and subfolder headings, in the order the backend sorted the documents.
  // Two columns: main documents (RAMS, SOPs, …) on the left, appendices on the right.
  const columns = useMemo(() => {
    const toRows = (docs) => {
      const out = [];
      let section = null;
      let group = null;
      docs.forEach((doc) => {
        if (doc.section !== section) {
          section = doc.section;
          group = null;
          out.push({ kind: 'section', label: section || 'Procedures', key: `s:${section}` });
        }
        if (doc.group && doc.group !== group) {
          group = doc.group;
          out.push({ kind: 'group', label: group, key: `g:${section}/${group}` });
        }
        out.push({ kind: 'doc', doc, key: `d:${section}/${doc.group}/${doc.name}` });
      });
      return out;
    };
    const main = documents.filter((doc) => doc.section !== APPENDIX_SECTION);
    const appendices = documents.filter((doc) => doc.section === APPENDIX_SECTION);
    return [toRows(main), toRows(appendices)].filter((rows) => rows.length > 0);
  }, [documents]);

  return (
    <div id="safety-procedures" className="mb-8 w-full scroll-mt-4 rounded-xl border border-sidebar-border bg-card/60 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <ShieldCheck size={22} className="text-primary" />
          <div>
            <h2 className="text-lg font-bold tracking-tight uppercase text-foreground">Safety Procedures</h2>
            <p className="text-[11px] text-muted-foreground">RAMS, appendices and SOPs from the project folder Procedures/</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={reload} className={BUTTON} title="Read the folder again">
            <RefreshCw size={12} /> Refresh
          </button>
          <button type="button" onClick={() => openOnComputer('Procedures')} className={BUTTON}>
            <FolderOpen size={12} /> Open folder
          </button>
        </div>
      </div>

      {error && <div className="mb-2 text-[11px] text-red-400">{error}</div>}
      {message && <div className="mb-2 text-[11px] text-red-400">{message}</div>}

      {!loading && !error && missingSections.length > 0 && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">
              {documents.length === 0 ? 'No safety procedures in this project.' : `Missing: ${missingSections.join(', ')}.`}
            </div>
            <div>
              {exists
                ? `Add the documents for this campaign to ${missingSections.map((s) => `Procedures/${s}/`).join(' and ')} (appendices are optional), then click Refresh.`
                : 'The Procedures folder is missing; it is created when the project is opened again.'}
            </div>
          </div>
        </div>
      )}

      {documents.length > 0 && (
        <div className={columns.length > 1 ? 'grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-2' : ''}>
          {columns.map((rows, colIdx) => (
        <div key={colIdx} className="min-w-0 space-y-1">
          {rows.map((row) => {
            if (row.kind === 'section') {
              return <div key={row.key} className="pt-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{row.label}</div>;
            }
            if (row.kind === 'group') {
              return <div key={row.key} className="pl-3 pt-1 text-[11px] font-semibold text-muted-foreground">{row.label}</div>;
            }
            const { doc } = row;
            const pdf = doc.files.find((f) => f.previewable);
            const showing = pdf && previewPath === pdf.path;
            return (
              <div key={row.key} className={doc.group ? 'pl-6' : 'pl-3'}>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sidebar-border/60 bg-background/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-foreground" title={doc.files.map((f) => f.path).join('\n')}>{doc.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {doc.files.map((f) => f.format).join(' · ')}
                      {doc.files[0]?.modified ? ` — modified ${formatDate(doc.files[0].modified)}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {pdf && (
                      <button type="button" onClick={() => setPreviewPath(showing ? '' : pdf.path)} className={BUTTON}>
                        {showing ? 'Hide Preview' : 'Preview'}
                      </button>
                    )}
                    {doc.files.map((file) => (
                      <React.Fragment key={file.path}>
                        {file.previewable ? (
                          <a href={fileUrl(file.path)} target="_blank" rel="noreferrer" className={BUTTON}>Open {file.format}</a>
                        ) : (
                          <button type="button" onClick={() => openOnComputer(file.path)} className={BUTTON}
                            title="Opens in its program on this computer">
                            Open {file.format}
                          </button>
                        )}
                        <a href={fileUrl(file.path, true)} download className={BUTTON}>Download {file.format}</a>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                {showing && (
                  <div className="mt-1 rounded-lg border border-sidebar-border overflow-hidden bg-background">
                    <iframe title={`Preview of ${doc.name}`} src={fileUrl(pdf.path)} className="w-full h-[420px]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProceduresPanel;
